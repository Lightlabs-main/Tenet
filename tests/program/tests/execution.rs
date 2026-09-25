//! On-chain EXECUTE boundary tests.
//!
//! Mainnet-profile structural checks. The full execution path — a real venue
//! moving real tokens, target weights, price impact, feed binding — runs on
//! the Devnet profile in `devnet_e2e.rs`.

mod common;

use anchor_lang::{prelude::Pubkey, InstructionData, ToAccountMetas};
use common::*;
use solana_signer::Signer;
use tenet::state::AssetClass;
use tenet::TenetError;

fn end_execution_ix(
    executor: &Pubkey,
    circle: &Pubkey,
    mandate: &Pubkey,
    mandate_asset_out: &Pubkey,
    epoch: &Pubkey,
    out_mint: &Pubkey,
    nonce: u64,
) -> anchor_lang::solana_program::instruction::Instruction {
    let circle_asset_out = tenet::pda::circle_asset(circle, out_mint).0;
    anchor_lang::solana_program::instruction::Instruction {
        program_id: tenet::ID,
        accounts: tenet::accounts::EndExecution {
            executor: *executor,
            circle: *circle,
            mandate: *mandate,
            execution_auth: tenet::pda::exec_auth(circle, epoch, nonce).0,
            epoch: *epoch,
            in_mint: Pubkey::default(), // replaced by caller below
            out_mint: *out_mint,
            mandate_asset_out: *mandate_asset_out,
            registry_entry: tenet::pda::registry(out_mint).0,
            config: tenet::pda::config().0,
            price_account: Pubkey::default(), // Begin fails before End is reached
            source_vault: tenet::pda::usdc_vault(circle).0,
            circle_asset_out,
            dest_vault: tenet::pda::asset_vault(circle, out_mint).0,
            source_token_program: token(),
            vault_authority: tenet::pda::vault_authority(circle).0,
        }
        .to_account_metas(None),
        data: tenet::instruction::EndExecution {}.data(),
    }
}

#[test]
fn test_execution_window_is_fail_closed() {
    let mut e = with_real_usdc_config();
    let equity = register_equity(&mut e, AssetClass::PublicTokenizedEquity, 1, 1);
    let (author, mandate) = draft_mandate(&mut e);
    let mandate_asset = tenet::pda::mandate_asset(&mandate, &equity).0;
    send(&mut e.svm, &[add_asset_ix(&author.pubkey(), &mandate, &equity, 4_000)], &author, &[]).unwrap();
    send(
        &mut e.svm,
        &[finalize_ix(&author.pubkey(), &mandate, &[(mandate_asset, tenet::pda::registry(&equity).0)])],
        &author,
        &[],
    )
    .unwrap();

    send(&mut e.svm, &[create_circle_ix(&author.pubkey(), &mandate, &e.usdc_mint, &token())], &author, &[]).unwrap();
    let circle = tenet::pda::circle(&mandate).0;
    send(
        &mut e.svm,
        &[add_circle_asset_ix(&author.pubkey(), &circle, &mandate_asset, &equity, &token_2022())],
        &author,
        &[],
    )
    .unwrap();

    // Make the Circle active through the real Epoch 0 path.
    let payer = funded(&mut e.svm);
    send(&mut e.svm, &[open_epoch_ix(&payer.pubkey(), &circle, &mandate, &e.usdc_mint, 0)], &payer, &[]).unwrap();
    let contributor = funded(&mut e.svm);
    let contributor_usdc = token_account_with(&mut e.svm, &e.usdc_mint, &contributor.pubkey(), 2_000_000);
    send(
        &mut e.svm,
        &[contribute_ix(&contributor.pubkey(), &circle, &mandate, &e.usdc_mint, 0, &contributor_usdc, 1_000_000)],
        &contributor,
        &[],
    )
    .unwrap();
    let epoch = tenet::pda::epoch(&circle, 0).0;
    let closes_at = read::<tenet::Epoch>(&e.svm, &epoch).closes_at;
    warp_to(&mut e.svm, closes_at);
    let closer = funded(&mut e.svm);
    send(&mut e.svm, &[close_contributions_ix(&closer.pubkey(), &circle, 0)], &closer, &[]).unwrap();
    send(&mut e.svm, &[finalize_epoch_ix(&closer.pubkey(), &circle, &e.usdc_mint, 0)], &closer, &[]).unwrap();
    send(&mut e.svm, &[settle_ix(&closer.pubkey(), &circle, 0, &contributor.pubkey())], &closer, &[]).unwrap();
    send(&mut e.svm, &[close_epoch_ix(&closer.pubkey(), &circle, 0)], &closer, &[]).unwrap();

    let executor = funded(&mut e.svm);
    let nonce = 7;
    let expires_at = now(&e.svm) + 300;
    let mut begin = begin_execution_ix(
        &executor.pubkey(),
        &circle,
        &mandate,
        &epoch,
        &mandate_asset,
        &equity,
        nonce,
        500_000,
        1,
        expires_at,
    );
    // The helper keeps the account list readable; bind the actual configured
    // USDC mint into the generated account position.
    begin.accounts[9].pubkey = e.usdc_mint;

    let mut end = end_execution_ix(&executor.pubkey(), &circle, &mandate, &mandate_asset, &epoch, &equity, nonce);
    end.accounts[4].pubkey = e.usdc_mint;

    // No external program is needed here: the structural window check must
    // reject the transaction before any route can be considered.
    expect_err(
        send(&mut e.svm, &[begin, end], &executor, &[]),
        TenetError::IncompleteExecutionWindow,
    );
}

#[test]
fn test_end_execution_builder_binds_circle_usdc_vault() {
    let executor = Pubkey::new_unique();
    let circle = Pubkey::new_unique();
    let mandate = Pubkey::new_unique();
    let mandate_asset = Pubkey::new_unique();
    let epoch = Pubkey::new_unique();
    let out_mint = Pubkey::new_unique();

    let instruction = end_execution_ix(
        &executor,
        &circle,
        &mandate,
        &mandate_asset,
        &epoch,
        &out_mint,
        7,
    );

    // EndExecution's source vault must remain Circle-scoped. It must never be
    // derived from the user-provided input mint or execution authorization.
    assert_eq!(instruction.accounts[11].pubkey, tenet::pda::usdc_vault(&circle).0);
}
