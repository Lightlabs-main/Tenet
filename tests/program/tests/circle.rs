//! On-chain: `create_circle`, `add_circle_asset` — the first custody accounts.
//!
//! Run against REAL mainnet mint snapshots (tests/fixtures/mints): USDC on
//! classic SPL, SPACEX (PreStocks) and AAPLx (xStocks) on Token-2022 with their
//! actual extensions, and vaults created by the real token programs.

mod common;

use anchor_lang::prelude::Pubkey;
use anchor_spl::token_2022::spl_token_2022::{
    extension::{BaseStateWithExtensions, ExtensionType, StateWithExtensions},
    state::{Account as T22Account, Mint as T22Mint},
};
use anchor_spl::token_interface::TokenAccount;
use common::*;
use solana_keypair::Keypair;
use solana_signer::Signer;
use tenet::state::{AssetClass, Circle, CircleAsset, CircleState};
use tenet::TenetError;

struct Setup {
    e: Env,
    author: Keypair,
    mandate: Pubkey,
    spacex: Pubkey,
    aaplx: Pubkey,
}

/// Active mandate: SPACEX 30% (pre-IPO, PreStocks) + AAPLx 40% (public, Backed).
fn active_mandate() -> Setup {
    let mut e = with_real_usdc_config();
    let spacex = register_fixture(&mut e, "SPACEX", AssetClass::PreIpo, 1, 1);
    let aaplx = register_fixture(&mut e, "AAPLx", AssetClass::PublicTokenizedEquity, 2, 2);
    let (author, mandate) = draft_mandate(&mut e);
    for (mint, w) in [(spacex, 3_000), (aaplx, 4_000)] {
        send(&mut e.svm, &[add_asset_ix(&author.pubkey(), &mandate, &mint, w)], &author, &[]).unwrap();
    }
    let pairs = [
        (tenet::pda::mandate_asset(&mandate, &spacex).0, tenet::pda::registry(&spacex).0),
        (tenet::pda::mandate_asset(&mandate, &aaplx).0, tenet::pda::registry(&aaplx).0),
    ];
    send(&mut e.svm, &[finalize_ix(&author.pubkey(), &mandate, &pairs)], &author, &[]).unwrap();
    Setup { e, author, mandate, spacex, aaplx }
}

fn circle_of(s: &Setup) -> Pubkey {
    tenet::pda::circle(&s.mandate).0
}

fn created(mut s: Setup) -> Setup {
    let usdc = s.e.usdc_mint;
    let a = s.author.insecure_clone();
    send(&mut s.e.svm, &[create_circle_ix(&a.pubkey(), &s.mandate, &usdc, &token())], &a, &[])
        .expect("create circle");
    s
}

fn token_account(svm: &litesvm::LiteSVM, key: &Pubkey) -> TokenAccount {
    read::<TokenAccount>(svm, key)
}

// ---------------------------------------------------------------- create

#[test]
fn test_create_circle() {
    let s = created(active_mandate());
    let circle = circle_of(&s);
    let c: Circle = read(&s.e.svm, &circle);
    assert_eq!(c.mandate, s.mandate);
    assert_eq!(c.state, CircleState::Funding);
    assert_eq!((c.total_shares, c.reserved_shares, c.current_epoch), (0, 0, 0));
    assert_eq!(c.vault_authority_bump, tenet::pda::vault_authority(&circle).1);

    // The USDC vault: classic SPL, the real USDC mint, owned by the vault
    // authority PDA and holding nothing.
    let vault_key = tenet::pda::usdc_vault(&circle).0;
    let acc = s.e.svm.get_account(&vault_key).unwrap();
    assert_eq!(acc.owner, token(), "USDC vault must be classic SPL");
    let v = token_account(&s.e.svm, &vault_key);
    assert_eq!(v.mint, s.e.usdc_mint);
    assert_eq!(v.owner, tenet::pda::vault_authority(&circle).0);
    assert_eq!(v.amount, 0);
}

#[test]
fn test_create_circle_rejections() {
    // Mandate still Draft.
    let mut e = with_real_usdc_config();
    let (author, draft) = draft_mandate(&mut e);
    let usdc = e.usdc_mint;
    let r = send(&mut e.svm, &[create_circle_ix(&author.pubkey(), &draft, &usdc, &token())], &author, &[]);
    expect_err(r, TenetError::InvalidMandateState);

    let mut s = active_mandate();
    let a = s.author.insecure_clone();
    let usdc = s.e.usdc_mint;

    // A USDC look-alike: right decimals, right program, wrong mint.
    let fake = create_mint(&mut s.e.svm, &token(), USDC_DECIMALS);
    let r = send(&mut s.e.svm, &[create_circle_ix(&a.pubkey(), &s.mandate, &fake, &token())], &a, &[]);
    expect_err(r, TenetError::UnexpectedUsdcMint);

    // Real USDC but Token-2022 passed as its program. Anchor's `init` CPIs into
    // the passed program before our TokenProgramMismatch constraint runs, so
    // the TOKEN PROGRAM refuses (it does not own the mint). What matters: the
    // transaction reverts and no Circle exists afterwards.
    let r = send(&mut s.e.svm, &[create_circle_ix(&a.pubkey(), &s.mandate, &usdc, &token_2022())], &a, &[]);
    expect_log(r, "incorrect program id");
    let circle = tenet::pda::circle(&s.mandate).0;
    assert!(s.e.svm.get_account(&circle).map_or(true, |x| x.data.is_empty()), "no Circle created");

    // A second Circle for the same Mandate.
    send(&mut s.e.svm, &[create_circle_ix(&a.pubkey(), &s.mandate, &usdc, &token())], &a, &[]).unwrap();
    let r = send(&mut s.e.svm, &[create_circle_ix(&a.pubkey(), &s.mandate, &usdc, &token())], &a, &[]);
    expect_log(r, "already in use");
}

// ---------------------------------------------------------------- add asset

#[test]
fn test_add_circle_asset_creates_token2022_vaults_for_real_mints() {
    let mut s = created(active_mandate());
    let circle = circle_of(&s);
    let payer = funded(&mut s.e.svm); // permissionless

    for (i, mint) in [s.spacex, s.aaplx].into_iter().enumerate() {
        let ma = tenet::pda::mandate_asset(&s.mandate, &mint).0;
        send(&mut s.e.svm, &[add_circle_asset_ix(&payer.pubkey(), &circle, &ma, &mint, &token_2022())], &payer, &[])
            .unwrap_or_else(|err| panic!("vault for asset {i}: {err}"));

        let ca: CircleAsset = read(&s.e.svm, &tenet::pda::circle_asset(&circle, &mint).0);
        assert_eq!(ca.mint, mint);
        assert_eq!(ca.token_program, token_2022());
        assert_eq!(ca.index as usize, i, "index must mirror the Mandate asset's");
        assert_eq!(ca.reserved_for_redemption_raw, 0);

        let vault_key = tenet::pda::asset_vault(&circle, &mint).0;
        assert_eq!(ca.vault, vault_key);
        let acc = s.e.svm.get_account(&vault_key).unwrap();
        assert_eq!(acc.owner, token_2022());

        // The vault carries exactly the account-side extensions this real mint
        // requires — sized from the mint, not assumed.
        let mint_acc = s.e.svm.get_account(&mint).unwrap();
        let mint_state = StateWithExtensions::<T22Mint>::unpack(&mint_acc.data).unwrap();
        let required = ExtensionType::get_required_init_account_extensions(&mint_state.get_extension_types().unwrap());
        let vault_state = StateWithExtensions::<T22Account>::unpack(&acc.data).unwrap();
        let mut have = vault_state.get_extension_types().unwrap();
        let mut want = required.clone();
        have.sort_by_key(|x| *x as u16);
        want.sort_by_key(|x| *x as u16);
        assert_eq!(have, want, "vault extensions for asset {i}");
        eprintln!("asset {i}: mint exts {:?} -> vault exts {:?} ({} bytes)",
            mint_state.get_extension_types().unwrap(), have, acc.data.len());

        let v = token_account(&s.e.svm, &vault_key);
        assert_eq!(v.owner, tenet::pda::vault_authority(&circle).0);
        assert_eq!(v.mint, mint);
        assert_eq!(v.amount, 0);
    }
    assert_eq!(read::<Circle>(&s.e.svm, &circle).asset_count, 2);
}

#[test]
fn test_add_circle_asset_rejections() {
    let mut s = created(active_mandate());
    let circle = circle_of(&s);
    let payer = funded(&mut s.e.svm);
    let spacex_ma = tenet::pda::mandate_asset(&s.mandate, &s.spacex).0;

    // Classic SPL passed for a Token-2022 mint. As in create_circle, the token
    // program itself refuses during init; assert revert and nothing created.
    let r = send(&mut s.e.svm, &[add_circle_asset_ix(&payer.pubkey(), &circle, &spacex_ma, &s.spacex, &token())], &payer, &[]);
    expect_log(r, "invalid account data");
    for k in [tenet::pda::circle_asset(&circle, &s.spacex).0, tenet::pda::asset_vault(&circle, &s.spacex).0] {
        assert!(s.e.svm.get_account(&k).map_or(true, |x| x.data.is_empty()), "nothing created");
    }
    assert_eq!(read::<Circle>(&s.e.svm, &circle).asset_count, 0);

    // SPACEX's MandateAsset with AAPLx's mint.
    let r = send(&mut s.e.svm, &[add_circle_asset_ix(&payer.pubkey(), &circle, &spacex_ma, &s.aaplx, &token_2022())], &payer, &[]);
    expect_err(r, TenetError::MintMismatch);

    // A MandateAsset from a different Mandate (INV-018).
    let other = active_mandate();
    let foreign_ma = tenet::pda::mandate_asset(&other.mandate, &other.spacex).0;
    let foreign_acc = other.e.svm.get_account(&foreign_ma).unwrap();
    s.e.svm.set_account(foreign_ma, foreign_acc).unwrap(); // bring it into this VM
    let r = send(&mut s.e.svm, &[add_circle_asset_ix(&payer.pubkey(), &circle, &foreign_ma, &s.spacex, &token_2022())], &payer, &[]);
    expect_err(r, TenetError::AccountSubstitution);

    // Duplicate vault.
    send(&mut s.e.svm, &[add_circle_asset_ix(&payer.pubkey(), &circle, &spacex_ma, &s.spacex, &token_2022())], &payer, &[]).unwrap();
    let r = send(&mut s.e.svm, &[add_circle_asset_ix(&payer.pubkey(), &circle, &spacex_ma, &s.spacex, &token_2022())], &payer, &[]);
    expect_log(r, "already in use");
    assert_eq!(read::<Circle>(&s.e.svm, &circle).asset_count, 1);
}
