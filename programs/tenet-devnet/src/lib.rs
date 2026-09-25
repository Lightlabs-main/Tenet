//! # tenet-devnet — DEVNET ONLY
//!
//! Test infrastructure that stands in for the external venues Tenet uses on
//! mainnet, so the whole product can run end to end on Solana Devnet with real
//! transactions and real token balances:
//!
//! | mainnet                     | devnet (this program)                           |
//! |-----------------------------|-------------------------------------------------|
//! | Circle USDC                 | **TUSDC**, minted by a PDA-controlled faucet    |
//! | Pyth `PriceUpdateV2`        | **`PriceFeed`**, operator-published test prices |
//! | Jupiter                     | **`Market`**, fixed-price inventory swaps       |
//!
//! Nothing here is value. Every instrument is a DEVNET TEST INSTRUMENT — NOT A
//! REAL STOCK OR SECURITY — and every price is a devnet test valuation.
//!
//! The Tenet core program does not depend on this crate. It only knows two
//! addresses in its `Config`: this program as the permitted execution venue,
//! and this program as the owner of the price accounts it may read. On mainnet
//! those are Jupiter and Pyth, and this program is never deployed.
//!
//! Price feeds deliberately mirror Pyth's `Price` shape (`price`, `conf`,
//! `exponent`, `publish_time`) so the core converts both into the same value
//! and runs identical NAV, price-impact and weight checks.

use anchor_lang::prelude::*;
use anchor_spl::token_interface::{
    self, Mint, MintTo, TokenAccount, TokenInterface, TransferChecked,
};

declare_id!("6ZXVyvYPPLhoMTF4BDa2M3SLpWRvHxPCLjD9WFQzBdNm");

// ---------------------------------------------------------------- constants

pub const ADMIN_SEED: &[u8] = b"admin";
pub const TUSDC_MINT_SEED: &[u8] = b"tusdc_mint";
pub const FAUCET_SEED: &[u8] = b"faucet";
pub const CLAIM_SEED: &[u8] = b"claim";
pub const FEED_SEED: &[u8] = b"feed";
pub const MARKET_SEED: &[u8] = b"market";
pub const INVENTORY_SEED: &[u8] = b"inventory";
pub const MARKET_USDC_SEED: &[u8] = b"market_usdc";

pub const TUSDC_DECIMALS: u8 = 6;
/// 1,000 TUSDC per claim.
pub const FAUCET_CLAIM_RAW: u64 = 1_000_000_000;
/// One claim per wallet per minute.
pub const FAUCET_COOLDOWN_SECONDS: i64 = 60;
/// Hard ceiling on all TUSDC ever minted: 1,000,000,000 TUSDC.
pub const FAUCET_SUPPLY_CAP_RAW: u64 = 1_000_000_000_000_000;

/// Prices are published with a fixed exponent: `price` is in units of 1e-6
/// USD per whole token (same scale as USDC). 40_000_000 = 40.00 TUSDC.
pub const PRICE_EXPONENT: i32 = -6;
pub const MAX_SPREAD_BPS: u16 = 1_000;
pub const MAX_SYMBOL_LEN: usize = 16;
pub const BPS: u128 = 10_000;

#[program]
pub mod tenet_devnet {
    use super::*;

    /// Create the admin record, the TUSDC mint and its faucet. Only this
    /// program's upgrade authority may call it, so nobody can race the deploy
    /// to become the operator.
    pub fn initialize(ctx: Context<Initialize>, operator: Pubkey) -> Result<()> {
        let admin = &mut ctx.accounts.admin;
        admin.operator = operator;
        admin.tusdc_mint = ctx.accounts.tusdc_mint.key();
        admin.bump = ctx.bumps.admin;

        let faucet = &mut ctx.accounts.faucet;
        faucet.tusdc_mint = ctx.accounts.tusdc_mint.key();
        faucet.total_minted_raw = 0;
        faucet.bump = ctx.bumps.faucet;
        emit!(DevnetInitialized { operator, tusdc_mint: admin.tusdc_mint });
        Ok(())
    }

    /// Mint 1,000 TUSDC to the caller's own token account. The caller signs
    /// and pays; the mint authority is the faucet PDA, so no private key
    /// controls TUSDC issuance.
    pub fn request_tusdc(ctx: Context<RequestTusdc>) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let claim = &mut ctx.accounts.claim;
        if claim.owner != Pubkey::default() {
            require!(
                now >= claim.last_claim_at.saturating_add(FAUCET_COOLDOWN_SECONDS),
                DevnetError::FaucetCooldown
            );
        }
        claim.owner = ctx.accounts.owner.key();
        claim.last_claim_at = now;
        claim.bump = ctx.bumps.claim;

        let faucet = &mut ctx.accounts.faucet;
        let total = faucet
            .total_minted_raw
            .checked_add(FAUCET_CLAIM_RAW)
            .ok_or(DevnetError::MathOverflow)?;
        require!(total <= FAUCET_SUPPLY_CAP_RAW, DevnetError::FaucetExhausted);
        faucet.total_minted_raw = total;

        let bump = [faucet.bump];
        let seeds: &[&[u8]] = &[FAUCET_SEED, &bump];
        token_interface::mint_to(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.key(),
                MintTo {
                    mint: ctx.accounts.tusdc_mint.to_account_info(),
                    to: ctx.accounts.destination.to_account_info(),
                    authority: faucet.to_account_info(),
                },
                &[seeds],
            ),
            FAUCET_CLAIM_RAW,
        )?;
        emit!(TusdcClaimed { owner: claim.owner, amount_raw: FAUCET_CLAIM_RAW });
        Ok(())
    }

    /// Create the price feed for one test instrument. Operator only.
    pub fn create_feed(ctx: Context<CreateFeed>, symbol: String, prices: FeedPrices) -> Result<()> {
        require!(!symbol.is_empty() && symbol.len() <= MAX_SYMBOL_LEN, DevnetError::InvalidSymbol);
        let feed = &mut ctx.accounts.feed;
        feed.mint = ctx.accounts.mint.key();
        // The feed id Tenet's registry binds to: the mint's own address bytes.
        feed.feed_id = ctx.accounts.mint.key().to_bytes();
        feed.symbol = symbol;
        feed.exponent = PRICE_EXPONENT;
        feed.bump = ctx.bumps.feed;
        apply_prices(feed, prices)
    }

    /// Publish new test prices (appreciation, depreciation, mark moves).
    /// Operator only.
    pub fn update_feed(ctx: Context<UpdateFeed>, prices: FeedPrices) -> Result<()> {
        apply_prices(&mut ctx.accounts.feed, prices)
    }

    /// Open a fixed-price market for one instrument, with program-owned
    /// inventory and TUSDC vaults. Operator only; inventory is funded by
    /// ordinary token transfers into `inventory`.
    pub fn create_market(ctx: Context<CreateMarket>, spread_bps: u16) -> Result<()> {
        require!(spread_bps <= MAX_SPREAD_BPS, DevnetError::SpreadTooWide);
        let m = &mut ctx.accounts.market;
        m.mint = ctx.accounts.mint.key();
        m.token_program = ctx.accounts.token_program.key();
        m.feed = ctx.accounts.feed.key();
        m.inventory = ctx.accounts.inventory.key();
        m.usdc_vault = ctx.accounts.usdc_vault.key();
        m.spread_bps = spread_bps;
        m.bump = ctx.bumps.market;
        emit!(MarketCreated { mint: m.mint, spread_bps });
        Ok(())
    }

    pub fn set_spread(ctx: Context<SetSpread>, spread_bps: u16) -> Result<()> {
        require!(spread_bps <= MAX_SPREAD_BPS, DevnetError::SpreadTooWide);
        ctx.accounts.market.spread_bps = spread_bps;
        Ok(())
    }

    /// Buy an instrument with TUSDC at the feed price minus the spread.
    ///
    /// `payer` is whoever may move `source`: its owner, or — inside Tenet's
    /// execution window — the executor the Circle approved as a bounded
    /// delegate. Real tokens move in both directions; the caller's `min_out`
    /// and Tenet's own post-trade delta checks bound the result.
    pub fn buy(ctx: Context<Buy>, amount_in_raw: u64, min_out_raw: u64) -> Result<()> {
        require!(amount_in_raw > 0, DevnetError::ZeroAmount);
        let feed = &ctx.accounts.feed;
        let out = quote_buy(
            amount_in_raw,
            feed.price,
            ctx.accounts.mint.decimals,
            ctx.accounts.market.spread_bps,
        )?;
        require!(out > 0, DevnetError::ZeroAmount);
        require!(out >= min_out_raw, DevnetError::SlippageExceeded);
        require!(out <= ctx.accounts.inventory.amount, DevnetError::InsufficientInventory);

        token_interface::transfer_checked(
            CpiContext::new(
                ctx.accounts.usdc_token_program.key(),
                TransferChecked {
                    from: ctx.accounts.source.to_account_info(),
                    mint: ctx.accounts.tusdc_mint.to_account_info(),
                    to: ctx.accounts.usdc_vault.to_account_info(),
                    authority: ctx.accounts.payer.to_account_info(),
                },
            ),
            amount_in_raw,
            TUSDC_DECIMALS,
        )?;

        let market = &ctx.accounts.market;
        let mint_key = market.mint;
        let bump = [market.bump];
        let seeds: &[&[u8]] = &[MARKET_SEED, mint_key.as_ref(), &bump];
        token_interface::transfer_checked(
            CpiContext::new_with_signer(
                ctx.accounts.asset_token_program.key(),
                TransferChecked {
                    from: ctx.accounts.inventory.to_account_info(),
                    mint: ctx.accounts.mint.to_account_info(),
                    to: ctx.accounts.destination.to_account_info(),
                    authority: market.to_account_info(),
                },
                &[seeds],
            ),
            out,
            ctx.accounts.mint.decimals,
        )?;
        emit!(Bought { mint: mint_key, amount_in_raw, amount_out_raw: out, price: feed.price });
        Ok(())
    }
}

// ---------------------------------------------------------------- pricing

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug)]
pub struct FeedPrices {
    /// Tokenized instrument price, 1e-6 USD per whole token. What Tenet values
    /// the instrument at and what the market trades at.
    pub price: i64,
    /// Confidence interval, same units.
    pub conf: u64,
    /// PreStocks-style reference mark (0 = none). Market vs mark.
    pub reference_mark: i64,
    /// Price of the underlying reference (0 = none). Underlying vs token.
    pub underlying_price: i64,
}

fn apply_prices(feed: &mut PriceFeed, p: FeedPrices) -> Result<()> {
    require!(p.price > 0, DevnetError::PriceNotPositive);
    require!(p.reference_mark >= 0 && p.underlying_price >= 0, DevnetError::PriceNotPositive);
    require!((p.conf as u128) * BPS <= (p.price as u128) * 100, DevnetError::ConfidenceTooWide);
    let clock = Clock::get()?;
    feed.price = p.price;
    feed.conf = p.conf;
    feed.reference_mark = p.reference_mark;
    feed.underlying_price = p.underlying_price;
    feed.publish_time = clock.unix_timestamp;
    feed.publish_slot = clock.slot;
    feed.revision = feed.revision.checked_add(1).ok_or(DevnetError::MathOverflow)?;
    emit!(FeedUpdated {
        mint: feed.mint,
        price: p.price,
        reference_mark: p.reference_mark,
        underlying_price: p.underlying_price,
        revision: feed.revision,
    });
    Ok(())
}

/// out = floor(amount_in × 10^decimals / price) × (1 − spread), integers only.
/// `amount_in` is raw TUSDC (6 dp); `price` is 1e-6 USD per whole token, so
/// the 10^6 factors cancel.
pub fn quote_buy(amount_in_raw: u64, price: i64, decimals: u8, spread_bps: u16) -> Result<u64> {
    require!(price > 0, DevnetError::PriceNotPositive);
    let gross = (amount_in_raw as u128)
        .checked_mul(10u128.pow(decimals as u32))
        .ok_or(DevnetError::MathOverflow)?
        / price as u128;
    let net = gross
        .checked_mul(BPS - spread_bps as u128)
        .ok_or(DevnetError::MathOverflow)?
        / BPS;
    u64::try_from(net).map_err(|_| error!(DevnetError::MathOverflow))
}

// ---------------------------------------------------------------- state

#[account]
#[derive(InitSpace)]
pub struct Admin {
    /// Publishes test prices and opens markets. Holds no custody power over
    /// any Tenet Circle.
    pub operator: Pubkey,
    pub tusdc_mint: Pubkey,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct Faucet {
    pub tusdc_mint: Pubkey,
    pub total_minted_raw: u64,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct Claim {
    pub owner: Pubkey,
    pub last_claim_at: i64,
    pub bump: u8,
}

/// A devnet test price for one instrument. Field names and semantics of the
/// first block mirror Pyth's `Price` so Tenet's core reads both the same way.
#[account]
#[derive(InitSpace)]
pub struct PriceFeed {
    pub feed_id: [u8; 32],
    pub price: i64,
    pub conf: u64,
    pub exponent: i32,
    pub publish_time: i64,
    // ---- devnet analytics, read by the VALUE layer -------------------------
    pub reference_mark: i64,
    pub underlying_price: i64,
    pub mint: Pubkey,
    #[max_len(MAX_SYMBOL_LEN)]
    pub symbol: String,
    pub publish_slot: u64,
    pub revision: u64,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct Market {
    pub mint: Pubkey,
    pub token_program: Pubkey,
    pub feed: Pubkey,
    pub inventory: Pubkey,
    pub usdc_vault: Pubkey,
    pub spread_bps: u16,
    pub bump: u8,
}

// ---------------------------------------------------------------- accounts

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub upgrade_authority: Signer<'info>,

    #[account(
        constraint = program.programdata_address()? == Some(program_data.key()) @ DevnetError::NotUpgradeAuthority,
    )]
    pub program: Program<'info, crate::program::TenetDevnet>,

    #[account(
        constraint = program_data.upgrade_authority_address == Some(upgrade_authority.key())
            @ DevnetError::NotUpgradeAuthority,
    )]
    pub program_data: Account<'info, ProgramData>,

    #[account(init, payer = upgrade_authority, space = 8 + Admin::INIT_SPACE, seeds = [ADMIN_SEED], bump)]
    pub admin: Account<'info, Admin>,

    #[account(init, payer = upgrade_authority, space = 8 + Faucet::INIT_SPACE, seeds = [FAUCET_SEED], bump)]
    pub faucet: Account<'info, Faucet>,

    /// TUSDC: classic SPL, 6 decimals, mint authority = the faucet PDA, no
    /// freeze authority. Created here so no keypair ever controls issuance.
    #[account(
        init,
        payer = upgrade_authority,
        seeds = [TUSDC_MINT_SEED],
        bump,
        mint::decimals = TUSDC_DECIMALS,
        mint::authority = faucet,
        mint::token_program = token_program,
    )]
    pub tusdc_mint: InterfaceAccount<'info, Mint>,

    #[account(address = anchor_spl::token::ID @ DevnetError::WrongTokenProgram)]
    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct RequestTusdc<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(mut, seeds = [FAUCET_SEED], bump = faucet.bump)]
    pub faucet: Account<'info, Faucet>,

    #[account(
        init_if_needed,
        payer = owner,
        space = 8 + Claim::INIT_SPACE,
        seeds = [CLAIM_SEED, owner.key().as_ref()],
        bump,
    )]
    pub claim: Account<'info, Claim>,

    #[account(mut, address = faucet.tusdc_mint @ DevnetError::WrongMint)]
    pub tusdc_mint: InterfaceAccount<'info, Mint>,

    /// The caller's own TUSDC account: the faucet cannot be pointed at anyone
    /// else's wallet.
    #[account(
        mut,
        token::mint = tusdc_mint,
        token::authority = owner,
        token::token_program = token_program,
    )]
    pub destination: InterfaceAccount<'info, TokenAccount>,

    #[account(address = anchor_spl::token::ID @ DevnetError::WrongTokenProgram)]
    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CreateFeed<'info> {
    #[account(mut)]
    pub operator: Signer<'info>,

    #[account(seeds = [ADMIN_SEED], bump = admin.bump, has_one = operator @ DevnetError::NotOperator)]
    pub admin: Account<'info, Admin>,

    pub mint: InterfaceAccount<'info, Mint>,

    #[account(
        init,
        payer = operator,
        space = 8 + PriceFeed::INIT_SPACE,
        seeds = [FEED_SEED, mint.key().as_ref()],
        bump,
    )]
    pub feed: Account<'info, PriceFeed>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UpdateFeed<'info> {
    pub operator: Signer<'info>,

    #[account(seeds = [ADMIN_SEED], bump = admin.bump, has_one = operator @ DevnetError::NotOperator)]
    pub admin: Account<'info, Admin>,

    #[account(mut, seeds = [FEED_SEED, feed.mint.as_ref()], bump = feed.bump)]
    pub feed: Account<'info, PriceFeed>,
}

#[derive(Accounts)]
pub struct CreateMarket<'info> {
    #[account(mut)]
    pub operator: Signer<'info>,

    #[account(seeds = [ADMIN_SEED], bump = admin.bump, has_one = operator @ DevnetError::NotOperator)]
    pub admin: Account<'info, Admin>,

    #[account(
        constraint = token_program.key() == *mint.to_account_info().owner @ DevnetError::WrongTokenProgram,
    )]
    pub mint: InterfaceAccount<'info, Mint>,

    #[account(seeds = [FEED_SEED, mint.key().as_ref()], bump = feed.bump)]
    pub feed: Account<'info, PriceFeed>,

    #[account(
        init,
        payer = operator,
        space = 8 + Market::INIT_SPACE,
        seeds = [MARKET_SEED, mint.key().as_ref()],
        bump,
    )]
    pub market: Account<'info, Market>,

    /// Instrument inventory, owned by the market PDA.
    #[account(
        init,
        payer = operator,
        seeds = [INVENTORY_SEED, mint.key().as_ref()],
        bump,
        token::mint = mint,
        token::authority = market,
        token::token_program = token_program,
    )]
    pub inventory: InterfaceAccount<'info, TokenAccount>,

    #[account(address = admin.tusdc_mint @ DevnetError::WrongMint)]
    pub tusdc_mint: InterfaceAccount<'info, Mint>,

    /// TUSDC proceeds, owned by the market PDA.
    #[account(
        init,
        payer = operator,
        seeds = [MARKET_USDC_SEED, mint.key().as_ref()],
        bump,
        token::mint = tusdc_mint,
        token::authority = market,
        token::token_program = usdc_token_program,
    )]
    pub usdc_vault: InterfaceAccount<'info, TokenAccount>,

    pub token_program: Interface<'info, TokenInterface>,
    #[account(address = anchor_spl::token::ID @ DevnetError::WrongTokenProgram)]
    pub usdc_token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SetSpread<'info> {
    pub operator: Signer<'info>,

    #[account(seeds = [ADMIN_SEED], bump = admin.bump, has_one = operator @ DevnetError::NotOperator)]
    pub admin: Account<'info, Admin>,

    #[account(mut, seeds = [MARKET_SEED, market.mint.as_ref()], bump = market.bump)]
    pub market: Account<'info, Market>,
}

#[derive(Accounts)]
pub struct Buy<'info> {
    /// Owner or approved delegate of `source`.
    pub payer: Signer<'info>,

    #[account(seeds = [ADMIN_SEED], bump = admin.bump)]
    pub admin: Account<'info, Admin>,

    #[account(
        seeds = [MARKET_SEED, market.mint.as_ref()],
        bump = market.bump,
        has_one = feed @ DevnetError::WrongFeed,
        has_one = inventory @ DevnetError::WrongVault,
        has_one = usdc_vault @ DevnetError::WrongVault,
    )]
    pub market: Account<'info, Market>,

    pub feed: Account<'info, PriceFeed>,

    #[account(mut)]
    pub inventory: InterfaceAccount<'info, TokenAccount>,

    #[account(mut)]
    pub usdc_vault: InterfaceAccount<'info, TokenAccount>,

    /// TUSDC being spent.
    #[account(mut, token::mint = tusdc_mint, token::token_program = usdc_token_program)]
    pub source: InterfaceAccount<'info, TokenAccount>,

    /// Where the instrument is delivered.
    #[account(mut, token::mint = mint, token::token_program = asset_token_program)]
    pub destination: InterfaceAccount<'info, TokenAccount>,

    #[account(address = market.mint @ DevnetError::WrongMint)]
    pub mint: InterfaceAccount<'info, Mint>,

    #[account(address = admin.tusdc_mint @ DevnetError::WrongMint)]
    pub tusdc_mint: InterfaceAccount<'info, Mint>,

    #[account(address = market.token_program @ DevnetError::WrongTokenProgram)]
    pub asset_token_program: Interface<'info, TokenInterface>,

    #[account(address = anchor_spl::token::ID @ DevnetError::WrongTokenProgram)]
    pub usdc_token_program: Interface<'info, TokenInterface>,
}

// ---------------------------------------------------------------- events

#[event]
pub struct DevnetInitialized { pub operator: Pubkey, pub tusdc_mint: Pubkey }
#[event]
pub struct TusdcClaimed { pub owner: Pubkey, pub amount_raw: u64 }
#[event]
pub struct FeedUpdated { pub mint: Pubkey, pub price: i64, pub reference_mark: i64, pub underlying_price: i64, pub revision: u64 }
#[event]
pub struct MarketCreated { pub mint: Pubkey, pub spread_bps: u16 }
#[event]
pub struct Bought { pub mint: Pubkey, pub amount_in_raw: u64, pub amount_out_raw: u64, pub price: i64 }

// ---------------------------------------------------------------- errors

#[error_code]
#[derive(PartialEq, Eq)]
pub enum DevnetError {
    #[msg("Signer is not this program's upgrade authority")]
    NotUpgradeAuthority,
    #[msg("Signer is not the devnet operator")]
    NotOperator,
    #[msg("Wait a minute between faucet claims")]
    FaucetCooldown,
    #[msg("The test-USDC faucet has reached its supply cap")]
    FaucetExhausted,
    #[msg("Wrong mint for this account")]
    WrongMint,
    #[msg("Wrong token program for this mint")]
    WrongTokenProgram,
    #[msg("Account is not this market's feed")]
    WrongFeed,
    #[msg("Account is not this market's vault")]
    WrongVault,
    #[msg("Symbol is empty or too long")]
    InvalidSymbol,
    #[msg("Price must be positive")]
    PriceNotPositive,
    #[msg("Confidence interval exceeds 1% of price")]
    ConfidenceTooWide,
    #[msg("Spread exceeds 10%")]
    SpreadTooWide,
    #[msg("Amount must be greater than zero")]
    ZeroAmount,
    #[msg("Output is below the caller's minimum")]
    SlippageExceeded,
    #[msg("The market does not hold enough inventory")]
    InsufficientInventory,
    #[msg("Arithmetic overflow")]
    MathOverflow,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn quote_buy_is_exact_and_floors() {
        // 100 TUSDC at 40.00 per token, 6-dp token, no spread = 2.5 tokens.
        assert_eq!(quote_buy(100_000_000, 40_000_000, 6, 0).unwrap(), 2_500_000);
        // 9-dp token.
        assert_eq!(quote_buy(100_000_000, 40_000_000, 9, 0).unwrap(), 2_500_000_000);
        // 30 bps spread comes off the output.
        assert_eq!(quote_buy(100_000_000, 40_000_000, 6, 30).unwrap(), 2_492_500);
        // Floors: 1 raw TUSDC at 3.00 buys 0.333… -> 0 of a 0-dp token.
        assert_eq!(quote_buy(1, 3_000_000, 0, 0).unwrap(), 0);
        assert!(quote_buy(1, 0, 6, 0).is_err());
    }
}
