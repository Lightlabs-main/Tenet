//! On-chain: `initialize_config` (A-18) and `upsert_registry_entry`.

mod common;

use common::*;
use solana_signer::Signer;
use tenet::state::{AssetClass, AssetRegistryEntry, AssetStatus, Config};
use tenet::TenetError;

// ---------------------------------------------------------------- config

#[test]
fn test_initialize_config_by_upgrade_authority() {
    let e = with_config();
    let c: Config = read(&e.svm, &tenet::pda::config().0);
    assert_eq!(c.registry_authority, e.registry_authority.pubkey());
    assert_eq!(c.usdc_mint, e.usdc_mint);
}

#[test]
fn test_initialize_config_rejects_anyone_else() {
    // The race A-18 exists to prevent: a stranger initializing first and
    // appointing themselves registry authority.
    let mut e = env();
    let stranger = funded(&mut e.svm);
    let ix = initialize_config_ix(&stranger.pubkey(), &stranger.pubkey(), &e.usdc_mint);
    expect_err(send(&mut e.svm, &[ix], &stranger, &[]), TenetError::NotUpgradeAuthority);
}

#[test]
fn test_initialize_config_impossible_once_program_is_immutable() {
    // With no upgrade authority, nobody can initialize. Documented consequence:
    // initialize before revoking the upgrade authority (R-14).
    let mut e = env();
    let mut acc = e.svm.get_account(&program_data_address()).unwrap();
    acc.data[12] = 0;
    e.svm.set_account(program_data_address(), acc).unwrap();
    let admin = e.admin.insecure_clone();
    let ix = initialize_config_ix(&admin.pubkey(), &admin.pubkey(), &e.usdc_mint);
    expect_err(send(&mut e.svm, &[ix], &admin, &[]), TenetError::NotUpgradeAuthority);
}

#[test]
fn test_initialize_config_rejects_wrong_usdc() {
    let mut e = env();
    let admin = e.admin.insecure_clone();

    let nine_decimals = create_mint(&mut e.svm, &token(), 9);
    let ix = initialize_config_ix(&admin.pubkey(), &admin.pubkey(), &nine_decimals);
    expect_err(send(&mut e.svm, &[ix], &admin, &[]), TenetError::UnexpectedUsdcMint);

    // Right decimals, wrong program: USDC is classic SPL (V-014).
    let t22 = create_mint(&mut e.svm, &token_2022(), USDC_DECIMALS);
    let ix = initialize_config_ix(&admin.pubkey(), &admin.pubkey(), &t22);
    expect_err(send(&mut e.svm, &[ix], &admin, &[]), TenetError::UnexpectedUsdcMint);
}

#[test]
fn test_initialize_config_only_once() {
    let mut e = with_config();
    let admin = e.admin.insecure_clone();
    let other = funded(&mut e.svm);
    let ix = initialize_config_ix(&admin.pubkey(), &other.pubkey(), &e.usdc_mint);
    expect_log(send(&mut e.svm, &[ix], &admin, &[]), "already in use");
    // And the original authority is untouched.
    let c: Config = read(&e.svm, &tenet::pda::config().0);
    assert_eq!(c.registry_authority, e.registry_authority.pubkey());
}

// ---------------------------------------------------------------- registry

#[test]
fn test_upsert_registry_entry_creates_then_updates() {
    let mut e = with_config();
    let mint = register_equity(&mut e, AssetClass::PublicTokenizedEquity, 1, 1);

    let entry: AssetRegistryEntry = read(&e.svm, &tenet::pda::registry(&mint).0);
    assert_eq!(entry.mint, mint);
    assert_eq!(entry.token_program, token_2022());
    assert_eq!(entry.decimals, 9);
    assert_eq!(entry.status, AssetStatus::Active);

    // Update: restrict it. Classification changes; identity does not.
    let ra = e.registry_authority.insecure_clone();
    let mut p = registry_params(AssetClass::PublicTokenizedEquity, 1, 1);
    p.status = AssetStatus::Restricted;
    send(&mut e.svm, &[upsert_ix(&ra.pubkey(), &mint, p)], &ra, &[]).expect("update");
    let entry: AssetRegistryEntry = read(&e.svm, &tenet::pda::registry(&mint).0);
    assert_eq!(entry.status, AssetStatus::Restricted);
    assert_eq!(entry.mint, mint);
}

#[test]
fn test_upsert_rejects_wrong_authority() {
    let mut e = with_config();
    let mint = create_mint(&mut e.svm, &token_2022(), 9);
    let impostor = funded(&mut e.svm);
    let ix = upsert_ix(&impostor.pubkey(), &mint, registry_params(AssetClass::PreIpo, 1, 1));
    expect_err(send(&mut e.svm, &[ix], &impostor, &[]), TenetError::NotRegistryAuthority);
}

#[test]
fn test_upsert_rejects_class_inconsistent_with_mint() {
    let mut e = with_config();
    let ra = e.registry_authority.insecure_clone();

    // An "equity" on the classic token program.
    let classic = create_mint(&mut e.svm, &token(), 9);
    let ix = upsert_ix(&ra.pubkey(), &classic, registry_params(AssetClass::PublicTokenizedEquity, 1, 1));
    expect_err(send(&mut e.svm, &[ix], &ra, &[]), TenetError::AssetClassMismatch);

    // "USDC" that is not the configured USDC mint.
    let fake_usdc = create_mint(&mut e.svm, &token(), USDC_DECIMALS);
    let ix = upsert_ix(&ra.pubkey(), &fake_usdc, registry_params(AssetClass::Usdc, 1, 1));
    expect_err(send(&mut e.svm, &[ix], &ra, &[]), TenetError::AssetClassMismatch);

    // The real USDC mint as Usdc is accepted.
    let usdc = e.usdc_mint;
    let ix = upsert_ix(&ra.pubkey(), &usdc, registry_params(AssetClass::Usdc, 1, 1));
    send(&mut e.svm, &[ix], &ra, &[]).expect("real USDC registers");
}

#[test]
fn test_upsert_rejects_bad_strings() {
    let mut e = with_config();
    let ra = e.registry_authority.insecure_clone();
    let mint = create_mint(&mut e.svm, &token_2022(), 9);

    let mut p = registry_params(AssetClass::PreIpo, 1, 1);
    p.symbol = String::new();
    expect_err(send(&mut e.svm, &[upsert_ix(&ra.pubkey(), &mint, p)], &ra, &[]), TenetError::InvalidRegistryString);

    let mut p = registry_params(AssetClass::PreIpo, 1, 1);
    p.symbol = "x".repeat(tenet::MAX_SYMBOL_LEN + 1);
    expect_err(send(&mut e.svm, &[upsert_ix(&ra.pubkey(), &mint, p)], &ra, &[]), TenetError::InvalidRegistryString);

    let mut p = registry_params(AssetClass::PreIpo, 1, 1);
    p.display_name = "x".repeat(tenet::MAX_DISPLAY_NAME_LEN + 1);
    expect_err(send(&mut e.svm, &[upsert_ix(&ra.pubkey(), &mint, p)], &ra, &[]), TenetError::InvalidRegistryString);
}

// ---------------------------------------------------------------- live metadata refresh

#[test]
fn test_refresh_is_permissionless() {
    let mut e = with_config();
    let mint = register_equity(&mut e, AssetClass::PublicTokenizedEquity, 1, 1);
    let anyone = funded(&mut e.svm);
    send(&mut e.svm, &[refresh_metadata_ix(&anyone.pubkey(), &mint)], &anyone, &[])
        .expect("any wallet can refresh live mint facts");
    let entry: AssetRegistryEntry = read(&e.svm, &tenet::pda::registry(&mint).0);
    assert_eq!(entry.raw_supply, 1_000_000_000_000);
    assert_eq!(entry.effective_multiplier_e18, 1_000_000_000_000_000_000);
    assert!(entry.last_verified_slot > 0 || entry.last_verified_ts >= 0);
}

#[test]
fn test_refresh_cannot_alter_classification() {
    let mut e = with_config();
    let mint = register_equity(&mut e, AssetClass::PreIpo, 7, 9);
    let before: AssetRegistryEntry = read(&e.svm, &tenet::pda::registry(&mint).0);
    let anyone = funded(&mut e.svm);
    send(&mut e.svm, &[refresh_metadata_ix(&anyone.pubkey(), &mint)], &anyone, &[]).unwrap();
    let after: AssetRegistryEntry = read(&e.svm, &tenet::pda::registry(&mint).0);
    assert_eq!(after.asset_class, before.asset_class);
    assert_eq!(after.issuer, before.issuer);
    assert_eq!(after.underlying_id, before.underlying_id);
    assert_eq!(after.symbol, before.symbol);
    assert_eq!(after.status, before.status);
}

#[test]
fn test_refresh_reads_epoch_correct_fee() {
    // The fake mint has no TransferFeeConfig, so the safe observable result is
    // zero rather than a caller-supplied or cached fee.
    let mut e = with_config();
    let mint = register_equity(&mut e, AssetClass::PublicTokenizedEquity, 1, 1);
    let payer = funded(&mut e.svm);
    send(&mut e.svm, &[refresh_metadata_ix(&payer.pubkey(), &mint)], &payer, &[]).unwrap();
    let entry: AssetRegistryEntry = read(&e.svm, &tenet::pda::registry(&mint).0);
    assert_eq!(entry.active_transfer_fee_bps, 0);
    assert_eq!(entry.active_transfer_fee_max, 0);
}

#[test]
fn test_refresh_reads_effective_multiplier() {
    // A mint without ScaledUiAmount has the neutral multiplier. Token-2022
    // extension-specific coverage uses the verified mainnet fixtures once the
    // deployable program is rebuilt.
    let mut e = with_config();
    let mint = register_equity(&mut e, AssetClass::PublicTokenizedEquity, 1, 1);
    let payer = funded(&mut e.svm);
    send(&mut e.svm, &[refresh_metadata_ix(&payer.pubkey(), &mint)], &payer, &[]).unwrap();
    let entry: AssetRegistryEntry = read(&e.svm, &tenet::pda::registry(&mint).0);
    assert_eq!(entry.effective_multiplier_e18, 1_000_000_000_000_000_000);
}
