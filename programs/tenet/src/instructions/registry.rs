//! `upsert_registry_entry` — classification by the registry authority.
//!
//! Metadata only: this authority has no custody power (spec §25). Live,
//! observable mint state (supply, multiplier, fee, issuer controls) is written
//! by the permissionless `refresh_asset_metadata` instead (A-16), which is why
//! none of those fields are accepted here.

use anchor_lang::prelude::*;
use anchor_spl::{
    token_2022::spl_token_2022::extension::{
        pausable::PausableConfig,
        permanent_delegate::PermanentDelegate,
        scaled_ui_amount::ScaledUiAmountConfig,
        transfer_fee::TransferFeeConfig,
        transfer_hook::TransferHook,
    },
    token_interface::{get_mint_extension_data, Mint},
};

use crate::constants::*;
use crate::errors::TenetError;
use crate::state::{AssetClass, AssetRegistryEntry, AssetStatus, Config};

const MULTIPLIER_SCALE_E18: u128 = 1_000_000_000_000_000_000;
const CONTROL_PERMANENT_DELEGATE: u8 = 1;
const CONTROL_FREEZE_AUTHORITY: u8 = 2;
const CONTROL_PAUSED: u8 = 4;
const CONTROL_TRANSFER_HOOK: u8 = 8;

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct RegistryParams {
    pub asset_class: AssetClass,
    pub issuer: Pubkey,
    pub underlying_id: [u8; 16],
    pub symbol: String,
    pub display_name: String,
    pub pyth_feed_tokenized: [u8; 32],
    pub pyth_feed_underlying: [u8; 32],
    pub status: AssetStatus,
}

#[derive(Accounts)]
pub struct UpsertRegistryEntry<'info> {
    #[account(mut)]
    pub registry_authority: Signer<'info>,

    #[account(
        seeds = [CONFIG_SEED],
        bump = config.bump,
        has_one = registry_authority @ TenetError::NotRegistryAuthority,
    )]
    pub config: Account<'info, Config>,

    #[account(
        init_if_needed,
        payer = registry_authority,
        space = 8 + AssetRegistryEntry::INIT_SPACE,
        seeds = [REGISTRY_SEED, mint.key().as_ref()],
        bump,
    )]
    pub registry_entry: Account<'info, AssetRegistryEntry>,

    /// `InterfaceAccount` proves the mint exists and is owned by the classic or
    /// Token-2022 program. Which one is recorded, never assumed (V-002).
    pub mint: InterfaceAccount<'info, Mint>,

    pub system_program: Program<'info, System>,
}

pub fn upsert_handler(ctx: Context<UpsertRegistryEntry>, p: RegistryParams) -> Result<()> {
    require!(
        !p.symbol.is_empty() && p.symbol.len() <= MAX_SYMBOL_LEN,
        TenetError::InvalidRegistryString
    );
    require!(
        !p.display_name.is_empty() && p.display_name.len() <= MAX_DISPLAY_NAME_LEN,
        TenetError::InvalidRegistryString
    );

    let mint_key = ctx.accounts.mint.key();
    let token_program = *ctx.accounts.mint.to_account_info().owner;

    // The class must agree with what the chain shows. USDC is classic SPL and
    // must be THE configured mint (V-014); every tokenized equity observed so
    // far is Token-2022 (V-002, V-010). A mismatch means the classification is
    // wrong, and caps enforced from it would be wrong too.
    let consistent = match p.asset_class {
        AssetClass::Usdc => {
            token_program == anchor_spl::token::ID && mint_key == ctx.accounts.config.usdc_mint
        }
        AssetClass::PublicTokenizedEquity | AssetClass::PreIpo => {
            token_program == anchor_spl::token_2022::ID
        }
        // Only initialize_devnet_test_market can create this class, and it
        // pins the known Devnet test-USDC mint and test-equity PDA.
        AssetClass::DevnetTestEquity => false,
    };
    require!(consistent, TenetError::AssetClassMismatch);

    let entry = &mut ctx.accounts.registry_entry;
    let is_new = entry.mint == Pubkey::default();
    if is_new {
        entry.mint = mint_key;
        entry.token_program = token_program;
        entry.bump = ctx.bumps.registry_entry;
    } else {
        // A mint cannot change owner program; if it appears to, refuse rather
        // than silently re-pointing custody logic at a different program.
        require_keys_eq!(entry.token_program, token_program, TenetError::TokenProgramMismatch);
    }

    entry.asset_class = p.asset_class;
    entry.issuer = p.issuer;
    entry.underlying_id = p.underlying_id;
    entry.symbol = p.symbol;
    entry.display_name = p.display_name;
    entry.pyth_feed_tokenized = p.pyth_feed_tokenized;
    entry.pyth_feed_underlying = p.pyth_feed_underlying;
    entry.status = p.status;
    // Decimals are immutable on a mint, so recording them here is fact, not
    // judgement. Everything else observable is left to refresh_asset_metadata.
    entry.decimals = ctx.accounts.mint.decimals;
    Ok(())
}

// ---------------------------------------------------------------- refresh

#[derive(Accounts)]
pub struct RefreshAssetMetadata<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(
        mut,
        seeds = [REGISTRY_SEED, mint.key().as_ref()],
        bump = registry_entry.bump,
        constraint = registry_entry.mint == mint.key() @ TenetError::MintMismatch,
    )]
    pub registry_entry: Account<'info, AssetRegistryEntry>,

    /// The live mint is read directly. No caller-supplied observation is
    /// accepted, and the recorded token program must remain immutable.
    pub mint: InterfaceAccount<'info, Mint>,
}

fn multiplier_e18(mint: &AccountInfo, now: i64) -> Result<u128> {
    let owner = mint.owner;
    if *owner != anchor_spl::token_2022::ID {
        return Ok(MULTIPLIER_SCALE_E18);
    }

    let cfg = match get_mint_extension_data::<ScaledUiAmountConfig>(mint) {
        Ok(value) => value,
        Err(_) => return Ok(MULTIPLIER_SCALE_E18),
    };
    let multiplier = if now >= cfg.new_multiplier_effective_timestamp.into() {
        f64::from(cfg.new_multiplier)
    } else {
        f64::from(cfg.multiplier)
    };
    require!(multiplier.is_finite() && multiplier > 0.0, TenetError::InvalidRegistryMetadata);
    let scaled = multiplier * MULTIPLIER_SCALE_E18 as f64;
    require!(scaled.is_finite() && scaled >= 1.0 && scaled <= u128::MAX as f64, TenetError::InvalidRegistryMetadata);
    Ok(scaled.round() as u128)
}

pub fn refresh_handler(ctx: Context<RefreshAssetMetadata>) -> Result<()> {
    let now = Clock::get()?;
    let mint_info = ctx.accounts.mint.to_account_info();
    let token_program = *mint_info.owner;
    require_keys_eq!(
        ctx.accounts.registry_entry.token_program,
        token_program,
        TenetError::TokenProgramMismatch
    );
    require_eq!(
        ctx.accounts.registry_entry.decimals,
        ctx.accounts.mint.decimals,
        TenetError::InvalidRegistryMetadata
    );

    let mut controls = 0u8;
    if ctx.accounts.mint.freeze_authority.is_some() {
        controls |= CONTROL_FREEZE_AUTHORITY;
    }

    let mut fee_bps = 0u16;
    let mut fee_max = 0u64;
    if token_program == anchor_spl::token_2022::ID {
        if get_mint_extension_data::<PermanentDelegate>(&mint_info).is_ok() {
            controls |= CONTROL_PERMANENT_DELEGATE;
        }
        if let Ok(paused) = get_mint_extension_data::<PausableConfig>(&mint_info) {
            if bool::from(paused.paused) {
                controls |= CONTROL_PAUSED;
            }
        }
        if let Ok(hook) = get_mint_extension_data::<TransferHook>(&mint_info) {
            if Option::<Pubkey>::from(hook.program_id).is_some() {
                controls |= CONTROL_TRANSFER_HOOK;
            }
        }
        if let Ok(config) = get_mint_extension_data::<TransferFeeConfig>(&mint_info) {
            let tier = config.get_epoch_fee(now.epoch);
            fee_bps = u16::from(tier.transfer_fee_basis_points);
            fee_max = u64::from(tier.maximum_fee);
        }
    }

    let entry = &mut ctx.accounts.registry_entry;
    entry.raw_supply = ctx.accounts.mint.supply;
    entry.effective_multiplier_e18 = multiplier_e18(&mint_info, now.unix_timestamp)?;
    entry.active_transfer_fee_bps = fee_bps;
    entry.active_transfer_fee_max = fee_max;
    entry.issuer_controls = controls;
    entry.last_verified_slot = now.slot;
    entry.last_verified_ts = now.unix_timestamp;
    Ok(())
}
