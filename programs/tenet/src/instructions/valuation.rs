//! On-chain valuation admission for rolling Epoch pricing.
//!
//! A snapshot is accumulated across bounded transactions. It reads the actual
//! vault balances, excludes already-reserved exit claims, and prices each
//! asset through the price adapter (`crate::price`): Pyth on mainnet, the
//! tenet-devnet feed on Devnet, identical checks on both. No client NAV or UI
//! quantity is accepted.

use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount};

use crate::constants::*;
use crate::errors::TenetError;
use crate::instructions::execution::pyth_value_usdc_raw;
use crate::price::read_price;
use crate::math;
use crate::state::{
    AssetRegistryEntry, Circle, CircleAsset, Config, Epoch, EpochState, MandateAsset, NavSnapshot,
};

#[derive(Accounts)]
pub struct OpenNavSnapshot<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(
        mut,
        seeds = [CIRCLE_SEED, circle.mandate.as_ref()],
        bump = circle.bump,
        constraint = circle.pending_reservations == 0 @ TenetError::RedemptionPending,
        constraint = !circle.execution_frozen @ TenetError::NavSnapshotOpen,
        constraint = circle.total_shares > 0 @ TenetError::RollingEpochsDisabled,
    )]
    pub circle: Box<Account<'info, Circle>>,

    #[account(
        seeds = [EPOCH_SEED, circle.key().as_ref(), epoch.index.to_le_bytes().as_ref()],
        bump = epoch.bump,
        constraint = epoch.circle == circle.key() @ TenetError::AccountSubstitution,
        constraint = epoch.state == EpochState::Closed @ TenetError::EpochNotClosed,
    )]
    pub epoch: Box<Account<'info, Epoch>>,

    #[account(
        init,
        payer = payer,
        space = 8 + NavSnapshot::INIT_SPACE,
        seeds = [NAV_SNAPSHOT_SEED, epoch.key().as_ref()],
        bump,
    )]
    pub nav_snapshot: Box<Account<'info, NavSnapshot>>,

    #[account(seeds = [USDC_VAULT_SEED, circle.key().as_ref()], bump)]
    pub active_usdc_vault: Box<InterfaceAccount<'info, TokenAccount>>,

    /// CHECK: PDA with no data; only identifies the Circle vault authority.
    #[account(seeds = [VAULT_AUTHORITY_SEED, circle.key().as_ref()], bump = circle.vault_authority_bump)]
    pub vault_authority: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

pub fn open_nav_snapshot_handler(ctx: Context<OpenNavSnapshot>) -> Result<()> {
    let circle = &mut ctx.accounts.circle;
    require_keys_eq!(
        ctx.accounts.active_usdc_vault.owner,
        ctx.accounts.vault_authority.key(),
        TenetError::AccountSubstitution
    );

    let active_usdc = math::checked_sub_u64(
        ctx.accounts.active_usdc_vault.amount,
        circle.usdc_reserved_raw,
    )?;
    let snapshot = &mut ctx.accounts.nav_snapshot;
    snapshot.circle = circle.key();
    snapshot.epoch = ctx.accounts.epoch.key();
    snapshot.slot_opened = Clock::get()?.slot;
    snapshot.nav_accum = u128::from(active_usdc);
    snapshot.assets_remaining = circle.asset_count;
    snapshot.recorded_bitmap = 0;
    snapshot.bump = ctx.bumps.nav_snapshot;
    circle.execution_frozen = true;
    Ok(())
}

#[derive(Accounts)]
pub struct RecordAssetNav<'info> {
    pub payer: Signer<'info>,

    #[account(
        seeds = [CIRCLE_SEED, circle.mandate.as_ref()],
        bump = circle.bump,
        constraint = circle.execution_frozen @ TenetError::NavSnapshotOpen,
    )]
    pub circle: Box<Account<'info, Circle>>,

    #[account(
        seeds = [EPOCH_SEED, circle.key().as_ref(), epoch.index.to_le_bytes().as_ref()],
        bump = epoch.bump,
        constraint = epoch.circle == circle.key() @ TenetError::AccountSubstitution,
        constraint = epoch.state == EpochState::Closed @ TenetError::EpochNotClosed,
    )]
    pub epoch: Box<Account<'info, Epoch>>,

    #[account(
        mut,
        seeds = [NAV_SNAPSHOT_SEED, epoch.key().as_ref()],
        bump = nav_snapshot.bump,
        constraint = nav_snapshot.circle == circle.key() @ TenetError::AccountSubstitution,
        constraint = nav_snapshot.epoch == epoch.key() @ TenetError::AccountSubstitution,
    )]
    pub nav_snapshot: Box<Account<'info, NavSnapshot>>,

    #[account(
        seeds = [CIRCLE_ASSET_SEED, circle.key().as_ref(), circle_asset.mint.as_ref()],
        bump = circle_asset.bump,
        constraint = circle_asset.circle == circle.key() @ TenetError::AccountSubstitution,
    )]
    pub circle_asset: Box<Account<'info, CircleAsset>>,

    #[account(
        seeds = [MANDATE_ASSET_SEED, circle.mandate.as_ref(), circle_asset.mint.as_ref()],
        bump = mandate_asset.bump,
        constraint = mandate_asset.mandate == circle.mandate @ TenetError::AccountSubstitution,
        constraint = mandate_asset.key() == circle_asset.mandate_asset @ TenetError::AccountSubstitution,
    )]
    pub mandate_asset: Box<Account<'info, MandateAsset>>,

    #[account(
        seeds = [REGISTRY_SEED, circle_asset.mint.as_ref()],
        bump = registry_entry.bump,
        constraint = registry_entry.mint == circle_asset.mint @ TenetError::MintMismatch,
        constraint = registry_entry.key() == mandate_asset.registry_entry @ TenetError::AccountSubstitution,
    )]
    pub registry_entry: Box<Account<'info, AssetRegistryEntry>>,

    #[account(address = circle_asset.vault @ TenetError::AccountSubstitution)]
    pub vault: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(address = circle_asset.mint @ TenetError::MintMismatch)]
    pub mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Box<Account<'info, Config>>,

    /// CHECK: validated by `read_price`: owner must be `config.price_program`,
    /// then decoded as that source's layout and bound to the registry's feed.
    pub price_account: UncheckedAccount<'info>,

    /// CHECK: PDA with no data; validates the token account's authority.
    #[account(seeds = [VAULT_AUTHORITY_SEED, circle.key().as_ref()], bump = circle.vault_authority_bump)]
    pub vault_authority: UncheckedAccount<'info>,
}

pub fn record_asset_nav_handler(ctx: Context<RecordAssetNav>) -> Result<()> {
    let clock = Clock::get()?;
    let snapshot = &mut ctx.accounts.nav_snapshot;
    let elapsed = clock
        .slot
        .checked_sub(snapshot.slot_opened)
        .ok_or(TenetError::NavSnapshotExpired)?;
    require!(
        elapsed <= NAV_SNAPSHOT_MAX_SLOTS,
        TenetError::NavSnapshotExpired
    );
    require!(
        snapshot.assets_remaining > 0,
        TenetError::NavSnapshotIncomplete
    );

    let circle_asset = &ctx.accounts.circle_asset;
    require!(
        circle_asset.index < u16::BITS as u16,
        TenetError::TooManyAssets
    );
    let bit = 1u16
        .checked_shl(circle_asset.index as u32)
        .ok_or(TenetError::TooManyAssets)?;
    require!(
        ctx.accounts.circle.asset_bitmap & bit != 0,
        TenetError::AccountSubstitution
    );
    require!(
        snapshot.recorded_bitmap & bit == 0,
        TenetError::AssetAlreadyRecorded
    );
    require_keys_eq!(
        ctx.accounts.vault.owner,
        ctx.accounts.vault_authority.key(),
        TenetError::AccountSubstitution
    );
    require_keys_eq!(
        *ctx.accounts.vault.to_account_info().owner,
        circle_asset.token_program,
        TenetError::TokenProgramMismatch
    );

    // Refreshes are permissionless observations. Requiring a recent refresh
    // prevents a stale ScaledUiAmount effective multiplier from silently
    // entering NAV while keeping raw balances authoritative.
    let metadata_age = clock
        .slot
        .checked_sub(ctx.accounts.registry_entry.last_verified_slot)
        .ok_or(TenetError::PriceObservationUnavailable)?;
    require!(
        metadata_age <= NAV_SNAPSHOT_MAX_SLOTS,
        TenetError::PriceObservationUnavailable
    );

    let price = read_price(
        &ctx.accounts.config,
        &ctx.accounts.price_account.to_account_info(),
        &ctx.accounts.registry_entry.pyth_feed_tokenized,
    )?;
    let available_raw = math::checked_sub_u64(
        ctx.accounts.vault.amount,
        circle_asset.reserved_for_redemption_raw,
    )?;
    let value = pyth_value_usdc_raw(
        available_raw,
        ctx.accounts.mint.decimals,
        ctx.accounts.registry_entry.effective_multiplier_e18,
        price,
    )?;
    snapshot.nav_accum = snapshot
        .nav_accum
        .checked_add(value)
        .ok_or(TenetError::PriceArithmeticOverflow)?;
    snapshot.recorded_bitmap |= bit;
    snapshot.assets_remaining = snapshot
        .assets_remaining
        .checked_sub(1)
        .ok_or(TenetError::MathUnderflow)?;
    Ok(())
}

/// Permissionless recovery for a closed rolling epoch when its oracle window
/// was never opened or has expired. Contributors can then use the existing
/// owner-only `cancel_contribution` path to recover escrowed USDC.
#[derive(Accounts)]
pub struct CancelEpoch<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(
        mut,
        seeds = [CIRCLE_SEED, circle.mandate.as_ref()],
        bump = circle.bump,
        constraint = circle.pending_reservations == 0 @ TenetError::RedemptionPending,
    )]
    pub circle: Account<'info, Circle>,

    #[account(
        mut,
        seeds = [EPOCH_SEED, circle.key().as_ref(), epoch.index.to_le_bytes().as_ref()],
        bump = epoch.bump,
        constraint = epoch.circle == circle.key() @ TenetError::AccountSubstitution,
        constraint = epoch.state == EpochState::Closed @ TenetError::EpochNotClosed,
        constraint = circle.total_shares > 0 @ TenetError::RollingEpochsDisabled,
        // Only the Circle's current window can be Closed; asserted, not assumed.
        constraint = epoch.index == circle.current_epoch @ TenetError::EpochIndexMismatch,
    )]
    pub epoch: Account<'info, Epoch>,

    /// Optional because cancellation may happen before a snapshot is opened.
    #[account(mut, close = payer)]
    pub nav_snapshot: Option<Account<'info, NavSnapshot>>,
}

pub fn cancel_epoch_handler(ctx: Context<CancelEpoch>) -> Result<()> {
    let clock = Clock::get()?;
    if let Some(snapshot) = ctx.accounts.nav_snapshot.as_ref() {
        require_keys_eq!(
            snapshot.circle,
            ctx.accounts.circle.key(),
            TenetError::AccountSubstitution
        );
        require_keys_eq!(
            snapshot.epoch,
            ctx.accounts.epoch.key(),
            TenetError::AccountSubstitution
        );
        let elapsed = clock
            .slot
            .checked_sub(snapshot.slot_opened)
            .ok_or(TenetError::NavSnapshotExpired)?;
        require!(
            elapsed > NAV_SNAPSHOT_MAX_SLOTS,
            TenetError::NavSnapshotExpired
        );
    } else {
        let grace_deadline = ctx
            .accounts
            .epoch
            .closes_at
            .checked_add(NAV_CANCELLATION_GRACE_SECONDS)
            .ok_or(TenetError::MathOverflow)?;
        require!(
            clock.unix_timestamp >= grace_deadline,
            TenetError::NavSnapshotExpired
        );
    }
    ctx.accounts.epoch.state = EpochState::Cancelled;
    ctx.accounts.circle.execution_frozen = false;
    // A-24: the cancelled window is finished; the next one may open.
    // Contributors refund from this epoch's own escrow (cancel_contribution
    // accepts Cancelled), and execution keeps using the last Completed NAV.
    let circle = &mut ctx.accounts.circle;
    circle.current_epoch = circle.current_epoch.checked_add(1).ok_or(TenetError::MathOverflow)?;
    Ok(())
}
