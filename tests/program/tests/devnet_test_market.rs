//! LiteSVM end-to-end coverage for the fixed, valueless Devnet test instrument.
//! This does not use a market quote or claim to represent stock/equity pricing.

mod common;

use anchor_lang::{
    prelude::Pubkey, solana_program::instruction::Instruction, InstructionData, ToAccountMetas,
};
use anchor_spl::associated_token::get_associated_token_address_with_program_id;
use common::*;
use solana_account::Account;
use solana_keypair::Keypair;
use solana_signer::Signer;
use tenet::state::{Circle, DevnetTestMarket, Epoch, Member};

const TEST_USDC_MINT: &str = "8XcK83nbTAtdvfHCFWLCAEHigHDBAGuEachzQss9oCkt";
const USDC: u64 = 1_000_000;
const CONTRIBUTION: u64 = 10 * USDC;
const PURCHASE: u64 = 4 * USDC;

struct TestMarket {
    e: Env,
    creator: Keypair,
    usdc: Pubkey,
    market: Pubkey,
    mint: Pubkey,
    inventory: Pubkey,
    reserve: Pubkey,
    mandate: Pubkey,
    circle: Pubkey,
    circle_asset_vault: Pubkey,
}

fn install_test_usdc(svm: &mut litesvm::LiteSVM) -> Pubkey {
    let mint = TEST_USDC_MINT.parse::<Pubkey>().unwrap();
    let mut data = vec![0u8; 82];
    data[36..44].copy_from_slice(&1_000_000_000u64.to_le_bytes());
    data[44] = 6;
    data[45] = 1;
    svm.set_account(
        mint,
        Account {
            lamports: 1_461_600,
            data,
            owner: token(),
            executable: false,
            rent_epoch: 0,
        },
    )
    .unwrap();
    mint
}

fn setup() -> TestMarket {
    let mut e = env();
    let usdc = install_test_usdc(&mut e.svm);
    e.usdc_mint = usdc;
    let admin = e.admin.insecure_clone();
    send(
        &mut e.svm,
        &[initialize_config_ix(&admin.pubkey(), &e.registry_authority.pubkey(), &usdc)],
        &admin,
        &[],
    )
    .expect("fixed Devnet test-USDC config initializes");

    let creator = funded(&mut e.svm);
    let creator_key = creator.pubkey();
    let market = tenet::pda::devnet_test_market().0;
    let mint = tenet::pda::devnet_test_mint().0;
    let inventory = get_associated_token_address_with_program_id(&market, &mint, &token_2022());
    let reserve = get_associated_token_address_with_program_id(&market, &usdc, &token());
    let initialize = Instruction {
        program_id: tenet::ID,
        accounts: tenet::accounts::InitializeDevnetTestMarket {
            payer: creator_key,
            config: tenet::pda::config().0,
            test_market: market,
            test_mint: mint,
            registry_entry: tenet::pda::registry(&mint).0,
            inventory_vault: inventory,
            usdc_mint: usdc,
            usdc_reserve_vault: reserve,
            token_2022_program: token_2022(),
            usdc_token_program: token(),
            associated_token_program: anchor_spl::associated_token::ID,
            system_program: system_program(),
        }
        .to_account_metas(None),
        data: tenet::instruction::InitializeDevnetTestMarket {}.data(),
    };
    send(&mut e.svm, &[initialize], &creator, &[]).expect("fixed inventory initializes once");

    let seed = Keypair::new().pubkey();
    let mandate = tenet::pda::mandate(&seed).0;
    let circle = tenet::pda::circle(&mandate).0;
    let circle_asset_vault = tenet::pda::asset_vault(&circle, &mint).0;
    let create_circle = Instruction {
        program_id: tenet::ID,
        accounts: tenet::accounts::CreateDevnetTestCircle {
            creator: creator_key,
            config: tenet::pda::config().0,
            test_market: market,
            test_mint: mint,
            registry_entry: tenet::pda::registry(&mint).0,
            usdc_mint: usdc,
            mandate,
            mandate_asset: tenet::pda::mandate_asset(&mandate, &mint).0,
            circle,
            vault_authority: tenet::pda::vault_authority(&circle).0,
            active_usdc_vault: tenet::pda::usdc_vault(&circle).0,
            circle_asset: tenet::pda::circle_asset(&circle, &mint).0,
            test_equity_vault: circle_asset_vault,
            epoch_zero: tenet::pda::epoch(&circle, 0).0,
            epoch_zero_escrow: tenet::pda::epoch_escrow(&circle, 0).0,
            usdc_token_program: token(),
            token_2022_program: token_2022(),
            system_program: system_program(),
        }
        .to_account_metas(None),
        data: tenet::instruction::CreateDevnetTestCircle { mandate_seed: seed }.data(),
    };
    send(&mut e.svm, &[create_circle], &creator, &[]).expect("test Circle and Epoch 0 initialize");

    let source = token_account_with(&mut e.svm, &usdc, &creator_key, CONTRIBUTION);
    let contribution = contribute_ix(&creator_key, &circle, &mandate, &usdc, 0, &source, CONTRIBUTION);
    send(&mut e.svm, &[contribution], &creator, &[]).expect("test-USDC enters isolated Epoch escrow");
    let epoch: Epoch = read(&e.svm, &tenet::pda::epoch(&circle, 0).0);
    warp_to(&mut e.svm, epoch.closes_at);
    let payer = funded(&mut e.svm);
    send(&mut e.svm, &[close_contributions_ix(&payer.pubkey(), &circle, 0)], &payer, &[])
        .expect("Epoch 0 closes");
    let payer = funded(&mut e.svm);
    send(&mut e.svm, &[finalize_epoch_ix(&payer.pubkey(), &circle, &usdc, 0)], &payer, &[])
        .expect("Epoch 0 finalizes");
    let payer = funded(&mut e.svm);
    send(&mut e.svm, &[settle_ix(&payer.pubkey(), &circle, 0, &creator_key)], &payer, &[])
        .expect("contribution settles into Member shares");
    let payer = funded(&mut e.svm);
    send(&mut e.svm, &[close_epoch_ix(&payer.pubkey(), &circle, 0)], &payer, &[])
        .expect("Epoch 0 completes");

    TestMarket {
        e, creator, usdc, market, mint, inventory, reserve, mandate, circle, circle_asset_vault,
    }
}

fn buy_ix(t: &TestMarket, amount: u64) -> Instruction {
    let creator = t.creator.pubkey();
    Instruction {
        program_id: tenet::ID,
        accounts: tenet::accounts::BuyDevnetTestEquity {
            buyer: creator,
            circle: t.circle,
            mandate: t.mandate,
            member: tenet::pda::member(&t.circle, &creator).0,
            config: tenet::pda::config().0,
            test_market: t.market,
            mandate_asset: tenet::pda::mandate_asset(&t.mandate, &t.mint).0,
            registry_entry: tenet::pda::registry(&t.mint).0,
            usdc_mint: t.usdc,
            test_mint: t.mint,
            active_usdc_vault: tenet::pda::usdc_vault(&t.circle).0,
            circle_asset: tenet::pda::circle_asset(&t.circle, &t.mint).0,
            test_equity_vault: t.circle_asset_vault,
            inventory_vault: t.inventory,
            usdc_reserve_vault: t.reserve,
            vault_authority: tenet::pda::vault_authority(&t.circle).0,
            usdc_token_program: token(),
            token_2022_program: token_2022(),
        }
        .to_account_metas(None),
        data: tenet::instruction::BuyDevnetTestEquity { amount_usdc_raw: amount }.data(),
    }
}

#[test]
fn test_execution_output_reaches_correct_vault() {
    let mut t = setup();
    let active = tenet::pda::usdc_vault(&t.circle).0;
    let member_addr = tenet::pda::member(&t.circle, &t.creator.pubkey()).0;
    let shares_before: Member = read(&t.e.svm, &member_addr);
    let circle_before: Circle = read(&t.e.svm, &t.circle);
    let reserve_before = token_balance(&t.e.svm, &t.reserve);
    let inventory_before = token_balance(&t.e.svm, &t.inventory);

    let mut substituted = buy_ix(&t, PURCHASE);
    assert_eq!(substituted.accounts[12].pubkey, t.circle_asset_vault);
    substituted.accounts[12].pubkey = t.inventory;
    assert!(send(&mut t.e.svm, &[substituted], &t.creator, &[]).is_err());
    assert_eq!(token_balance(&t.e.svm, &active), CONTRIBUTION);
    assert_eq!(token_balance(&t.e.svm, &t.reserve), reserve_before);
    assert_eq!(token_balance(&t.e.svm, &t.inventory), inventory_before);

    let purchase_ix = buy_ix(&t, PURCHASE);
    send(&mut t.e.svm, &[purchase_ix], &t.creator, &[]).expect("test allocation succeeds");
    assert_eq!(token_balance(&t.e.svm, &active), CONTRIBUTION - PURCHASE);
    assert_eq!(token_balance(&t.e.svm, &t.circle_asset_vault), PURCHASE);
    assert_eq!(token_balance(&t.e.svm, &t.reserve), reserve_before + PURCHASE);
    assert_eq!(token_balance(&t.e.svm, &t.inventory), inventory_before - PURCHASE);

    let shares_after: Member = read(&t.e.svm, &member_addr);
    let circle_after: Circle = read(&t.e.svm, &t.circle);
    assert_eq!(shares_after.shares, shares_before.shares, "test allocation cannot mint shares");
    assert_eq!(circle_after.total_shares, circle_before.total_shares);
}

#[test]
fn test_account_substitution_rejected() {
    let mut t = setup();
    let active = tenet::pda::usdc_vault(&t.circle).0;
    let active_before = token_balance(&t.e.svm, &active);
    let mut ix = buy_ix(&t, PURCHASE);
    ix.accounts[12].pubkey = t.inventory;
    assert!(send(&mut t.e.svm, &[ix], &t.creator, &[]).is_err());
    assert_eq!(token_balance(&t.e.svm, &active), active_before);
    assert_eq!(token_balance(&t.e.svm, &t.circle_asset_vault), 0);
}

#[test]
fn test_pending_usdc_isolated_until_epoch_settlement() {
    let mut t = setup();
    let active = tenet::pda::usdc_vault(&t.circle).0;
    let before = token_balance(&t.e.svm, &active);
    let market: DevnetTestMarket = read(&t.e.svm, &t.market);
    assert_eq!(market.mint, t.mint);
    assert_eq!(market.inventory_raw, token_balance(&t.e.svm, &t.inventory));

    let index = read::<Circle>(&t.e.svm, &t.circle).current_epoch;
    let opener = funded(&mut t.e.svm);
    let open = open_epoch_ix(&opener.pubkey(), &t.circle, &t.mandate, &t.usdc, index);
    send(&mut t.e.svm, &[open], &opener, &[]).expect("rolling Epoch opens");

    let pending_owner = funded(&mut t.e.svm);
    let source = token_account_with(&mut t.e.svm, &t.usdc, &pending_owner.pubkey(), USDC);
    let contribution = contribute_ix(
        &pending_owner.pubkey(), &t.circle, &t.mandate, &t.usdc, index, &source, USDC,
    );
    send(&mut t.e.svm, &[contribution], &pending_owner, &[])
        .expect("pending contribution enters Epoch escrow");

    let escrow = tenet::pda::epoch_escrow(&t.circle, index).0;
    assert_eq!(token_balance(&t.e.svm, &escrow), USDC);
    assert_eq!(token_balance(&t.e.svm, &active), before, "pending USDC is not active Circle capital");
    let pending_member = tenet::pda::member(&t.circle, &pending_owner.pubkey()).0;
    assert!(t.e.svm.get_account(&pending_member).is_none(), "pending contributor has no active Member claim");
}
