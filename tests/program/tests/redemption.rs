//! On-chain: exit — `initiate_redemption`, `reserve_redemption_asset`,
//! `reserve_redemption_usdc`, `claim_redemption_asset`, `claim_redemption_usdc`.
//!
//! Holdings are SIMULATED by writing vault balances directly: execution (buying
//! assets) is Phase 4, and an exit's entitlement depends only on vault balances.
//! The mints are real mainnet snapshots (SPACEX, AAPLx, USDC), so transfers run
//! through the real token programs with the real Token-2022 extensions —
//! transfer fees and pausability included.

mod common;

use anchor_lang::prelude::Pubkey;
use anchor_spl::token_2022::spl_token_2022::{
    extension::{
        pausable::PausableConfig,
        transfer_fee::{TransferFeeAmount, TransferFeeConfig},
        BaseStateWithExtensions, BaseStateWithExtensionsMut, StateWithExtensions, StateWithExtensionsMut,
    },
    state::{Account as T22Account, Mint as T22Mint},
};
use common::*;
use solana_keypair::Keypair;
use solana_signer::Signer;
use tenet::state::{AssetClass, Circle, CircleAsset, Member};
use tenet::TenetError;

const USDC: u64 = 1_000_000;
const SPACEX_HELD: u64 = 1_000_000_000_000;
const AAPLX_HELD: u64 = 999_999_999;

struct Exit {
    e: Env,
    circle: Pubkey,
    usdc: Pubkey,
    spacex: Pubkey,
    aaplx: Pubkey,
    alice: Keypair,
    bob: Keypair,
    carol: Keypair,
}

impl Exit {
    fn circle(&self) -> Circle {
        read(&self.e.svm, &self.circle)
    }
    fn shares(&self, who: &Keypair) -> u64 {
        read::<Member>(&self.e.svm, &tenet::pda::member(&self.circle, &who.pubkey()).0).shares
    }
    fn vault(&self, mint: &Pubkey) -> Pubkey {
        tenet::pda::asset_vault(&self.circle, mint).0
    }
    fn usdc_vault(&self) -> Pubkey {
        tenet::pda::usdc_vault(&self.circle).0
    }
    fn reserved(&self, mint: &Pubkey) -> u64 {
        read::<CircleAsset>(&self.e.svm, &tenet::pda::circle_asset(&self.circle, mint).0).reserved_for_redemption_raw
    }
    fn stranger(&mut self) -> Keypair {
        funded(&mut self.e.svm)
    }
    fn initiate(&mut self, who: &Keypair, seq: u64, shares: u64) -> TxResult {
        let ix = initiate_redemption_ix(&who.pubkey(), &self.circle, seq, shares);
        send(&mut self.e.svm, &[ix], who, &[])
    }
    /// Reserve EVERYTHING of an exit — done by a stranger: it is permissionless.
    fn reserve_all(&mut self, who: &Keypair, seq: u64) {
        let r = redemption_key(&self.circle, &who.pubkey(), seq);
        let p = self.stranger();
        for mint in [self.spacex, self.aaplx] {
            send(&mut self.e.svm, &[reserve_asset_ix(&p.pubkey(), &self.circle, &r, &mint)], &p, &[])
                .unwrap_or_else(|err| panic!("reserve asset: {err}"));
        }
        let usdc = self.usdc;
        send(&mut self.e.svm, &[reserve_usdc_ix(&p.pubkey(), &self.circle, &r, &usdc)], &p, &[])
            .unwrap_or_else(|err| panic!("reserve usdc: {err}"));
    }
    fn entitled(&self, who: &Keypair, seq: u64, mint: &Pubkey) -> u64 {
        let r = redemption_key(&self.circle, &who.pubkey(), seq);
        read::<tenet::state::RedemptionAsset>(&self.e.svm, &tenet::pda::redemption_asset(&r, mint).0).amount_raw
    }
    fn assert_inv_001(&self) {
        let c = self.circle();
        let sum = self.shares(&self.alice) + self.shares(&self.bob) + self.shares(&self.carol);
        assert_eq!(sum + c.reserved_shares, c.total_shares, "INV-001");
    }
}

/// A Circle with SPACEX (PreStocks, pre-IPO) and AAPLx (xStocks) vaults, a
/// completed Epoch 0 — alice 40, bob 30, carol 30 USDC — and simulated holdings.
fn exit_setup() -> Exit {
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
    let usdc = e.usdc_mint;
    send(&mut e.svm, &[create_circle_ix(&author.pubkey(), &mandate, &usdc, &token())], &author, &[]).unwrap();
    let circle = tenet::pda::circle(&mandate).0;
    for mint in [spacex, aaplx] {
        let ma = tenet::pda::mandate_asset(&mandate, &mint).0;
        send(&mut e.svm, &[add_circle_asset_ix(&author.pubkey(), &circle, &ma, &mint, &token_2022())], &author, &[]).unwrap();
    }

    // Epoch 0.
    let p = funded(&mut e.svm);
    send(&mut e.svm, &[open_epoch_ix(&p.pubkey(), &circle, &mandate, &usdc, 0)], &p, &[]).unwrap();
    let (alice, bob, carol) = (funded(&mut e.svm), funded(&mut e.svm), funded(&mut e.svm));
    for (k, amt) in [(&alice, 40), (&bob, 30), (&carol, 30)] {
        let from = token_account_with(&mut e.svm, &usdc, &k.pubkey(), amt * USDC);
        let ix = contribute_ix(&k.pubkey(), &circle, &mandate, &usdc, 0, &from, amt * USDC);
        send(&mut e.svm, &[ix], k, &[]).unwrap();
    }
    let closes = read::<tenet::state::Epoch>(&e.svm, &epoch_key(&circle, 0)).closes_at;
    warp_to(&mut e.svm, closes);
    send(&mut e.svm, &[close_contributions_ix(&p.pubkey(), &circle, 0)], &p, &[]).unwrap();
    send(&mut e.svm, &[finalize_epoch_ix(&p.pubkey(), &circle, &usdc, 0)], &p, &[]).unwrap();
    for k in [&alice, &bob, &carol] {
        send(&mut e.svm, &[settle_ix(&p.pubkey(), &circle, 0, &k.pubkey())], &p, &[]).unwrap();
    }
    send(&mut e.svm, &[close_epoch_ix(&p.pubkey(), &circle, 0)], &p, &[]).unwrap();

    // Simulated holdings (execution is Phase 4).
    set_token_amount(&mut e.svm, &tenet::pda::asset_vault(&circle, &spacex).0, SPACEX_HELD);
    set_token_amount(&mut e.svm, &tenet::pda::asset_vault(&circle, &aaplx).0, AAPLX_HELD);

    Exit { e, circle, usdc, spacex, aaplx, alice, bob, carol }
}

fn floor_share(held: u64, s: u64, total: u64) -> u64 {
    ((held as u128) * (s as u128) / (total as u128)) as u64
}

// ================================================================ the exit

#[test]
fn test_exit_without_oracle() {
    // No price account exists anywhere in this VM, and no redemption
    // instruction takes one. Exit is a function of balances only (RULE 6).
    let mut x = exit_setup();
    let bob = x.bob.insecure_clone();
    assert_eq!(x.circle().member_count, 3, "all settled members are active");
    x.initiate(&bob, 0, 30 * USDC).unwrap();

    let c = x.circle();
    assert_eq!(c.total_shares, 70 * USDC, "bob's shares leave the supply at initiation");
    assert_eq!(c.member_count, 2, "a full redemption removes the active member");
    assert_eq!(c.pending_reservations, 1);
    x.assert_inv_001();

    x.reserve_all(&bob, 0);
    assert_eq!(x.circle().pending_reservations, 0);
    assert_eq!(x.entitled(&bob, 0, &x.spacex), floor_share(SPACEX_HELD, 30 * USDC, 100 * USDC));
    assert_eq!(x.entitled(&bob, 0, &x.aaplx), floor_share(AAPLX_HELD, 30 * USDC, 100 * USDC));
    assert_eq!(x.entitled(&bob, 0, &x.usdc), 30 * USDC);

    // Claims — USDC and AAPLx here; SPACEX (transfer fee) in its own test.
    let r = redemption_key(&x.circle, &bob.pubkey(), 0);
    let bob_usdc = token_account_with(&mut x.e.svm, &x.usdc, &bob.pubkey(), 0);
    send(&mut x.e.svm, &[claim_usdc_ix(&bob.pubkey(), &x.circle, &r, &x.usdc, &bob_usdc)], &bob, &[]).unwrap();
    assert_eq!(token_balance(&x.e.svm, &bob_usdc), 30 * USDC);
    assert_eq!(token_balance(&x.e.svm, &x.usdc_vault()), 70 * USDC);
    assert_eq!(x.circle().usdc_reserved_raw, 0, "obligation discharged");

    let aaplx_vault = x.vault(&x.aaplx);
    let bob_aaplx = clone_token_account_for(&mut x.e.svm, &aaplx_vault, &bob.pubkey());
    let owed = x.entitled(&bob, 0, &x.aaplx);
    send(&mut x.e.svm, &[claim_asset_ix(&bob.pubkey(), &x.circle, &r, &x.aaplx, &bob_aaplx)], &bob, &[]).unwrap();
    assert_eq!(token_balance(&x.e.svm, &aaplx_vault), AAPLX_HELD - owed, "vault debited exactly the entitlement");
    assert_eq!(x.reserved(&x.aaplx), 0);
    x.assert_inv_001();
}

#[test]
fn test_parallel_redemptions() {
    // REVIEW.md H-02 on-chain: equal holders get equal amounts, whoever goes
    // first, because a second exit cannot start until the first is reserved.
    let mut results = vec![];
    for first_is_bob in [true, false] {
        let mut x = exit_setup();
        let (bob, carol) = (x.bob.insecure_clone(), x.carol.insecure_clone());
        let (first, second) = if first_is_bob { (&bob, &carol) } else { (&carol, &bob) };

        x.initiate(first, 0, 30 * USDC).unwrap();
        expect_err(x.initiate(second, 0, 30 * USDC), TenetError::RedemptionPending);
        x.reserve_all(first, 0);
        x.initiate(second, 0, 30 * USDC).unwrap();
        x.reserve_all(second, 0);

        let b = x.entitled(&bob, 0, &x.spacex);
        let c = x.entitled(&carol, 0, &x.spacex);
        assert!(b.abs_diff(c) <= 1, "bob {b} vs carol {c}");
        results.push((b, c));

        // Alice, who stayed, is unharmed: backing per remaining share did not fall.
        let left = SPACEX_HELD - x.reserved(&x.spacex);
        assert!((left as u128) * 100 >= (SPACEX_HELD as u128) * 40, "alice's backing fell");
        x.assert_inv_001();
    }
    assert!(results[0].0.abs_diff(results[1].0) <= 1, "bob depends on order: {results:?}");
    assert!(results[0].1.abs_diff(results[1].1) <= 1, "carol depends on order: {results:?}");
}

#[test]
fn test_finalize_refused_while_an_exit_is_unreserved() {
    // A-22 inflow guard. Alice is the sole member and exits entirely, so
    // total_shares is 0 and a new epoch may open. Without the guard, the
    // newcomer's USDC swept in by finalize would be divided by alice's stale
    // denominator — she would take it.
    let mut e = with_real_usdc_config();
    let asset = register_equity(&mut e, AssetClass::PublicTokenizedEquity, 1, 1);
    let (author, mandate) = draft_mandate(&mut e);
    send(&mut e.svm, &[add_asset_ix(&author.pubkey(), &mandate, &asset, 4_000)], &author, &[]).unwrap();
    let pair = (tenet::pda::mandate_asset(&mandate, &asset).0, tenet::pda::registry(&asset).0);
    send(&mut e.svm, &[finalize_ix(&author.pubkey(), &mandate, &[pair])], &author, &[]).unwrap();
    let usdc = e.usdc_mint;
    send(&mut e.svm, &[create_circle_ix(&author.pubkey(), &mandate, &usdc, &token())], &author, &[]).unwrap();
    let circle = tenet::pda::circle(&mandate).0;
    let p = funded(&mut e.svm);

    // Open an epoch, one contribution, close the window. Finalization is left
    // to the caller.
    let run_epoch = |e: &mut Env, index: u64, who: &Keypair, amt: u64| {
        send(&mut e.svm, &[open_epoch_ix(&p.pubkey(), &circle, &mandate, &usdc, index)], &p, &[]).unwrap();
        let from = token_account_with(&mut e.svm, &usdc, &who.pubkey(), amt);
        send(&mut e.svm, &[contribute_ix(&who.pubkey(), &circle, &mandate, &usdc, index, &from, amt)], who, &[]).unwrap();
        let closes = read::<tenet::state::Epoch>(&e.svm, &epoch_key(&circle, index)).closes_at;
        warp_to(&mut e.svm, closes);
        send(&mut e.svm, &[close_contributions_ix(&p.pubkey(), &circle, index)], &p, &[]).unwrap();
    };

    let alice = funded(&mut e.svm);
    run_epoch(&mut e, 0, &alice, 10 * USDC);
    send(&mut e.svm, &[finalize_epoch_ix(&p.pubkey(), &circle, &usdc, 0)], &p, &[]).unwrap();
    send(&mut e.svm, &[settle_ix(&p.pubkey(), &circle, 0, &alice.pubkey())], &p, &[]).unwrap();
    send(&mut e.svm, &[close_epoch_ix(&p.pubkey(), &circle, 0)], &p, &[]).unwrap();

    send(&mut e.svm, &[initiate_redemption_ix(&alice.pubkey(), &circle, 0, 10 * USDC)], &alice, &[]).unwrap();
    assert_eq!(read::<Circle>(&e.svm, &circle).total_shares, 0);

    let newcomer = funded(&mut e.svm);
    run_epoch(&mut e, 1, &newcomer, 50 * USDC);
    let r = send(&mut e.svm, &[finalize_epoch_ix(&p.pubkey(), &circle, &usdc, 1)], &p, &[]);
    expect_err(r, TenetError::RedemptionPending);

    // Reserve alice's exit (anyone may), then finalize proceeds. This Circle
    // has no asset vaults, so the exit is USDC only.
    let red = redemption_key(&circle, &alice.pubkey(), 0);
    send(&mut e.svm, &[reserve_usdc_ix(&p.pubkey(), &circle, &red, &usdc)], &p, &[]).unwrap();
    let owed = read::<tenet::state::RedemptionAsset>(&e.svm, &tenet::pda::redemption_asset(&red, &usdc).0).amount_raw;
    assert_eq!(owed, 10 * USDC, "alice gets exactly her 10 USDC — none of the newcomer's 50");
    send(&mut e.svm, &[finalize_epoch_ix(&p.pubkey(), &circle, &usdc, 1)], &p, &[]).unwrap();
}

// ================================================================ fees & isolation

#[test]
fn test_transfer_fee_borne_by_exiting_member() {
    let mut x = exit_setup();
    // Move to an epoch where SPACEX's newer fee schedule applies (V-004).
    let mut clock = x.e.svm.get_sysvar::<anchor_lang::prelude::Clock>();
    clock.epoch = 2_000;
    x.e.svm.set_sysvar(&clock);

    let bob = x.bob.insecure_clone();
    x.initiate(&bob, 0, 30 * USDC).unwrap();
    x.reserve_all(&bob, 0);
    let owed = x.entitled(&bob, 0, &x.spacex);

    let mint_data = x.e.svm.get_account(&x.spacex).unwrap().data;
    let fee = StateWithExtensions::<T22Mint>::unpack(&mint_data).unwrap()
        .get_extension::<TransferFeeConfig>().expect("SPACEX has a transfer fee")
        .calculate_epoch_fee(clock.epoch, owed).unwrap();
    assert!(fee > 0, "this test needs a non-zero fee to mean anything");

    let spacex_vault = x.vault(&x.spacex);
    let usdc_before = token_balance(&x.e.svm, &x.usdc_vault());
    let bob_spacex = clone_token_account_for(&mut x.e.svm, &spacex_vault, &bob.pubkey());
    let r = redemption_key(&x.circle, &bob.pubkey(), 0);
    send(&mut x.e.svm, &[claim_asset_ix(&bob.pubkey(), &x.circle, &r, &x.spacex, &bob_spacex)], &bob, &[]).unwrap();

    // The vault is debited exactly the entitlement; bob receives it minus the
    // fee, which Token-2022 withholds on HIS account.
    assert_eq!(token_balance(&x.e.svm, &spacex_vault), SPACEX_HELD - owed);
    assert_eq!(token_balance(&x.e.svm, &bob_spacex), owed - fee);
    let acc = x.e.svm.get_account(&bob_spacex).unwrap().data;
    let withheld: u64 = StateWithExtensions::<T22Account>::unpack(&acc).unwrap()
        .get_extension::<TransferFeeAmount>().unwrap().withheld_amount.into();
    assert_eq!(withheld, fee);

    // test_remaining_members_not_charged_exit_fee: no Circle USDC moved, and
    // the vault still holds exactly the remaining members' pro-rata backing.
    assert_eq!(token_balance(&x.e.svm, &x.usdc_vault()), usdc_before, "no reimbursement from Circle USDC");
    assert_eq!(SPACEX_HELD - owed, SPACEX_HELD - floor_share(SPACEX_HELD, 30 * USDC, 100 * USDC));
}

#[test]
fn test_one_failed_asset_does_not_unnecessarily_lock_other_claims() {
    let mut x = exit_setup();
    let bob = x.bob.insecure_clone();
    x.initiate(&bob, 0, 30 * USDC).unwrap();
    x.reserve_all(&bob, 0);
    let r = redemption_key(&x.circle, &bob.pubkey(), 0);

    // SPACEX becomes unclaimable: the ISSUER pauses the mint (V-002 shows the
    // pausable authority is live on PreStocks mints).
    let mut mint = x.e.svm.get_account(&x.spacex).unwrap();
    StateWithExtensionsMut::<T22Mint>::unpack(&mut mint.data).unwrap()
        .get_extension_mut::<PausableConfig>().expect("SPACEX is pausable")
        .paused = true.into();
    x.e.svm.set_account(x.spacex, mint.clone()).unwrap();

    let spacex_vault = x.vault(&x.spacex);
    let bob_spacex = clone_token_account_for(&mut x.e.svm, &spacex_vault, &bob.pubkey());
    let res = send(&mut x.e.svm, &[claim_asset_ix(&bob.pubkey(), &x.circle, &r, &x.spacex, &bob_spacex)], &bob, &[]);
    assert!(res.is_err(), "a paused mint cannot transfer");

    // Every OTHER claim still works.
    let aaplx_vault = x.vault(&x.aaplx);
    let bob_aaplx = clone_token_account_for(&mut x.e.svm, &aaplx_vault, &bob.pubkey());
    send(&mut x.e.svm, &[claim_asset_ix(&bob.pubkey(), &x.circle, &r, &x.aaplx, &bob_aaplx)], &bob, &[]).unwrap();
    let bob_usdc = token_account_with(&mut x.e.svm, &x.usdc, &bob.pubkey(), 0);
    send(&mut x.e.svm, &[claim_usdc_ix(&bob.pubkey(), &x.circle, &r, &x.usdc, &bob_usdc)], &bob, &[]).unwrap();
    assert_eq!(token_balance(&x.e.svm, &bob_usdc), 30 * USDC);

    // And the SPACEX claim stayed OPEN: once unpaused, it pays in full.
    StateWithExtensionsMut::<T22Mint>::unpack(&mut mint.data).unwrap()
        .get_extension_mut::<PausableConfig>().unwrap()
        .paused = false.into();
    x.e.svm.set_account(x.spacex, mint).unwrap();
    send(&mut x.e.svm, &[claim_asset_ix(&bob.pubkey(), &x.circle, &r, &x.spacex, &bob_spacex)], &bob, &[]).unwrap();
    assert_eq!(x.reserved(&x.spacex), 0);

    // A frozen destination account is the member's own problem, isolated the
    // same way: carol's frozen AAPLx account blocks only her AAPLx claim.
    let carol = x.carol.insecure_clone();
    x.initiate(&carol, 0, 30 * USDC).unwrap();
    x.reserve_all(&carol, 0);
    let rc = redemption_key(&x.circle, &carol.pubkey(), 0);
    let carol_aaplx = clone_token_account_for(&mut x.e.svm, &aaplx_vault, &carol.pubkey());
    set_token_state(&mut x.e.svm, &carol_aaplx, 2);
    assert!(send(&mut x.e.svm, &[claim_asset_ix(&carol.pubkey(), &x.circle, &rc, &x.aaplx, &carol_aaplx)], &carol, &[]).is_err());
    let carol_usdc = token_account_with(&mut x.e.svm, &x.usdc, &carol.pubkey(), 0);
    send(&mut x.e.svm, &[claim_usdc_ix(&carol.pubkey(), &x.circle, &rc, &x.usdc, &carol_usdc)], &carol, &[]).unwrap();
}

// ================================================================ rejections & liveness

#[test]
fn test_redemption_rejections() {
    let mut x = exit_setup();
    let bob = x.bob.insecure_clone();

    expect_err(x.initiate(&bob, 0, 0), TenetError::ZeroShares);
    expect_err(x.initiate(&bob, 0, 30 * USDC + 1), TenetError::InsufficientShares);
    let stranger = x.stranger();
    expect_log(x.initiate(&stranger, 0, 1), "AccountNotInitialized"); // not a member

    x.initiate(&bob, 0, 10 * USDC).unwrap();
    let r = redemption_key(&x.circle, &bob.pubkey(), 0);
    let p = x.stranger();

    // Claiming before reserving: nothing to claim yet.
    let bob_usdc = token_account_with(&mut x.e.svm, &x.usdc, &bob.pubkey(), 0);
    expect_log(send(&mut x.e.svm, &[claim_usdc_ix(&bob.pubkey(), &x.circle, &r, &x.usdc, &bob_usdc)], &bob, &[]), "AccountNotInitialized");

    // Double reservation of one asset is impossible.
    send(&mut x.e.svm, &[reserve_asset_ix(&p.pubkey(), &x.circle, &r, &x.spacex)], &p, &[]).unwrap();
    expect_log(send(&mut x.e.svm, &[reserve_asset_ix(&p.pubkey(), &x.circle, &r, &x.spacex)], &p, &[]), "already in use");
    x.reserve_all_remaining(&bob, 0);
    // Reserving again after completion fails: the RedemptionAsset account
    // already exists (Anchor's `init` runs before the NothingToReserve
    // constraint is evaluated, so this is the error that surfaces).
    let usdc = x.usdc;
    expect_log(send(&mut x.e.svm, &[reserve_usdc_ix(&p.pubkey(), &x.circle, &r, &usdc)], &p, &[]), "already in use");

    // Only the owner may claim, and only to their own account.
    let carol = x.carol.insecure_clone();
    let carol_usdc = token_account_with(&mut x.e.svm, &x.usdc, &carol.pubkey(), 0);
    let ix = claim_usdc_ix(&carol.pubkey(), &x.circle, &r, &x.usdc, &carol_usdc);
    expect_log(send(&mut x.e.svm, &[ix], &carol, &[]), "ConstraintSeeds");
    let ix = claim_usdc_ix(&bob.pubkey(), &x.circle, &r, &x.usdc, &carol_usdc);
    expect_log(send(&mut x.e.svm, &[ix], &bob, &[]), "ConstraintTokenOwner");

    // Claim once; the second finds no account.
    send(&mut x.e.svm, &[claim_usdc_ix(&bob.pubkey(), &x.circle, &r, &x.usdc, &bob_usdc)], &bob, &[]).unwrap();
    expect_log(send(&mut x.e.svm, &[claim_usdc_ix(&bob.pubkey(), &x.circle, &r, &x.usdc, &bob_usdc)], &bob, &[]), "AccountNotInitialized");
    assert_eq!(token_balance(&x.e.svm, &bob_usdc), 10 * USDC);

    // Partial exits: bob's next exit uses seq 1.
    x.initiate(&bob, 1, 5 * USDC).unwrap();
    assert_eq!(x.shares(&bob), 15 * USDC);
}

#[test]
fn test_exit_covers_exactly_the_vaults_that_existed() {
    // Liveness + anti-griefing. Only AAPLx's vault exists (Mandate index 1 —
    // indexes need not be contiguous). The exit must complete with AAPLx +
    // USDC; a vault created AFTER initiation (SPACEX) is not part of it and
    // cannot be reserved in place of a real asset.
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
    let usdc = e.usdc_mint;
    send(&mut e.svm, &[create_circle_ix(&author.pubkey(), &mandate, &usdc, &token())], &author, &[]).unwrap();
    let circle = tenet::pda::circle(&mandate).0;
    let aaplx_ma = tenet::pda::mandate_asset(&mandate, &aaplx).0;
    send(&mut e.svm, &[add_circle_asset_ix(&author.pubkey(), &circle, &aaplx_ma, &aaplx, &token_2022())], &author, &[]).unwrap();

    let p = funded(&mut e.svm);
    send(&mut e.svm, &[open_epoch_ix(&p.pubkey(), &circle, &mandate, &usdc, 0)], &p, &[]).unwrap();
    let alice = funded(&mut e.svm);
    let from = token_account_with(&mut e.svm, &usdc, &alice.pubkey(), 10 * USDC);
    send(&mut e.svm, &[contribute_ix(&alice.pubkey(), &circle, &mandate, &usdc, 0, &from, 10 * USDC)], &alice, &[]).unwrap();
    let closes = read::<tenet::state::Epoch>(&e.svm, &epoch_key(&circle, 0)).closes_at;
    warp_to(&mut e.svm, closes);
    send(&mut e.svm, &[close_contributions_ix(&p.pubkey(), &circle, 0)], &p, &[]).unwrap();
    send(&mut e.svm, &[finalize_epoch_ix(&p.pubkey(), &circle, &usdc, 0)], &p, &[]).unwrap();
    send(&mut e.svm, &[settle_ix(&p.pubkey(), &circle, 0, &alice.pubkey())], &p, &[]).unwrap();

    send(&mut e.svm, &[initiate_redemption_ix(&alice.pubkey(), &circle, 0, 4 * USDC)], &alice, &[]).unwrap();
    let r = redemption_key(&circle, &alice.pubkey(), 0);

    // SPACEX's vault appears after the exit began.
    let spacex_ma = tenet::pda::mandate_asset(&mandate, &spacex).0;
    send(&mut e.svm, &[add_circle_asset_ix(&p.pubkey(), &circle, &spacex_ma, &spacex, &token_2022())], &p, &[]).unwrap();
    let res = send(&mut e.svm, &[reserve_asset_ix(&p.pubkey(), &circle, &r, &spacex)], &p, &[]);
    expect_err(res, TenetError::AssetNotInSnapshot);

    // The real set completes, and the Circle is not left blocked.
    send(&mut e.svm, &[reserve_asset_ix(&p.pubkey(), &circle, &r, &aaplx)], &p, &[]).unwrap();
    send(&mut e.svm, &[reserve_usdc_ix(&p.pubkey(), &circle, &r, &usdc)], &p, &[]).unwrap();
    assert_eq!(read::<Circle>(&e.svm, &circle).pending_reservations, 0, "exit completed");
    let res = send(&mut e.svm, &[reserve_asset_ix(&p.pubkey(), &circle, &r, &spacex)], &p, &[]);
    expect_err(res, TenetError::NothingToReserve);
}

impl Exit {
    /// Reserve whatever of this exit is not yet reserved.
    fn reserve_all_remaining(&mut self, who: &Keypair, seq: u64) {
        let r = redemption_key(&self.circle, &who.pubkey(), seq);
        let p = self.stranger();
        for mint in [self.spacex, self.aaplx] {
            let ra = tenet::pda::redemption_asset(&r, &mint).0;
            if self.e.svm.get_account(&ra).map_or(true, |a| a.data.is_empty()) {
                send(&mut self.e.svm, &[reserve_asset_ix(&p.pubkey(), &self.circle, &r, &mint)], &p, &[]).unwrap();
            }
        }
        let usdc = self.usdc;
        let ra = tenet::pda::redemption_asset(&r, &usdc).0;
        if self.e.svm.get_account(&ra).map_or(true, |a| a.data.is_empty()) {
            send(&mut self.e.svm, &[reserve_usdc_ix(&p.pubkey(), &self.circle, &r, &usdc)], &p, &[]).unwrap();
        }
    }
}
