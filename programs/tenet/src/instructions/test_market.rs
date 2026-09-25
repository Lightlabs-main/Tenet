//! Devnet-only test-market path. This is a fixed-inventory test instrument,
//! not a tokenized stock, market venue, oracle source, or NAV observation.
//!
//! The normal Jupiter/Pyth execution path remains fail-closed. This route is
//! compiled into Tenet but can initialize only when Config is pinned to the
//! project's known Devnet test-USDC mint. It is unusable with canonical USDC.

use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token::Token,
    token_2022::Token2022,
    token_interface::{self, Mint, MintTo, TokenAccount, TransferChecked},
};

use crate::{
    constants::*,
    errors::TenetError,
    state::{
        AssetClass, AssetRegistryEntry, AssetStatus, Circle, CircleAsset, CircleState, Config,
        DevnetTestMarket, Epoch, EpochState, Mandate, MandateAsset, MandateState, Member, MembershipPolicy,
    },
};

const E18: u128 = 1_000_000_000_000_000_000;

#[derive(Accounts)]
pub struct InitializeDevnetTestMarket<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(
        seeds = [CONFIG_SEED],
        bump = config.bump,
        constraint = config.usdc_mint == DEVNET_TEST_USDC_MINT @ TenetError::DevnetTestMarketOnly,
    )]
    pub config: Account<'info, Config>,

    #[account(
        init,
        payer = payer,
        space = 8 + DevnetTestMarket::INIT_SPACE,
        seeds = [DEVNET_TEST_MARKET_SEED],
        bump,
    )]
    pub test_market: Account<'info, DevnetTestMarket>,

    /// The market PDA is the only mint authority; there is no freeze authority.
    #[account(
        init,
        payer = payer,
        seeds = [DEVNET_TEST_MINT_SEED],
        bump,
        mint::decimals = DEVNET_TEST_EQUITY_DECIMALS,
        mint::authority = test_market,
        mint::token_program = token_2022_program,
    )]
    pub test_mint: InterfaceAccount<'info, Mint>,

    #[account(
        init,
        payer = payer,
        associated_token::mint = test_mint,
        associated_token::authority = test_market,
        associated_token::token_program = token_2022_program,
    )]
    pub inventory_vault: InterfaceAccount<'info, TokenAccount>,

    #[account(address = DEVNET_TEST_USDC_MINT @ TenetError::DevnetTestMarketOnly)]
    pub usdc_mint: InterfaceAccount<'info, Mint>,

    #[account(
        init,
        payer = payer,
        associated_token::mint = usdc_mint,
        associated_token::authority = test_market,
        associated_token::token_program = usdc_token_program,
    )]
    pub usdc_reserve_vault: InterfaceAccount<'info, TokenAccount>,

    #[account(
        init,
        payer = payer,
        space = 8 + AssetRegistryEntry::INIT_SPACE,
        seeds = [REGISTRY_SEED, test_mint.key().as_ref()],
        bump,
    )]
    pub registry_entry: Account<'info, AssetRegistryEntry>,

    pub token_2022_program: Program<'info, Token2022>,
    pub usdc_token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

pub fn initialize_test_market_handler(ctx: Context<InitializeDevnetTestMarket>) -> Result<()> {
    require_keys_eq!(ctx.accounts.config.usdc_mint, DEVNET_TEST_USDC_MINT, TenetError::DevnetTestMarketOnly);
    require_keys_eq!(*ctx.accounts.usdc_mint.to_account_info().owner, anchor_spl::token::ID, TenetError::TokenProgramMismatch);
    require_eq!(ctx.accounts.usdc_mint.decimals, 6, TenetError::UnexpectedUsdcMint);

    let market_bump = [ctx.bumps.test_market];
    let signer_seeds: &[&[u8]] = &[DEVNET_TEST_MARKET_SEED, &market_bump];
    token_interface::mint_to(
        CpiContext::new_with_signer(
            ctx.accounts.token_2022_program.key(),
            MintTo {
                mint: ctx.accounts.test_mint.to_account_info(),
                to: ctx.accounts.inventory_vault.to_account_info(),
                authority: ctx.accounts.test_market.to_account_info(),
            },
            &[signer_seeds],
        ),
        DEVNET_TEST_EQUITY_INVENTORY_RAW,
    )?;

    ctx.accounts.test_mint.reload()?;
    ctx.accounts.inventory_vault.reload()?;
    require_eq!(ctx.accounts.test_mint.supply, DEVNET_TEST_EQUITY_INVENTORY_RAW, TenetError::InvalidRegistryMetadata);
    require_eq!(ctx.accounts.inventory_vault.amount, DEVNET_TEST_EQUITY_INVENTORY_RAW, TenetError::InvalidRegistryMetadata);

    let now = Clock::get()?;
    let market = &mut ctx.accounts.test_market;
    market.mint = ctx.accounts.test_mint.key();
    market.inventory_vault = ctx.accounts.inventory_vault.key();
    market.usdc_reserve_vault = ctx.accounts.usdc_reserve_vault.key();
    market.inventory_raw = DEVNET_TEST_EQUITY_INVENTORY_RAW;
    market.bump = ctx.bumps.test_market;

    let entry = &mut ctx.accounts.registry_entry;
    entry.mint = ctx.accounts.test_mint.key();
    entry.token_program = ctx.accounts.token_2022_program.key();
    entry.asset_class = AssetClass::DevnetTestEquity;
    entry.issuer = Pubkey::default();
    entry.underlying_id = *b"TENET_TEST_EQUIV";
    entry.symbol = "TST-EQ".to_owned();
    entry.display_name = "Devnet test equity".to_owned();
    entry.pyth_feed_tokenized = [0; 32];
    entry.pyth_feed_underlying = [0; 32];
    entry.status = AssetStatus::Active;
    entry.decimals = DEVNET_TEST_EQUITY_DECIMALS;
    entry.raw_supply = DEVNET_TEST_EQUITY_INVENTORY_RAW;
    entry.effective_multiplier_e18 = E18;
    entry.active_transfer_fee_bps = 0;
    entry.active_transfer_fee_max = 0;
    entry.issuer_controls = 0;
    entry.last_verified_slot = now.slot;
    entry.last_verified_ts = now.unix_timestamp;
    entry.bump = ctx.bumps.registry_entry;

    emit!(DevnetTestMarketInitialized {
        market: market.key(),
        mint: entry.mint,
        inventory_raw: market.inventory_raw,
        slot: now.slot,
    });
    Ok(())
}

#[derive(Accounts)]
#[instruction(mandate_seed: Pubkey)]
pub struct CreateDevnetTestCircle<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,

    #[account(seeds = [CONFIG_SEED], bump = config.bump,
        constraint = config.usdc_mint == DEVNET_TEST_USDC_MINT @ TenetError::DevnetTestMarketOnly)]
    pub config: Box<Account<'info, Config>>,

    #[account(seeds = [DEVNET_TEST_MARKET_SEED], bump = test_market.bump,
        constraint = test_market.mint == test_mint.key() @ TenetError::MintMismatch)]
    pub test_market: Box<Account<'info, DevnetTestMarket>>,

    #[account(address = test_market.mint @ TenetError::MintMismatch)]
    pub test_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(seeds = [REGISTRY_SEED, test_mint.key().as_ref()], bump = registry_entry.bump,
        constraint = registry_entry.asset_class == AssetClass::DevnetTestEquity @ TenetError::AssetClassMismatch,
        constraint = registry_entry.status == AssetStatus::Active @ TenetError::RegistryEntryInactive)]
    pub registry_entry: Box<Account<'info, AssetRegistryEntry>>,

    #[account(address = DEVNET_TEST_USDC_MINT @ TenetError::DevnetTestMarketOnly)]
    pub usdc_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(
        init,
        payer = creator,
        space = 8 + Mandate::INIT_SPACE,
        seeds = [MANDATE_SEED, mandate_seed.as_ref()],
        bump,
    )]
    pub mandate: Box<Account<'info, Mandate>>,

    #[account(
        init,
        payer = creator,
        space = 8 + MandateAsset::INIT_SPACE,
        seeds = [MANDATE_ASSET_SEED, mandate.key().as_ref(), test_mint.key().as_ref()],
        bump,
    )]
    pub mandate_asset: Box<Account<'info, MandateAsset>>,

    #[account(
        init,
        payer = creator,
        space = 8 + Circle::INIT_SPACE,
        seeds = [CIRCLE_SEED, mandate.key().as_ref()],
        bump,
    )]
    pub circle: Box<Account<'info, Circle>>,

    /// CHECK: PDA with no data, used only as vault authority.
    #[account(seeds = [VAULT_AUTHORITY_SEED, circle.key().as_ref()], bump)]
    pub vault_authority: UncheckedAccount<'info>,

    #[account(
        init,
        payer = creator,
        seeds = [USDC_VAULT_SEED, circle.key().as_ref()],
        bump,
        token::mint = usdc_mint,
        token::authority = vault_authority,
        token::token_program = usdc_token_program,
    )]
    pub active_usdc_vault: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        init,
        payer = creator,
        space = 8 + CircleAsset::INIT_SPACE,
        seeds = [CIRCLE_ASSET_SEED, circle.key().as_ref(), test_mint.key().as_ref()],
        bump,
    )]
    pub circle_asset: Box<Account<'info, CircleAsset>>,

    #[account(
        init,
        payer = creator,
        seeds = [VAULT_SEED, circle.key().as_ref(), test_mint.key().as_ref()],
        bump,
        token::mint = test_mint,
        token::authority = vault_authority,
        token::token_program = token_2022_program,
    )]
    pub test_equity_vault: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        init,
        payer = creator,
        space = 8 + Epoch::INIT_SPACE,
        seeds = [EPOCH_SEED, circle.key().as_ref(), &0u64.to_le_bytes()],
        bump,
    )]
    pub epoch_zero: Box<Account<'info, Epoch>>,

    #[account(
        init,
        payer = creator,
        seeds = [EPOCH_ESCROW_SEED, circle.key().as_ref(), &0u64.to_le_bytes()],
        bump,
        token::mint = usdc_mint,
        token::authority = vault_authority,
        token::token_program = usdc_token_program,
    )]
    pub epoch_zero_escrow: Box<InterfaceAccount<'info, TokenAccount>>,

    pub usdc_token_program: Program<'info, Token>,
    pub token_2022_program: Program<'info, Token2022>,
    pub system_program: Program<'info, System>,
}

pub fn create_test_circle_handler(ctx: Context<CreateDevnetTestCircle>, mandate_seed: Pubkey) -> Result<()> {
    let now = Clock::get()?;
    let mandate_key = ctx.accounts.mandate.key();
    let mandate = &mut ctx.accounts.mandate;
    mandate.author = ctx.accounts.creator.key();
    mandate.mandate_seed = mandate_seed;
    mandate.name = "Devnet test equity".to_owned();
    mandate.description = "Valueless test instrument. Not a stock, market price, or real equity exposure.".to_owned();
    mandate.state = MandateState::Active;
    mandate.asset_count = 1;
    mandate.max_weight_per_asset_bps = 4_000;
    mandate.max_pre_ipo_weight_bps = 0;
    mandate.max_issuer_weight_bps = 4_000;
    mandate.max_underlying_weight_bps = 4_000;
    mandate.max_supply_consumption_bps = 100;
    mandate.max_price_impact_bps = 100;
    mandate.min_contribution_usdc = 1_000_000;
    mandate.max_pool_size_usdc = 100_000_000;
    mandate.epoch_duration = MIN_EPOCH_DURATION;
    mandate.membership_policy = MembershipPolicy::Open;
    mandate.amendment_threshold_bps = 6_667;
    mandate.amendment_delay_seconds = MIN_AMENDMENT_DELAY_SECONDS;
    mandate.forked_from = None;
    mandate.version = 1;
    mandate.created_at = now.unix_timestamp;
    mandate.bump = ctx.bumps.mandate;

    let mandate_asset = &mut ctx.accounts.mandate_asset;
    mandate_asset.mandate = mandate_key;
    mandate_asset.mint = ctx.accounts.test_mint.key();
    mandate_asset.registry_entry = ctx.accounts.registry_entry.key();
    mandate_asset.target_weight_bps = 4_000;
    mandate_asset.index = 0;
    mandate_asset.enabled = true;
    mandate_asset.bump = ctx.bumps.mandate_asset;

    let circle = &mut ctx.accounts.circle;
    circle.mandate = mandate_key;
    circle.state = CircleState::Funding;
    circle.created_at = now.unix_timestamp;
    circle.total_shares = 0;
    circle.reserved_shares = 0;
    circle.current_epoch = 0;
    circle.member_count = 0;
    circle.asset_count = 1;
    circle.pending_reservations = 0;
    circle.execution_frozen = false;
    circle.bump = ctx.bumps.circle;
    circle.vault_authority_bump = ctx.bumps.vault_authority;
    circle.usdc_reserved_raw = 0;
    circle.asset_bitmap = 1;

    let circle_asset = &mut ctx.accounts.circle_asset;
    circle_asset.circle = circle.key();
    circle_asset.mandate_asset = mandate_asset.key();
    circle_asset.mint = ctx.accounts.test_mint.key();
    circle_asset.vault = ctx.accounts.test_equity_vault.key();
    circle_asset.token_program = ctx.accounts.token_2022_program.key();
    circle_asset.index = 0;
    circle_asset.status = AssetStatus::Active;
    circle_asset.reserved_for_redemption_raw = 0;
    circle_asset.bump = ctx.bumps.circle_asset;

    let epoch = &mut ctx.accounts.epoch_zero;
    epoch.circle = circle.key();
    epoch.index = 0;
    epoch.opened_at = now.unix_timestamp;
    epoch.closes_at = now.unix_timestamp.checked_add(MIN_EPOCH_DURATION).ok_or(TenetError::MathOverflow)?;
    epoch.state = EpochState::Open;
    epoch.pending_usdc_raw = 0;
    epoch.total_shares_before = 0;
    epoch.nav_before = 0;
    epoch.reserved_shares = 0;
    epoch.settled_shares = 0;
    epoch.receipt_count = 0;
    epoch.settled_count = 0;
    epoch.finalized_at = None;
    epoch.bump = ctx.bumps.epoch_zero;

    emit!(DevnetTestCircleCreated {
        creator: ctx.accounts.creator.key(),
        mandate: mandate_key,
        circle: circle.key(),
        test_mint: ctx.accounts.test_mint.key(),
    });
    Ok(())
}

#[event]
pub struct DevnetTestCircleCreated {
    pub creator: Pubkey,
    pub mandate: Pubkey,
    pub circle: Pubkey,
    pub test_mint: Pubkey,
}

#[derive(Accounts)]
#[instruction(amount_usdc_raw: u64)]
pub struct BuyDevnetTestEquity<'info> {
    #[account(mut)]
    pub buyer: Signer<'info>,

    #[account(
        mut,
        seeds = [CIRCLE_SEED, circle.mandate.as_ref()],
        bump = circle.bump,
        constraint = circle.state == CircleState::Active @ TenetError::InvalidMandateState,
        constraint = !circle.execution_frozen @ TenetError::ExecutionFrozen,
        constraint = circle.pending_reservations == 0 @ TenetError::RedemptionPending,
        constraint = circle.asset_count == 1 @ TenetError::TestEquityOnlyMandate,
    )]
    pub circle: Box<Account<'info, Circle>>,

    #[account(
        seeds = [MANDATE_SEED, mandate.mandate_seed.as_ref()],
        bump = mandate.bump,
        address = circle.mandate @ TenetError::AccountSubstitution,
        constraint = mandate.state == MandateState::Active @ TenetError::InvalidMandateState,
        constraint = mandate.asset_count == 1 @ TenetError::TestEquityOnlyMandate,
    )]
    pub mandate: Box<Account<'info, Mandate>>,

    #[account(
        seeds = [MEMBER_SEED, circle.key().as_ref(), buyer.key().as_ref()],
        bump = member.bump,
        constraint = member.circle == circle.key() @ TenetError::AccountSubstitution,
        constraint = member.owner == buyer.key() @ TenetError::AccountSubstitution,
    )]
    pub member: Box<Account<'info, Member>>,

    #[account(seeds = [CONFIG_SEED], bump = config.bump,
        constraint = config.usdc_mint == DEVNET_TEST_USDC_MINT @ TenetError::DevnetTestMarketOnly)]
    pub config: Box<Account<'info, Config>>,

    #[account(seeds = [DEVNET_TEST_MARKET_SEED], bump = test_market.bump,
        constraint = test_market.mint == test_mint.key() @ TenetError::MintMismatch)]
    pub test_market: Box<Account<'info, DevnetTestMarket>>,

    #[account(
        seeds = [MANDATE_ASSET_SEED, mandate.key().as_ref(), test_mint.key().as_ref()],
        bump = mandate_asset.bump,
        constraint = mandate_asset.mandate == mandate.key() @ TenetError::AccountSubstitution,
        constraint = mandate_asset.mint == test_mint.key() @ TenetError::MintMismatch,
        constraint = mandate_asset.enabled @ TenetError::AssetNotInMandate,
        constraint = mandate_asset.index == 0 @ TenetError::TestEquityOnlyMandate,
    )]
    pub mandate_asset: Box<Account<'info, MandateAsset>>,

    #[account(
        seeds = [REGISTRY_SEED, test_mint.key().as_ref()],
        bump = registry_entry.bump,
        constraint = registry_entry.mint == test_mint.key() @ TenetError::MintMismatch,
        constraint = registry_entry.asset_class == AssetClass::DevnetTestEquity @ TenetError::AssetClassMismatch,
        constraint = registry_entry.status == AssetStatus::Active @ TenetError::RegistryEntryInactive,
    )]
    pub registry_entry: Box<Account<'info, AssetRegistryEntry>>,

    #[account(address = DEVNET_TEST_USDC_MINT @ TenetError::DevnetTestMarketOnly)]
    pub usdc_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(address = test_market.mint @ TenetError::MintMismatch)]
    pub test_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(
        mut,
        seeds = [USDC_VAULT_SEED, circle.key().as_ref()],
        bump,
        constraint = active_usdc_vault.mint == config.usdc_mint @ TenetError::UnexpectedUsdcMint,
    )]
    pub active_usdc_vault: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        seeds = [CIRCLE_ASSET_SEED, circle.key().as_ref(), test_mint.key().as_ref()],
        bump = circle_asset.bump,
        constraint = circle_asset.circle == circle.key() @ TenetError::AccountSubstitution,
        constraint = circle_asset.mandate_asset == mandate_asset.key() @ TenetError::AccountSubstitution,
        constraint = circle_asset.mint == test_mint.key() @ TenetError::MintMismatch,
        constraint = circle_asset.status == AssetStatus::Active @ TenetError::RegistryEntryInactive,
    )]
    pub circle_asset: Box<Account<'info, CircleAsset>>,

    #[account(mut, address = circle_asset.vault @ TenetError::AccountSubstitution)]
    pub test_equity_vault: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(mut, address = test_market.inventory_vault @ TenetError::AccountSubstitution)]
    pub inventory_vault: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(mut, address = test_market.usdc_reserve_vault @ TenetError::AccountSubstitution)]
    pub usdc_reserve_vault: Box<InterfaceAccount<'info, TokenAccount>>,

    /// CHECK: PDA authority verified by seeds and the Circle's stored bump.
    #[account(seeds = [VAULT_AUTHORITY_SEED, circle.key().as_ref()], bump = circle.vault_authority_bump)]
    pub vault_authority: UncheckedAccount<'info>,

    pub usdc_token_program: Program<'info, Token>,
    pub token_2022_program: Program<'info, Token2022>,
}

pub fn buy_test_equity_handler(ctx: Context<BuyDevnetTestEquity>, amount_usdc_raw: u64) -> Result<()> {
    require!(ctx.accounts.member.shares > 0, TenetError::AmendmentRequiresMember);
    require!(amount_usdc_raw > 0, TenetError::InvalidTestPurchase);
    require_eq!(ctx.accounts.usdc_mint.decimals, 6, TenetError::UnexpectedUsdcMint);
    require_eq!(ctx.accounts.test_mint.decimals, DEVNET_TEST_EQUITY_DECIMALS, TenetError::InvalidRegistryMetadata);
    require!(ctx.accounts.test_mint.freeze_authority.is_none(), TenetError::InvalidRegistryMetadata);
    require!(ctx.accounts.registry_entry.issuer_controls == 0, TenetError::InvalidRegistryMetadata);
    require!(ctx.accounts.registry_entry.active_transfer_fee_bps == 0, TenetError::InvalidRegistryMetadata);

    require_keys_eq!(ctx.accounts.active_usdc_vault.owner, ctx.accounts.vault_authority.key(), TenetError::AccountSubstitution);
    require_keys_eq!(ctx.accounts.test_equity_vault.owner, ctx.accounts.vault_authority.key(), TenetError::AccountSubstitution);
    require_keys_eq!(ctx.accounts.inventory_vault.owner, ctx.accounts.test_market.key(), TenetError::AccountSubstitution);
    require_keys_eq!(ctx.accounts.usdc_reserve_vault.owner, ctx.accounts.test_market.key(), TenetError::AccountSubstitution);
    require_keys_eq!(ctx.accounts.active_usdc_vault.mint, DEVNET_TEST_USDC_MINT, TenetError::UnexpectedUsdcMint);
    require_keys_eq!(ctx.accounts.usdc_reserve_vault.mint, DEVNET_TEST_USDC_MINT, TenetError::UnexpectedUsdcMint);
    require_keys_eq!(ctx.accounts.test_equity_vault.mint, ctx.accounts.test_mint.key(), TenetError::MintMismatch);
    require_keys_eq!(ctx.accounts.inventory_vault.mint, ctx.accounts.test_mint.key(), TenetError::MintMismatch);
    require_keys_eq!(*ctx.accounts.active_usdc_vault.to_account_info().owner, ctx.accounts.usdc_token_program.key(), TenetError::TokenProgramMismatch);
    require_keys_eq!(*ctx.accounts.test_equity_vault.to_account_info().owner, ctx.accounts.token_2022_program.key(), TenetError::TokenProgramMismatch);
    require!(ctx.accounts.active_usdc_vault.delegate.is_none(), TenetError::ExistingVaultDelegate);

    let spendable_usdc = ctx.accounts.active_usdc_vault.amount
        .checked_sub(ctx.accounts.circle.usdc_reserved_raw)
        .ok_or(TenetError::InsufficientUnreservedBalance)?;
    require!(amount_usdc_raw <= spendable_usdc, TenetError::InsufficientUnreservedBalance);
    require!(amount_usdc_raw <= ctx.accounts.inventory_vault.amount, TenetError::TestInventoryInsufficient);

    // This fixed 1:1 ratio is only a test-market allocation guard, not a quote,
    // market price, NAV input, or claim about the value of a stock.
    validate_test_purchase_caps(
        amount_usdc_raw,
        spendable_usdc,
        ctx.accounts.test_equity_vault.amount,
        ctx.accounts.test_mint.supply,
        ctx.accounts.mandate.max_weight_per_asset_bps,
        ctx.accounts.mandate.max_issuer_weight_bps,
        ctx.accounts.mandate.max_underlying_weight_bps,
        ctx.accounts.mandate.max_supply_consumption_bps,
    )?;

    let pre_usdc = ctx.accounts.active_usdc_vault.amount;
    let pre_test = ctx.accounts.test_equity_vault.amount;
    let pre_market_usdc = ctx.accounts.usdc_reserve_vault.amount;
    let pre_inventory = ctx.accounts.inventory_vault.amount;

    let circle_bump = [ctx.accounts.circle.vault_authority_bump];
    let circle_key = ctx.accounts.circle.key();
    let circle_seeds: &[&[u8]] = &[VAULT_AUTHORITY_SEED, circle_key.as_ref(), &circle_bump];
    token_interface::transfer_checked(
        CpiContext::new_with_signer(
            ctx.accounts.usdc_token_program.key(),
            TransferChecked {
                from: ctx.accounts.active_usdc_vault.to_account_info(),
                mint: ctx.accounts.usdc_mint.to_account_info(),
                to: ctx.accounts.usdc_reserve_vault.to_account_info(),
                authority: ctx.accounts.vault_authority.to_account_info(),
            },
            &[circle_seeds],
        ),
        amount_usdc_raw,
        6,
    )?;

    let market_bump = [ctx.accounts.test_market.bump];
    let market_seeds: &[&[u8]] = &[DEVNET_TEST_MARKET_SEED, &market_bump];
    token_interface::transfer_checked(
        CpiContext::new_with_signer(
            ctx.accounts.token_2022_program.key(),
            TransferChecked {
                from: ctx.accounts.inventory_vault.to_account_info(),
                mint: ctx.accounts.test_mint.to_account_info(),
                to: ctx.accounts.test_equity_vault.to_account_info(),
                authority: ctx.accounts.test_market.to_account_info(),
            },
            &[market_seeds],
        ),
        amount_usdc_raw,
        DEVNET_TEST_EQUITY_DECIMALS,
    )?;

    ctx.accounts.active_usdc_vault.reload()?;
    ctx.accounts.test_equity_vault.reload()?;
    ctx.accounts.usdc_reserve_vault.reload()?;
    ctx.accounts.inventory_vault.reload()?;
    require_eq!(pre_usdc.checked_sub(ctx.accounts.active_usdc_vault.amount).ok_or(TenetError::MathUnderflow)?, amount_usdc_raw, TenetError::MathUnderflow);
    require_eq!(ctx.accounts.test_equity_vault.amount.checked_sub(pre_test).ok_or(TenetError::MathUnderflow)?, amount_usdc_raw, TenetError::MathUnderflow);
    require_eq!(ctx.accounts.usdc_reserve_vault.amount.checked_sub(pre_market_usdc).ok_or(TenetError::MathUnderflow)?, amount_usdc_raw, TenetError::MathUnderflow);
    require_eq!(pre_inventory.checked_sub(ctx.accounts.inventory_vault.amount).ok_or(TenetError::MathUnderflow)?, amount_usdc_raw, TenetError::MathUnderflow);

    emit!(DevnetTestEquityPurchased {
        circle: ctx.accounts.circle.key(),
        member: ctx.accounts.buyer.key(),
        usdc_raw: amount_usdc_raw,
        test_equity_raw: amount_usdc_raw,
        remaining_inventory_raw: ctx.accounts.inventory_vault.amount,
    });
    Ok(())
}

fn validate_test_purchase_caps(
    amount_raw: u64,
    spendable_usdc_raw: u64,
    current_test_raw: u64,
    supply_raw: u64,
    asset_cap_bps: u16,
    issuer_cap_bps: u16,
    underlying_cap_bps: u16,
    supply_cap_bps: u16,
) -> Result<()> {
    require!(amount_raw > 0, TenetError::InvalidTestPurchase);
    require!(supply_raw > 0, TenetError::InvalidRegistryMetadata);
    let post_test = u128::from(current_test_raw)
        .checked_add(u128::from(amount_raw))
        .ok_or(TenetError::MathOverflow)?;
    let test_notional_before = u128::from(spendable_usdc_raw)
        .checked_add(u128::from(current_test_raw))
        .ok_or(TenetError::MathOverflow)?;
    require!(test_notional_before > 0, TenetError::ZeroNav);

    let lhs = post_test.checked_mul(10_000).ok_or(TenetError::MathOverflow)?;
    let asset_rhs = test_notional_before.checked_mul(u128::from(asset_cap_bps)).ok_or(TenetError::MathOverflow)?;
    require!(lhs <= asset_rhs, TenetError::AssetWeightCapExceeded);
    let issuer_rhs = test_notional_before.checked_mul(u128::from(issuer_cap_bps)).ok_or(TenetError::MathOverflow)?;
    require!(lhs <= issuer_rhs, TenetError::IssuerWeightCapExceeded);
    let underlying_rhs = test_notional_before.checked_mul(u128::from(underlying_cap_bps)).ok_or(TenetError::MathOverflow)?;
    require!(lhs <= underlying_rhs, TenetError::UnderlyingWeightCapExceeded);

    let supply_rhs = u128::from(supply_raw)
        .checked_mul(u128::from(supply_cap_bps))
        .ok_or(TenetError::MathOverflow)?;
    require!(lhs <= supply_rhs, TenetError::SupplyConsumptionCapExceeded);
    Ok(())
}

#[event]
pub struct DevnetTestMarketInitialized {
    pub market: Pubkey,
    pub mint: Pubkey,
    pub inventory_raw: u64,
    pub slot: u64,
}

#[event]
pub struct DevnetTestEquityPurchased {
    pub circle: Pubkey,
    pub member: Pubkey,
    pub usdc_raw: u64,
    pub test_equity_raw: u64,
    pub remaining_inventory_raw: u64,
}

#[cfg(test)]
mod tests {
    use super::validate_test_purchase_caps;
    use crate::errors::TenetError;

    #[test]
    fn test_purchase_uses_checked_raw_units_and_mandate_caps() {
        // $100 test-USDC, with a 40% per-asset/issuer/company cap. Buying $40
        // reaches the cap exactly; $40.000001 is rejected.
        assert!(validate_test_purchase_caps(40_000_000, 100_000_000, 0, 1_000_000_000_000, 4_000, 4_000, 4_000, 10_000).is_ok());
        assert_eq!(
            validate_test_purchase_caps(40_000_001, 100_000_000, 0, 1_000_000_000_000, 4_000, 4_000, 4_000, 10_000).unwrap_err(),
            TenetError::AssetWeightCapExceeded.into(),
        );
    }

    #[test]
    fn test_supply_cap_uses_live_raw_supply() {
        assert_eq!(
            validate_test_purchase_caps(10_001, 100_000, 0, 1_000_000, 10_000, 10_000, 10_000, 100).unwrap_err(),
            TenetError::SupplyConsumptionCapExceeded.into(),
        );
    }

    #[test]
    fn test_zero_purchase_is_rejected() {
        assert_eq!(
            validate_test_purchase_caps(0, 100_000, 0, 1_000_000, 10_000, 10_000, 10_000, 10_000).unwrap_err(),
            TenetError::InvalidTestPurchase.into(),
        );
    }
}
