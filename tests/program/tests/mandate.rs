//! On-chain: `create_mandate`, `add_mandate_asset`, `finalize_mandate`.
//!
//! Exhaustive boundary sweeps live next to the rules, in
//! programs/tenet/src/instructions/mandate.rs. These tests prove the program
//! actually runs those rules, and cover what only exists on-chain: signers,
//! PDAs, account substitution and completeness of the finalize account set.

mod common;

use anchor_lang::prelude::Pubkey;
use common::*;
use solana_keypair::Keypair;
use solana_signer::Signer;
use tenet::state::{AssetClass, AssetStatus, Mandate, MandateAsset, MandateState};
use tenet::state::{Circle, CircleAsset, CircleState};
use tenet::TenetError;

fn pair(mandate: &Pubkey, mint: &Pubkey) -> (Pubkey, Pubkey) {
    (tenet::pda::mandate_asset(mandate, mint).0, tenet::pda::registry(mint).0)
}

// ---------------------------------------------------------------- create

#[test]
fn test_create_valid_mandate() {
    let mut e = with_config();
    let (author, mandate) = draft_mandate(&mut e);
    let m: Mandate = read(&e.svm, &mandate);
    assert_eq!(m.author, author.pubkey());
    assert_eq!(m.state, MandateState::Draft);
    assert_eq!(m.asset_count, 0);
    assert_eq!(m.version, 1);
    assert!(m.forked_from.is_none());
}

#[test]
fn test_create_mandate_runs_the_validation_rules() {
    // One case per rule family, to prove validate_params is wired in.
    let mut e = with_config();
    let author = funded(&mut e.svm);
    let cases: Vec<(Box<dyn Fn(&mut tenet::MandateParams)>, TenetError)> = vec![
        (Box::new(|p| p.name = String::new()), TenetError::InvalidMandateName),
        (Box::new(|p| p.max_issuer_weight_bps = 10_001), TenetError::InvalidBps),
        (Box::new(|p| p.max_underlying_weight_bps = 10_001), TenetError::InvalidBps),
        (Box::new(|p| p.min_contribution_usdc = 0), TenetError::InvalidMinContribution),
        (Box::new(|p| p.max_pool_size_usdc = p.min_contribution_usdc), TenetError::InvalidMaxPoolSize),
        (Box::new(|p| p.epoch_duration = 0), TenetError::InvalidEpochDuration),
        (Box::new(|p| p.amendment_threshold_bps = 5_000), TenetError::InvalidAmendmentThreshold),
        (Box::new(|p| p.amendment_delay_seconds = 0), TenetError::InvalidAmendmentDelay),
    ];
    for (mutate, want) in cases {
        let mut p = mandate_params();
        mutate(&mut p);
        let seed = Keypair::new().pubkey();
        expect_err(send(&mut e.svm, &[create_mandate_ix(&author.pubkey(), &seed, p)], &author, &[]), want);
    }
}

// ---------------------------------------------------------------- add asset

#[test]
fn test_reject_duplicate_asset() {
    let mut e = with_config();
    let mint = register_equity(&mut e, AssetClass::PublicTokenizedEquity, 1, 1);
    let (author, mandate) = draft_mandate(&mut e);
    send(&mut e.svm, &[add_asset_ix(&author.pubkey(), &mandate, &mint, 2_000)], &author, &[]).unwrap();

    // Same mint again, different weight: the PDA already exists.
    let r = send(&mut e.svm, &[add_asset_ix(&author.pubkey(), &mandate, &mint, 1_000)], &author, &[]);
    expect_log(r, "already in use");
    let m: Mandate = read(&e.svm, &mandate);
    assert_eq!(m.asset_count, 1, "a rejected duplicate must not bump the count");
}

#[test]
fn test_add_asset_records_index_and_weight() {
    let mut e = with_config();
    let a = register_equity(&mut e, AssetClass::PublicTokenizedEquity, 1, 1);
    let b = register_equity(&mut e, AssetClass::PreIpo, 2, 2);
    let (author, mandate) = draft_mandate(&mut e);
    for (mint, w) in [(a, 3_000), (b, 2_000)] {
        send(&mut e.svm, &[add_asset_ix(&author.pubkey(), &mandate, &mint, w)], &author, &[]).unwrap();
    }
    let ma: MandateAsset = read(&e.svm, &pair(&mandate, &b).0);
    assert_eq!((ma.index, ma.target_weight_bps, ma.mint), (1, 2_000, b));
    assert_eq!(read::<Mandate>(&e.svm, &mandate).asset_count, 2);
}

#[test]
fn test_add_asset_rejections() {
    let mut e = with_config();
    let mint = register_equity(&mut e, AssetClass::PublicTokenizedEquity, 1, 1);
    let (author, mandate) = draft_mandate(&mut e);

    // Not the author.
    let stranger = funded(&mut e.svm);
    let r = send(&mut e.svm, &[add_asset_ix(&stranger.pubkey(), &mandate, &mint, 1_000)], &stranger, &[]);
    expect_err(r, TenetError::NotMandateAuthor);

    // Above the per-asset cap (40%).
    let r = send(&mut e.svm, &[add_asset_ix(&author.pubkey(), &mandate, &mint, 4_001)], &author, &[]);
    expect_err(r, TenetError::AssetWeightCapExceeded);

    // Registry entry not Active.
    let restricted = register_equity(&mut e, AssetClass::PublicTokenizedEquity, 3, 3);
    let ra = e.registry_authority.insecure_clone();
    let mut p = registry_params(AssetClass::PublicTokenizedEquity, 3, 3);
    p.status = AssetStatus::Restricted;
    send(&mut e.svm, &[upsert_ix(&ra.pubkey(), &restricted, p)], &ra, &[]).unwrap();
    let r = send(&mut e.svm, &[add_asset_ix(&author.pubkey(), &mandate, &restricted, 1_000)], &author, &[]);
    expect_err(r, TenetError::RegistryEntryInactive);

    // No registry entry at all: the account does not exist.
    let unregistered = create_mint(&mut e.svm, &token_2022(), 9);
    let r = send(&mut e.svm, &[add_asset_ix(&author.pubkey(), &mandate, &unregistered, 1_000)], &author, &[]);
    expect_log(r, "AccountNotInitialized");
}

#[test]
fn test_add_asset_rejects_ninth_asset() {
    let mut e = with_config();
    let (author, mandate) = draft_mandate(&mut e);
    for i in 0..8u8 {
        let mint = register_equity(&mut e, AssetClass::PublicTokenizedEquity, i, i);
        send(&mut e.svm, &[add_asset_ix(&author.pubkey(), &mandate, &mint, 100)], &author, &[]).unwrap();
    }
    let ninth = register_equity(&mut e, AssetClass::PublicTokenizedEquity, 99, 99);
    let r = send(&mut e.svm, &[add_asset_ix(&author.pubkey(), &mandate, &ninth, 100)], &author, &[]);
    expect_err(r, TenetError::TooManyAssets);
}

// ---------------------------------------------------------------- finalize

/// A draft mandate with two assets: 40% public (issuer 1) + 30% pre-IPO (issuer 2).
fn two_asset_draft(e: &mut Env) -> (Keypair, Pubkey, Vec<(Pubkey, Pubkey)>) {
    let a = register_equity(e, AssetClass::PublicTokenizedEquity, 1, 1);
    let b = register_equity(e, AssetClass::PreIpo, 2, 2);
    let (author, mandate) = draft_mandate(e);
    for (mint, w) in [(a, 4_000), (b, 3_000)] {
        send(&mut e.svm, &[add_asset_ix(&author.pubkey(), &mandate, &mint, w)], &author, &[]).unwrap();
    }
    (author, mandate, vec![pair(&mandate, &a), pair(&mandate, &b)])
}

#[test]
fn test_finalize_mandate_activates_and_freezes_it() {
    let mut e = with_config();
    let (author, mandate, pairs) = two_asset_draft(&mut e);
    send(&mut e.svm, &[finalize_ix(&author.pubkey(), &mandate, &pairs)], &author, &[]).expect("finalize");
    assert_eq!(read::<Mandate>(&e.svm, &mandate).state, MandateState::Active);

    // Immutable after finalization: no more assets, no second finalize.
    let c = register_equity(&mut e, AssetClass::PublicTokenizedEquity, 5, 5);
    let r = send(&mut e.svm, &[add_asset_ix(&author.pubkey(), &mandate, &c, 1_000)], &author, &[]);
    expect_err(r, TenetError::InvalidMandateState);
    let r = send(&mut e.svm, &[finalize_ix(&author.pubkey(), &mandate, &pairs)], &author, &[]);
    expect_err(r, TenetError::InvalidMandateState);
}

#[test]
fn test_reject_invalid_weights() {
    let mut e = with_config();

    // Empty universe.
    let (author, mandate) = draft_mandate(&mut e);
    let r = send(&mut e.svm, &[finalize_ix(&author.pubkey(), &mandate, &[])], &author, &[]);
    expect_err(r, TenetError::EmptyAssetUniverse);

    // Pre-IPO over its 30% cap across two assets (each under the 40% per-asset cap).
    let a = register_equity(&mut e, AssetClass::PreIpo, 1, 1);
    let b = register_equity(&mut e, AssetClass::PreIpo, 2, 2);
    let (author, mandate) = draft_mandate(&mut e);
    for mint in [a, b] {
        send(&mut e.svm, &[add_asset_ix(&author.pubkey(), &mandate, &mint, 2_000)], &author, &[]).unwrap();
    }
    let pairs = [pair(&mandate, &a), pair(&mandate, &b)];
    let r = send(&mut e.svm, &[finalize_ix(&author.pubkey(), &mandate, &pairs)], &author, &[]);
    expect_err(r, TenetError::PreIpoWeightCapExceeded);

    // Same underlying through two issuers: 2 × 30% = 60% > 50% underlying cap.
    let x = register_equity(&mut e, AssetClass::PublicTokenizedEquity, 1, 7);
    let y = register_equity(&mut e, AssetClass::PublicTokenizedEquity, 2, 7);
    let (author, mandate) = draft_mandate(&mut e);
    for mint in [x, y] {
        send(&mut e.svm, &[add_asset_ix(&author.pubkey(), &mandate, &mint, 3_000)], &author, &[]).unwrap();
    }
    let pairs = [pair(&mandate, &x), pair(&mandate, &y)];
    let r = send(&mut e.svm, &[finalize_ix(&author.pubkey(), &mandate, &pairs)], &author, &[]);
    expect_err(r, TenetError::UnderlyingWeightCapExceeded);
}

#[test]
fn test_finalize_rejects_an_incomplete_asset_set() {
    // Omitting an asset would let it escape every cap. Must be refused.
    let mut e = with_config();
    let (author, mandate, pairs) = two_asset_draft(&mut e);
    let r = send(&mut e.svm, &[finalize_ix(&author.pubkey(), &mandate, &pairs[..1])], &author, &[]);
    expect_err(r, TenetError::IncompleteMandateAssets);

    // Right count, but one asset twice and the other missing.
    let dup = [pairs[0], pairs[0]];
    let r = send(&mut e.svm, &[finalize_ix(&author.pubkey(), &mandate, &dup)], &author, &[]);
    expect_err(r, TenetError::IncompleteMandateAssets);
}

#[test]
fn test_finalize_rejects_substituted_accounts() {
    let mut e = with_config();
    let (author, mandate, pairs) = two_asset_draft(&mut e);

    // A MandateAsset belonging to a DIFFERENT mandate.
    let (_, _, foreign) = two_asset_draft(&mut e);
    let spliced = [foreign[0], pairs[1]];
    let r = send(&mut e.svm, &[finalize_ix(&author.pubkey(), &mandate, &spliced)], &author, &[]);
    expect_err(r, TenetError::AccountSubstitution);

    // The right MandateAsset with another asset's registry entry — e.g. to
    // make a pre-IPO asset look public and dodge the pre-IPO cap.
    let swapped = [(pairs[0].0, pairs[1].1), (pairs[1].0, pairs[0].1)];
    let r = send(&mut e.svm, &[finalize_ix(&author.pubkey(), &mandate, &swapped)], &author, &[]);
    expect_err(r, TenetError::AccountSubstitution);

    // Not the author.
    let stranger = funded(&mut e.svm);
    let r = send(&mut e.svm, &[finalize_ix(&stranger.pubkey(), &mandate, &pairs)], &stranger, &[]);
    expect_err(r, TenetError::NotMandateAuthor);
}

// ---------------------------------------------------------------- fork

#[test]
fn test_fork_copies_rules() {
    let mut e = with_config();
    let (forker, parent, pairs) = two_asset_draft(&mut e);
    send(&mut e.svm, &[finalize_ix(&forker.pubkey(), &parent, &pairs)], &forker, &[]).unwrap();
    let parent_before = e.svm.get_account(&parent).unwrap().data.clone();

    let seed = Keypair::new().pubkey();
    let child = tenet::pda::mandate(&seed).0;
    send(&mut e.svm, &[fork_ix(&forker.pubkey(), &parent, &seed)], &forker, &[]).unwrap();

    let child_m: Mandate = read(&e.svm, &child);
    let parent_m: Mandate = read(&e.svm, &parent);
    assert_eq!(child_m.author, forker.pubkey());
    assert_eq!(child_m.forked_from, Some(parent));
    assert_eq!(child_m.state, MandateState::Draft);
    assert_eq!(child_m.asset_count, 0);
    assert_eq!(child_m.name, parent_m.name);
    assert_eq!(child_m.description, parent_m.description);
    assert_eq!(child_m.max_weight_per_asset_bps, parent_m.max_weight_per_asset_bps);
    assert_eq!(child_m.max_pre_ipo_weight_bps, parent_m.max_pre_ipo_weight_bps);
    assert_eq!(child_m.max_issuer_weight_bps, parent_m.max_issuer_weight_bps);
    assert_eq!(child_m.max_underlying_weight_bps, parent_m.max_underlying_weight_bps);
    assert_eq!(child_m.max_supply_consumption_bps, parent_m.max_supply_consumption_bps);
    assert_eq!(child_m.max_price_impact_bps, parent_m.max_price_impact_bps);
    assert_eq!(child_m.min_contribution_usdc, parent_m.min_contribution_usdc);
    assert_eq!(child_m.max_pool_size_usdc, parent_m.max_pool_size_usdc);
    assert_eq!(child_m.epoch_duration, parent_m.epoch_duration);
    assert_eq!(child_m.membership_policy, parent_m.membership_policy);
    assert_eq!(child_m.amendment_threshold_bps, parent_m.amendment_threshold_bps);
    assert_eq!(child_m.amendment_delay_seconds, parent_m.amendment_delay_seconds);

    // Asset PDAs are copied explicitly, then the child can be finalized using
    // the same registry observations as the parent.
    let mints = [
        read::<MandateAsset>(&e.svm, &pairs[0].0).mint,
        read::<MandateAsset>(&e.svm, &pairs[1].0).mint,
    ];
    for mint in mints {
        send(&mut e.svm, &[fork_asset_ix(&forker.pubkey(), &parent, &child, &mint)], &forker, &[]).unwrap();
    }
    let child_pairs = [(tenet::pda::mandate_asset(&child, &mints[0]).0, tenet::pda::registry(&mints[0]).0),
        (tenet::pda::mandate_asset(&child, &mints[1]).0, tenet::pda::registry(&mints[1]).0)];
    send(&mut e.svm, &[finalize_ix(&forker.pubkey(), &child, &child_pairs)], &forker, &[]).unwrap();
    assert_eq!(read::<Mandate>(&e.svm, &child).state, MandateState::Active);
    assert_eq!(e.svm.get_account(&parent).unwrap().data, parent_before);
}

#[test]
fn test_fork_does_not_move_parent_assets() {
    let mut e = with_config();
    let (forker, parent, pairs) = two_asset_draft(&mut e);
    send(&mut e.svm, &[finalize_ix(&forker.pubkey(), &parent, &pairs)], &forker, &[]).unwrap();
    let before: Vec<Vec<u8>> = pairs.iter().map(|(asset, _)| e.svm.get_account(asset).unwrap().data).collect();

    let seed = Keypair::new().pubkey();
    let child = tenet::pda::mandate(&seed).0;
    send(&mut e.svm, &[fork_ix(&forker.pubkey(), &parent, &seed)], &forker, &[]).unwrap();
    for (asset, _) in &pairs {
        let mint = read::<MandateAsset>(&e.svm, asset).mint;
        send(&mut e.svm, &[fork_asset_ix(&forker.pubkey(), &parent, &child, &mint)], &forker, &[]).unwrap();
    }
    let after: Vec<Vec<u8>> = pairs.iter().map(|(asset, _)| e.svm.get_account(asset).unwrap().data).collect();
    assert_eq!(before, after);
    assert_eq!(read::<Mandate>(&e.svm, &parent).asset_count, 2);
    assert_eq!(read::<Mandate>(&e.svm, &child).asset_count, 2);
}

#[test]
fn test_forked_mandate_creates_independent_circle_and_vaults() {
    // End-to-end fork setup must create new custody only after copying and activating rules.
    let mut e = with_config();
    let (forker, parent, parent_pairs) = two_asset_draft(&mut e);
    send(&mut e.svm, &[finalize_ix(&forker.pubkey(), &parent, &parent_pairs)], &forker, &[]).unwrap();

    let parent_circle = tenet::pda::circle(&parent).0;
    let usdc = e.usdc_mint;
    send(&mut e.svm, &[create_circle_ix(&forker.pubkey(), &parent, &usdc, &token())], &forker, &[]).unwrap();
    let mints: Vec<Pubkey> = parent_pairs.iter().map(|(asset, _)| read::<MandateAsset>(&e.svm, asset).mint).collect();
    for &mint in &mints {
        let parent_asset = tenet::pda::mandate_asset(&parent, &mint).0;
        send(&mut e.svm, &[add_circle_asset_ix(&forker.pubkey(), &parent_circle, &parent_asset, &mint, &token_2022())], &forker, &[]).unwrap();
    }
    let parent_mandate_before = e.svm.get_account(&parent).unwrap().data;
    let parent_circle_before = e.svm.get_account(&parent_circle).unwrap().data;
    let parent_usdc_vault = tenet::pda::usdc_vault(&parent_circle).0;
    let parent_usdc_vault_before = e.svm.get_account(&parent_usdc_vault).unwrap().data;
    let parent_vaults_before: Vec<Vec<u8>> = mints.iter()
        .map(|mint| e.svm.get_account(&tenet::pda::asset_vault(&parent_circle, &mint).0).unwrap().data)
        .collect();

    let seed = Keypair::new().pubkey();
    let child = tenet::pda::mandate(&seed).0;
    let child_circle = tenet::pda::circle(&child).0;
    send(&mut e.svm, &[fork_ix(&forker.pubkey(), &parent, &seed)], &forker, &[]).unwrap();
    for &mint in &mints {
        send(&mut e.svm, &[fork_asset_ix(&forker.pubkey(), &parent, &child, &mint)], &forker, &[]).unwrap();
    }
    let child_pairs: Vec<(Pubkey, Pubkey)> = mints.iter().map(|mint| pair(&child, mint)).collect();
    send(&mut e.svm, &[finalize_ix(&forker.pubkey(), &child, &child_pairs)], &forker, &[]).unwrap();
    send(&mut e.svm, &[create_circle_ix(&forker.pubkey(), &child, &usdc, &token())], &forker, &[]).unwrap();
    for (&mint, (child_asset, _)) in mints.iter().zip(&child_pairs) {
        send(&mut e.svm, &[add_circle_asset_ix(&forker.pubkey(), &child_circle, child_asset, &mint, &token_2022())], &forker, &[]).unwrap();
    }

    let created_circle: Circle = read(&e.svm, &child_circle);
    assert_eq!(created_circle.mandate, child);
    assert_eq!(created_circle.state, CircleState::Funding);
    assert_eq!((created_circle.total_shares, created_circle.member_count, created_circle.asset_count), (0, 0, 2));
    assert_eq!(read::<Mandate>(&e.svm, &child).forked_from, Some(parent));
    let child_usdc_vault = tenet::pda::usdc_vault(&child_circle).0;
    assert_ne!(child_usdc_vault, parent_usdc_vault);
    assert_eq!(token_balance(&e.svm, &child_usdc_vault), 0, "fork starts with no copied cash");
    for &mint in &mints {
        let parent_asset: CircleAsset = read(&e.svm, &tenet::pda::circle_asset(&parent_circle, &mint).0);
        let child_asset: CircleAsset = read(&e.svm, &tenet::pda::circle_asset(&child_circle, &mint).0);
        assert_eq!(child_asset.mandate_asset, tenet::pda::mandate_asset(&child, &mint).0);
        assert_eq!(child_asset.status, AssetStatus::Active);
        assert_ne!(child_asset.vault, parent_asset.vault);
        assert_eq!(token_balance(&e.svm, &child_asset.vault), 0, "fork starts with empty independent vaults");
    }
    assert_eq!(e.svm.get_account(&parent).unwrap().data, parent_mandate_before);
    assert_eq!(e.svm.get_account(&parent_circle).unwrap().data, parent_circle_before);
    assert_eq!(e.svm.get_account(&parent_usdc_vault).unwrap().data, parent_usdc_vault_before);
    let parent_vaults_after: Vec<Vec<u8>> = mints.iter()
        .map(|mint| e.svm.get_account(&tenet::pda::asset_vault(&parent_circle, &mint).0).unwrap().data)
        .collect();
    assert_eq!(parent_vaults_after, parent_vaults_before, "fork setup must leave parent custody untouched");
}

#[test]
fn test_child_mandate_cannot_modify_parent() {
    let mut e = with_config();
    let (forker, parent, pairs) = two_asset_draft(&mut e);
    send(&mut e.svm, &[finalize_ix(&forker.pubkey(), &parent, &pairs)], &forker, &[]).unwrap();
    let parent_before = e.svm.get_account(&parent).unwrap().data;
    let seed = Keypair::new().pubkey();
    let child = tenet::pda::mandate(&seed).0;
    send(&mut e.svm, &[fork_ix(&forker.pubkey(), &parent, &seed)], &forker, &[]).unwrap();
    let extra = register_equity(&mut e, AssetClass::PublicTokenizedEquity, 9, 9);
    let r = send(&mut e.svm, &[add_asset_ix(&forker.pubkey(), &parent, &extra, 100)], &forker, &[]);
    expect_err(r, TenetError::InvalidMandateState);
    assert_eq!(e.svm.get_account(&parent).unwrap().data, parent_before);
    assert_eq!(read::<Mandate>(&e.svm, &child).forked_from, Some(parent));
}
