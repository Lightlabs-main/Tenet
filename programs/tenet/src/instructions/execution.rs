//! Execution boundary — fail-closed raw-vault verification.
//!
//! This is the first half of EXECUTE. It deliberately does not pretend that a
//! client quote is an oracle: `begin_execution` only authorizes a bounded,
//! replay-protected Jupiter window, and `end_execution` verifies the actual
//! token-account deltas. The raw supply-consumption cap is enforced from the
//! live mint supply. Pyth freshness, feed binding, confidence, and the
//! price-impact floor are implemented in `end_execution`, but the whole route
//! remains disabled until target-feed and Jupiter-route verification is complete.

use anchor_lang::prelude::*;
use anchor_spl::token_interface::{self, Mint, Revoke, TokenAccount, TokenInterface};
use pyth_solana_receiver_sdk::price_update::{Price, PriceUpdateV2};

use crate::constants::*;
use crate::errors::TenetError;
use crate::state::{AssetRegistryEntry, AssetStatus, Circle, CircleAsset, CircleState, Config, Epoch, ExecutionAuth, Mandate, MandateAsset, MandateState};

const END_EXECUTION_DISCRIMINATOR: &[u8; 8] = &[167, 104, 37, 207, 92, 147, 230, 237];
const MAX_EXECUTION_PRICE_AGE_SECONDS: u64 = 60;
const MAX_PYTH_CONFIDENCE_BPS: u16 = 100;
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
    require!(consumed <= allowed, TenetError::SupplyConsumptionCapExceeded);
    Ok(())
}

pub(crate) fn validate_pyth_price(price_update: &PriceUpdateV2, feed_id: &[u8; 32]) -> Result<Price> {
    let price = price_update
        .get_price_no_older_than(&Clock::get()?, MAX_EXECUTION_PRICE_AGE_SECONDS, feed_id)
        .map_err(|_| error!(TenetError::PriceObservationUnavailable))?;
    require!(price.price > 0, TenetError::PriceNotPositive);

    let price_abs = u128::try_from(price.price).map_err(|_| error!(TenetError::PriceNotPositive))?;
    let confidence_bps = u128::from(price.conf)
        .checked_mul(10_000)
        .and_then(|v| v.checked_add(price_abs - 1))
        .ok_or(TenetError::PriceArithmeticOverflow)?
        / price_abs;
    require!(confidence_bps <= u128::from(MAX_PYTH_CONFIDENCE_BPS), TenetError::PriceConfidenceTooWide);
    Ok(price)
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
            .checked_mul(power_of_ten(u32::try_from(scale).map_err(|_| error!(TenetError::PriceArithmeticOverflow))?)?)
            .ok_or(TenetError::PriceArithmeticOverflow)?;
    } else {
        let divisor = u32::try_from(scale.unsigned_abs())
            .map_err(|_| error!(TenetError::PriceArithmeticOverflow))?;
        value /= power_of_ten(divisor)?;
    }
    Ok(value)
}

/// Convert the Pyth USD price into a conservative minimum raw output. The
/// computation stays integer-only and floors in the Circle's favour.
fn pyth_min_output_raw(
    spent_usdc_raw: u64,
    output_decimals: u8,
    price: Price,
    max_impact_bps: u16,
) -> Result<u64> {
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

    let fair_raw = numerator / denominator;
    let protection_bps = 10_000u16
        .checked_sub(max_impact_bps)
        .ok_or(TenetError::PriceArithmeticOverflow)?;
    let protected = fair_raw
        .checked_mul(u128::from(protection_bps))
        .ok_or(TenetError::PriceArithmeticOverflow)?
        / 10_000u128;
    u64::try_from(protected).map_err(|_| error!(TenetError::PriceArithmeticOverflow))
}

/// Prove that the remainder of this transaction is exactly a Jupiter window
/// followed by Tenet's matching end instruction. Setup/cleanup instructions
/// must be placed outside the window by the transaction builder.
fn validate_jupiter_window(instructions_sysvar: &AccountInfo) -> Result<()> {
    use solana_instructions_sysvar::{load_current_index_checked, load_instruction_at_checked};

    let current = load_current_index_checked(instructions_sysvar)
        .map_err(|_| error!(TenetError::IncompleteExecutionWindow))? as usize;
    let mut saw_jupiter = false;
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
        if instruction.program_id != JUPITER_PROGRAM_ID {
            return err!(TenetError::UnexpectedInstructionInWindow);
        }
        saw_jupiter = true;
    }

    require!(saw_jupiter && saw_end, TenetError::IncompleteExecutionWindow);
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

pub fn begin_handler(
    ctx: Context<BeginExecution>,
    nonce: u64,
    max_in: u64,
    min_out: u64,
    expires_at: i64,
) -> Result<()> {
    let _ = nonce;
    require!(max_in > 0, TenetError::AboveMaximumInput);
    require!(min_out > 0, TenetError::BelowMinimumOutput);
    require!(expires_at >= Clock::get()?.unix_timestamp, TenetError::AuthorizationExpired);
    require!(ctx.accounts.source_vault.delegate.is_none(), TenetError::ExistingVaultDelegate);

    let available = ctx
        .accounts
        .source_vault
        .amount
        .checked_sub(ctx.accounts.circle.usdc_reserved_raw)
        .ok_or(TenetError::InsufficientUnreservedBalance)?;
    require!(max_in <= available, TenetError::InsufficientUnreservedBalance);
    validate_jupiter_window(&ctx.accounts.instructions_sysvar.to_account_info())?;

    // Until verified price observations are wired into the instruction, do not
    // authorize a production swap. This keeps the new boundary present in the
    // IDL without weakening Mandate price-impact policy.
    return err!(TenetError::ExecutionPricePolicyUnavailable);
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

    /// Pyth Receiver `PriceUpdateV2`; freshness, feed binding, and confidence
    /// are checked in the handler before any price-dependent cap is applied.
    pub price_update: Box<Account<'info, PriceUpdateV2>>,

    #[account(
        mut,
        seeds = [USDC_VAULT_SEED, circle.key().as_ref()],
        bump,
        address = execution_auth.in_mint @ TenetError::MintMismatch,
    )]
    pub source_vault: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        seeds = [CIRCLE_ASSET_SEED, circle.key().as_ref(), execution_auth.out_mint.as_ref()],
        bump = circle_asset_out.bump,
        constraint = circle_asset_out.circle == circle.key() @ TenetError::AccountSubstitution,
        constraint = circle_asset_out.mint == execution_auth.out_mint @ TenetError::MintMismatch,
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

    require_keys_eq!(ctx.accounts.source_vault.owner, ctx.accounts.vault_authority.key(), TenetError::AccountSubstitution);
    require_keys_eq!(ctx.accounts.dest_vault.owner, ctx.accounts.vault_authority.key(), TenetError::AccountSubstitution);
    require!(ctx.accounts.source_vault.mint == auth.in_mint, TenetError::MintMismatch);
    require!(ctx.accounts.dest_vault.mint == auth.out_mint, TenetError::MintMismatch);
    require_keys_eq!(
        ctx.accounts.registry_entry.token_program,
        *ctx.accounts.out_mint.to_account_info().owner,
        TenetError::TokenProgramMismatch,
    );

    let post_in = ctx.accounts.source_vault.amount;
    let post_out = ctx.accounts.dest_vault.amount;
    require!(post_in <= auth.pre_in_balance, TenetError::SourceBalanceIncreased);
    require!(post_out >= auth.pre_out_balance, TenetError::DestinationBalanceDecreased);

    let spent = auth.pre_in_balance.checked_sub(post_in).ok_or(TenetError::MathUnderflow)?;
    let gained = post_out.checked_sub(auth.pre_out_balance).ok_or(TenetError::MathUnderflow)?;
    require!(spent <= auth.max_in, TenetError::AboveMaximumInput);
    require!(gained >= auth.min_out, TenetError::BelowMinimumOutput);
    validate_supply_consumption(
        post_out,
        ctx.accounts.out_mint.supply,
        ctx.accounts.mandate.max_supply_consumption_bps,
    )?;
    let price = validate_pyth_price(
        &ctx.accounts.price_update,
        &ctx.accounts.registry_entry.pyth_feed_tokenized,
    )?;
    let pyth_floor = pyth_min_output_raw(
        spent,
        ctx.accounts.registry_entry.decimals,
        price,
        ctx.accounts.mandate.max_price_impact_bps,
    )?;
    require!(gained >= pyth_floor, TenetError::PriceImpactExceeded);

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
        let price = Price { price: 2_000, conf: 1, exponent: -2, publish_time: 0 };
        // $10 USDC at a $20.00 price buys 0.5 output units; a 1% impact
        // allowance leaves a 0.495-unit floor at six output decimals.
        assert_eq!(pyth_min_output_raw(10_000_000, 6, price, 100).unwrap(), 495_000);
    }

    #[test]
    fn pyth_value_applies_multiplier_only_at_the_valuation_boundary() {
        let price = Price { price: 2_000, conf: 1, exponent: -2, publish_time: 0 };
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
