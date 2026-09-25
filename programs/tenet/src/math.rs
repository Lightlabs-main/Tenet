//! Checked accounting arithmetic.
//!
//! The Rust half of `packages/domain/src/accounting.ts`. These two must agree
//! exactly — the same property-test vectors are replayed against both
//! (`REVIEW.md` U-12). Every division floors **toward the Circle**, so rounding
//! never advantages whoever triggered the operation (INV-005).
//!
//! No floating point appears anywhere in this file, and no `as` casts are used
//! for narrowing: every u128 → u64 conversion is checked and refuses rather than
//! truncating.

use crate::errors::TenetError;
use anchor_lang::prelude::*;

/// Narrow a u128 intermediate to u64, refusing rather than truncating.
#[inline]
pub fn to_u64(v: u128) -> Result<u64> {
    u64::try_from(v).map_err(|_| error!(TenetError::MathOverflow))
}

#[inline]
pub fn checked_add_u64(a: u64, b: u64) -> Result<u64> {
    a.checked_add(b)
        .ok_or_else(|| error!(TenetError::MathOverflow))
}

#[inline]
pub fn checked_sub_u64(a: u64, b: u64) -> Result<u64> {
    a.checked_sub(b)
        .ok_or_else(|| error!(TenetError::MathUnderflow))
}

/// `floor(a * b / d)` computed in u128, refusing on overflow or zero divisor.
///
/// This is the single shape used by both issuance and redemption. Keeping it in
/// one place means the rounding direction is defined once.
#[inline]
pub fn mul_div_floor(a: u64, b: u64, d: u128) -> Result<u64> {
    require!(d > 0, TenetError::DivisionByZero);
    let product = (a as u128)
        .checked_mul(b as u128)
        .ok_or_else(|| error!(TenetError::MathOverflow))?;
    to_u64(product / d)
}

/// Shares owed for a contribution.
///
/// Epoch 0 (`shares_before == 0`) is exact and needs no division at all.
///
/// Rolling: `floor(amount * shares_before / nav_before)`.
///
/// Deliberately NOT a precomputed fixed-point rate. `docs/accounting.md` §4.1
/// shows the rate formulation overflows u128 when NAV has collapsed toward zero
/// — which is exactly the state an attacker would want to contribute into.
/// Decision A-17.
pub fn shares_for_contribution(amount: u64, shares_before: u64, nav_before: u128) -> Result<u64> {
    if shares_before == 0 {
        return Ok(amount); // Epoch 0: 1 share per micro-USDC, exact
    }
    require!(nav_before > 0, TenetError::ZeroNav);
    mul_div_floor(amount, shares_before, nav_before)
}

/// Raw entitlement to one asset for a redemption.
///
/// `available` must ALREADY have existing reservations subtracted. Passing a
/// bare vault balance over-allocates concurrent redeemers — see `REVIEW.md` H-01
/// and `docs/accounting.md` §6.
pub fn entitlement_for_redemption(
    available: u64,
    shares_redeemed: u64,
    total_shares_at_snapshot: u64,
) -> Result<u64> {
    require!(total_shares_at_snapshot > 0, TenetError::DivisionByZero);
    require!(
        shares_redeemed <= total_shares_at_snapshot,
        TenetError::InsufficientShares
    );
    mul_div_floor(available, shares_redeemed, total_shares_at_snapshot as u128)
}

/// Supply consumption in basis points, computed raw-over-raw.
///
/// Both operands are raw base units, so the Token-2022 ScaledUiAmount multiplier
/// cancels and cannot corrupt the ratio (V-003, V-017, decision A-09). Floors,
/// which understates consumption and therefore makes the Mandate cap bind
/// *earlier* — the conservative direction.
pub fn supply_consumption_bps(vault_raw: u64, mint_supply_raw: u64) -> Result<u64> {
    require!(mint_supply_raw > 0, TenetError::DivisionByZero);
    mul_div_floor(vault_raw, 10_000, mint_supply_raw as u128)
}

/// Weight of a position in basis points of NAV.
pub fn weight_bps(position_value: u128, nav: u128) -> Result<u64> {
    require!(nav > 0, TenetError::ZeroNav);
    let scaled = position_value
        .checked_mul(10_000)
        .ok_or_else(|| error!(TenetError::MathOverflow))?;
    to_u64(scaled / nav)
}

/// The transfer fee withheld on `amount_raw`.
///
/// Rounds **up** — the one deliberate exception to floor-toward-the-Circle. It
/// rounds against the actor too: showing a larger expected cost is conservative,
/// so a member is never shown a rosier number than reality
/// (`docs/accounting.md` §7).
pub fn transfer_fee_amount(amount_raw: u64, fee_bps: u16, maximum_fee: u64) -> Result<u64> {
    if fee_bps == 0 || amount_raw == 0 {
        return Ok(0);
    }
    let numerator = (amount_raw as u128)
        .checked_mul(fee_bps as u128)
        .ok_or_else(|| error!(TenetError::MathOverflow))?;
    let ceil = (numerator - 1) / 10_000 + 1;
    let fee = to_u64(ceil)?;
    Ok(fee.min(maximum_fee))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn epoch_zero_is_exact_and_needs_no_division() {
        assert_eq!(
            shares_for_contribution(30_000_000, 0, 0).unwrap(),
            30_000_000
        );
    }

    #[test]
    fn rolling_issuance_matches_the_worked_example() {
        // docs/accounting.md §10: 12 USDC into a 60 NAV circle with 50 shares.
        assert_eq!(
            shares_for_contribution(12_000_000, 50_000_000, 60_000_000).unwrap(),
            10_000_000
        );
    }

    #[test]
    fn issuance_never_rounds_up() {
        for amount in [1u64, 3, 1_000_001] {
            for (s, n) in [(7u64, 3u128), (1_000_000, 3), (5, 999)] {
                let sh = shares_for_contribution(amount, s, n).unwrap();
                assert!((sh as u128) * n <= (amount as u128) * (s as u128));
            }
        }
    }

    #[test]
    fn redemption_never_rounds_up_and_dust_stays() {
        // docs/accounting.md §10 exit example.
        let e = entitlement_for_redemption(7_000_000_003, 20_000_000, 60_000_000).unwrap();
        assert_eq!(e, 2_333_333_334);
        assert!(7_000_000_003 - 3 * e == 1); // one raw unit of dust remains
    }

    #[test]
    fn zero_nav_is_refused_rather_than_divided() {
        assert!(shares_for_contribution(100, 100, 0).is_err());
        assert!(entitlement_for_redemption(100, 1, 0).is_err());
    }

    #[test]
    fn redeeming_more_than_total_is_refused() {
        assert!(entitlement_for_redemption(100, 5, 4).is_err());
    }

    #[test]
    fn u64_max_operands_stay_inside_u128() {
        // (2^64-1)^2 < 2^128, so the A-17 formulation cannot overflow.
        assert_eq!(
            entitlement_for_redemption(u64::MAX, u64::MAX, u64::MAX).unwrap(),
            u64::MAX
        );
    }

    #[test]
    fn supply_consumption_floors_conservatively() {
        // SPACEX verified raw supply (V-003). 1% is 87_425_067_530.69 raw units.
        let supply = 8_742_506_753_069u64;
        assert_eq!(supply_consumption_bps(87_425_067_531, supply).unwrap(), 100);
        assert_eq!(supply_consumption_bps(87_425_067_530, supply).unwrap(), 99);
    }

    #[test]
    fn transfer_fee_rounds_up_and_respects_the_cap() {
        // V-004: 100 bps, uncapped.
        assert_eq!(
            transfer_fee_amount(1_000_000_000, 100, u64::MAX).unwrap(),
            10_000_000
        );
        assert_eq!(transfer_fee_amount(1, 100, u64::MAX).unwrap(), 1); // rounds up
        assert_eq!(transfer_fee_amount(0, 100, u64::MAX).unwrap(), 0);
        assert_eq!(transfer_fee_amount(1_000_000_000, 100, 5).unwrap(), 5); // capped
        assert_eq!(transfer_fee_amount(1_000_000_000, 0, u64::MAX).unwrap(), 0);
        // xStocks
    }
}
