//! Mandate lifecycle: `create_mandate` → `add_mandate_asset`* → `finalize_mandate`.
//!
//! A Mandate is rules, never money. It is mutable only while `Draft`; after
//! finalization it changes only through the amendment process (Phase 8).

use anchor_lang::prelude::*;

use crate::constants::*;
use crate::errors::TenetError;
use crate::state::{
    AssetClass, AssetRegistryEntry, AssetStatus, Mandate, MandateAsset, MandateState,
    MembershipPolicy,
};

// ---------------------------------------------------------------- create

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct MandateParams {
    pub name: String,
    pub description: String,
    pub max_weight_per_asset_bps: u16,
    pub max_pre_ipo_weight_bps: u16,
    pub max_issuer_weight_bps: u16,
    pub max_underlying_weight_bps: u16,
    pub max_supply_consumption_bps: u16,
    pub max_price_impact_bps: u16,
    pub min_contribution_usdc: u64,
    pub max_pool_size_usdc: u64,
    pub epoch_duration: i64,
    pub membership_policy: MembershipPolicy,
    pub amendment_threshold_bps: u16,
    pub amendment_delay_seconds: i64,
}

#[derive(Accounts)]
pub struct CreateMandate<'info> {
    #[account(mut)]
    pub author: Signer<'info>,

    /// CHECK: any pubkey; used only as a PDA seed so names never collide.
    pub mandate_seed: UncheckedAccount<'info>,

    #[account(
        init,
        payer = author,
        space = 8 + Mandate::INIT_SPACE,
        seeds = [MANDATE_SEED, mandate_seed.key().as_ref()],
        bump,
    )]
    pub mandate: Account<'info, Mandate>,

    pub system_program: Program<'info, System>,
}

/// Every check in `docs/instructions.md` §2 `create_mandate`, in order.
/// Public so the rules can be unit-tested without a VM.
pub fn validate_params(p: &MandateParams) -> Result<()> {
    require!(
        !p.name.is_empty() && p.name.len() <= MAX_MANDATE_NAME_LEN,
        TenetError::InvalidMandateName
    );
    require!(
        p.description.len() <= MAX_MANDATE_DESCRIPTION_LEN,
        TenetError::InvalidMandateDescription
    );
    for bps in [
        p.max_weight_per_asset_bps,
        p.max_pre_ipo_weight_bps,
        p.max_issuer_weight_bps,
        // Not in the original spec list, which predates the underlying cap
        // (V-010, R-23). Same bound, same reason.
        p.max_underlying_weight_bps,
        p.max_supply_consumption_bps,
        p.max_price_impact_bps,
    ] {
        require!(bps as u64 <= BPS_DENOMINATOR, TenetError::InvalidBps);
    }
    require!(
        p.min_contribution_usdc > 0,
        TenetError::InvalidMinContribution
    );
    require!(
        p.max_pool_size_usdc > p.min_contribution_usdc,
        TenetError::InvalidMaxPoolSize
    );
    require!(
        (MIN_EPOCH_DURATION..=MAX_EPOCH_DURATION).contains(&p.epoch_duration),
        TenetError::InvalidEpochDuration
    );
    require!(
        p.amendment_threshold_bps >= MIN_AMENDMENT_THRESHOLD_BPS
            && p.amendment_threshold_bps as u64 <= BPS_DENOMINATOR,
        TenetError::InvalidAmendmentThreshold
    );
    require!(
        p.amendment_delay_seconds >= MIN_AMENDMENT_DELAY_SECONDS,
        TenetError::InvalidAmendmentDelay
    );
    Ok(())
}

pub fn create_handler(ctx: Context<CreateMandate>, p: MandateParams) -> Result<()> {
    validate_params(&p)?;
    let m = &mut ctx.accounts.mandate;
    m.author = ctx.accounts.author.key();
    m.mandate_seed = ctx.accounts.mandate_seed.key();
    m.name = p.name;
    m.description = p.description;
    m.state = MandateState::Draft;
    m.asset_count = 0;
    m.max_weight_per_asset_bps = p.max_weight_per_asset_bps;
    m.max_pre_ipo_weight_bps = p.max_pre_ipo_weight_bps;
    m.max_issuer_weight_bps = p.max_issuer_weight_bps;
    m.max_underlying_weight_bps = p.max_underlying_weight_bps;
    m.max_supply_consumption_bps = p.max_supply_consumption_bps;
    m.max_price_impact_bps = p.max_price_impact_bps;
    m.min_contribution_usdc = p.min_contribution_usdc;
    m.max_pool_size_usdc = p.max_pool_size_usdc;
    m.epoch_duration = p.epoch_duration;
    m.membership_policy = p.membership_policy;
    m.amendment_threshold_bps = p.amendment_threshold_bps;
    m.amendment_delay_seconds = p.amendment_delay_seconds;
    m.forked_from = None;
    m.version = 1;
    m.created_at = Clock::get()?.unix_timestamp;
    m.bump = ctx.bumps.mandate;
    Ok(())
}

// ---------------------------------------------------------------- fork

/// Create a new, independent constitution from an active parent.
///
/// The parent is read-only by construction. Asset rules are copied through
/// `fork_mandate_asset` because each MandateAsset is its own PDA; this keeps
/// the fixed Mandate account bounded and makes the copy auditable one asset at
/// a time. No Circle, vault, Member or capital account is present anywhere in
/// this path.
#[derive(Accounts)]
pub struct ForkMandate<'info> {
    #[account(mut)]
    pub forker: Signer<'info>,

    #[account(
        seeds = [MANDATE_SEED, parent_mandate.mandate_seed.as_ref()],
        bump = parent_mandate.bump,
        constraint = parent_mandate.state == MandateState::Active @ TenetError::ParentMandateNotActive,
    )]
    pub parent_mandate: Account<'info, Mandate>,

    /// CHECK: used only as the child Mandate's unique seed.
    pub new_mandate_seed: UncheckedAccount<'info>,

    #[account(
        init,
        payer = forker,
        space = 8 + Mandate::INIT_SPACE,
        seeds = [MANDATE_SEED, new_mandate_seed.key().as_ref()],
        bump,
    )]
    pub new_mandate: Account<'info, Mandate>,

    pub system_program: Program<'info, System>,
}

/// The child's rules are supplied by the forker — a fork exists to disagree
/// with its parent about something — and pass exactly the validation
/// `create_mandate` applies. Lineage is the only thing inherited: `forked_from`
/// records the parent. To reproduce the parent verbatim, pass its rules back.
pub fn fork_handler(ctx: Context<ForkMandate>, p: MandateParams) -> Result<()> {
    validate_params(&p)?;
    let parent = &ctx.accounts.parent_mandate;
    let child = &mut ctx.accounts.new_mandate;

    child.author = ctx.accounts.forker.key();
    child.mandate_seed = ctx.accounts.new_mandate_seed.key();
    child.name = p.name;
    child.description = p.description;
    child.state = MandateState::Draft;
    child.asset_count = 0;
    child.max_weight_per_asset_bps = p.max_weight_per_asset_bps;
    child.max_pre_ipo_weight_bps = p.max_pre_ipo_weight_bps;
    child.max_issuer_weight_bps = p.max_issuer_weight_bps;
    child.max_underlying_weight_bps = p.max_underlying_weight_bps;
    child.max_supply_consumption_bps = p.max_supply_consumption_bps;
    child.max_price_impact_bps = p.max_price_impact_bps;
    child.min_contribution_usdc = p.min_contribution_usdc;
    child.max_pool_size_usdc = p.max_pool_size_usdc;
    child.epoch_duration = p.epoch_duration;
    child.membership_policy = p.membership_policy;
    child.amendment_threshold_bps = p.amendment_threshold_bps;
    child.amendment_delay_seconds = p.amendment_delay_seconds;
    child.forked_from = Some(parent.key());
    child.version = 1;
    child.created_at = Clock::get()?.unix_timestamp;
    child.bump = ctx.bumps.new_mandate;
    Ok(())
}

#[derive(Accounts)]
pub struct ForkMandateAsset<'info> {
    #[account(mut)]
    pub forker: Signer<'info>,

    #[account(
        seeds = [MANDATE_SEED, parent_mandate.mandate_seed.as_ref()],
        bump = parent_mandate.bump,
        constraint = parent_mandate.state == MandateState::Active @ TenetError::ParentMandateNotActive,
    )]
    pub parent_mandate: Account<'info, Mandate>,

    /// CHECK: only used to bind both MandateAsset PDAs to the copied mint.
    pub mint: UncheckedAccount<'info>,

    #[account(
        seeds = [MANDATE_ASSET_SEED, parent_mandate.key().as_ref(), mint.key().as_ref()],
        bump = parent_asset.bump,
        constraint = parent_asset.mandate == parent_mandate.key() @ TenetError::AccountSubstitution,
        constraint = parent_asset.mint == mint.key() @ TenetError::MintMismatch,
    )]
    pub parent_asset: Account<'info, MandateAsset>,

    #[account(
        mut,
        seeds = [MANDATE_SEED, new_mandate.mandate_seed.as_ref()],
        bump = new_mandate.bump,
        constraint = new_mandate.author == forker.key() @ TenetError::NotMandateAuthor,
        constraint = new_mandate.forked_from == Some(parent_mandate.key()) @ TenetError::AccountSubstitution,
        constraint = new_mandate.state == MandateState::Draft @ TenetError::InvalidMandateState,
    )]
    pub new_mandate: Account<'info, Mandate>,

    #[account(
        init,
        payer = forker,
        space = 8 + MandateAsset::INIT_SPACE,
        seeds = [MANDATE_ASSET_SEED, new_mandate.key().as_ref(), mint.key().as_ref()],
        bump,
    )]
    pub new_asset: Account<'info, MandateAsset>,

    #[account(
        seeds = [REGISTRY_SEED, mint.key().as_ref()],
        bump = registry_entry.bump,
        constraint = registry_entry.key() == parent_asset.registry_entry @ TenetError::AccountSubstitution,
        constraint = registry_entry.status == AssetStatus::Active @ TenetError::RegistryEntryInactive,
    )]
    pub registry_entry: Account<'info, AssetRegistryEntry>,

    pub system_program: Program<'info, System>,
}

/// Copies one parent asset in parent order, with a target weight chosen for
/// the child's rules (the parent's target may exceed a tightened child cap).
/// The whole target set is proven against every cap at `finalize_mandate`.
pub fn fork_asset_handler(ctx: Context<ForkMandateAsset>, target_weight_bps: u16) -> Result<()> {
    let parent_asset = &ctx.accounts.parent_asset;
    let child = &mut ctx.accounts.new_mandate;
    require!(
        child.asset_count < MAX_CIRCLE_ASSETS,
        TenetError::TooManyAssets
    );
    require!(
        target_weight_bps <= child.max_weight_per_asset_bps,
        TenetError::AssetWeightCapExceeded
    );
    require!(
        parent_asset.index == child.asset_count,
        TenetError::IncompleteMandateAssets
    );

    let copied = &mut ctx.accounts.new_asset;
    copied.mandate = child.key();
    copied.mint = parent_asset.mint;
    copied.registry_entry = ctx.accounts.registry_entry.key();
    copied.target_weight_bps = target_weight_bps;
    copied.index = parent_asset.index;
    copied.enabled = parent_asset.enabled;
    copied.bump = ctx.bumps.new_asset;
    child.asset_count = child
        .asset_count
        .checked_add(1)
        .ok_or(TenetError::MathOverflow)?;
    Ok(())
}

// ---------------------------------------------------------------- add asset

#[derive(Accounts)]
pub struct AddMandateAsset<'info> {
    #[account(mut)]
    pub author: Signer<'info>,

    #[account(
        mut,
        seeds = [MANDATE_SEED, mandate.mandate_seed.as_ref()],
        bump = mandate.bump,
        has_one = author @ TenetError::NotMandateAuthor,
        constraint = mandate.state == MandateState::Draft @ TenetError::InvalidMandateState,
    )]
    pub mandate: Account<'info, Mandate>,

    /// Mint in the seed: a second add of the same mint fails because the
    /// account already exists. Duplicates are impossible, not merely rejected.
    #[account(
        init,
        payer = author,
        space = 8 + MandateAsset::INIT_SPACE,
        seeds = [MANDATE_ASSET_SEED, mandate.key().as_ref(), registry_entry.mint.as_ref()],
        bump,
    )]
    pub mandate_asset: Account<'info, MandateAsset>,

    #[account(
        seeds = [REGISTRY_SEED, registry_entry.mint.as_ref()],
        bump = registry_entry.bump,
        constraint = registry_entry.status == AssetStatus::Active @ TenetError::RegistryEntryInactive,
    )]
    pub registry_entry: Account<'info, AssetRegistryEntry>,

    pub system_program: Program<'info, System>,
}

pub fn add_asset_handler(ctx: Context<AddMandateAsset>, target_weight_bps: u16) -> Result<()> {
    let m = &mut ctx.accounts.mandate;
    require!(m.asset_count < MAX_CIRCLE_ASSETS, TenetError::TooManyAssets);
    require!(
        target_weight_bps <= m.max_weight_per_asset_bps,
        TenetError::AssetWeightCapExceeded
    );

    let a = &mut ctx.accounts.mandate_asset;
    a.mandate = m.key();
    a.mint = ctx.accounts.registry_entry.mint;
    a.registry_entry = ctx.accounts.registry_entry.key();
    a.target_weight_bps = target_weight_bps;
    a.index = m.asset_count;
    a.enabled = true;
    a.bump = ctx.bumps.mandate_asset;

    m.asset_count = m
        .asset_count
        .checked_add(1)
        .ok_or(TenetError::MathOverflow)?;
    Ok(())
}

// ---------------------------------------------------------------- finalize

#[derive(Accounts)]
pub struct FinalizeMandate<'info> {
    pub author: Signer<'info>,

    #[account(
        mut,
        seeds = [MANDATE_SEED, mandate.mandate_seed.as_ref()],
        bump = mandate.bump,
        has_one = author @ TenetError::NotMandateAuthor,
        constraint = mandate.state == MandateState::Draft @ TenetError::InvalidMandateState,
    )]
    pub mandate: Account<'info, Mandate>,
    // remaining_accounts: [mandate_asset_i, registry_entry_i] for every asset,
    // in any order. Bounded by MAX_CIRCLE_ASSETS, so at most 16 accounts.
}

/// One asset's contribution to the weight sums.
pub struct WeightInput {
    pub target_weight_bps: u16,
    pub asset_class: AssetClass,
    pub issuer: Pubkey,
    pub underlying_id: [u8; 16],
}

/// The finalization rules, separated from account handling so they can be
/// unit-tested directly. Sums are u32: 8 assets × 10_000 cannot overflow.
pub fn check_weights(m: &Mandate, assets: &[WeightInput]) -> Result<()> {
    require!(!assets.is_empty(), TenetError::EmptyAssetUniverse);

    let total: u32 = assets.iter().map(|a| a.target_weight_bps as u32).sum();
    require!(
        total as u64 <= BPS_DENOMINATOR,
        TenetError::TargetWeightsExceedTotal
    );

    let pre_ipo: u32 = assets
        .iter()
        .filter(|a| a.asset_class == AssetClass::PreIpo)
        .map(|a| a.target_weight_bps as u32)
        .sum();
    require!(
        pre_ipo <= m.max_pre_ipo_weight_bps as u32,
        TenetError::PreIpoWeightCapExceeded
    );

    // Per-issuer and per-underlying sums. At most 8 assets, so a quadratic scan
    // is bounded and needs no map.
    for a in assets {
        let by_issuer: u32 = assets
            .iter()
            .filter(|b| b.issuer == a.issuer)
            .map(|b| b.target_weight_bps as u32)
            .sum();
        require!(
            by_issuer <= m.max_issuer_weight_bps as u32,
            TenetError::IssuerWeightCapExceeded
        );

        // Same company through two issuers is still one concentration (R-23).
        let by_underlying: u32 = assets
            .iter()
            .filter(|b| b.underlying_id == a.underlying_id)
            .map(|b| b.target_weight_bps as u32)
            .sum();
        require!(
            by_underlying <= m.max_underlying_weight_bps as u32,
            TenetError::UnderlyingWeightCapExceeded
        );
    }
    Ok(())
}

pub fn finalize_handler<'info>(ctx: Context<'info, FinalizeMandate<'info>>) -> Result<()> {
    let mandate_key = ctx.accounts.mandate.key();
    let count = ctx.accounts.mandate.asset_count as usize;
    let rest = ctx.remaining_accounts;

    // Completeness: exactly one (asset, registry) pair per asset. Without this
    // an author could omit an asset from the sums and pass every cap.
    require!(rest.len() == count * 2, TenetError::IncompleteMandateAssets);

    let mut seen: u16 = 0;
    let mut inputs = Vec::with_capacity(count);
    for pair in rest.chunks_exact(2) {
        // `Account::try_from` checks owner == this program and the
        // discriminator, so a forged or foreign account cannot pass.
        let asset: Account<MandateAsset> = Account::try_from(&pair[0])?;
        let entry: Account<AssetRegistryEntry> = Account::try_from(&pair[1])?;

        require_keys_eq!(asset.mandate, mandate_key, TenetError::AccountSubstitution);
        require_keys_eq!(
            asset.registry_entry,
            entry.key(),
            TenetError::AccountSubstitution
        );
        require_keys_eq!(asset.mint, entry.mint, TenetError::MintMismatch);

        // Index bitmap: each of 0..count must appear exactly once. Together with
        // the length check this rules out both omission and repetition.
        let bit = 1u16
            .checked_shl(asset.index as u32)
            .ok_or(TenetError::IncompleteMandateAssets)?;
        require!(
            (asset.index as usize) < count && seen & bit == 0,
            TenetError::IncompleteMandateAssets
        );
        seen |= bit;

        inputs.push(WeightInput {
            target_weight_bps: asset.target_weight_bps,
            asset_class: entry.asset_class,
            issuer: entry.issuer,
            underlying_id: entry.underlying_id,
        });
    }

    check_weights(&ctx.accounts.mandate, &inputs)?;
    ctx.accounts.mandate.state = MandateState::Active;
    Ok(())
}

#[cfg(test)]
mod tests {
    //! Boundary sweeps over the pure rules. The on-chain tests in
    //! tests/program prove these same functions are what the program runs.
    use super::*;

    fn params() -> MandateParams {
        MandateParams {
            name: "Frontier Tech".into(),
            description: String::new(),
            max_weight_per_asset_bps: 4_000,
            max_pre_ipo_weight_bps: 3_000,
            max_issuer_weight_bps: 6_000,
            max_underlying_weight_bps: 5_000,
            max_supply_consumption_bps: 100,
            max_price_impact_bps: 100,
            min_contribution_usdc: 1_000_000,
            max_pool_size_usdc: 100_000_000_000,
            epoch_duration: 7 * 24 * 60 * 60,
            membership_policy: MembershipPolicy::Open,
            amendment_threshold_bps: 6_667,
            amendment_delay_seconds: MIN_AMENDMENT_DELAY_SECONDS,
        }
    }

    /// The error a rejected call returned, as a `TenetError` variant.
    fn err(r: Result<()>) -> TenetError {
        match r.expect_err("expected a rejection") {
            anchor_lang::error::Error::AnchorError(e) => {
                let code = e.error_code_number;
                let all = [
                    TenetError::InvalidMandateName,
                    TenetError::InvalidMandateDescription,
                    TenetError::InvalidBps,
                    TenetError::InvalidMinContribution,
                    TenetError::InvalidMaxPoolSize,
                    TenetError::InvalidEpochDuration,
                    TenetError::InvalidAmendmentThreshold,
                    TenetError::InvalidAmendmentDelay,
                    TenetError::EmptyAssetUniverse,
                    TenetError::TargetWeightsExceedTotal,
                    TenetError::PreIpoWeightCapExceeded,
                    TenetError::IssuerWeightCapExceeded,
                    TenetError::UnderlyingWeightCapExceeded,
                ];
                *all.iter()
                    .find(|x| u32::from(**x) == code)
                    .expect("unexpected error code")
            }
            other => panic!("non-Anchor error: {other:?}"),
        }
    }

    #[test]
    fn test_create_valid_mandate() {
        assert!(validate_params(&params()).is_ok());
    }

    #[test]
    fn test_reject_invalid_caps() {
        // Every bps field: 10_000 is the last legal value, 10_001 the first illegal.
        let setters: [fn(&mut MandateParams, u16); 6] = [
            |p, v| p.max_weight_per_asset_bps = v,
            |p, v| p.max_pre_ipo_weight_bps = v,
            |p, v| p.max_issuer_weight_bps = v,
            |p, v| p.max_underlying_weight_bps = v,
            |p, v| p.max_supply_consumption_bps = v,
            |p, v| p.max_price_impact_bps = v,
        ];
        for (i, set) in setters.iter().enumerate() {
            let mut p = params();
            set(&mut p, 10_000);
            assert!(validate_params(&p).is_ok(), "field {i} at 10_000");
            set(&mut p, 10_001);
            assert_eq!(
                err(validate_params(&p)),
                TenetError::InvalidBps,
                "field {i} at 10_001"
            );
            set(&mut p, u16::MAX);
            assert_eq!(
                err(validate_params(&p)),
                TenetError::InvalidBps,
                "field {i} at u16::MAX"
            );
        }
    }

    #[test]
    fn test_zero_boundaries() {
        let mut p = params();
        p.min_contribution_usdc = 0;
        assert_eq!(err(validate_params(&p)), TenetError::InvalidMinContribution);

        let mut p = params();
        p.name = String::new();
        assert_eq!(err(validate_params(&p)), TenetError::InvalidMandateName);

        // Zero caps are legal (a Mandate may forbid pre-IPO entirely), and an
        // empty description is allowed.
        let mut p = params();
        p.max_pre_ipo_weight_bps = 0;
        p.max_price_impact_bps = 0;
        assert!(validate_params(&p).is_ok());

        // max_pool_size must be strictly above the minimum contribution.
        let mut p = params();
        p.max_pool_size_usdc = p.min_contribution_usdc;
        assert_eq!(err(validate_params(&p)), TenetError::InvalidMaxPoolSize);
        p.max_pool_size_usdc = p.min_contribution_usdc + 1;
        assert!(validate_params(&p).is_ok());
    }

    #[test]
    fn test_max_boundaries() {
        let mut p = params();
        p.name = "x".repeat(MAX_MANDATE_NAME_LEN);
        p.description = "x".repeat(MAX_MANDATE_DESCRIPTION_LEN);
        assert!(validate_params(&p).is_ok());
        p.name.push('x');
        assert_eq!(err(validate_params(&p)), TenetError::InvalidMandateName);

        let mut p = params();
        p.description = "x".repeat(MAX_MANDATE_DESCRIPTION_LEN + 1);
        assert_eq!(
            err(validate_params(&p)),
            TenetError::InvalidMandateDescription
        );

        // Length is BYTES, matching the account space: 16 three-byte
        // characters are 48 bytes and fit; one more does not.
        let mut p = params();
        p.name = "\u{20ac}".repeat(16);
        assert!(validate_params(&p).is_ok());
        p.name.push('\u{20ac}');
        assert_eq!(err(validate_params(&p)), TenetError::InvalidMandateName);

        for (d, ok) in [
            (MIN_EPOCH_DURATION - 1, false),
            (MIN_EPOCH_DURATION, true),
            (MAX_EPOCH_DURATION, true),
            (MAX_EPOCH_DURATION + 1, false),
            (0, false),
            (-1, false),
        ] {
            let mut p = params();
            p.epoch_duration = d;
            if ok {
                assert!(validate_params(&p).is_ok(), "duration {d}");
            } else {
                assert_eq!(
                    err(validate_params(&p)),
                    TenetError::InvalidEpochDuration,
                    "duration {d}"
                );
            }
        }

        // Threshold must be a strict majority: (5_000, 10_000].
        for (t, ok) in [
            (5_000, false),
            (5_001, true),
            (10_000, true),
            (10_001, false),
        ] {
            let mut p = params();
            p.amendment_threshold_bps = t;
            if ok {
                assert!(validate_params(&p).is_ok(), "threshold {t}");
            } else {
                assert_eq!(
                    err(validate_params(&p)),
                    TenetError::InvalidAmendmentThreshold,
                    "threshold {t}"
                );
            }
        }

        let mut p = params();
        p.amendment_delay_seconds = MIN_AMENDMENT_DELAY_SECONDS - 1;
        assert_eq!(err(validate_params(&p)), TenetError::InvalidAmendmentDelay);
    }

    // ---- finalization rules ---------------------------------------------------

    fn mandate() -> Mandate {
        let p = params();
        Mandate {
            author: Pubkey::default(),
            mandate_seed: Pubkey::default(),
            name: p.name,
            description: p.description,
            state: MandateState::Draft,
            asset_count: 0,
            max_weight_per_asset_bps: p.max_weight_per_asset_bps,
            max_pre_ipo_weight_bps: p.max_pre_ipo_weight_bps,
            max_issuer_weight_bps: p.max_issuer_weight_bps,
            max_underlying_weight_bps: p.max_underlying_weight_bps,
            max_supply_consumption_bps: p.max_supply_consumption_bps,
            max_price_impact_bps: p.max_price_impact_bps,
            min_contribution_usdc: p.min_contribution_usdc,
            max_pool_size_usdc: p.max_pool_size_usdc,
            epoch_duration: p.epoch_duration,
            membership_policy: p.membership_policy,
            amendment_threshold_bps: p.amendment_threshold_bps,
            amendment_delay_seconds: p.amendment_delay_seconds,
            forked_from: None,
            version: 1,
            created_at: 0,
            bump: 0,
        }
    }

    fn asset(bps: u16, class: AssetClass, issuer: u8, underlying: u8) -> WeightInput {
        WeightInput {
            target_weight_bps: bps,
            asset_class: class,
            issuer: Pubkey::new_from_array([issuer; 32]),
            underlying_id: [underlying; 16],
        }
    }

    use AssetClass::{PreIpo, PublicTokenizedEquity as Pub};

    #[test]
    fn test_reject_invalid_weights() {
        let m = mandate(); // pre-IPO 30%, issuer 60%, underlying 50%

        assert_eq!(err(check_weights(&m, &[])), TenetError::EmptyAssetUniverse);

        // Exactly 100% across distinct issuers and underlyings is fine.
        let ok = [
            asset(4_000, Pub, 1, 1),
            asset(3_000, Pub, 2, 2),
            asset(3_000, PreIpo, 3, 3),
        ];
        assert!(check_weights(&m, &ok).is_ok());

        // 100.01% is not.
        let over = [
            asset(2_501, Pub, 1, 1),
            asset(2_500, Pub, 2, 2),
            asset(2_500, Pub, 3, 3),
            asset(2_500, Pub, 4, 4),
        ];
        assert_eq!(
            err(check_weights(&m, &over)),
            TenetError::TargetWeightsExceedTotal
        );

        // Pre-IPO: 30% allowed, 30.01% not, summed ACROSS assets.
        let pre = [asset(1_500, PreIpo, 1, 1), asset(1_500, PreIpo, 2, 2)];
        assert!(check_weights(&m, &pre).is_ok());
        let pre = [asset(1_500, PreIpo, 1, 1), asset(1_501, PreIpo, 2, 2)];
        assert_eq!(
            err(check_weights(&m, &pre)),
            TenetError::PreIpoWeightCapExceeded
        );

        // Issuer: three assets from one issuer, 60% allowed, 60.01% not.
        let iss = [
            asset(2_000, Pub, 9, 1),
            asset(2_000, Pub, 9, 2),
            asset(2_000, Pub, 9, 3),
        ];
        assert!(check_weights(&m, &iss).is_ok());
        let iss = [
            asset(2_000, Pub, 9, 1),
            asset(2_000, Pub, 9, 2),
            asset(2_001, Pub, 9, 3),
        ];
        assert_eq!(
            err(check_weights(&m, &iss)),
            TenetError::IssuerWeightCapExceeded
        );
    }

    #[test]
    fn test_same_company_through_two_issuers_is_one_concentration() {
        // R-23 / V-010: SPCXx (Backed) and SPACEX (PreStocks) are the same
        // company. Each is under the issuer cap alone; together they must
        // still respect the underlying cap (50%).
        let m = mandate();
        let ok = [asset(2_500, Pub, 1, 7), asset(2_500, PreIpo, 2, 7)];
        assert!(check_weights(&m, &ok).is_ok());
        let over = [asset(2_500, Pub, 1, 7), asset(2_501, PreIpo, 2, 7)];
        assert_eq!(
            err(check_weights(&m, &over)),
            TenetError::UnderlyingWeightCapExceeded
        );
    }
}
