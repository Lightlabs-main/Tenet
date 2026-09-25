//! `initialize_config` — decisions A-18 and A-23.

use anchor_lang::prelude::*;
use anchor_spl::token_interface::Mint;

use crate::constants::*;
use crate::errors::TenetError;
use crate::program::Tenet;
use crate::state::{Config, Network, PriceSource};

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug)]
pub struct ConfigParams {
    pub registry_authority: Pubkey,
    pub network: Network,
    pub execution_venue: Pubkey,
    pub price_source: PriceSource,
    pub price_program: Pubkey,
    pub max_price_age_seconds: u64,
}

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

/// The only legal environments (A-23). Fails closed:
///
/// - **Mainnet** must use canonical USDC, Jupiter as the sole venue, Pyth
///   Receiver prices, and a freshness bound no looser than Pyth's 60 s. A
///   mainnet Tenet cannot be pointed at test prices or a test venue.
/// - **Devnet** must NOT use canonical USDC. Test prices and the test market
///   can therefore never value or move real money.
pub fn validate_config(usdc_mint: &Pubkey, p: &ConfigParams) -> Result<()> {
    require!(p.max_price_age_seconds > 0, TenetError::InvalidNetworkConfig);
    match p.network {
        Network::Mainnet => {
            require_keys_eq!(*usdc_mint, CANONICAL_USDC_MINT, TenetError::InvalidNetworkConfig);
            require_keys_eq!(p.execution_venue, JUPITER_PROGRAM_ID, TenetError::InvalidNetworkConfig);
            require!(p.price_source == PriceSource::Pyth, TenetError::InvalidNetworkConfig);
            require_keys_eq!(p.price_program, PYTH_RECEIVER_PROGRAM_ID, TenetError::InvalidNetworkConfig);
            require!(
                p.max_price_age_seconds <= MAINNET_MAX_PRICE_AGE_SECONDS,
                TenetError::InvalidNetworkConfig
            );
        }
        Network::Devnet => {
            require!(*usdc_mint != CANONICAL_USDC_MINT, TenetError::InvalidNetworkConfig);
            require!(p.execution_venue != Pubkey::default(), TenetError::InvalidNetworkConfig);
            require!(p.price_program != Pubkey::default(), TenetError::InvalidNetworkConfig);
            require!(
                p.max_price_age_seconds <= DEVNET_MAX_PRICE_AGE_SECONDS,
                TenetError::InvalidNetworkConfig
            );
        }
    }
    Ok(())
}

pub fn initialize_handler(ctx: Context<InitializeConfig>, p: ConfigParams) -> Result<()> {
    let usdc_mint = ctx.accounts.usdc_mint.key();
    validate_config(&usdc_mint, &p)?;
    let config = &mut ctx.accounts.config;
    config.registry_authority = p.registry_authority;
    config.usdc_mint = usdc_mint;
    config.network = p.network;
    config.execution_venue = p.execution_venue;
    config.price_source = p.price_source;
    config.price_program = p.price_program;
    config.max_price_age_seconds = p.max_price_age_seconds;
    config.bump = ctx.bumps.config;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn mainnet() -> ConfigParams {
        ConfigParams {
            registry_authority: Pubkey::new_unique(),
            network: Network::Mainnet,
            execution_venue: JUPITER_PROGRAM_ID,
            price_source: PriceSource::Pyth,
            price_program: PYTH_RECEIVER_PROGRAM_ID,
            max_price_age_seconds: 60,
        }
    }

    fn devnet() -> ConfigParams {
        ConfigParams {
            network: Network::Devnet,
            execution_venue: Pubkey::new_unique(),
            price_source: PriceSource::DevnetFeed,
            price_program: Pubkey::new_unique(),
            max_price_age_seconds: DEVNET_MAX_PRICE_AGE_SECONDS,
            ..mainnet()
        }
    }

    #[test]
    fn mainnet_accepts_only_the_real_venues() {
        assert!(validate_config(&CANONICAL_USDC_MINT, &mainnet()).is_ok());
        let bad: [fn(&mut ConfigParams); 4] = [
            |p| p.execution_venue = Pubkey::new_unique(),
            |p| p.price_source = PriceSource::DevnetFeed,
            |p| p.price_program = Pubkey::new_unique(),
            |p| p.max_price_age_seconds = 61,
        ];
        for (i, f) in bad.iter().enumerate() {
            let mut p = mainnet();
            f(&mut p);
            assert!(validate_config(&CANONICAL_USDC_MINT, &p).is_err(), "mainnet case {i}");
        }
        // Mainnet with anything but canonical USDC.
        assert!(validate_config(&Pubkey::new_unique(), &mainnet()).is_err());
    }

    #[test]
    fn devnet_can_never_touch_canonical_usdc() {
        let tusdc = Pubkey::new_unique();
        assert!(validate_config(&tusdc, &devnet()).is_ok());
        // The critical case: test prices / test venue against real USDC.
        assert!(validate_config(&CANONICAL_USDC_MINT, &devnet()).is_err());
        let mut p = devnet();
        p.max_price_age_seconds = DEVNET_MAX_PRICE_AGE_SECONDS + 1;
        assert!(validate_config(&tusdc, &p).is_err());
        let mut p = devnet();
        p.max_price_age_seconds = 0;
        assert!(validate_config(&tusdc, &p).is_err());
    }
}
