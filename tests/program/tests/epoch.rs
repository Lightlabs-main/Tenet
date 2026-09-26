//! On-chain: Epoch 0 — the first instructions that move value.
//!
//! Every test that moves USDC checks balances on BOTH sides of the transfer
//! and the invariants afterwards, not just that the call succeeded:
//!   INV-001  Σ member.shares + circle.reserved_shares == circle.total_shares
//!   INV-002  escrow is never active capital
//!   INV-003  an unsettled receipt confers no claim

mod common;

use anchor_lang::prelude::Pubkey;
use common::*;
use solana_keypair::Keypair;
use solana_signer::Signer;
use tenet::state::{AssetClass, Circle, CircleState, Epoch, EpochState, Member, MembershipPolicy};
use tenet::TenetError;

const USDC: u64 = 1_000_000; // 1 USDC in raw units

struct Pool {
    e: Env,
    mandate: Pubkey,
    circle: Pubkey,
    usdc: Pubkey,
}

impl Pool {
    fn escrow(&self, index: u64) -> Pubkey {
        tenet::pda::epoch_escrow(&self.circle, index).0
    }
    fn active(&self) -> Pubkey {
        tenet::pda::usdc_vault(&self.circle).0
    }
    fn circle(&self) -> Circle {
        read(&self.e.svm, &self.circle)
    }
    fn epoch(&self, index: u64) -> Epoch {
        read(&self.e.svm, &epoch_key(&self.circle, index))
    }
    /// A contributor wallet holding `usdc` whole USDC.
    fn wallet(&mut self, usdc: u64) -> (Keypair, Pubkey) {
        let k = funded(&mut self.e.svm);
        let acct = token_account_with(&mut self.e.svm, &self.usdc, &k.pubkey(), usdc * USDC);
        (k, acct)
    }
    fn open(&mut self, index: u64) -> TxResult {
        let p = funded(&mut self.e.svm);
        let ix = open_epoch_ix(&p.pubkey(), &self.circle, &self.mandate, &self.usdc, index);
        send(&mut self.e.svm, &[ix], &p, &[])
    }
    fn contribute(&mut self, who: &Keypair, from: &Pubkey, index: u64, raw: u64) -> TxResult {
        let ix = contribute_ix(&who.pubkey(), &self.circle, &self.mandate, &self.usdc, index, from, raw);
        send(&mut self.e.svm, &[ix], who, &[])
    }
    fn close_window(&mut self, index: u64) -> TxResult {
        let closes = self.epoch(index).closes_at;
        warp_to(&mut self.e.svm, closes);
        let p = funded(&mut self.e.svm);
        send(&mut self.e.svm, &[close_contributions_ix(&p.pubkey(), &self.circle, index)], &p, &[])
    }
    fn finalize(&mut self, index: u64) -> TxResult {
        let p = funded(&mut self.e.svm);
        send(&mut self.e.svm, &[finalize_epoch_ix(&p.pubkey(), &self.circle, &self.usdc, index)], &p, &[])
    }
    /// Settled by a THIRD PARTY: settlement is permissionless.
    fn settle(&mut self, index: u64, owner: &Pubkey) -> TxResult {
        let p = funded(&mut self.e.svm);
        send(&mut self.e.svm, &[settle_ix(&p.pubkey(), &self.circle, index, owner)], &p, &[])
    }
    fn close_epoch(&mut self, index: u64) -> TxResult {
        let p = funded(&mut self.e.svm);
        send(&mut self.e.svm, &[close_epoch_ix(&p.pubkey(), &self.circle, index)], &p, &[])
    }
    fn cancel_epoch(&mut self, index: u64) -> TxResult {
        let p = funded(&mut self.e.svm);
        send(&mut self.e.svm, &[cancel_epoch_ix(&p.pubkey(), &self.circle, index)], &p, &[])
    }
    fn member_shares(&self, owner: &Pubkey) -> Option<u64> {
        self.e.svm
            .get_account(&tenet::pda::member(&self.circle, owner).0)
            .filter(|a| !a.data.is_empty())
            .map(|_| read::<Member>(&self.e.svm, &tenet::pda::member(&self.circle, owner).0).shares)
    }
    /// INV-001 over an explicit member list.
    fn assert_inv_001(&self, members: &[Pubkey]) {
        let c = self.circle();
        let sum: u64 = members.iter().map(|m| self.member_shares(m).unwrap_or(0)).sum();
        assert_eq!(sum + c.reserved_shares, c.total_shares, "INV-001");
    }
}

fn pool_with(params: tenet::MandateParams) -> Pool {
    let mut e = with_real_usdc_config();
    let asset = register_equity(&mut e, AssetClass::PublicTokenizedEquity, 1, 1);
    let (author, mandate) = draft_mandate_with(&mut e, params);
    send(&mut e.svm, &[add_asset_ix(&author.pubkey(), &mandate, &asset, 4_000)], &author, &[]).unwrap();
    let pair = (tenet::pda::mandate_asset(&mandate, &asset).0, tenet::pda::registry(&asset).0);
    send(&mut e.svm, &[finalize_ix(&author.pubkey(), &mandate, &[pair])], &author, &[]).unwrap();
    let usdc = e.usdc_mint;
    send(&mut e.svm, &[create_circle_ix(&author.pubkey(), &mandate, &usdc, &token())], &author, &[]).unwrap();
    let circle = tenet::pda::circle(&mandate).0;
    Pool { e, mandate, circle, usdc }
}

fn pool() -> Pool {
    pool_with(mandate_params()) // min 1 USDC, max pool 100k USDC
}

// ================================================================ the happy path

#[test]
fn test_epoch_zero_accounting() {
    let mut p = pool();
    p.open(0).unwrap();
    let (a, a_usdc) = p.wallet(100);
    let (b, b_usdc) = p.wallet(100);
    let (c, c_usdc) = p.wallet(100);
    for (k, acct, amt) in [(&a, a_usdc, 30), (&b, b_usdc, 50), (&c, c_usdc, 20)] {
        p.contribute(k, &acct, 0, amt * USDC).unwrap();
    }
    p.close_window(0).unwrap();
    p.finalize(0).unwrap();

    // 1 share per micro-USDC, exact.
    let circle = p.circle();
    assert_eq!(circle.total_shares, 100 * USDC);
    assert_eq!(circle.reserved_shares, 100 * USDC);
    assert_eq!(circle.state, CircleState::Active);
    assert_eq!(token_balance(&p.e.svm, &p.escrow(0)), 0, "escrow swept");
    assert_eq!(token_balance(&p.e.svm, &p.active()), 100 * USDC, "into active capital");

    let owners = [a.pubkey(), b.pubkey(), c.pubkey()];
    for o in &owners {
        p.settle(0, o).unwrap();
        p.assert_inv_001(&owners); // after EVERY step
    }
    assert_eq!(p.member_shares(&a.pubkey()), Some(30 * USDC));
    assert_eq!(p.member_shares(&b.pubkey()), Some(50 * USDC));
    assert_eq!(p.member_shares(&c.pubkey()), Some(20 * USDC));

    p.close_epoch(0).unwrap();
    let circle = p.circle();
    assert_eq!((circle.total_shares, circle.reserved_shares), (100 * USDC, 0));
    assert_eq!(circle.current_epoch, 1);
    assert_eq!(circle.member_count, 3);
    assert_eq!(p.epoch(0).state, EpochState::Completed);

    // Contributors paid exactly what they contributed, nothing more.
    assert_eq!(token_balance(&p.e.svm, &a_usdc), 70 * USDC);
    assert_eq!(token_balance(&p.e.svm, &b_usdc), 50 * USDC);
    assert_eq!(token_balance(&p.e.svm, &c_usdc), 80 * USDC);
}

#[test]
fn test_contribution_enters_epoch_escrow() {
    let mut p = pool();
    p.open(0).unwrap();
    let (a, a_usdc) = p.wallet(10);
    p.contribute(&a, &a_usdc, 0, 4 * USDC).unwrap();
    p.contribute(&a, &a_usdc, 0, 3 * USDC).unwrap(); // repeat: same receipt

    assert_eq!(token_balance(&p.e.svm, &a_usdc), 3 * USDC);
    assert_eq!(token_balance(&p.e.svm, &p.escrow(0)), 7 * USDC);
    let e = p.epoch(0);
    assert_eq!((e.pending_usdc_raw, e.receipt_count), (7 * USDC, 1));
}

#[test]
fn test_pending_usdc_isolated() {
    // INV-002: pending USDC is in escrow, and the active vault is untouched.
    let mut p = pool();
    p.open(0).unwrap();
    let (a, a_usdc) = p.wallet(10);
    p.contribute(&a, &a_usdc, 0, 5 * USDC).unwrap();
    assert_eq!(token_balance(&p.e.svm, &p.active()), 0);
    assert_eq!(token_balance(&p.e.svm, &p.escrow(0)), 5 * USDC);

    // And a contribution cannot be routed INTO the active vault by passing it
    // as the escrow: the escrow is derived, not chosen.
    let active = p.active();
    let ix = contribute_ix_to(&a.pubkey(), &p.circle, &p.mandate, &p.usdc, 0, &a_usdc, &active, 2 * USDC);
    expect_log(send(&mut p.e.svm, &[ix], &a, &[]), "ConstraintSeeds");
    assert_eq!(token_balance(&p.e.svm, &p.active()), 0);
}

#[test]
fn test_pending_member_has_no_active_claim() {
    // INV-003: contributed and even finalized, but unsettled => no Member, no
    // shares held. Only the Circle's reserved pool accounts for them.
    let mut p = pool();
    p.open(0).unwrap();
    let (a, a_usdc) = p.wallet(10);
    p.contribute(&a, &a_usdc, 0, 5 * USDC).unwrap();
    assert_eq!(p.member_shares(&a.pubkey()), None);
    assert_eq!(p.circle().total_shares, 0, "contributing mints nothing");

    p.close_window(0).unwrap();
    p.finalize(0).unwrap();
    assert_eq!(p.member_shares(&a.pubkey()), None, "still no claim before settlement");
    assert_eq!(p.circle().reserved_shares, 5 * USDC);
}

#[test]
fn test_pending_contribution_cancel() {
    // Full recovery, no admin anywhere in the path.
    let mut p = pool();
    p.open(0).unwrap();
    let (a, a_usdc) = p.wallet(10);
    let (b, b_usdc) = p.wallet(10);
    p.contribute(&a, &a_usdc, 0, 6 * USDC).unwrap();
    p.contribute(&b, &b_usdc, 0, 2 * USDC).unwrap();

    let ix = cancel_ix(&a.pubkey(), &p.circle, &p.usdc, 0, &a_usdc);
    send(&mut p.e.svm, &[ix], &a, &[]).unwrap();

    assert_eq!(token_balance(&p.e.svm, &a_usdc), 10 * USDC, "refunded in full");
    assert_eq!(token_balance(&p.e.svm, &p.escrow(0)), 2 * USDC, "b's money untouched");
    let e = p.epoch(0);
    assert_eq!((e.pending_usdc_raw, e.receipt_count), (2 * USDC, 1));
    let receipt = tenet::pda::receipt(&epoch_key(&p.circle, 0), &a.pubkey()).0;
    assert!(p.e.svm.get_account(&receipt).map_or(true, |x| x.data.is_empty()), "receipt closed");

    // B cannot cancel A's (now non-existent) receipt, nor refund to A's
    // account: the receipt is derived from the SIGNER.
    let ix = cancel_ix(&b.pubkey(), &p.circle, &p.usdc, 0, &a_usdc);
    expect_log(send(&mut p.e.svm, &[ix], &b, &[]), "ConstraintTokenOwner");
}

// ================================================================ rejections

#[test]
fn test_contribute_rejections() {
    let mut p = pool();
    let (a, a_usdc) = p.wallet(200_000);

    // Epoch not opened yet: the account does not exist.
    expect_log(p.contribute(&a, &a_usdc, 0, 5 * USDC), "AccountNotInitialized");
    p.open(0).unwrap();

    expect_err(p.contribute(&a, &a_usdc, 0, USDC - 1), TenetError::BelowMinimumContribution);
    expect_err(p.contribute(&a, &a_usdc, 0, 100_001 * USDC), TenetError::ExceedsMaxPoolSize);
    // The cap counts what is already pending.
    p.contribute(&a, &a_usdc, 0, 99_999 * USDC).unwrap();
    expect_err(p.contribute(&a, &a_usdc, 0, 2 * USDC), TenetError::ExceedsMaxPoolSize);

    // After the window: refused even before anyone calls close_contributions.
    let closes = p.epoch(0).closes_at;
    warp_to(&mut p.e.svm, closes);
    expect_err(p.contribute(&a, &a_usdc, 0, USDC), TenetError::ContributionWindowClosed);
}

#[test]
fn test_invite_only_circle_admits_no_one_yet() {
    let mut params = mandate_params();
    params.membership_policy = MembershipPolicy::InviteOnly;
    let mut p = pool_with(params);
    p.open(0).unwrap();
    let (a, a_usdc) = p.wallet(10);
    expect_err(p.contribute(&a, &a_usdc, 0, 5 * USDC), TenetError::MembershipPolicyRejected);
    assert_eq!(token_balance(&p.e.svm, &a_usdc), 10 * USDC);
}

#[test]
fn test_lifecycle_ordering_is_enforced() {
    let mut p = pool();
    p.open(0).unwrap();
    let (a, a_usdc) = p.wallet(10);
    p.contribute(&a, &a_usdc, 0, 5 * USDC).unwrap();

    // Cannot close early, finalize while open, or open a second epoch.
    let pk = funded(&mut p.e.svm);
    let r = send(&mut p.e.svm, &[close_contributions_ix(&pk.pubkey(), &p.circle, 0)], &pk, &[]);
    expect_err(r, TenetError::ContributionWindowStillOpen);
    expect_err(p.finalize(0), TenetError::EpochNotClosed);
    expect_err(p.open(1), TenetError::EpochIndexMismatch);
    expect_log(p.open(0), "already in use");

    p.close_window(0).unwrap();
    // Closed: no more contributions, and no more cancellations.
    expect_err(p.contribute(&a, &a_usdc, 0, USDC), TenetError::EpochNotOpen);
    let ix = cancel_ix(&a.pubkey(), &p.circle, &p.usdc, 0, &a_usdc);
    expect_err(send(&mut p.e.svm, &[ix], &a, &[]), TenetError::EpochNotOpen);

    // Settlement needs finalization; closing needs every receipt settled.
    expect_err(p.settle(0, &a.pubkey()), TenetError::EpochNotFinalized);
    p.finalize(0).unwrap();
    expect_err(p.close_epoch(0), TenetError::UnsettledReceipts);
}

#[test]
fn test_reserved_shares_do_not_dilute() {
    // Settlement moves shares from "reserved" to members. It must never change
    // total_shares (A-20, spec §12).
    let mut p = pool();
    p.open(0).unwrap();
    let (a, a_usdc) = p.wallet(10);
    let (b, b_usdc) = p.wallet(10);
    p.contribute(&a, &a_usdc, 0, 3 * USDC).unwrap();
    p.contribute(&b, &b_usdc, 0, 7 * USDC).unwrap();
    p.close_window(0).unwrap();
    p.finalize(0).unwrap();

    let total = p.circle().total_shares;
    p.settle(0, &b.pubkey()).unwrap();
    assert_eq!(p.circle().total_shares, total);
    p.settle(0, &a.pubkey()).unwrap();
    assert_eq!(p.circle().total_shares, total);
    assert_eq!(p.circle().reserved_shares, 0);

    // Double settlement: the receipt no longer exists.
    expect_log(p.settle(0, &a.pubkey()), "AccountNotInitialized");
    assert_eq!(p.member_shares(&a.pubkey()), Some(3 * USDC));
}

#[test]
fn test_settlement_order_does_not_matter() {
    let run = |order: [usize; 3]| -> Vec<u64> {
        let mut p = pool();
        p.open(0).unwrap();
        let ws: Vec<(Keypair, Pubkey)> = (0..3).map(|_| p.wallet(100)).collect();
        for (i, (k, acct)) in ws.iter().enumerate() {
            p.contribute(k, acct, 0, (i as u64 * 17 + 11) * USDC).unwrap();
        }
        p.close_window(0).unwrap();
        p.finalize(0).unwrap();
        for i in order {
            p.settle(0, &ws[i].0.pubkey()).unwrap();
        }
        ws.iter().map(|(k, _)| p.member_shares(&k.pubkey()).unwrap()).collect()
    };
    assert_eq!(run([0, 1, 2]), run([2, 0, 1]));
}

// ================================================================ edge cases

#[test]
fn test_empty_epoch_does_not_deadlock_the_circle() {
    // A-21: nobody contributes. The spec's version failed finalization here,
    // leaving the epoch stuck in Closed and the Circle unable to open another.
    let mut p = pool();
    p.open(0).unwrap();
    p.close_window(0).unwrap();
    p.finalize(0).unwrap();
    p.close_epoch(0).unwrap();
    assert_eq!(p.circle().current_epoch, 1);
    assert_eq!(p.circle().state, CircleState::Funding, "no shares, still funding");
    p.open(1).expect("the next epoch can open");
}

#[test]
fn test_rolling_epoch_opens_for_snapshot_pricing() {
    // Rolling Epochs are now admitted because closed-epoch NAV pricing has a
    // bounded Pyth snapshot path and an explicit cancellation recovery path.
    let mut p = pool();
    p.open(0).unwrap();
    let (a, a_usdc) = p.wallet(10);
    p.contribute(&a, &a_usdc, 0, 5 * USDC).unwrap();
    p.close_window(0).unwrap();
    p.finalize(0).unwrap();
    p.settle(0, &a.pubkey()).unwrap();
    p.close_epoch(0).unwrap();
    p.open(1).unwrap();
    assert_eq!(p.epoch(1).state, EpochState::Open);

    let (b, b_usdc) = p.wallet(10);
    p.contribute(&b, &b_usdc, 1, 2 * USDC).unwrap();
    p.close_window(1).unwrap();
    let grace = p.epoch(1).closes_at + tenet::NAV_CANCELLATION_GRACE_SECONDS;
    warp_to(&mut p.e.svm, grace);
    p.cancel_epoch(1).unwrap();
    assert_eq!(p.epoch(1).state, EpochState::Cancelled);
    p.settle(1, &b.pubkey()).expect_err("cancelled contributions do not settle");
    let refund = cancel_ix(&b.pubkey(), &p.circle, &p.usdc, 1, &b_usdc);
    send(&mut p.e.svm, &[refund], &b, &[]).unwrap();
    // A-24: a cancelled window no longer blocks the Circle.
    assert_eq!(p.circle().current_epoch, 2, "cancellation advances to the next window");
    assert!(!p.circle().execution_frozen);
    p.open(2).expect("the next window opens after a cancellation");
}

#[test]
fn test_escrow_donation_is_swept_not_claimed() {
    // Anyone can send tokens to any account. Extra USDC in the escrow must not
    // mint extra shares for anyone; it is swept into active capital, where it
    // backs every share pro rata.
    let mut p = pool();
    p.open(0).unwrap();
    let (a, a_usdc) = p.wallet(10);
    p.contribute(&a, &a_usdc, 0, 5 * USDC).unwrap();

    let escrow = p.escrow(0);
    let mut acc = p.e.svm.get_account(&escrow).unwrap();
    let bal = u64::from_le_bytes(acc.data[64..72].try_into().unwrap()) + 2 * USDC;
    acc.data[64..72].copy_from_slice(&bal.to_le_bytes());
    p.e.svm.set_account(escrow, acc).unwrap();

    p.close_window(0).unwrap();
    p.finalize(0).unwrap();
    assert_eq!(p.circle().total_shares, 5 * USDC, "shares follow receipts, not balance");
    assert_eq!(token_balance(&p.e.svm, &p.active()), 7 * USDC);
}
