//! On-chain amendment governance against the rebuilt program artifact.
//!
//! These tests keep the governance boundary deliberately narrow: voting power
//! comes from settled Member shares, the active Circle share total is snapped
//! at proposal time, and the current Mandate delay governs the proposal being
//! executed. Exit remains a separate path and is not referenced by these
//! accounts.

mod common;

use anchor_lang::prelude::Pubkey;
use common::*;
use solana_keypair::Keypair;
use solana_signer::Signer;
use tenet::state::{AmendmentProposal, AssetClass, Mandate, Member};
use tenet::TenetError;

const USDC: u64 = 1_000_000;

struct ActivePool {
    e: Env,
    mandate: Pubkey,
    circle: Pubkey,
    member: Keypair,
}

fn active_pool() -> ActivePool {
    let mut e = with_real_usdc_config();
    let asset = register_equity(&mut e, AssetClass::PublicTokenizedEquity, 1, 1);
    let (author, mandate) = draft_mandate(&mut e);
    send(
        &mut e.svm,
        &[add_asset_ix(&author.pubkey(), &mandate, &asset, 4_000)],
        &author,
        &[],
    )
    .unwrap();
    let pair = (
        tenet::pda::mandate_asset(&mandate, &asset).0,
        tenet::pda::registry(&asset).0,
    );
    send(
        &mut e.svm,
        &[finalize_ix(&author.pubkey(), &mandate, &[pair])],
        &author,
        &[],
    )
    .unwrap();

    send(
        &mut e.svm,
        &[create_circle_ix(
            &author.pubkey(),
            &mandate,
            &e.usdc_mint,
            &token(),
        )],
        &author,
        &[],
    )
    .unwrap();
    let circle = tenet::pda::circle(&mandate).0;
    let member = funded(&mut e.svm);
    let member_usdc = token_account_with(&mut e.svm, &e.usdc_mint, &member.pubkey(), 10 * USDC);
    let payer = funded(&mut e.svm);
    send(
        &mut e.svm,
        &[open_epoch_ix(
            &payer.pubkey(),
            &circle,
            &mandate,
            &e.usdc_mint,
            0,
        )],
        &payer,
        &[],
    )
    .unwrap();
    send(
        &mut e.svm,
        &[contribute_ix(
            &member.pubkey(),
            &circle,
            &mandate,
            &e.usdc_mint,
            0,
            &member_usdc,
            USDC,
        )],
        &member,
        &[],
    )
    .unwrap();
    let closes_at = read::<tenet::state::Epoch>(&e.svm, &epoch_key(&circle, 0)).closes_at;
    warp_to(&mut e.svm, closes_at);
    send(
        &mut e.svm,
        &[close_contributions_ix(&payer.pubkey(), &circle, 0)],
        &payer,
        &[],
    )
    .unwrap();
    send(
        &mut e.svm,
        &[finalize_epoch_ix(&payer.pubkey(), &circle, &e.usdc_mint, 0)],
        &payer,
        &[],
    )
    .unwrap();
    send(
        &mut e.svm,
        &[settle_ix(&payer.pubkey(), &circle, 0, &member.pubkey())],
        &payer,
        &[],
    )
    .unwrap();
    send(
        &mut e.svm,
        &[close_epoch_ix(&payer.pubkey(), &circle, 0)],
        &payer,
        &[],
    )
    .unwrap();

    ActivePool {
        e,
        mandate,
        circle,
        member,
    }
}

fn amended_params() -> tenet::MandateParams {
    let mut params = mandate_params();
    params.name = "Member Amended Constitution".into();
    params.description = "A governed update".into();
    params.max_price_impact_bps = 150;
    params
}

#[test]
fn test_amendment_requires_threshold_and_delay() {
    let mut p = active_pool();
    let proposal_id = 7;
    let params = amended_params();
    send(
        &mut p.e.svm,
        &[propose_amendment_ix(
            &p.member.pubkey(),
            &p.mandate,
            &p.circle,
            proposal_id,
            params,
        )],
        &p.member,
        &[],
    )
    .unwrap();

    // No votes means the threshold is not met once the current delay expires.
    let proposal_now = now(&p.e.svm);
    warp_to(
        &mut p.e.svm,
        proposal_now + tenet::MIN_AMENDMENT_DELAY_SECONDS + 1,
    );
    let executor = funded(&mut p.e.svm);
    expect_err(
        send(
            &mut p.e.svm,
            &[execute_amendment_ix(
                &executor.pubkey(),
                &p.mandate,
                &p.circle,
                proposal_id,
            )],
            &executor,
            &[],
        ),
        TenetError::AmendmentThresholdNotMet,
    );

    send(
        &mut p.e.svm,
        &[vote_amendment_ix(
            &p.member.pubkey(),
            &p.mandate,
            &p.circle,
            proposal_id,
            true,
        )],
        &p.member,
        &[],
    )
    .unwrap();
    // A fresh proposal demonstrates the delay gate before it can be executed.
    let proposal_id_2 = 8;
    send(
        &mut p.e.svm,
        &[propose_amendment_ix(
            &p.member.pubkey(),
            &p.mandate,
            &p.circle,
            proposal_id_2,
            amended_params(),
        )],
        &p.member,
        &[],
    )
    .unwrap();
    expect_err(
        send(
            &mut p.e.svm,
            &[execute_amendment_ix(
                &executor.pubkey(),
                &p.mandate,
                &p.circle,
                proposal_id_2,
            )],
            &executor,
            &[],
        ),
        TenetError::AmendmentDelayNotElapsed,
    );

    send(
        &mut p.e.svm,
        &[vote_amendment_ix(
            &p.member.pubkey(),
            &p.mandate,
            &p.circle,
            proposal_id_2,
            true,
        )],
        &p.member,
        &[],
    )
    .unwrap();
    let execute_now = now(&p.e.svm);
    warp_to(
        &mut p.e.svm,
        execute_now + tenet::MIN_AMENDMENT_DELAY_SECONDS + 1,
    );
    send(
        &mut p.e.svm,
        &[execute_amendment_ix(
            &executor.pubkey(),
            &p.mandate,
            &p.circle,
            proposal_id_2,
        )],
        &executor,
        &[],
    )
    .unwrap();

    let mandate: Mandate = read(&p.e.svm, &p.mandate);
    assert_eq!(mandate.name, "Member Amended Constitution");
    assert_eq!(mandate.version, 2);
    assert!(
        read::<AmendmentProposal>(
            &p.e.svm,
            &tenet::pda::amendment(&p.mandate, proposal_id_2).0
        )
        .executed
    );
}

#[test]
fn test_amendment_vote_is_unique_and_uses_settled_shares() {
    let mut p = active_pool();
    let proposal_id = 9;
    send(
        &mut p.e.svm,
        &[propose_amendment_ix(
            &p.member.pubkey(),
            &p.mandate,
            &p.circle,
            proposal_id,
            amended_params(),
        )],
        &p.member,
        &[],
    )
    .unwrap();
    send(
        &mut p.e.svm,
        &[vote_amendment_ix(
            &p.member.pubkey(),
            &p.mandate,
            &p.circle,
            proposal_id,
            true,
        )],
        &p.member,
        &[],
    )
    .unwrap();

    let member_account: Member = read(
        &p.e.svm,
        &tenet::pda::member(&p.circle, &p.member.pubkey()).0,
    );
    let proposal: AmendmentProposal =
        read(&p.e.svm, &tenet::pda::amendment(&p.mandate, proposal_id).0);
    assert_eq!(proposal.total_shares_at_proposal, member_account.shares);
    assert_eq!(proposal.for_shares, member_account.shares);

    // The vote PDA is one-per-member-per-proposal, so a second vote cannot
    // overwrite or double-count the member's settled shares.
    expect_log(
        send(
            &mut p.e.svm,
            &[vote_amendment_ix(
                &p.member.pubkey(),
                &p.mandate,
                &p.circle,
                proposal_id,
                true,
            )],
            &p.member,
            &[],
        ),
        "already in use",
    );
}

#[test]
fn test_amendment_rejects_non_member() {
    let mut p = active_pool();
    let stranger = funded(&mut p.e.svm);
    expect_log(
        send(
            &mut p.e.svm,
            &[propose_amendment_ix(
                &stranger.pubkey(),
                &p.mandate,
                &p.circle,
                10,
                amended_params(),
            )],
            &stranger,
            &[],
        ),
        "AccountNotInitialized",
    );
}
