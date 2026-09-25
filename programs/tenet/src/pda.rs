//! PDA derivation — the single source of truth for every Tenet address.
//!
//! One function per row of `docs/architecture.md` §2. Every account is bound to
//! its parent by its seeds, so no address in the custody path can be chosen
//! freely by a caller.
//!
//! `packages/sdk/src/pda.ts` builds the same seeds for clients. The two are
//! checked against each other by `tests/vectors/pda.json` (generated from the
//! TS side, replayed here): a divergence would make a client address the wrong
//! account without any error, so it must fail a test instead.
//!
//! Integers in seeds are little-endian `u64`, matching `to_le_bytes`.

use anchor_lang::prelude::*;

use crate::constants::*;

fn find(seeds: &[&[u8]]) -> (Pubkey, u8) {
    Pubkey::find_program_address(seeds, &crate::ID)
}

/// Program-wide settings: the registry authority and the USDC mint (A-18).
pub fn config() -> (Pubkey, u8) {
    find(&[CONFIG_SEED])
}

/// `mandate_seed` is a client-generated key: it avoids name collisions and
/// variable-length seeds.
pub fn mandate(mandate_seed: &Pubkey) -> (Pubkey, u8) {
    find(&[MANDATE_SEED, mandate_seed.as_ref()])
}

/// Mint in the seed: a duplicate asset cannot be initialized at all (A-01).
pub fn mandate_asset(mandate: &Pubkey, mint: &Pubkey) -> (Pubkey, u8) {
    find(&[MANDATE_ASSET_SEED, mandate.as_ref(), mint.as_ref()])
}

/// One entry per mint, globally.
pub fn registry(mint: &Pubkey) -> (Pubkey, u8) {
    find(&[REGISTRY_SEED, mint.as_ref()])
}

/// 1:1 with its Mandate in v1.
pub fn circle(mandate: &Pubkey) -> (Pubkey, u8) {
    find(&[CIRCLE_SEED, mandate.as_ref()])
}

/// Keyed by Circle AND mint, so a CircleAsset from Circle B cannot be derived at
/// Circle A's address (INV-018).
pub fn circle_asset(circle: &Pubkey, mint: &Pubkey) -> (Pubkey, u8) {
    find(&[CIRCLE_ASSET_SEED, circle.as_ref(), mint.as_ref()])
}

/// The only signer over Circle assets. It has no private key.
pub fn vault_authority(circle: &Pubkey) -> (Pubkey, u8) {
    find(&[VAULT_AUTHORITY_SEED, circle.as_ref()])
}

pub fn asset_vault(circle: &Pubkey, mint: &Pubkey) -> (Pubkey, u8) {
    find(&[VAULT_SEED, circle.as_ref(), mint.as_ref()])
}

/// Active capital only. Pending contributions live in the epoch escrow.
pub fn usdc_vault(circle: &Pubkey) -> (Pubkey, u8) {
    find(&[USDC_VAULT_SEED, circle.as_ref()])
}

pub fn epoch(circle: &Pubkey, index: u64) -> (Pubkey, u8) {
    find(&[EPOCH_SEED, circle.as_ref(), &index.to_le_bytes()])
}

/// A separate token account from `usdc_vault`: pending USDC can never be spent
/// as active capital (spec §22).
pub fn epoch_escrow(circle: &Pubkey, index: u64) -> (Pubkey, u8) {
    find(&[EPOCH_ESCROW_SEED, circle.as_ref(), &index.to_le_bytes()])
}

/// One per member per epoch.
pub fn receipt(epoch: &Pubkey, owner: &Pubkey) -> (Pubkey, u8) {
    find(&[RECEIPT_SEED, epoch.as_ref(), owner.as_ref()])
}

pub fn member(circle: &Pubkey, owner: &Pubkey) -> (Pubkey, u8) {
    find(&[MEMBER_SEED, circle.as_ref(), owner.as_ref()])
}

pub fn nav_snapshot(epoch: &Pubkey) -> (Pubkey, u8) {
    find(&[NAV_SNAPSHOT_SEED, epoch.as_ref()])
}

/// `seq` allows repeated partial exits by the same owner.
pub fn redemption(circle: &Pubkey, owner: &Pubkey, seq: u64) -> (Pubkey, u8) {
    find(&[REDEMPTION_SEED, circle.as_ref(), owner.as_ref(), &seq.to_le_bytes()])
}

pub fn redemption_asset(redemption: &Pubkey, mint: &Pubkey) -> (Pubkey, u8) {
    find(&[REDEMPTION_ASSET_SEED, redemption.as_ref(), mint.as_ref()])
}

/// `epoch` is the Epoch ACCOUNT address, not its index. Seeding on `nonce` makes
/// replay structurally impossible: the account already exists (INV-020).
pub fn exec_auth(circle: &Pubkey, epoch: &Pubkey, nonce: u64) -> (Pubkey, u8) {
    find(&[EXEC_AUTH_SEED, circle.as_ref(), epoch.as_ref(), &nonce.to_le_bytes()])
}

/// One governance proposal per caller-chosen id. The id is explicit so the
/// fixed Mandate account never grows a proposal list.
pub fn amendment(mandate: &Pubkey, proposal_id: u64) -> (Pubkey, u8) {
    find(&[AMENDMENT_SEED, mandate.as_ref(), &proposal_id.to_le_bytes()])
}

pub fn amendment_vote(proposal: &Pubkey, voter: &Pubkey) -> (Pubkey, u8) {
    find(&[AMENDMENT_VOTE_SEED, proposal.as_ref(), voter.as_ref()])
}

/// Singleton inventory and reserve for the explicitly valueless Devnet test market.
pub fn devnet_test_market() -> (Pubkey, u8) {
    find(&[DEVNET_TEST_MARKET_SEED])
}

pub fn devnet_test_mint() -> (Pubkey, u8) {
    find(&[DEVNET_TEST_MINT_SEED])
}
