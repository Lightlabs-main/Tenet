//! Account model.
//!
//! Two rules hold throughout, and most of the safety follows from them:
//!
//! 1. **No account stores an authoritative token balance.** The token account's
//!    own `amount` is the source of truth, so no duplicate can drift (spec §25).
//! 2. **No unbounded `Vec` lives inside a fixed account.** Collections are
//!    modelled as one PDA per element, keyed on mint, which makes duplicates and
//!    cross-Circle substitution structurally impossible rather than merely
//!    rejected (decision A-01).

use anchor_lang::prelude::*;

use crate::constants::*;

// ---------------------------------------------------------------- enums

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, InitSpace)]
pub enum MandateState {
    Draft,
    Active,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, InitSpace)]
pub enum MembershipPolicy {
    Open,
    InviteOnly,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, InitSpace)]
pub enum CircleState {
    Funding,
    Active,
}

/// Explicit states — never inferred from timestamps alone (spec §30).
///
/// `Cancelled` is a safety valve, not a failure: when prices cannot be trusted
/// the honest outcome is to refuse to price new shares and let contributors take
/// their money back, rather than guess a NAV.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, InitSpace)]
pub enum EpochState {
    Open,
    Closed,
    Finalized,
    Executing,
    Completed,
    Cancelled,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, InitSpace)]
pub enum AssetStatus {
    Active,
    /// New purchases blocked (corporate action, delisting). Exit is unaffected.
    Restricted,
    Disabled,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, InitSpace)]
pub enum AssetClass {
    Usdc,
    PublicTokenizedEquity,
    PreIpo,
}

// ---------------------------------------------------------------- config

/// Program-wide settings. Decision A-18.
///
/// The spec referenced `config.registry_authority` and `config.usdc_mint`
/// without ever defining the account. It holds exactly those two values and no
/// custody power. It is created once, by the program's upgrade authority, so
/// nobody can race the deployer to choose the registry authority.
#[account]
#[derive(InitSpace)]
pub struct Config {
    /// Classifies mints (pre-IPO? which issuer?). A disclosed trust
    /// assumption, R-13 — it can mislabel an asset but cannot move funds.
    pub registry_authority: Pubkey,
    /// The only mint Circles accept as USDC (V-014). On Devnet: TUSDC.
    pub usdc_mint: Pubkey,

    // ---- environment seams (A-23) -------------------------------------------
    // Tenet's product logic is identical on every network. These fields name
    // the external venues it talks to; `initialize_config` refuses any
    // combination that mixes Devnet test infrastructure with real value.
    pub network: Network,
    /// The ONLY program allowed between `begin_execution` and `end_execution`.
    /// Mainnet: Jupiter. Devnet: the tenet-devnet test market.
    pub execution_venue: Pubkey,
    /// How prices are read, and which program must own the price accounts.
    pub price_source: PriceSource,
    pub price_program: Pubkey,
    /// Older observations are refused. Mainnet: at most 60 s (Pyth).
    pub max_price_age_seconds: u64,

    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, InitSpace)]
pub enum Network {
    Mainnet,
    Devnet,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, InitSpace)]
pub enum PriceSource {
    /// Pyth Receiver `PriceUpdateV2` accounts.
    Pyth,
    /// tenet-devnet `PriceFeed` accounts: operator-published DEVNET TEST
    /// valuations, Pyth-shaped so the same checks and arithmetic apply.
    DevnetFeed,
}

// ---------------------------------------------------------------- registry

/// Classification plus live, observable mint state.
///
/// The two halves have different trust models, which is why `upsert_registry_entry`
/// (authority-gated judgement) and `refresh_asset_metadata` (permissionless fact)
/// are separate instructions — decision A-16.
#[account]
#[derive(InitSpace)]
pub struct AssetRegistryEntry {
    pub mint: Pubkey,
    pub token_program: Pubkey,

    // ---- classification: requires a trusted authority (R-13) --------------
    pub asset_class: AssetClass,
    /// The token issuer — Backed, PreStocks — i.e. counterparty risk.
    pub issuer: Pubkey,
    /// The underlying company. Distinct from `issuer`: SPCXx and SPACEX are the
    /// same underlying through different issuers (V-010, `REVIEW.md` R-23).
    pub underlying_id: [u8; 16],
    #[max_len(MAX_SYMBOL_LEN)]
    pub symbol: String,
    #[max_len(MAX_DISPLAY_NAME_LEN)]
    pub display_name: String,
    pub pyth_feed_tokenized: [u8; 32],
    pub pyth_feed_underlying: [u8; 32],
    pub status: AssetStatus,

    // ---- observable fact: refreshed permissionlessly ----------------------
    pub decimals: u8,
    pub raw_supply: u64,
    /// Effective multiplier, scaled by 1e18. Selected by comparing the mint's
    /// `newMultiplierEffectiveTimestamp` against the clock — reading the
    /// `multiplier` field alone is wrong on live mainnet data (V-003, V-017,
    /// V-026). Display only; never enters ownership accounting (INV-019).
    pub effective_multiplier_e18: u128,
    /// Fee in force at the CURRENT epoch, not simply `newerTransferFee` (V-004).
    pub active_transfer_fee_bps: u16,
    pub active_transfer_fee_max: u64,
    /// Bitflags: 1 permanent delegate · 2 freeze · 4 paused · 8 transfer hook.
    /// Powers Tenet cannot constrain, so they are surfaced, not hidden (R-09).
    pub issuer_controls: u8,
    pub last_verified_slot: u64,
    pub last_verified_ts: i64,

    pub bump: u8,
}

// ---------------------------------------------------------------- mandate

/// The investment constitution. Rules, never money.
#[account]
#[derive(InitSpace)]
pub struct Mandate {
    pub author: Pubkey,
    pub mandate_seed: Pubkey,

    #[max_len(MAX_MANDATE_NAME_LEN)]
    pub name: String,
    #[max_len(MAX_MANDATE_DESCRIPTION_LEN)]
    pub description: String,

    pub state: MandateState,
    pub asset_count: u16,

    pub max_weight_per_asset_bps: u16,
    pub max_pre_ipo_weight_bps: u16,
    /// Cap on exposure to one token ISSUER — counterparty risk.
    pub max_issuer_weight_bps: u16,
    /// Cap on exposure to one UNDERLYING company — investment concentration.
    /// Separate from the issuer cap because the same company can be held through
    /// two different issuers (V-010, R-23).
    pub max_underlying_weight_bps: u16,
    pub max_supply_consumption_bps: u16,
    pub max_price_impact_bps: u16,

    pub min_contribution_usdc: u64,
    pub max_pool_size_usdc: u64,

    pub epoch_duration: i64,
    pub membership_policy: MembershipPolicy,

    pub amendment_threshold_bps: u16,
    pub amendment_delay_seconds: i64,

    /// Lineage. A fork records its parent and never touches it (INV-017).
    pub forked_from: Option<Pubkey>,
    pub version: u16,
    pub created_at: i64,

    pub bump: u8,
}

/// One permitted asset. Keyed on mint in the PDA seed, so a duplicate cannot be
/// initialized at all.
#[account]
#[derive(InitSpace)]
pub struct MandateAsset {
    pub mandate: Pubkey,
    pub mint: Pubkey,
    pub registry_entry: Pubkey,
    pub target_weight_bps: u16,
    pub index: u16,
    pub enabled: bool,
    pub bump: u8,
}

// ---------------------------------------------------------------- governance

/// A governance proposal is a bounded snapshot of a possible Mandate update.
/// Voting power is measured against the Circle share total captured here; the
/// Circle must remain unchanged through execution, so late contributions or
/// exits cannot silently alter the electorate underneath a proposal.
#[account]
#[derive(InitSpace)]
pub struct AmendmentProposal {
    pub mandate: Pubkey,
    pub circle: Pubkey,
    pub proposer: Pubkey,
    pub proposal_id: u64,
    pub created_at: i64,
    pub execute_after: i64,
    pub total_shares_at_proposal: u64,
    pub for_shares: u64,
    pub executed: bool,

    #[max_len(MAX_MANDATE_NAME_LEN)]
    pub name: String,
    #[max_len(MAX_MANDATE_DESCRIPTION_LEN)]
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
    pub bump: u8,
}

/// One vote per proposal/member. A separate PDA makes double voting
/// structurally impossible without growing the proposal account.
#[account]
#[derive(InitSpace)]
pub struct AmendmentVote {
    pub proposal: Pubkey,
    pub voter: Pubkey,
    pub shares: u64,
    pub support: bool,
    pub bump: u8,
}

// ---------------------------------------------------------------- circle

/// Pooled capital governed by one Mandate.
///
/// Holds no token balances: every vault's own `amount` is authoritative.
#[account]
#[derive(InitSpace)]
pub struct Circle {
    pub mandate: Pubkey,
    pub state: CircleState,
    pub created_at: i64,

    pub total_shares: u64,
    /// Derived aggregate of `Σ over open epochs (reserved − settled)`.
    ///
    /// Makes INV-001 checkable in a single account read instead of iterating
    /// epochs — which matters because it is asserted after every step of the
    /// fuzz harness. Not a second source of truth: the property test recomputes
    /// the per-epoch sum and asserts the two agree (decision A-14).
    pub reserved_shares: u64,

    pub current_epoch: u64,
    /// Number of Members with a non-zero share balance. This is updated on
    /// zero→positive settlement and positive→zero redemption transitions.
    pub member_count: u32,
    pub asset_count: u16,

    /// Redemptions whose reservations are incomplete. Execution is frozen while
    /// this is non-zero — but note the freeze alone is NOT sufficient: spending
    /// must also respect `balance − reserved` (`REVIEW.md` H-01).
    pub pending_reservations: u32,
    /// Set while a NAV snapshot is open, so vault balances cannot move
    /// underneath a valuation in progress.
    pub execution_frozen: bool,

    pub bump: u8,
    /// Bump of the `VaultAuthority` PDA, which signs every vault transfer.
    /// Stored so each signing does not re-derive it.
    pub vault_authority_bump: u8,
    /// USDC promised to exiting members and not yet claimed — an OBLIGATION,
    /// not a balance (the vault's own `amount` stays authoritative). Every
    /// debit of the active USDC vault must use `amount − usdc_reserved_raw`
    /// (REVIEW.md H-01). Asset vaults carry the same on `CircleAsset`.
    pub usdc_reserved_raw: u64,
    /// Bit `i` set when the vault for Mandate asset index `i` exists. Exits
    /// snapshot this to know exactly which vaults they cover.
    pub asset_bitmap: u16,
}

/// One asset held by a Circle, and the vault that holds it.
#[account]
#[derive(InitSpace)]
pub struct CircleAsset {
    pub circle: Pubkey,
    pub mandate_asset: Pubkey,
    pub mint: Pubkey,
    pub vault: Pubkey,
    /// Stored because a Circle holds BOTH token programs at once: classic SPL
    /// for USDC (V-014) and Token-2022 for every tokenized equity (V-002,
    /// V-010). Assuming one program anywhere in the custody path is a bug.
    pub token_program: Pubkey,
    pub index: u16,
    pub status: AssetStatus,

    /// Raw units already promised to exiting members and not yet claimed.
    /// Every debit of this vault must use `vault.amount − reserved`.
    pub reserved_for_redemption_raw: u64,

    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct Member {
    pub circle: Pubkey,
    pub owner: Pubkey,
    pub shares: u64,
    /// A record of what was contributed. **Not** tax cost basis under any
    /// jurisdiction's methodology, and never presented as such (spec §28).
    pub contributed_basis_usdc: u64,
    pub joined_epoch: u64,
    /// Seq of this member's NEXT redemption; seeds its PDA so a member can exit
    /// in several parts, each a distinct account.
    pub next_redemption_seq: u64,
    pub bump: u8,
}

// ---------------------------------------------------------------- epoch

#[account]
#[derive(InitSpace)]
pub struct Epoch {
    pub circle: Pubkey,
    pub index: u64,

    pub opened_at: i64,
    pub closes_at: i64,
    pub state: EpochState,

    pub pending_usdc_raw: u64,

    /// Frozen at finalization. Settlement divides by these two rather than a
    /// precomputed rate, which keeps every intermediate inside u128 and makes
    /// the result reproducible and order-independent (decision A-17).
    pub total_shares_before: u64,
    pub nav_before: u128,

    pub reserved_shares: u64,
    pub settled_shares: u64,
    pub receipt_count: u32,
    pub settled_count: u32,

    pub finalized_at: Option<i64>,
    pub bump: u8,
}

/// A member's pending contribution for one epoch.
///
/// Cancellable by the owner before finalization, with no admin approval anywhere
/// in that path (spec §10, §20).
#[account]
#[derive(InitSpace)]
pub struct ContributionReceipt {
    pub circle: Pubkey,
    pub epoch: Pubkey,
    pub owner: Pubkey,
    pub amount_usdc_raw: u64,
    pub shares_entitled: u64,
    pub settled: bool,
    pub bump: u8,
}

/// NAV accumulated across transactions.
///
/// Decouples the asset count from transaction size, and bounds the whole
/// valuation to a slot window so an epoch cannot be priced at stale prices
/// (decision A-05).
#[account]
#[derive(InitSpace)]
pub struct NavSnapshot {
    pub circle: Pubkey,
    pub epoch: Pubkey,
    pub slot_opened: u64,
    pub nav_accum: u128,
    pub assets_remaining: u16,
    /// One bit per `CircleAsset.index`, so an asset cannot be counted twice.
    pub recorded_bitmap: u16,
    pub bump: u8,
}

// ---------------------------------------------------------------- redemption

/// An in-flight exit. Shares are burned at initiation, so the entitlement is
/// frozen against the vaults as they stood at that instant.
///
/// Requires no price, no oracle, no approval (RULE 6, INV-014).
#[account]
#[derive(InitSpace)]
pub struct Redemption {
    pub circle: Pubkey,
    pub owner: Pubkey,
    pub seq: u64,
    pub shares_redeemed: u64,
    pub total_shares_at_snapshot: u64,
    pub assets_remaining: u16,
    pub initiated_at: i64,
    /// After this, anyone may force-complete the remaining reservations so one
    /// absent participant cannot freeze execution indefinitely (R-20).
    pub reservation_deadline: i64,
    /// `circle.asset_bitmap` at initiation: exactly the vaults this exit covers.
    /// Only those may be reserved. Without it a vault added AFTER initiation
    /// (permissionless, and empty) could be reserved in place of a real asset,
    /// completing the exit with a real asset never reserved — a third party
    /// could do that to grief an exiter.
    ///
    /// A bitmap, not a count: `CircleAsset.index` is the asset's index in the
    /// MANDATE, so vaults need not exist for a contiguous `0..count`. With a
    /// count, a Circle holding only asset 1 would reject asset 1 (`1 < 1`), the
    /// exit could never complete, and every later exit and epoch would block.
    pub asset_bitmap_at_snapshot: u16,
    pub bump: u8,
}

/// One asset's claim. Separate account per asset so a failure on one — a paused
/// mint, a frozen account, a transfer hook — cannot trap the others (spec §65).
#[account]
#[derive(InitSpace)]
pub struct RedemptionAsset {
    pub redemption: Pubkey,
    pub mint: Pubkey,
    pub amount_raw: u64,
    pub claimed: bool,
    pub bump: u8,
}

/// Authorization for one execution.
///
/// Seeded on a nonce and closed on use, so replay fails at account init rather
/// than at a flag check (INV-020).
#[account]
#[derive(InitSpace)]
pub struct ExecutionAuth {
    pub circle: Pubkey,
    pub epoch: Pubkey,
    pub nonce: u64,
    pub executor: Pubkey,
    pub in_mint: Pubkey,
    pub out_mint: Pubkey,
    pub max_in: u64,
    pub min_out: u64,
    pub pre_in_balance: u64,
    pub pre_out_balance: u64,
    pub expires_at: i64,
    pub bump: u8,
}

#[cfg(test)]
mod tests {
    use super::*;
    use anchor_lang::Discriminator;

    /// Anchor 1.x exposes `DISCRIMINATOR` as `&'static [u8]` whose length is
    /// not guaranteed to be 8, so the size is computed from the real length
    /// rather than a hardcoded prefix.
    fn account_size(disc: &[u8], init_space: usize) -> usize {
        disc.len() + init_space
    }

    #[test]
    fn every_account_has_a_discriminator_and_a_bounded_size() {
        // Proves the `#[account]` / `InitSpace` derives actually ran. The
        // generated IDL cannot show this yet: Anchor emits only types reachable
        // from an instruction, and Phase 1 has no instructions that take these.
        let sizes: &[(&str, &[u8], usize)] = &[
            ("Config", Config::DISCRIMINATOR, Config::INIT_SPACE),
            (
                "AssetRegistryEntry",
                AssetRegistryEntry::DISCRIMINATOR,
                AssetRegistryEntry::INIT_SPACE,
            ),
            ("Mandate", Mandate::DISCRIMINATOR, Mandate::INIT_SPACE),
            (
                "MandateAsset",
                MandateAsset::DISCRIMINATOR,
                MandateAsset::INIT_SPACE,
            ),
            (
                "AmendmentProposal",
                AmendmentProposal::DISCRIMINATOR,
                AmendmentProposal::INIT_SPACE,
            ),
            (
                "AmendmentVote",
                AmendmentVote::DISCRIMINATOR,
                AmendmentVote::INIT_SPACE,
            ),
            ("Circle", Circle::DISCRIMINATOR, Circle::INIT_SPACE),
            (
                "CircleAsset",
                CircleAsset::DISCRIMINATOR,
                CircleAsset::INIT_SPACE,
            ),
            ("Member", Member::DISCRIMINATOR, Member::INIT_SPACE),
            ("Epoch", Epoch::DISCRIMINATOR, Epoch::INIT_SPACE),
            (
                "ContributionReceipt",
                ContributionReceipt::DISCRIMINATOR,
                ContributionReceipt::INIT_SPACE,
            ),
            (
                "NavSnapshot",
                NavSnapshot::DISCRIMINATOR,
                NavSnapshot::INIT_SPACE,
            ),
            (
                "Redemption",
                Redemption::DISCRIMINATOR,
                Redemption::INIT_SPACE,
            ),
            (
                "RedemptionAsset",
                RedemptionAsset::DISCRIMINATOR,
                RedemptionAsset::INIT_SPACE,
            ),
            (
                "ExecutionAuth",
                ExecutionAuth::DISCRIMINATOR,
                ExecutionAuth::INIT_SPACE,
            ),
        ];

        let mut seen: Vec<&[u8]> = Vec::new();
        for (name, disc, init_space) in sizes {
            assert!(!disc.is_empty(), "{name} has an empty discriminator");
            assert!(
                disc.iter().any(|b| *b != 0),
                "{name} has an all-zero discriminator"
            );
            assert!(
                !seen.contains(disc),
                "{name} shares a discriminator with another account"
            );
            seen.push(disc);

            let size = account_size(disc, *init_space);
            assert!(size > disc.len(), "{name} is empty");
            // 10 KiB is the practical ceiling for an account created via CPI in
            // one instruction. Anything approaching it needs a realloc strategy.
            assert!(
                size < 10_240,
                "{name} is {size} bytes, too large to init in one ix"
            );
        }
    }

    #[test]
    fn nav_snapshot_bitmap_covers_every_possible_asset() {
        // `recorded_bitmap` is a u16, and one bit is set per CircleAsset.index
        // so an asset cannot be counted twice in a NAV snapshot. If
        // MAX_CIRCLE_ASSETS ever exceeds the bit width, double-counting becomes
        // silently possible — which would corrupt NAV and therefore share pricing.
        assert!(
            (MAX_CIRCLE_ASSETS as u32) <= u16::BITS,
            "recorded_bitmap (u16) cannot index {MAX_CIRCLE_ASSETS} assets"
        );
    }

    #[test]
    fn circle_holds_no_token_balances() {
        // A regression guard for spec §25 and decision A-01: the only balance a
        // Circle may track is `reserved_for_redemption_raw` on CircleAsset, which
        // is an obligation, not a balance. Actual holdings live in the vault's
        // own `amount`, so no duplicate can drift.
        //
        // Circle carries: mandate, state, created_at, total_shares,
        // reserved_shares, current_epoch, member_count, asset_count,
        // pending_reservations, execution_frozen, bump, vault_authority_bump,
        // usdc_reserved_raw, asset_bitmap. usdc_reserved_raw is an OBLIGATION
        // owed to exiters, not a balance: the vault's own amount remains the
        // only balance.
        // If this size jumps, something balance-shaped was probably added.
        assert_eq!(
            Circle::INIT_SPACE,
            32 + 1 + 8 + 8 + 8 + 8 + 4 + 2 + 4 + 1 + 1 + 1 + 8 + 2,
            "Circle layout changed - confirm no token balance was introduced"
        );
    }
}
