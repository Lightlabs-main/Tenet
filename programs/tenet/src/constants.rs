//! Protocol constants and PDA seeds.
//!
//! Seeds are defined once here. Derivations live in `pda.rs`; the TypeScript
//! SDK mirrors them in `packages/sdk/src/pda.ts`. A divergence would silently
//! address the wrong account, so the two are checked against each other by
//! `tests/vectors/pda.json`.

use anchor_lang::prelude::*;

// ---------------------------------------------------------------- seeds

pub const CONFIG_SEED: &[u8] = b"config";
pub const MANDATE_SEED: &[u8] = b"mandate";
pub const MANDATE_ASSET_SEED: &[u8] = b"mandate_asset";
pub const REGISTRY_SEED: &[u8] = b"registry";
pub const CIRCLE_SEED: &[u8] = b"circle";
pub const CIRCLE_ASSET_SEED: &[u8] = b"circle_asset";
pub const VAULT_AUTHORITY_SEED: &[u8] = b"vault_authority";
pub const VAULT_SEED: &[u8] = b"vault";
pub const USDC_VAULT_SEED: &[u8] = b"usdc_vault";
pub const EPOCH_SEED: &[u8] = b"epoch";
pub const EPOCH_ESCROW_SEED: &[u8] = b"epoch_escrow";
pub const RECEIPT_SEED: &[u8] = b"receipt";
pub const MEMBER_SEED: &[u8] = b"member";
pub const NAV_SNAPSHOT_SEED: &[u8] = b"nav_snapshot";
pub const REDEMPTION_SEED: &[u8] = b"redemption";
pub const REDEMPTION_ASSET_SEED: &[u8] = b"redemption_asset";
pub const EXEC_AUTH_SEED: &[u8] = b"exec_auth";
pub const AMENDMENT_SEED: &[u8] = b"amendment";
pub const AMENDMENT_VOTE_SEED: &[u8] = b"amendment_vote";

/// Jupiter's current aggregator program, verified in V-020. The execution
/// window accepts only this program between `begin_execution` and
/// `end_execution`; route venues remain Jupiter's concern.
pub const JUPITER_PROGRAM_ID: Pubkey = pubkey!("JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4");

// ---------------------------------------------------------------- limits

/// Justified in `docs/architecture.md` §5: product and operational limits, not
/// transaction size — NAV is accumulated across transactions, and redemption is
/// per-asset, so neither constrains the count.
pub const MAX_CIRCLE_ASSETS: u16 = 8;

pub const MAX_MANDATE_NAME_LEN: usize = 48;
pub const MAX_MANDATE_DESCRIPTION_LEN: usize = 512;
pub const MAX_SYMBOL_LEN: usize = 16;
pub const MAX_DISPLAY_NAME_LEN: usize = 48;

pub const BPS_DENOMINATOR: u64 = 10_000;

/// Epoch duration bounds. An epoch too short makes contribution impractical;
/// too long strands capital.
pub const MIN_EPOCH_DURATION: i64 = 60; // 1 minute (test-friendly lower bound)
pub const MAX_EPOCH_DURATION: i64 = 90 * 24 * 60 * 60; // 90 days

/// Amendments require a supermajority and a delay so members can exit or fork
/// before a rule change takes effect (spec §39).
pub const MIN_AMENDMENT_THRESHOLD_BPS: u16 = 5_001;
pub const MIN_AMENDMENT_DELAY_SECONDS: i64 = 24 * 60 * 60;

/// A NAV snapshot is accumulated across transactions; this bounds how long the
/// whole valuation may take, so an epoch cannot be priced at stale prices.
pub const NAV_SNAPSHOT_MAX_SLOTS: u64 = 150; // ~60s at 400ms slots
/// Grace period for a closed rolling epoch whose valuation snapshot was never
/// opened. This gives anyone time to start pricing while guaranteeing that a
/// closed epoch cannot strand contributors indefinitely.
pub const NAV_CANCELLATION_GRACE_SECONDS: i64 = 60;

/// Below this NAV a Circle cannot price new entrants: the share price becomes
/// absurd and rounding pathological. Issuance is refused; **exit never is**
/// (INV-014). See `docs/accounting.md` §4.3.
pub const MIN_NAV_FOR_ISSUANCE: u128 = 1_000_000; // $1.00 in micro-USDC

/// Shares are `u64` with 6 decimals. At inception 1 share = 1 micro-USDC
/// contributed, which is why Epoch 0 needs no division (`docs/accounting.md` §3).
pub const SHARE_DECIMALS: u8 = 6;

/// Expected USDC decimals, confirmed on-chain (V-014). Asserted at Circle
/// creation rather than assumed: if it were ever untrue the share representation
/// itself would change.
pub const EXPECTED_USDC_DECIMALS: u8 = 6;
