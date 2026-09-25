//! Circle creation: `create_circle`, then `add_circle_asset` once per Mandate asset.
//!
//! These create the custody accounts. Every vault is a PDA token account whose
//! authority is the Circle's `VaultAuthority` PDA — the only signer that will
//! ever move Circle assets, and it has no private key.
//!
//! A Circle holds BOTH token programs at once: classic SPL for USDC (V-014) and
//! Token-2022 for tokenized equities (V-002, V-010). The token program is taken
//! from the mint's owner and checked, never assumed.
//!
//! WHO REJECTS A WRONG TOKEN PROGRAM. Anchor performs `init` (including the
//! `InitializeAccount3` CPI into `token_program`) while loading accounts, and
//! evaluates plain `constraint = ...` checks afterwards — regardless of field
//! order (verified: reordering changed nothing). So for these two instructions
//! a mismatched `token_program` is rejected by the token program itself, which
//! refuses a mint it does not own (`IncorrectProgramId` / `InvalidAccountData`),
//! and the whole transaction reverts. That is a hard guarantee: `Interface`
//! admits only the two genuine SPL token programs, and both check mint
//! ownership. The `TokenProgramMismatch` constraints below are a backstop that
//! runs after init; they are not the first line of defence here. Tests assert
//! the property that matters — rejected, and nothing created.

use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

use crate::constants::*;
use crate::errors::TenetError;
use crate::state::{
    AssetStatus, Circle, CircleAsset, CircleState, Config, Mandate, MandateAsset, MandateState,
};

// ---------------------------------------------------------------- create

#[derive(Accounts)]
pub struct CreateCircle<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,

    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,

    #[account(
        seeds = [MANDATE_SEED, mandate.mandate_seed.as_ref()],
        bump = mandate.bump,
        constraint = mandate.state == MandateState::Active @ TenetError::InvalidMandateState,
    )]
    pub mandate: Account<'info, Mandate>,

    // ---- inputs (see module note on who rejects a wrong token program) ------
    #[account(address = config.usdc_mint @ TenetError::UnexpectedUsdcMint)]
    pub usdc_mint: InterfaceAccount<'info, Mint>,

    #[account(
        constraint = token_program.key() == *usdc_mint.to_account_info().owner
            @ TenetError::TokenProgramMismatch,
    )]
    pub token_program: Interface<'info, TokenInterface>,

    // ---- created ---------------------------------------------------------------
    /// 1:1 with the Mandate in v1: a second Circle for the same Mandate cannot
    /// be initialized at this address.
    #[account(
        init,
        payer = creator,
        space = 8 + Circle::INIT_SPACE,
        seeds = [CIRCLE_SEED, mandate.key().as_ref()],
        bump,
    )]
    pub circle: Account<'info, Circle>,

    /// CHECK: PDA with no data; only ever used as the vaults' authority.
    #[account(seeds = [VAULT_AUTHORITY_SEED, circle.key().as_ref()], bump)]
    pub vault_authority: UncheckedAccount<'info>,

    /// Active capital only. Pending contributions go to a per-epoch escrow,
    /// a different account (spec §22, INV-002).
    #[account(
        init,
        payer = creator,
        seeds = [USDC_VAULT_SEED, circle.key().as_ref()],
        bump,
        token::mint = usdc_mint,
        token::authority = vault_authority,
        token::token_program = token_program,
    )]
    pub active_usdc_vault: InterfaceAccount<'info, TokenAccount>,

    pub system_program: Program<'info, System>,
}

pub fn create_circle_handler(ctx: Context<CreateCircle>) -> Result<()> {
    let c = &mut ctx.accounts.circle;
    c.mandate = ctx.accounts.mandate.key();
    c.state = CircleState::Funding;
    c.created_at = Clock::get()?.unix_timestamp;
    c.total_shares = 0;
    c.reserved_shares = 0;
    c.current_epoch = 0;
    c.member_count = 0;
    c.asset_count = 0;
    c.pending_reservations = 0;
    c.execution_frozen = false;
    c.bump = ctx.bumps.circle;
    c.vault_authority_bump = ctx.bumps.vault_authority;
    c.usdc_reserved_raw = 0;
    c.asset_bitmap = 0;
    Ok(())
}

// ---------------------------------------------------------------- add asset

/// Permissionless: it only creates an empty vault for an asset the Mandate
/// already permits. It cannot add an asset the Mandate does not name.
#[derive(Accounts)]
pub struct AddCircleAsset<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(
        mut,
        seeds = [CIRCLE_SEED, circle.mandate.as_ref()],
        bump = circle.bump,
    )]
    pub circle: Account<'info, Circle>,

    /// Bound to this Circle's Mandate by its stored `mandate` field; the account
    /// type proves it is a genuine MandateAsset written by this program.
    #[account(
        constraint = mandate_asset.mandate == circle.mandate @ TenetError::AccountSubstitution,
        constraint = mandate_asset.enabled @ TenetError::AssetNotInMandate,
    )]
    pub mandate_asset: Account<'info, MandateAsset>,

    // ---- inputs (see module note on who rejects a wrong token program) ------
    #[account(address = mandate_asset.mint @ TenetError::MintMismatch)]
    pub mint: InterfaceAccount<'info, Mint>,

    /// Token-2022 or classic — whichever owns this mint. Branch explicitly,
    /// never assume (V-002).
    #[account(
        constraint = token_program.key() == *mint.to_account_info().owner
            @ TenetError::TokenProgramMismatch,
    )]
    pub token_program: Interface<'info, TokenInterface>,

    /// CHECK: PDA with no data; verified by seeds and the stored bump.
    #[account(seeds = [VAULT_AUTHORITY_SEED, circle.key().as_ref()], bump = circle.vault_authority_bump)]
    pub vault_authority: UncheckedAccount<'info>,

    // ---- created ---------------------------------------------------------------
    /// Mint in the seed: a second vault for the same asset cannot exist.
    #[account(
        init,
        payer = payer,
        space = 8 + CircleAsset::INIT_SPACE,
        seeds = [CIRCLE_ASSET_SEED, circle.key().as_ref(), mint.key().as_ref()],
        bump,
    )]
    pub circle_asset: Account<'info, CircleAsset>,

    /// Sized from the mint's own extensions: Anchor asks Token-2022 which
    /// account-side extensions this mint requires (transfer fee amount,
    /// pausable, transfer hook, ...), so real PreStocks/xStocks mints work.
    #[account(
        init,
        payer = payer,
        seeds = [VAULT_SEED, circle.key().as_ref(), mint.key().as_ref()],
        bump,
        token::mint = mint,
        token::authority = vault_authority,
        token::token_program = token_program,
    )]
    pub vault: InterfaceAccount<'info, TokenAccount>,

    pub system_program: Program<'info, System>,
}

pub fn add_circle_asset_handler(ctx: Context<AddCircleAsset>) -> Result<()> {
    let circle = &mut ctx.accounts.circle;
    require!(
        circle.asset_count < MAX_CIRCLE_ASSETS,
        TenetError::TooManyAssets
    );

    let a = &mut ctx.accounts.circle_asset;
    a.circle = circle.key();
    a.mandate_asset = ctx.accounts.mandate_asset.key();
    a.mint = ctx.accounts.mint.key();
    a.vault = ctx.accounts.vault.key();
    a.token_program = ctx.accounts.token_program.key();
    // Same index as the Mandate asset, so the NAV snapshot bitmap (keyed on
    // index) lines up with the Mandate's universe.
    a.index = ctx.accounts.mandate_asset.index;
    a.status = AssetStatus::Active;
    a.reserved_for_redemption_raw = 0;
    a.bump = ctx.bumps.circle_asset;

    circle.asset_count = circle
        .asset_count
        .checked_add(1)
        .ok_or(TenetError::MathOverflow)?;
    // Mandate indexes are < MAX_CIRCLE_ASSETS (8), which fits u16; the shift is
    // still checked rather than assumed.
    let bit = 1u16
        .checked_shl(a.index as u32)
        .ok_or(TenetError::TooManyAssets)?;
    circle.asset_bitmap |= bit;
    Ok(())
}
