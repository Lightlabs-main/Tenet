//! `initialize_config` — decision A-18.

use anchor_lang::prelude::*;
use anchor_spl::token_interface::Mint;

use crate::constants::*;
use crate::errors::TenetError;
use crate::program::Tenet;
use crate::state::Config;

/// Only the program's upgrade authority may create `Config`, which is what
/// chooses the registry authority. Without this gate, anyone watching the
/// deploy could initialize it first and appoint themselves.
///
/// Consequence worth stating: a program deployed immutable (no upgrade
/// authority) can never initialize `Config`, so initialization must happen
/// before the upgrade authority is ever revoked (R-14).
#[derive(Accounts)]
pub struct InitializeConfig<'info> {
    #[account(mut)]
    pub upgrade_authority: Signer<'info>,

    #[account(
        init,
        payer = upgrade_authority,
        space = 8 + Config::INIT_SPACE,
        seeds = [CONFIG_SEED],
        bump,
    )]
    pub config: Account<'info, Config>,

    #[account(
        constraint = program.programdata_address()? == Some(program_data.key())
            @ TenetError::ProgramDataMismatch,
    )]
    pub program: Program<'info, Tenet>,

    #[account(
        constraint = program_data.upgrade_authority_address == Some(upgrade_authority.key())
            @ TenetError::NotUpgradeAuthority,
    )]
    pub program_data: Account<'info, ProgramData>,

    /// USDC is classic SPL Token with 6 decimals (V-014). Asserted here rather
    /// than assumed: shares are defined as 1 per micro-USDC in Epoch 0, so a
    /// different decimals count would silently change what a share means.
    #[account(
        constraint = usdc_mint.decimals == EXPECTED_USDC_DECIMALS @ TenetError::UnexpectedUsdcMint,
        constraint = *usdc_mint.to_account_info().owner == anchor_spl::token::ID
            @ TenetError::UnexpectedUsdcMint,
    )]
    pub usdc_mint: InterfaceAccount<'info, Mint>,

    pub system_program: Program<'info, System>,
}

pub fn initialize_handler(ctx: Context<InitializeConfig>, registry_authority: Pubkey) -> Result<()> {
    let config = &mut ctx.accounts.config;
    config.registry_authority = registry_authority;
    config.usdc_mint = ctx.accounts.usdc_mint.key();
    config.bump = ctx.bumps.config;
    Ok(())
}
