//! The price adapter (A-23): the single place a price enters Tenet.
//!
//! Every consumer — NAV snapshots, the execution price-impact floor, the
//! target-weight check — calls `read_price` and receives the same `Price`
//! (Pyth's own struct), whatever the network. Product logic never knows which
//! source sat underneath:
//!
//! | `Config.price_source` | account owner (`Config.price_program`) | layout            |
//! |-----------------------|----------------------------------------|-------------------|
//! | `Pyth`                | Pyth Solana Receiver                    | `PriceUpdateV2`   |
//! | `DevnetFeed`          | tenet-devnet                            | `PriceFeed` header|
//!
//! Both paths get identical treatment: the account must be owned by the
//! configured program, carry the feed the registry binds for this asset, be no
//! older than `Config.max_price_age_seconds`, be strictly positive, and have a
//! confidence interval within 1% of price.

use anchor_lang::prelude::*;
use anchor_lang::AccountDeserialize;
use pyth_solana_receiver_sdk::price_update::{Price, PriceUpdateV2};

use crate::constants::*;
use crate::errors::TenetError;
use crate::state::{Config, Network, PriceSource};

pub const MAX_CONFIDENCE_BPS: u128 = 100;

/// Byte layout of the Pyth-shaped header of a tenet-devnet `PriceFeed`:
/// discriminator(8) feed_id(32) price(i64) conf(u64) exponent(i32) publish_time(i64).
const FEED_HEADER_LEN: usize = 8 + 32 + 8 + 8 + 4 + 8;

/// Decode the devnet feed header. Returns (feed_id, price).
pub fn parse_devnet_feed(data: &[u8]) -> Result<([u8; 32], Price)> {
    require!(data.len() >= FEED_HEADER_LEN, TenetError::PriceFeedMismatch);
    require!(data[..8] == DEVNET_PRICE_FEED_DISCRIMINATOR, TenetError::PriceFeedMismatch);
    let mut feed_id = [0u8; 32];
    feed_id.copy_from_slice(&data[8..40]);
    let le8 = |o: usize| -> [u8; 8] { data[o..o + 8].try_into().unwrap() };
    let price = Price {
        price: i64::from_le_bytes(le8(40)),
        conf: u64::from_le_bytes(le8(48)),
        exponent: i32::from_le_bytes(data[56..60].try_into().unwrap()),
        publish_time: i64::from_le_bytes(le8(60)),
    };
    Ok((feed_id, price))
}

/// Positive price and confidence within 1% — applied to every source.
pub fn check_price(price: &Price) -> Result<()> {
    require!(price.price > 0, TenetError::PriceNotPositive);
    let abs = price.price as u128;
    let conf_bps = (price.conf as u128)
        .checked_mul(10_000)
        .and_then(|v| v.checked_add(abs - 1))
        .ok_or(TenetError::PriceArithmeticOverflow)?
        / abs;
    require!(conf_bps <= MAX_CONFIDENCE_BPS, TenetError::PriceConfidenceTooWide);
    Ok(())
}

pub fn read_price(config: &Config, account: &AccountInfo, feed_id: &[u8; 32]) -> Result<Price> {
    require_keys_eq!(*account.owner, config.price_program, TenetError::PriceSourceMismatch);
    let clock = Clock::get()?;
    let price = match config.price_source {
        PriceSource::Pyth => {
            let data = account.try_borrow_data()?;
            let update = PriceUpdateV2::try_deserialize(&mut &data[..])
                .map_err(|_| error!(TenetError::PriceObservationUnavailable))?;
            update
                .get_price_no_older_than(&clock, config.max_price_age_seconds, feed_id)
                .map_err(|_| error!(TenetError::PriceObservationUnavailable))?
        }
        PriceSource::DevnetFeed => {
            // Belt and braces: validate_config already refuses this pairing.
            require!(config.network == Network::Devnet, TenetError::InvalidNetworkConfig);
            let (id, price) = parse_devnet_feed(&account.try_borrow_data()?)?;
            require!(id == *feed_id, TenetError::PriceFeedMismatch);
            let age = clock
                .unix_timestamp
                .checked_sub(price.publish_time)
                .ok_or(TenetError::PriceObservationUnavailable)?;
            require!(
                age >= 0 && (age as u64) <= config.max_price_age_seconds,
                TenetError::PriceObservationUnavailable
            );
            price
        }
    };
    check_price(&price)?;
    Ok(price)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn header(feed: [u8; 32], price: i64, conf: u64, exp: i32, t: i64) -> Vec<u8> {
        let mut v = DEVNET_PRICE_FEED_DISCRIMINATOR.to_vec();
        v.extend_from_slice(&feed);
        v.extend_from_slice(&price.to_le_bytes());
        v.extend_from_slice(&conf.to_le_bytes());
        v.extend_from_slice(&exp.to_le_bytes());
        v.extend_from_slice(&t.to_le_bytes());
        v.extend_from_slice(&[0u8; 40]); // devnet-only analytics fields follow
        v
    }

    #[test]
    fn devnet_feed_header_decodes_to_pyth_price() {
        let (id, p) = parse_devnet_feed(&header([7; 32], 40_000_000, 4_000, -6, 1_700_000_000)).unwrap();
        assert_eq!(id, [7; 32]);
        assert_eq!((p.price, p.conf, p.exponent, p.publish_time), (40_000_000, 4_000, -6, 1_700_000_000));
    }

    #[test]
    fn wrong_discriminator_or_short_data_is_refused() {
        let mut h = header([7; 32], 1, 0, -6, 0);
        h[0] ^= 1;
        assert!(parse_devnet_feed(&h).is_err());
        assert!(parse_devnet_feed(&DEVNET_PRICE_FEED_DISCRIMINATOR).is_err());
    }

    #[test]
    fn confidence_and_sign_rules() {
        let p = |price, conf| Price { price, conf, exponent: -6, publish_time: 0 };
        assert!(check_price(&p(100_000, 1_000)).is_ok()); // exactly 1%
        assert!(check_price(&p(100_000, 1_001)).is_err()); // just over
        assert!(check_price(&p(0, 0)).is_err());
        assert!(check_price(&p(-5, 0)).is_err());
    }
}
