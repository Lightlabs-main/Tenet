//! Exit — Phase 3, built before execution on purpose: if members cannot
//! retrieve their proportional assets, no capital deployment gets built.
//!
//!   initiate_redemption → reserve_redemption_asset* + reserve_redemption_usdc
//!     → claim_redemption_asset* / claim_redemption_usdc
//!
//! Rules that hold throughout:
//! - **No price, no oracle, no approval** (RULE 6). An exiting member receives
//!   `floor((vault − reserved) × s / S)` of EACH asset, in kind. Nothing here
//!   can be blocked by a stale price or an absent admin.
//! - **Exits are serialized (A-22, REVIEW.md H-02).** A new exit cannot start
//!   while another has unreserved assets; otherwise whichever reserves first
//!   takes value from the other. Reservation is permissionless and moves no
//!   tokens, so no issuer can block it and anyone can push an exit through.
//! - **Each asset is claimed separately.** A paused mint, frozen account or
//!   rejecting transfer hook fails only that asset's claim; every other claim
//!   still works (spec §65).
//! - **The exiting member bears transfer fees.** Token-2022 withholds the fee
//!   from what arrives; the vault is debited exactly the entitled amount. No
//!   Circle USDC reimburses it (INV-015).

use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

use crate::constants::*;
use crate::errors::TenetError;
use crate::instructions::epoch::transfer_signed;
use crate::math;
use crate::state::{Circle, CircleAsset, Member, Redemption, RedemptionAsset};

// ================================================================ initiate

#[derive(Accounts)]
pub struct InitiateRedemption<'info> {
    #[account(mut)]
    pub member_owner: Signer<'info>,

    #[account(
        mut,
        seeds = [CIRCLE_SEED, circle.mandate.as_ref()],
        bump = circle.bump,
        // A-22: one exit reserving at a time.
        constraint = circle.pending_reservations == 0 @ TenetError::RedemptionPending,
        // A NAV snapshot in progress must not see shares vanish under it.
        constraint = !circle.execution_frozen @ TenetError::NavSnapshotOpen,
    )]
    pub circle: Account<'info, Circle>,

    #[account(
        mut,
        seeds = [MEMBER_SEED, circle.key().as_ref(), member_owner.key().as_ref()],
        bump = member.bump,
    )]
    pub member: Account<'info, Member>,

    #[account(
        init,
        payer = member_owner,
        space = 8 + Redemption::INIT_SPACE,
        seeds = [
            REDEMPTION_SEED,
            circle.key().as_ref(),
            member_owner.key().as_ref(),
            &member.next_redemption_seq.to_le_bytes(),
        ],
        bump,
    )]
    pub redemption: Account<'info, Redemption>,

    pub system_program: Program<'info, System>,
}

pub fn initiate_handler(ctx: Context<InitiateRedemption>, shares: u64) -> Result<()> {
    require!(shares > 0, TenetError::ZeroShares);
    let member = &mut ctx.accounts.member;
    require!(shares <= member.shares, TenetError::InsufficientShares);

    let circle = &mut ctx.accounts.circle;
    let now = Clock::get()?.unix_timestamp;

    let r = &mut ctx.accounts.redemption;
    r.circle = circle.key();
    r.owner = ctx.accounts.member_owner.key();
    r.seq = member.next_redemption_seq;
    r.shares_redeemed = shares;
    // S is taken BEFORE this exit's shares leave the supply.
    r.total_shares_at_snapshot = circle.total_shares;
    // Exactly the vaults in the snapshot, plus USDC. Derived from the same
    // bitmap the reservations are checked against, so the count and the set of
    // reservable assets cannot disagree.
    r.asset_bitmap_at_snapshot = circle.asset_bitmap;
    r.assets_remaining = (circle.asset_bitmap.count_ones() as u16)
        .checked_add(1)
        .ok_or(TenetError::MathOverflow)?;
    r.initiated_at = now;
    // Reservation is permissionless from the start, so there is no window in
    // which only the owner may act; the deadline is informational (R-20).
    r.reservation_deadline = now;
    r.bump = ctx.bumps.redemption;

    member.shares = math::checked_sub_u64(member.shares, shares)?;
    member.next_redemption_seq = member
        .next_redemption_seq
        .checked_add(1)
        .ok_or(TenetError::MathOverflow)?;
    circle.total_shares = math::checked_sub_u64(circle.total_shares, shares)?;
    if member.shares == 0 {
        circle.member_count = circle
            .member_count
            .checked_sub(1)
            .ok_or(TenetError::MathUnderflow)?;
    }
    circle.pending_reservations = circle
        .pending_reservations
        .checked_add(1)
        .ok_or(TenetError::MathOverflow)?;
    Ok(())
}

/// Shared tail of both reserve instructions: count one reservation, and clear
/// the Circle's pending flag when the exit's last asset is reserved.
fn record_reservation(circle: &mut Circle, redemption: &mut Redemption) -> Result<()> {
    redemption.assets_remaining = redemption
        .assets_remaining
        .checked_sub(1)
        .ok_or(TenetError::NothingToReserve)?;
    if redemption.assets_remaining == 0 {
        circle.pending_reservations = circle
            .pending_reservations
            .checked_sub(1)
            .ok_or(TenetError::MathUnderflow)?;
    }
    Ok(())
}

// ================================================================ reserve asset

/// Permissionless: anyone may reserve any asset of any exit. The entitlement is
/// a pure function of on-chain state, so the caller cannot influence it.
#[derive(Accounts)]
pub struct ReserveRedemptionAsset<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(mut, seeds = [CIRCLE_SEED, circle.mandate.as_ref()], bump = circle.bump)]
    pub circle: Account<'info, Circle>,

    #[account(
        mut,
        seeds = [REDEMPTION_SEED, circle.key().as_ref(), redemption.owner.as_ref(), &redemption.seq.to_le_bytes()],
        bump = redemption.bump,
        constraint = redemption.assets_remaining > 0 @ TenetError::NothingToReserve,
    )]
    pub redemption: Account<'info, Redemption>,

    /// Seeds bind it to THIS circle; the snapshot bitmap binds it to this exit.
    #[account(
        mut,
        seeds = [CIRCLE_ASSET_SEED, circle.key().as_ref(), circle_asset.mint.as_ref()],
        bump = circle_asset.bump,
        constraint = (circle_asset.index as u32) < u16::BITS
            && redemption.asset_bitmap_at_snapshot & (1u16 << circle_asset.index) != 0
            @ TenetError::AssetNotInSnapshot,
    )]
    pub circle_asset: Account<'info, CircleAsset>,

    /// The vault balance read here is canonical.
    #[account(address = circle_asset.vault @ TenetError::AccountSubstitution)]
    pub vault: InterfaceAccount<'info, TokenAccount>,

    /// Mint in the seed: reserving the same asset twice for one exit is
    /// impossible — the account already exists.
    #[account(
        init,
        payer = payer,
        space = 8 + RedemptionAsset::INIT_SPACE,
        seeds = [REDEMPTION_ASSET_SEED, redemption.key().as_ref(), circle_asset.mint.as_ref()],
        bump,
    )]
    pub redemption_asset: Account<'info, RedemptionAsset>,

    pub system_program: Program<'info, System>,
}

pub fn reserve_asset_handler(ctx: Context<ReserveRedemptionAsset>) -> Result<()> {
    let (expected_authority, _) = Pubkey::find_program_address(
        &[VAULT_AUTHORITY_SEED, ctx.accounts.circle.key().as_ref()],
        &crate::ID,
    );
    require_keys_eq!(
        ctx.accounts.vault.mint,
        ctx.accounts.circle_asset.mint,
        TenetError::MintMismatch
    );
    require_keys_eq!(
        ctx.accounts.vault.owner,
        expected_authority,
        TenetError::AccountSubstitution
    );

    let ca = &mut ctx.accounts.circle_asset;
    let r = &mut ctx.accounts.redemption;

    // Existing reservations are subtracted first, or concurrent obligations
    // would be counted twice (REVIEW.md H-01, accounting.md §6).
    let available =
        math::checked_sub_u64(ctx.accounts.vault.amount, ca.reserved_for_redemption_raw)?;
    let entitled =
        math::entitlement_for_redemption(available, r.shares_redeemed, r.total_shares_at_snapshot)?;
    ca.reserved_for_redemption_raw =
        math::checked_add_u64(ca.reserved_for_redemption_raw, entitled)?;

    let ra = &mut ctx.accounts.redemption_asset;
    ra.redemption = r.key();
    ra.mint = ca.mint;
    ra.amount_raw = entitled;
    ra.claimed = false;
    ra.bump = ctx.bumps.redemption_asset;

    record_reservation(&mut ctx.accounts.circle, r)
}

// ================================================================ reserve USDC

#[derive(Accounts)]
pub struct ReserveRedemptionUsdc<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(mut, seeds = [CIRCLE_SEED, circle.mandate.as_ref()], bump = circle.bump)]
    pub circle: Account<'info, Circle>,

    #[account(
        mut,
        seeds = [REDEMPTION_SEED, circle.key().as_ref(), redemption.owner.as_ref(), &redemption.seq.to_le_bytes()],
        bump = redemption.bump,
        constraint = redemption.assets_remaining > 0 @ TenetError::NothingToReserve,
    )]
    pub redemption: Account<'info, Redemption>,

    /// ACTIVE capital only. Epoch escrows are not Circle capital and are never
    /// part of an exit (INV-002).
    #[account(seeds = [USDC_VAULT_SEED, circle.key().as_ref()], bump)]
    pub active_usdc_vault: InterfaceAccount<'info, TokenAccount>,

    #[account(
        init,
        payer = payer,
        space = 8 + RedemptionAsset::INIT_SPACE,
        seeds = [REDEMPTION_ASSET_SEED, redemption.key().as_ref(), active_usdc_vault.mint.as_ref()],
        bump,
    )]
    pub redemption_asset: Account<'info, RedemptionAsset>,

    pub system_program: Program<'info, System>,
}

pub fn reserve_usdc_handler(ctx: Context<ReserveRedemptionUsdc>) -> Result<()> {
    let circle = &mut ctx.accounts.circle;
    let r = &mut ctx.accounts.redemption;

    let (expected_authority, _) =
        Pubkey::find_program_address(&[VAULT_AUTHORITY_SEED, circle.key().as_ref()], &crate::ID);
    require_keys_eq!(
        ctx.accounts.active_usdc_vault.owner,
        expected_authority,
        TenetError::AccountSubstitution
    );

    let available = math::checked_sub_u64(
        ctx.accounts.active_usdc_vault.amount,
        circle.usdc_reserved_raw,
    )?;
    let entitled =
        math::entitlement_for_redemption(available, r.shares_redeemed, r.total_shares_at_snapshot)?;
    circle.usdc_reserved_raw = math::checked_add_u64(circle.usdc_reserved_raw, entitled)?;

    let ra = &mut ctx.accounts.redemption_asset;
    ra.redemption = r.key();
    ra.mint = ctx.accounts.active_usdc_vault.mint;
    ra.amount_raw = entitled;
    ra.claimed = false;
    ra.bump = ctx.bumps.redemption_asset;

    record_reservation(circle, r)
}

// ================================================================ claim asset

/// Pay a reserved entitlement out of a Circle vault. A zero entitlement makes
/// no CPI at all, so a paused mint cannot block closing out a claim for 0.
#[allow(clippy::too_many_arguments)]
fn pay_out<'info>(
    token_program: &Interface<'info, TokenInterface>,
    vault: AccountInfo<'info>,
    mint: &InterfaceAccount<'info, Mint>,
    to: AccountInfo<'info>,
    vault_authority: AccountInfo<'info>,
    circle: &Pubkey,
    vault_authority_bump: u8,
    amount: u64,
) -> Result<()> {
    if amount == 0 {
        return Ok(());
    }
    transfer_signed(
        token_program,
        vault,
        mint,
        to,
        vault_authority,
        circle,
        vault_authority_bump,
        amount,
    )
}

#[derive(Accounts)]
pub struct ClaimRedemptionAsset<'info> {
    #[account(mut)]
    pub member_owner: Signer<'info>,

    #[account(seeds = [CIRCLE_SEED, circle.mandate.as_ref()], bump = circle.bump)]
    pub circle: Account<'info, Circle>,

    #[account(
        seeds = [REDEMPTION_SEED, circle.key().as_ref(), member_owner.key().as_ref(), &redemption.seq.to_le_bytes()],
        bump = redemption.bump,
    )]
    pub redemption: Account<'info, Redemption>,

    #[account(
        mut,
        seeds = [CIRCLE_ASSET_SEED, circle.key().as_ref(), circle_asset.mint.as_ref()],
        bump = circle_asset.bump,
    )]
    pub circle_asset: Account<'info, CircleAsset>,

    /// Closed on claim, rent to the member: a second claim finds no account.
    #[account(
        mut,
        close = member_owner,
        seeds = [REDEMPTION_ASSET_SEED, redemption.key().as_ref(), circle_asset.mint.as_ref()],
        bump = redemption_asset.bump,
        constraint = !redemption_asset.claimed @ TenetError::AlreadyClaimed,
    )]
    pub redemption_asset: Account<'info, RedemptionAsset>,

    #[account(mut, address = circle_asset.vault @ TenetError::AccountSubstitution)]
    pub vault: InterfaceAccount<'info, TokenAccount>,

    #[account(address = circle_asset.mint @ TenetError::MintMismatch)]
    pub mint: InterfaceAccount<'info, Mint>,

    /// Recorded at vault creation from the mint's owner; never assumed.
    #[account(address = circle_asset.token_program @ TenetError::TokenProgramMismatch)]
    pub token_program: Interface<'info, TokenInterface>,

    /// The member's own account for this asset.
    #[account(
        mut,
        token::mint = mint,
        token::authority = member_owner,
        token::token_program = token_program,
    )]
    pub member_token_account: InterfaceAccount<'info, TokenAccount>,

    /// CHECK: PDA with no data; signs the payout.
    #[account(seeds = [VAULT_AUTHORITY_SEED, circle.key().as_ref()], bump = circle.vault_authority_bump)]
    pub vault_authority: UncheckedAccount<'info>,
}

pub fn claim_asset_handler(ctx: Context<ClaimRedemptionAsset>) -> Result<()> {
    let (expected_authority, _) = Pubkey::find_program_address(
        &[VAULT_AUTHORITY_SEED, ctx.accounts.circle.key().as_ref()],
        &crate::ID,
    );
    require_keys_eq!(
        ctx.accounts.vault.owner,
        expected_authority,
        TenetError::AccountSubstitution
    );

    let amount = ctx.accounts.redemption_asset.amount_raw;
    pay_out(
        &ctx.accounts.token_program,
        ctx.accounts.vault.to_account_info(),
        &ctx.accounts.mint,
        ctx.accounts.member_token_account.to_account_info(),
        ctx.accounts.vault_authority.to_account_info(),
        &ctx.accounts.circle.key(),
        ctx.accounts.circle.vault_authority_bump,
        amount,
    )?;
    // The obligation is discharged exactly as the tokens leave.
    let ca = &mut ctx.accounts.circle_asset;
    ca.reserved_for_redemption_raw = math::checked_sub_u64(ca.reserved_for_redemption_raw, amount)?;
    ctx.accounts.redemption_asset.claimed = true;
    Ok(())
}

// ================================================================ claim USDC

#[derive(Accounts)]
pub struct ClaimRedemptionUsdc<'info> {
    #[account(mut)]
    pub member_owner: Signer<'info>,

    #[account(mut, seeds = [CIRCLE_SEED, circle.mandate.as_ref()], bump = circle.bump)]
    pub circle: Account<'info, Circle>,

    #[account(
        seeds = [REDEMPTION_SEED, circle.key().as_ref(), member_owner.key().as_ref(), &redemption.seq.to_le_bytes()],
        bump = redemption.bump,
    )]
    pub redemption: Account<'info, Redemption>,

    /// Active capital only — never an epoch escrow (INV-002).
    #[account(mut, seeds = [USDC_VAULT_SEED, circle.key().as_ref()], bump)]
    pub active_usdc_vault: InterfaceAccount<'info, TokenAccount>,

    #[account(
        mut,
        close = member_owner,
        seeds = [REDEMPTION_ASSET_SEED, redemption.key().as_ref(), active_usdc_vault.mint.as_ref()],
        bump = redemption_asset.bump,
        constraint = !redemption_asset.claimed @ TenetError::AlreadyClaimed,
    )]
    pub redemption_asset: Account<'info, RedemptionAsset>,

    #[account(address = active_usdc_vault.mint @ TenetError::UnexpectedUsdcMint)]
    pub usdc_mint: InterfaceAccount<'info, Mint>,

    #[account(constraint = token_program.key() == *usdc_mint.to_account_info().owner @ TenetError::TokenProgramMismatch)]
    pub token_program: Interface<'info, TokenInterface>,

    #[account(
        mut,
        token::mint = usdc_mint,
        token::authority = member_owner,
        token::token_program = token_program,
    )]
    pub member_usdc: InterfaceAccount<'info, TokenAccount>,

    /// CHECK: PDA with no data; signs the payout.
    #[account(seeds = [VAULT_AUTHORITY_SEED, circle.key().as_ref()], bump = circle.vault_authority_bump)]
    pub vault_authority: UncheckedAccount<'info>,
}

pub fn claim_usdc_handler(ctx: Context<ClaimRedemptionUsdc>) -> Result<()> {
    let (expected_authority, _) = Pubkey::find_program_address(
        &[VAULT_AUTHORITY_SEED, ctx.accounts.circle.key().as_ref()],
        &crate::ID,
    );
    require_keys_eq!(
        ctx.accounts.active_usdc_vault.owner,
        expected_authority,
        TenetError::AccountSubstitution
    );

    let amount = ctx.accounts.redemption_asset.amount_raw;
    pay_out(
        &ctx.accounts.token_program,
        ctx.accounts.active_usdc_vault.to_account_info(),
        &ctx.accounts.usdc_mint,
        ctx.accounts.member_usdc.to_account_info(),
        ctx.accounts.vault_authority.to_account_info(),
        &ctx.accounts.circle.key(),
        ctx.accounts.circle.vault_authority_bump,
        amount,
    )?;
    let circle = &mut ctx.accounts.circle;
    circle.usdc_reserved_raw = math::checked_sub_u64(circle.usdc_reserved_raw, amount)?;
    ctx.accounts.redemption_asset.claimed = true;
    Ok(())
}
