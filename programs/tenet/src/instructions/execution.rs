//! Execution boundary — fail-closed raw-vault verification.
//!
//! `begin_execution` authorizes a bounded, replay-protected window in which the
//! ONLY permitted program is `Config.execution_venue` (Jupiter on mainnet, the
//! tenet-devnet market on Devnet), and grants the executor a delegate on the
//! Circle's USDC vault for at most `max_in`. `end_execution` then verifies the
//! actual token-account deltas, never a quote:
//!
//! - spent ≤ max_in and gained ≥ min_out, from real balances;
//! - the Mandate's supply-consumption cap, from the live mint supply;
//! - the price-impact floor, from the price adapter (`crate::price`);
//! - the asset's post-trade value ≤ its Mandate TARGET share of NAV. The
//!   targets were proven at `finalize_mandate` to satisfy the per-asset,
//!   pre-IPO, issuer and company caps, so holding every asset at or below its
//!   target enforces all of those caps as a consequence (A-23);
//!
//! and revokes the delegate. Any failure reverts the whole transaction.

use anchor_lang::prelude::*;
use anchor_spl::token_interface::{self, Approve, Mint, Revoke, TokenAccount, TokenInterface};
use pyth_solana_receiver_sdk::price_update::Price;

use crate::constants::*;
use crate::errors::TenetError;
use crate::price::read_price;
use crate::state::{
    AssetRegistryEntry, AssetStatus, Circle, CircleAsset, CircleState, Config, Epoch,
    ExecutionAuth, Mandate, MandateAsset, MandateState,
};

const END_EXECUTION_DISCRIMINATOR: &[u8; 8] = &[167, 104, 37, 207, 92, 147, 230, 237];
const USDC_DECIMALS: u8 = 6;

fn has_end_execution(data: &[u8]) -> bool {
    data.len() >= END_EXECUTION_DISCRIMINATOR.len()
        && data[..END_EXECUTION_DISCRIMINATOR.len()] == *END_EXECUTION_DISCRIMINATOR
}

/// Enforce the supply-consumption cap using the live mint supply and the
/// destination vault's canonical raw balance. This deliberately does not use
/// ScaledUiAmount, a quote, or a displayed quantity.
fn validate_supply_consumption(raw_balance: u64, raw_supply: u64, cap_bps: u16) -> Result<()> {
    require!(raw_supply > 0, TenetError::InvalidRegistryMetadata);
    let consumed = u128::from(raw_balance)
        .checked_mul(10_000)
        .ok_or(TenetError::MathOverflow)?;
    let allowed = u128::from(raw_supply)
        .checked_mul(u128::from(cap_bps))
        .ok_or(TenetError::MathOverflow)?;
    require!(
        consumed <= allowed,
        TenetError::SupplyConsumptionCapExceeded
    );
    Ok(())
}

pub(crate) fn power_of_ten(exponent: u32) -> Result<u128> {
    10u128
        .checked_pow(exponent)
        .ok_or(TenetError::PriceArithmeticOverflow.into())
}

/// Convert one asset vault's canonical raw balance into raw USDC value.
///
/// The Token-2022 ScaledUiAmount multiplier is applied only at this valuation
/// boundary. Raw ownership and redemption state remain untouched. The
/// calculation is integer-only after the already-verified multiplier has been
/// represented as an e18 integer in the registry entry.
pub(crate) fn pyth_value_usdc_raw(
    raw_amount: u64,
    asset_decimals: u8,
    multiplier_e18: u128,
    price: Price,
) -> Result<u128> {
    require!(multiplier_e18 > 0, TenetError::InvalidRegistryMetadata);
    let scaled_raw = u128::from(raw_amount)
        .checked_mul(multiplier_e18)
        .ok_or(TenetError::PriceArithmeticOverflow)?
        / 1_000_000_000_000_000_000u128;
    let mut value = scaled_raw
        .checked_mul(u128::try_from(price.price).map_err(|_| error!(TenetError::PriceNotPositive))?)
        .ok_or(TenetError::PriceArithmeticOverflow)?;

    // raw_asset * price * 10^(USDC_DECIMALS + price.exponent - asset_decimals)
    // is the same quantity as converting the asset amount to economic units,
    // applying the USD price, then converting to raw USDC.
    let scale = i64::from(USDC_DECIMALS)
        .checked_add(i64::from(price.exponent))
        .and_then(|v| v.checked_sub(i64::from(asset_decimals)))
        .ok_or(TenetError::PriceArithmeticOverflow)?;
    if scale >= 0 {
        value = value
            .checked_mul(power_of_ten(
                u32::try_from(scale).map_err(|_| error!(TenetError::PriceArithmeticOverflow))?,
            )?)
            .ok_or(TenetError::PriceArithmeticOverflow)?;
    } else {
        let divisor = u32::try_from(scale.unsigned_abs())
            .map_err(|_| error!(TenetError::PriceArithmeticOverflow))?;
        value /= power_of_ten(divisor)?;
    }
    Ok(value)
}

/// Convert the USD price into a conservative minimum raw output. The
/// computation stays integer-only and floors in the Circle's favour.
///
/// The price is per economic unit, and one raw unit is worth
/// `multiplier_e18 / 1e18` economic units (ScaledUiAmount), so the fair raw
/// output is divided by the multiplier — the exact inverse of
/// `pyth_value_usdc_raw`. Without this, a 2x multiplier would demand twice
/// the tokens the price justifies, and a 0.5x one half.
fn pyth_min_output_raw(
    spent_usdc_raw: u64,
    output_decimals: u8,
    multiplier_e18: u128,
    price: Price,
    max_impact_bps: u16,
) -> Result<u64> {
    require!(multiplier_e18 > 0, TenetError::InvalidRegistryMetadata);
    let mut numerator = u128::from(spent_usdc_raw)
        .checked_mul(power_of_ten(u32::from(output_decimals))?)
        .ok_or(TenetError::PriceArithmeticOverflow)?;
    let mut denominator = power_of_ten(u32::from(USDC_DECIMALS))?
        .checked_mul(u128::try_from(price.price).map_err(|_| error!(TenetError::PriceNotPositive))?)
        .ok_or(TenetError::PriceArithmeticOverflow)?;

    if price.exponent < 0 {
        numerator = numerator
            .checked_mul(power_of_ten(price.exponent.unsigned_abs())?)
            .ok_or(TenetError::PriceArithmeticOverflow)?;
    } else {
        denominator = denominator
            .checked_mul(power_of_ten(price.exponent as u32)?)
            .ok_or(TenetError::PriceArithmeticOverflow)?;
    }

    // Raw output at a 1x multiplier, then rescaled. Scaling by 1e18 before dividing
    // would overflow u128 at ordinary trade sizes.
    let fair_unscaled = numerator / denominator;
    let fair_raw = fair_unscaled
        .checked_mul(1_000_000_000_000_000_000u128)
        .ok_or(TenetError::PriceArithmeticOverflow)?
        / multiplier_e18;
    let protection_bps = 10_000u16
        .checked_sub(max_impact_bps)
        .ok_or(TenetError::PriceArithmeticOverflow)?;
    let protected = fair_raw
        .checked_mul(u128::from(protection_bps))
        .ok_or(TenetError::PriceArithmeticOverflow)?
        / 10_000u128;
    u64::try_from(protected).map_err(|_| error!(TenetError::PriceArithmeticOverflow))
}

/// Prove that the remainder of this transaction is exactly a window of the
/// configured venue's instructions followed by Tenet's matching end
/// instruction. Setup/cleanup instructions must sit outside the window.
fn validate_venue_window(instructions_sysvar: &AccountInfo, venue: &Pubkey) -> Result<()> {
    use solana_instructions_sysvar::{load_current_index_checked, load_instruction_at_checked};

    let current = load_current_index_checked(instructions_sysvar)
        .map_err(|_| error!(TenetError::IncompleteExecutionWindow))? as usize;
    let mut saw_venue = false;
    let mut saw_end = false;
    // The sysvar does not expose a public length field. Walk the bounded
    // transaction instruction indexes until the loader reports the end.
    for index in (current + 1)..=64 {
        let instruction = match load_instruction_at_checked(index, instructions_sysvar) {
            Ok(value) => value,
            Err(_) => break,
        };

        if instruction.program_id == crate::ID && has_end_execution(&instruction.data) {
            saw_end = true;
            break;
        }
        if instruction.program_id != *venue {
            return err!(TenetError::UnexpectedInstructionInWindow);
        }
        saw_venue = true;
    }

    require!(
        saw_venue && saw_end,
        TenetError::IncompleteExecutionWindow
    );
    Ok(())
}

#[derive(Accounts)]
#[instruction(nonce: u64, max_in: u64, min_out: u64, expires_at: i64)]
pub struct BeginExecution<'info> {
    #[account(mut)]
    pub executor: Signer<'info>,

    #[account(
        mut,
        seeds = [CIRCLE_SEED, circle.mandate.as_ref()],
        bump = circle.bump,
        constraint = circle.state == CircleState::Active @ TenetError::InvalidMandateState,
        constraint = !circle.execution_frozen @ TenetError::ExecutionFrozen,
        constraint = circle.pending_reservations == 0 @ TenetError::RedemptionPending,
    )]
    pub circle: Box<Account<'info, Circle>>,

    #[account(
        seeds = [MANDATE_SEED, mandate.mandate_seed.as_ref()],
        bump = mandate.bump,
        address = circle.mandate @ TenetError::AccountSubstitution,
        constraint = mandate.state == MandateState::Active @ TenetError::InvalidMandateState,
    )]
    pub mandate: Box<Account<'info, Mandate>>,

    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Box<Account<'info, Config>>,

    #[account(
        seeds = [EPOCH_SEED, circle.key().as_ref(), epoch.index.to_le_bytes().as_ref()],
        bump = epoch.bump,
        constraint = epoch.circle == circle.key() @ TenetError::AccountSubstitution,
        constraint = epoch.state == crate::state::EpochState::Completed @ TenetError::EpochNotFinalized,
        // Must be the most recently COMPLETED epoch — its NAV is the
        // denominator of the target-weight check, so an older one must not be
        // used. Proven in the handler: every epoch after it is passed as a
        // remaining account and must be Cancelled (A-24).
    )]
    pub epoch: Box<Account<'info, Epoch>>,

    #[account(
        constraint = mandate_asset_out.mandate == mandate.key() @ TenetError::AccountSubstitution,
        constraint = mandate_asset_out.mint == out_mint.key() @ TenetError::MintMismatch,
        constraint = mandate_asset_out.enabled @ TenetError::AssetNotInMandate,
    )]
    pub mandate_asset_out: Box<Account<'info, MandateAsset>>,

    #[account(
        mut,
        seeds = [CIRCLE_ASSET_SEED, circle.key().as_ref(), out_mint.key().as_ref()],
        bump = circle_asset_out.bump,
        constraint = circle_asset_out.circle == circle.key() @ TenetError::AccountSubstitution,
        constraint = circle_asset_out.mandate_asset == mandate_asset_out.key() @ TenetError::AccountSubstitution,
        constraint = circle_asset_out.status == AssetStatus::Active @ TenetError::RegistryEntryInactive,
    )]
    pub circle_asset_out: Box<Account<'info, CircleAsset>>,

    #[account(
        mut,
        seeds = [USDC_VAULT_SEED, circle.key().as_ref()],
        bump,
        constraint = source_vault.mint == config.usdc_mint @ TenetError::UnexpectedUsdcMint,
    )]
    pub source_vault: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        mut,
        address = circle_asset_out.vault @ TenetError::AccountSubstitution,
    )]
    pub dest_vault: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(address = config.usdc_mint @ TenetError::UnexpectedUsdcMint)]
    pub in_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(address = circle_asset_out.mint @ TenetError::MintMismatch)]
    pub out_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(
        constraint = source_token_program.key() == *source_vault.to_account_info().owner
            @ TenetError::TokenProgramMismatch,
    )]
    pub source_token_program: Interface<'info, TokenInterface>,

    #[account(
        constraint = dest_token_program.key() == *dest_vault.to_account_info().owner
            @ TenetError::TokenProgramMismatch,
    )]
    pub dest_token_program: Interface<'info, TokenInterface>,

    /// CHECK: PDA authority checked by seeds and the Circle's stored bump.
    #[account(seeds = [VAULT_AUTHORITY_SEED, circle.key().as_ref()], bump = circle.vault_authority_bump)]
    pub vault_authority: UncheckedAccount<'info>,

    #[account(
        init,
        payer = executor,
        space = 8 + ExecutionAuth::INIT_SPACE,
        seeds = [EXEC_AUTH_SEED, circle.key().as_ref(), epoch.key().as_ref(), nonce.to_le_bytes().as_ref()],
        bump,
    )]
    pub execution_auth: Box<Account<'info, ExecutionAuth>>,

    /// CHECK: address is the canonical Instructions sysvar.
    #[account(address = solana_instructions_sysvar::ID)]
    pub instructions_sysvar: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

/// A-24: the NAV basis is the most recent Completed epoch. Epochs after it
/// can only have been Cancelled (a timed-out valuation): they moved no capital
/// — their contributions sit in their own escrow until refunded — so the last
/// completed NAV is still the right basis. Each one must be passed, in order,
/// as a remaining account and proven Cancelled; any gap or other state refuses.
fn require_latest_completed<'info>(
    circle: &Account<'info, Circle>,
    epoch: &Account<'info, Epoch>,
    later: &'info [AccountInfo<'info>],
) -> Result<()> {
    let first_after = epoch.index.checked_add(1).ok_or(TenetError::MathOverflow)?;
    let gap = circle
        .current_epoch
        .checked_sub(first_after)
        .ok_or(TenetError::EpochIndexMismatch)?;
    require!(later.len() as u64 == gap, TenetError::EpochIndexMismatch);
    for (i, info) in later.iter().enumerate() {
        // try_from checks owner == this program and the Epoch discriminator.
        let e: Account<'info, Epoch> = Account::try_from(info)?;
        require_keys_eq!(e.circle, circle.key(), TenetError::AccountSubstitution);
        require!(e.index == first_after + i as u64, TenetError::EpochIndexMismatch);
        require!(e.state == crate::state::EpochState::Cancelled, TenetError::EpochIndexMismatch);
    }
    Ok(())
}

pub fn begin_handler<'info>(
    ctx: Context<'info, BeginExecution<'info>>,
    nonce: u64,
    max_in: u64,
    min_out: u64,
    expires_at: i64,
) -> Result<()> {
    require_latest_completed(&ctx.accounts.circle, &ctx.accounts.epoch, ctx.remaining_accounts)?;
    require!(max_in > 0, TenetError::AboveMaximumInput);
    require!(min_out > 0, TenetError::BelowMinimumOutput);
    require!(
        expires_at >= Clock::get()?.unix_timestamp,
        TenetError::AuthorizationExpired
    );
    require!(
        ctx.accounts.source_vault.delegate.is_none(),
        TenetError::ExistingVaultDelegate
    );
    require_keys_eq!(
        ctx.accounts.source_vault.owner,
        ctx.accounts.vault_authority.key(),
        TenetError::AccountSubstitution,
    );
    require_keys_eq!(
        ctx.accounts.dest_vault.owner,
        ctx.accounts.vault_authority.key(),
        TenetError::AccountSubstitution,
    );
    require_keys_eq!(
        ctx.accounts.circle_asset_out.token_program,
        *ctx.accounts.dest_vault.to_account_info().owner,
        TenetError::TokenProgramMismatch,
    );

    let available = ctx
        .accounts
        .source_vault
        .amount
        .checked_sub(ctx.accounts.circle.usdc_reserved_raw)
        .ok_or(TenetError::InsufficientUnreservedBalance)?;
    require!(
        max_in <= available,
        TenetError::InsufficientUnreservedBalance
    );
    validate_venue_window(
        &ctx.accounts.instructions_sysvar.to_account_info(),
        &ctx.accounts.config.execution_venue,
    )?;

    let auth = &mut ctx.accounts.execution_auth;
    auth.circle = ctx.accounts.circle.key();
    auth.epoch = ctx.accounts.epoch.key();
    auth.nonce = nonce;
    auth.executor = ctx.accounts.executor.key();
    auth.in_mint = ctx.accounts.in_mint.key();
    auth.out_mint = ctx.accounts.out_mint.key();
    auth.max_in = max_in;
    auth.min_out = min_out;
    auth.pre_in_balance = ctx.accounts.source_vault.amount;
    auth.pre_out_balance = ctx.accounts.dest_vault.amount;
    auth.expires_at = expires_at;
    auth.bump = ctx.bumps.execution_auth;

    // Let the executor move at most `max_in` of the Circle's USDC — and only
    // within this transaction: the window check above guarantees the next
    // instructions are the venue and then `end_execution`, which revokes it.
    let bump = [ctx.accounts.circle.vault_authority_bump];
    let circle_key = ctx.accounts.circle.key();
    let signer_seeds: &[&[u8]] = &[VAULT_AUTHORITY_SEED, circle_key.as_ref(), &bump];
    token_interface::approve(
        CpiContext::new_with_signer(
            ctx.accounts.source_token_program.key(),
            Approve {
                to: ctx.accounts.source_vault.to_account_info(),
                delegate: ctx.accounts.executor.to_account_info(),
                authority: ctx.accounts.vault_authority.to_account_info(),
            },
            &[signer_seeds],
        ),
        max_in,
    )?;
    Ok(())
}

#[derive(Accounts)]
pub struct EndExecution<'info> {
    #[account(mut)]
    pub executor: Signer<'info>,

    #[account(mut)]
    pub circle: Box<Account<'info, Circle>>,

    #[account(
        seeds = [MANDATE_SEED, mandate.mandate_seed.as_ref()],
        bump = mandate.bump,
        address = circle.mandate @ TenetError::AccountSubstitution,
        constraint = mandate.state == MandateState::Active @ TenetError::InvalidMandateState,
    )]
    pub mandate: Box<Account<'info, Mandate>>,

    #[account(
        mut,
        close = executor,
        seeds = [EXEC_AUTH_SEED, circle.key().as_ref(), epoch.key().as_ref(), execution_auth.nonce.to_le_bytes().as_ref()],
        bump = execution_auth.bump,
        constraint = execution_auth.circle == circle.key() @ TenetError::AuthorizationCircleMismatch,
        constraint = execution_auth.executor == executor.key() @ TenetError::AccountSubstitution,
    )]
    pub execution_auth: Box<Account<'info, ExecutionAuth>>,

    #[account(
        seeds = [EPOCH_SEED, circle.key().as_ref(), epoch.index.to_le_bytes().as_ref()],
        bump = epoch.bump,
        constraint = epoch.circle == circle.key() @ TenetError::AccountSubstitution,
        constraint = epoch.state == crate::state::EpochState::Completed @ TenetError::EpochNotFinalized,
    )]
    pub epoch: Box<Account<'info, Epoch>>,

    #[account(mut, address = execution_auth.in_mint @ TenetError::MintMismatch)]
    pub in_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(mut, address = execution_auth.out_mint @ TenetError::MintMismatch)]
    pub out_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(
        constraint = mandate_asset_out.mandate == mandate.key() @ TenetError::AccountSubstitution,
        constraint = mandate_asset_out.mint == execution_auth.out_mint @ TenetError::MintMismatch,
        constraint = mandate_asset_out.enabled @ TenetError::AssetNotInMandate,
    )]
    pub mandate_asset_out: Box<Account<'info, MandateAsset>>,

    #[account(
        address = mandate_asset_out.registry_entry @ TenetError::AccountSubstitution,
        constraint = registry_entry.mint == execution_auth.out_mint @ TenetError::MintMismatch,
    )]
    pub registry_entry: Box<Account<'info, AssetRegistryEntry>>,

    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Box<Account<'info, Config>>,

    /// CHECK: validated by `read_price`: owner must be `config.price_program`,
    /// then decoded as that source's layout and bound to the registry's feed.
    pub price_account: UncheckedAccount<'info>,

    #[account(
        mut,
        seeds = [USDC_VAULT_SEED, circle.key().as_ref()],
        bump,
    )]
    pub source_vault: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        seeds = [CIRCLE_ASSET_SEED, circle.key().as_ref(), execution_auth.out_mint.as_ref()],
        bump = circle_asset_out.bump,
        constraint = circle_asset_out.circle == circle.key() @ TenetError::AccountSubstitution,
        constraint = circle_asset_out.mint == execution_auth.out_mint @ TenetError::MintMismatch,
        constraint = circle_asset_out.status == AssetStatus::Active @ TenetError::RegistryEntryInactive,
    )]
    pub circle_asset_out: Box<Account<'info, CircleAsset>>,

    #[account(mut, address = circle_asset_out.vault @ TenetError::AccountSubstitution)]
    pub dest_vault: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        constraint = source_token_program.key() == *source_vault.to_account_info().owner
            @ TenetError::TokenProgramMismatch,
    )]
    pub source_token_program: Interface<'info, TokenInterface>,

    /// CHECK: PDA authority checked by seeds and the Circle's stored bump.
    #[account(seeds = [VAULT_AUTHORITY_SEED, circle.key().as_ref()], bump = circle.vault_authority_bump)]
    pub vault_authority: UncheckedAccount<'info>,
}

pub fn end_handler(ctx: Context<EndExecution>) -> Result<()> {
    let auth = &ctx.accounts.execution_auth;
    let now = Clock::get()?.unix_timestamp;
    require!(now <= auth.expires_at, TenetError::AuthorizationExpired);

    require_keys_eq!(
        ctx.accounts.source_vault.owner,
        ctx.accounts.vault_authority.key(),
        TenetError::AccountSubstitution
    );
    require_keys_eq!(
        ctx.accounts.dest_vault.owner,
        ctx.accounts.vault_authority.key(),
        TenetError::AccountSubstitution
    );
    require!(
        ctx.accounts.source_vault.mint == auth.in_mint,
        TenetError::MintMismatch
    );
    require!(
        ctx.accounts.dest_vault.mint == auth.out_mint,
        TenetError::MintMismatch
    );
    require_keys_eq!(
        ctx.accounts.registry_entry.token_program,
        *ctx.accounts.out_mint.to_account_info().owner,
        TenetError::TokenProgramMismatch,
    );
    require_keys_eq!(
        ctx.accounts.circle_asset_out.token_program,
        *ctx.accounts.dest_vault.to_account_info().owner,
        TenetError::TokenProgramMismatch,
    );

    let post_in = ctx.accounts.source_vault.amount;
    let post_out = ctx.accounts.dest_vault.amount;
    require!(
        post_in <= auth.pre_in_balance,
        TenetError::SourceBalanceIncreased
    );
    require!(
        post_out >= auth.pre_out_balance,
        TenetError::DestinationBalanceDecreased
    );

    let spent = auth
        .pre_in_balance
        .checked_sub(post_in)
        .ok_or(TenetError::MathUnderflow)?;
    let gained = post_out
        .checked_sub(auth.pre_out_balance)
        .ok_or(TenetError::MathUnderflow)?;
    require!(spent <= auth.max_in, TenetError::AboveMaximumInput);
    require!(gained >= auth.min_out, TenetError::BelowMinimumOutput);
    validate_supply_consumption(
        post_out,
        ctx.accounts.out_mint.supply,
        ctx.accounts.mandate.max_supply_consumption_bps,
    )?;
    let price = read_price(
        &ctx.accounts.config,
        &ctx.accounts.price_account.to_account_info(),
        &ctx.accounts.registry_entry.pyth_feed_tokenized,
    )?;
    let pyth_floor = pyth_min_output_raw(
        spent,
        ctx.accounts.registry_entry.decimals,
        ctx.accounts.registry_entry.effective_multiplier_e18,
        price,
        ctx.accounts.mandate.max_price_impact_bps,
    )?;
    require!(gained >= pyth_floor, TenetError::PriceImpactExceeded);

    // Target-weight enforcement (A-23). NAV after the most recent
    // finalization: the valued Circle before the epoch plus the USDC it
    // admitted. The asset's post-trade value — excluding tokens already owed
    // to exits — may not exceed its Mandate target share of that NAV.
    let nav = ctx
        .accounts
        .epoch
        .nav_before
        .checked_add(u128::from(ctx.accounts.epoch.pending_usdc_raw))
        .ok_or(TenetError::MathOverflow)?;
    require!(nav > 0, TenetError::ExecutionNavUnavailable);
    let held_raw = post_out
        .checked_sub(ctx.accounts.circle_asset_out.reserved_for_redemption_raw)
        .ok_or(TenetError::MathUnderflow)?;
    let value_after = pyth_value_usdc_raw(
        held_raw,
        ctx.accounts.registry_entry.decimals,
        ctx.accounts.registry_entry.effective_multiplier_e18,
        price,
    )?;
    let target_value = nav
        .checked_mul(u128::from(ctx.accounts.mandate_asset_out.target_weight_bps))
        .ok_or(TenetError::MathOverflow)?
        / 10_000u128;
    require!(value_after <= target_value, TenetError::TargetWeightExceeded);

    let bump = [ctx.accounts.circle.vault_authority_bump];
    let circle_key = ctx.accounts.circle.key();
    let signer_seeds: &[&[u8]] = &[VAULT_AUTHORITY_SEED, circle_key.as_ref(), &bump];
    let revoke = Revoke {
        source: ctx.accounts.source_vault.to_account_info(),
        authority: ctx.accounts.vault_authority.to_account_info(),
    };
    token_interface::revoke(CpiContext::new_with_signer(
        ctx.accounts.source_token_program.key(),
        revoke,
        &[signer_seeds],
    ))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{pyth_min_output_raw, pyth_value_usdc_raw, validate_supply_consumption, Price};
    use crate::errors::TenetError;

    const E18: u128 = 1_000_000_000_000_000_000;

    #[test]
    fn supply_cap_uses_raw_balance_and_live_supply() {
        assert!(validate_supply_consumption(100, 10_000, 100).is_ok());
        assert_eq!(
            validate_supply_consumption(101, 10_000, 100).unwrap_err(),
            TenetError::SupplyConsumptionCapExceeded.into()
        );
    }

    #[test]
    fn supply_cap_refuses_zero_supply() {
        assert_eq!(
            validate_supply_consumption(0, 0, 10_000).unwrap_err(),
            TenetError::InvalidRegistryMetadata.into()
        );
    }

    #[test]
    fn pyth_floor_is_integer_only_and_favours_the_circle() {
        let price = Price {
            price: 2_000,
            conf: 1,
            exponent: -2,
            publish_time: 0,
        };
        // $10 USDC at a $20.00 price buys 0.5 output units; a 1% impact
        // allowance leaves a 0.495-unit floor at six output decimals.
        assert_eq!(
            pyth_min_output_raw(10_000_000, 6, E18, price, 100).unwrap(),
            495_000
        );
    }

    #[test]
    fn pyth_floor_does_not_overflow_at_large_trade_sizes() {
        // $10M into a 9-decimal token at $0.01: the largest intermediate here.
        let price = Price { price: 10_000, conf: 1, exponent: -6, publish_time: 0 };
        assert_eq!(
            pyth_min_output_raw(10_000_000_000_000, 9, E18, price, 0).unwrap(),
            1_000_000_000_000_000_000
        );
    }

    #[test]
    fn pyth_floor_is_the_inverse_of_valuation_under_a_multiplier() {
        let price = Price { price: 2_000, conf: 1, exponent: -2, publish_time: 0 };
        // 2x multiplier: each raw unit is worth two economic units, so $10
        // justifies 0.25 raw units, not 0.5 (0.2475 after 1% impact).
        assert_eq!(pyth_min_output_raw(10_000_000, 6, 2 * E18, price, 100).unwrap(), 247_500);
        // Round trip: the unimpacted floor values back to the USDC spent.
        let raw = pyth_min_output_raw(10_000_000, 6, 2 * E18, price, 0).unwrap();
        assert_eq!(pyth_value_usdc_raw(raw, 6, 2 * E18, price).unwrap(), 10_000_000);
        assert!(pyth_min_output_raw(10_000_000, 6, 0, price, 0).is_err());
    }

    #[test]
    fn pyth_value_applies_multiplier_only_at_the_valuation_boundary() {
        let price = Price {
            price: 2_000,
            conf: 1,
            exponent: -2,
            publish_time: 0,
        };
        // 1.5 economic units at $20 = $30 = 30_000_000 raw USDC.
        assert_eq!(
            pyth_value_usdc_raw(1_500_000, 6, 1_000_000_000_000_000_000, price).unwrap(),
            30_000_000
        );
        // A 2x display multiplier changes valuation, never raw ownership.
        assert_eq!(
            pyth_value_usdc_raw(1_500_000, 6, 2_000_000_000_000_000_000, price).unwrap(),
            60_000_000
        );
    }
}
