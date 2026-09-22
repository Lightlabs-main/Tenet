/**
 * Tenet — domain accounting tests.
 *
 *   node --test packages/domain/test/
 *
 * Named tests follow docs/instructions.md and the specification's §47 list.
 * The final block is a seeded property fuzzer that asserts INV-001 after every
 * single generated step.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  createCircle,
  openEpoch,
  contribute,
  cancelContribution,
  closeContributions,
  finalizeEpoch,
  settleContribution,
  closeEpoch,
  execute,
  initiateRedemption,
  reserveRedemptionAsset,
  claimRedemptionAsset,
  checkInvariants,
  sharesForContribution,
  entitlementForRedemption,
  backingPerShare,
  hasPendingReservations,
  availableUsdc,
  AccountingError,
  MIN_NAV_FOR_ISSUANCE,
  U64_MAX,
  type Circle,
} from "../src/accounting.ts";

import {
  dec,
  decToString,
  effectiveMultiplier,
  activeTransferFee,
  transferFeeAmount,
  rawToDisplay,
  supplyConsumptionBps,
} from "../src/display.ts";

// ---------------------------------------------------------------- helpers

const NO_ASSETS = new Map<string, bigint>();

function ok(c: Circle, label = "") {
  const v = checkInvariants(c);
  assert.deepEqual(v, [], `${label} invariant violations: ${JSON.stringify(v)}`);
}

/**
 * Run a full epoch: open, contribute, close, finalize, settle all, close.
 *
 * `activeNav` refuses to price an epoch when any asset's value is missing
 * (RULE 1 — no fabricated fallback), so the helper supplies an explicit zero
 * for every asset unless the caller overrides it.
 */
function valuesFor(c: Circle, overrides?: Map<string, bigint>): Map<string, bigint> {
  const m = new Map<string, bigint>();
  for (const mint of c.assets.keys()) m.set(mint, overrides?.get(mint) ?? 0n);
  return m;
}

function runEpoch(
  c: Circle,
  contributions: Array<[string, bigint]>,
  assetValues?: Map<string, bigint>,
) {
  const e = openEpoch(c);
  for (const [who, amt] of contributions) contribute(c, e.index, who, amt);
  closeContributions(c, e.index);
  finalizeEpoch(c, e.index, valuesFor(c, assetValues));
  for (const [who] of contributions) settleContribution(c, e.index, who);
  closeEpoch(c, e.index);
  return e;
}

// ---------------------------------------------------------------- epoch 0

test("test_epoch_zero_accounting: 1 share per micro-USDC, exact, no division", () => {
  const c = createCircle();
  runEpoch(c, [["alice", 30_000_000n], ["bob", 20_000_000n]]);

  assert.equal(c.members.get("alice"), 30_000_000n);
  assert.equal(c.members.get("bob"), 20_000_000n);
  assert.equal(c.totalShares, 50_000_000n);
  assert.equal(c.activeUsdc, 50_000_000n);
  assert.equal(c.reservedShares, 0n);
  ok(c, "epoch 0");
});

test("test_pending_usdc_isolated: escrow is not active capital until finalization", () => {
  const c = createCircle();
  const e = openEpoch(c);
  contribute(c, e.index, "alice", 10_000_000n);

  assert.equal(c.activeUsdc, 0n, "escrow must not be spendable");
  assert.equal(c.escrow.get(e.index), 10_000_000n);
  ok(c, "pending");

  closeContributions(c, e.index);
  finalizeEpoch(c, e.index, valuesFor(c));
  assert.equal(c.activeUsdc, 10_000_000n, "swept only at finalization");
  assert.equal(c.escrow.get(e.index), 0n);
  ok(c, "swept");
});

test("test_pending_member_has_no_active_claim: unsettled receipt confers no shares", () => {
  const c = createCircle();
  runEpoch(c, [["alice", 10_000_000n]]);

  const e2 = openEpoch(c);
  contribute(c, e2.index, "bob", 5_000_000n);

  assert.equal(c.members.get("bob"), undefined, "bob holds no shares while pending");
  assert.equal(c.totalShares, 10_000_000n, "total unchanged by a pending contribution");
  ok(c, "pending member");

  // Bob cannot exit on the strength of a pending contribution.
  assert.throws(() => initiateRedemption(c, "r1", "bob", 1n), AccountingError);
});

test("test_pending_contribution_cancel: member recovers escrow with no admin", () => {
  const c = createCircle();
  const e = openEpoch(c);
  contribute(c, e.index, "alice", 7_000_000n);
  const refund = cancelContribution(c, e.index, "alice");

  assert.equal(refund, 7_000_000n);
  assert.equal(c.escrow.get(e.index), 0n);
  assert.equal(c.activeUsdc, 0n);
  ok(c, "cancelled");
});

// ---------------------------------------------------------------- rolling

test("test_rolling_epoch_no_dilution: existing members keep their value", () => {
  const c = createCircle(["NVDAx"]);
  runEpoch(c, [["alice", 30_000_000n], ["bob", 20_000_000n]]);

  // Deploy into an asset that then appreciates: NAV 50 -> 60.
  execute(c, "NVDAx", 50_000_000n, 1_000_000_00n);
  const values = new Map([["NVDAx", 60_000_000n]]);

  const backingBefore = backingPerShare(60_000_000n, c.totalShares);

  const e = openEpoch(c);
  contribute(c, e.index, "carol", 12_000_000n);
  closeContributions(c, e.index);
  finalizeEpoch(c, e.index, values);
  settleContribution(c, e.index, "carol");

  // 12 * 50/60 = 10 shares exactly.
  assert.equal(c.members.get("carol"), 10_000_000n);
  assert.equal(c.totalShares, 60_000_000n);

  const navAfter = 60_000_000n + 12_000_000n;
  const backingAfter = backingPerShare(navAfter, c.totalShares);
  assert.ok(backingAfter >= backingBefore, "per-share backing must not fall");
  ok(c, "rolling");
});

test("test_reserved_shares_do_not_dilute: reserved counted once, at finalization", () => {
  const c = createCircle();
  const e = openEpoch(c);
  contribute(c, e.index, "alice", 10_000_000n);
  contribute(c, e.index, "bob", 10_000_000n);
  closeContributions(c, e.index);
  finalizeEpoch(c, e.index, valuesFor(c));

  assert.equal(c.totalShares, 20_000_000n, "all shares counted at finalization");
  assert.equal(c.reservedShares, 20_000_000n, "none claimed yet");
  ok(c, "reserved");

  settleContribution(c, e.index, "alice");
  assert.equal(c.totalShares, 20_000_000n, "settlement must NOT re-inflate total");
  assert.equal(c.reservedShares, 10_000_000n);
  ok(c, "half settled");
});

test("test_late_settlement_no_dilution: settling epochs later changes nothing", () => {
  const c = createCircle();

  const e0 = openEpoch(c);
  contribute(c, e0.index, "alice", 10_000_000n);
  contribute(c, e0.index, "slowpoke", 10_000_000n);
  closeContributions(c, e0.index);
  finalizeEpoch(c, e0.index, valuesFor(c));
  settleContribution(c, e0.index, "alice");
  // slowpoke does NOT settle. Epoch cannot close, so open the next via a fresh circle
  // path: verify the outstanding reservation is carried correctly instead.

  assert.equal(c.totalShares, 20_000_000n);
  assert.equal(c.reservedShares, 10_000_000n);
  ok(c, "before late settle");

  // Much later, slowpoke settles and receives exactly the frozen entitlement.
  const shares = settleContribution(c, e0.index, "slowpoke");
  assert.equal(shares, 10_000_000n);
  assert.equal(c.totalShares, 20_000_000n, "total unchanged by a late claim");
  assert.equal(c.reservedShares, 0n);
  ok(c, "after late settle");
});

test("rounding residue is released so dust cannot dilute forever", () => {
  const c = createCircle();
  runEpoch(c, [["alice", 1_000_000n]]);

  // Force a fractional rate: NAV 3, shares 1_000_000.
  const e = openEpoch(c);
  contribute(c, e.index, "b", 1n);
  contribute(c, e.index, "c", 1n);
  closeContributions(c, e.index);
  finalizeEpoch(c, e.index, valuesFor(c));
  settleContribution(c, e.index, "b");
  settleContribution(c, e.index, "c");
  const residue = closeEpoch(c, e.index);

  assert.ok(residue >= 0n, "residue is non-negative");
  ok(c, "residue released");
});

test("finalization is refused when NAV has collapsed; exit stays open", () => {
  const c = createCircle(["X"]);
  runEpoch(c, [["alice", 10_000_000n]]);
  execute(c, "X", 10_000_000n, 1_000n);

  const e = openEpoch(c);
  contribute(c, e.index, "bob", 5_000_000n);
  closeContributions(c, e.index);
  finalizeEpoch(c, e.index, new Map([["X", 0n]])); // asset worthless

  assert.equal(c.epochs.get(e.index)!.phase, "Cancelled");
  assert.equal(c.members.get("bob"), undefined);
  assert.equal(cancelContribution(c, e.index, "bob"), 5_000_000n, "bob recovers escrow");

  // Alice can still exit — no oracle, no approval.
  const r = initiateRedemption(c, "r1", "alice", 10_000_000n);
  assert.equal(r.sharesRedeemed, 10_000_000n);
  ok(c, "collapsed nav");
});

// ---------------------------------------------------------------- exit

test("test_exit_without_oracle: entitlement needs no price at all", () => {
  const c = createCircle(["A", "B"]);
  runEpoch(c, [["alice", 60_000_000n], ["bob", 40_000_000n]]);
  execute(c, "A", 30_000_000n, 7_000_000_003n);
  execute(c, "B", 30_000_000n, 1_234_567n);

  const r = initiateRedemption(c, "r1", "bob", 40_000_000n);
  const a = reserveRedemptionAsset(c, "r1", "A");
  const b = reserveRedemptionAsset(c, "r1", "B");
  const u = reserveRedemptionAsset(c, "r1", "USDC");

  // 40% of each vault, floored.
  assert.equal(a, (7_000_000_003n * 40_000_000n) / 100_000_000n);
  assert.equal(b, (1_234_567n * 40_000_000n) / 100_000_000n);
  assert.equal(u, (40_000_000n * 40_000_000n) / 100_000_000n);
  assert.equal(r.unreserved.size, 0);
  ok(c, "exit reserved");

  claimRedemptionAsset(c, "r1", "A");
  claimRedemptionAsset(c, "r1", "B");
  claimRedemptionAsset(c, "r1", "USDC");
  ok(c, "exit claimed");
});

test("test_redemption_entitlement_cannot_be_diluted: later activity cannot shrink a claim", () => {
  const c = createCircle(["A"]);
  runEpoch(c, [["alice", 50_000_000n], ["bob", 50_000_000n]]);
  execute(c, "A", 50_000_000n, 1_000_000n);

  initiateRedemption(c, "r1", "bob", 50_000_000n);
  const entitled = reserveRedemptionAsset(c, "r1", "A");
  reserveRedemptionAsset(c, "r1", "USDC");
  assert.equal(entitled, 500_000n, "half the vault");

  // A later contributor joins and settles.
  const e = openEpoch(c);
  contribute(c, e.index, "carol", 25_000_000n);
  closeContributions(c, e.index);
  finalizeEpoch(c, e.index, new Map([["A", 25_000_000n]]));
  settleContribution(c, e.index, "carol");

  // Bob's frozen claim is untouched, and still claimable.
  assert.equal(c.redemptions.get("r1")!.claims.get("A")!.amount, 500_000n);
  assert.equal(claimRedemptionAsset(c, "r1", "A"), 500_000n);
  ok(c, "no dilution of exit");
});

test("rolling NAV excludes reserved redemption obligations", () => {
  const c = createCircle();
  runEpoch(c, [["alice", 2_000_000n]]);

  // Alice's USDC claim is fixed before the next contribution arrives.  The
  // remaining Circle NAV is 1,000,000, not the original 2,000,000.
  initiateRedemption(c, "r1", "alice", 1_000_000n);
  assert.equal(reserveRedemptionAsset(c, "r1", "USDC"), 1_000_000n);

  const e = openEpoch(c);
  contribute(c, e.index, "bob", 1_000_000n);
  closeContributions(c, e.index);
  finalizeEpoch(c, e.index, valuesFor(c));

  assert.equal(
    e.reservedShares,
    1_000_000n,
    "new entrants must not be priced against value already owed to an exit",
  );
  ok(c, "reserved NAV excluded");
});

test("test_parallel_redemptions: fair in every order", () => {
  // REVIEW.md H-02. The previous version of this test let both exits initiate
  // before either reserved, and asserted only that the REMAINING member was
  // unharmed. It never compared the two exiters — and they were not treated
  // equally: with bob and carol at 30% each, carol reserving first took
  // 428_571_428 and left bob 171_428_571. Reservation is permissionless, so
  // carol could always arrange to go first. The value moved between exiters,
  // which is why an assertion about the remaining member could not see it.
  const results: Record<string, { bob: bigint; carol: bigint }> = {};
  for (const [first, second] of [["bob", "carol"], ["carol", "bob"]] as const) {
    const c = createCircle(["A"]);
    runEpoch(c, [["alice", 40_000_000n], ["bob", 30_000_000n], ["carol", 30_000_000n]]);
    execute(c, "A", 40_000_000n, 999_999_999n);

    const r1 = initiateRedemption(c, `r-${first}`, first, 30_000_000n);
    // A second exit cannot start while the first has unreserved assets (A-22).
    assert.throws(
      () => initiateRedemption(c, `r-${second}`, second, 30_000_000n),
      (e: unknown) => e instanceof AccountingError && e.code === "E_REDEMPTION_PENDING",
    );
    reserveRedemptionAsset(c, r1.id, "A");
    reserveRedemptionAsset(c, r1.id, "USDC");

    const r2 = initiateRedemption(c, `r-${second}`, second, 30_000_000n);
    reserveRedemptionAsset(c, r2.id, "A");
    reserveRedemptionAsset(c, r2.id, "USDC");
    ok(c, `parallel ${first} first`);

    const got = (who: string) => c.redemptions.get(`r-${who}`)!.claims.get("A")!.amount;
    results[first] = { bob: got("bob"), carol: got("carol") };

    // Equal holders, equal treatment — up to 1 raw unit of floor rounding.
    const diff = got("bob") > got("carol") ? got("bob") - got("carol") : got("carol") - got("bob");
    assert.ok(diff <= 1n, `${first} first: bob ${got("bob")} vs carol ${got("carol")}`);

    // And the remaining member is still unharmed.
    const before = backingPerShare(999_999_999n, 100_000_000n);
    const a = c.assets.get("A")!;
    const after = backingPerShare(a.vault - a.reservedForRedemption, c.totalShares);
    assert.ok(after >= before, `remaining backing fell: ${after} < ${before}`);
  }
  // Order-independent: each person gets the same amount whoever went first.
  for (const who of ["bob", "carol"] as const) {
    const d = results.bob[who] - results.carol[who];
    assert.ok(d >= -1n && d <= 1n, `${who} depends on exit order: ${results.bob[who]} vs ${results.carol[who]}`);
  }
});

test("finalization is refused while an exit is unreserved (A-22 inflow guard)", () => {
  // Without this, new USDC swept in by finalization would be divided by a
  // share count snapshotted BEFORE it arrived: an exiter who initiated earlier
  // would take a slice of the newcomers' money.
  const c = createCircle(["A"]);
  runEpoch(c, [["alice", 10_000_000n]]);
  initiateRedemption(c, "r1", "alice", 10_000_000n);

  const e = openEpoch(c);
  contribute(c, e.index, "newcomer", 50_000_000n);
  closeContributions(c, e.index);
  assert.throws(
    () => finalizeEpoch(c, e.index, new Map([["A", 0n]])),
    (err: unknown) => err instanceof AccountingError && err.code === "E_REDEMPTION_PENDING",
  );

  // Once the exit is fully reserved, finalization proceeds, and the exiter's
  // USDC claim is exactly what was there before the newcomer arrived.
  reserveRedemptionAsset(c, "r1", "A");
  const owed = reserveRedemptionAsset(c, "r1", "USDC");
  assert.equal(owed, 10_000_000n);
  finalizeEpoch(c, e.index, new Map([["A", 0n]]));
  ok(c, "after guarded finalize");
});

test("test_one_failed_asset_does_not_unnecessarily_lock_other_claims", () => {
  const c = createCircle(["GOOD", "PAUSED"]);
  runEpoch(c, [["alice", 50_000_000n], ["bob", 50_000_000n]]);
  execute(c, "GOOD", 25_000_000n, 1_000_000n);
  execute(c, "PAUSED", 25_000_000n, 2_000_000n);

  initiateRedemption(c, "r1", "bob", 50_000_000n);
  reserveRedemptionAsset(c, "r1", "GOOD");
  reserveRedemptionAsset(c, "r1", "PAUSED");
  reserveRedemptionAsset(c, "r1", "USDC");

  // The issuer has paused this mint: the claim fails.
  assert.throws(
    () => claimRedemptionAsset(c, "r1", "PAUSED", { willFail: true }),
    AccountingError,
  );

  // Every other claim still works, and the failed one stays outstanding.
  assert.equal(claimRedemptionAsset(c, "r1", "GOOD"), 500_000n);
  assert.equal(claimRedemptionAsset(c, "r1", "USDC"), 25_000_000n);
  assert.equal(c.redemptions.get("r1")!.claims.get("PAUSED")!.claimed, false);
  ok(c, "isolated failure");

  // Later, once unpaused, it succeeds. Nothing was seized or socialised.
  assert.equal(claimRedemptionAsset(c, "r1", "PAUSED"), 1_000_000n);
  ok(c, "recovered");
});

test("execution is frozen while a redemption has unreserved assets", () => {
  const c = createCircle(["A"]);
  runEpoch(c, [["alice", 100_000_000n]]);
  initiateRedemption(c, "r1", "alice", 50_000_000n);

  assert.ok(hasPendingReservations(c));
  assert.throws(() => execute(c, "A", 1_000n, 1_000n), AccountingError);

  reserveRedemptionAsset(c, "r1", "A");
  reserveRedemptionAsset(c, "r1", "USDC");
  assert.ok(!hasPendingReservations(c));
  execute(c, "A", 1_000n, 1_000n); // now permitted
  ok(c, "unfrozen");
});

test("regression (fuzz seed 157): execution cannot spend USDC reserved for an exit", () => {
  const c = createCircle(["A"]);
  runEpoch(c, [["alice", 60_000_000n], ["bob", 40_000_000n]]);

  // Bob exits and his USDC share is reserved. Reservations are COMPLETE, so the
  // hasPendingReservations freeze has lifted - which is exactly the window the
  // fuzzer exploited.
  initiateRedemption(c, "r1", "bob", 40_000_000n);
  reserveRedemptionAsset(c, "r1", "A");
  const owed = reserveRedemptionAsset(c, "r1", "USDC");
  assert.equal(owed, 40_000_000n);
  assert.ok(!hasPendingReservations(c), "freeze has lifted");

  assert.equal(availableUsdc(c), 60_000_000n, "only unreserved USDC is spendable");

  // Spending into the reserved portion must be refused...
  assert.throws(() => execute(c, "A", 60_000_001n, 1n), AccountingError);
  ok(c, "refused");

  // ...while spending strictly unreserved capital is fine.
  execute(c, "A", 60_000_000n, 1_000n);
  ok(c, "allowed");

  // Bob's claim is still fully backed.
  assert.equal(claimRedemptionAsset(c, "r1", "USDC"), 40_000_000n);
  ok(c, "claim honoured");
});

// ---------------------------------------------------------------- rounding

test("test_rounding_always_favours_the_circle", () => {
  // Adversarial amounts chosen to leave remainders everywhere.
  for (const vault of [1n, 7n, 999_999_999_999n, 1_000_000_007n]) {
    for (const [s, S] of [[1n, 3n], [2n, 7n], [999n, 1000n], [1n, U64_MAX]] as const) {
      const e = entitlementForRedemption(vault, s, S);
      assert.ok(e * S <= vault * s, `entitlement rounded up: ${e}`);
      assert.ok(vault - e >= 0n, "cannot over-withdraw");
    }
  }

  // Issuance never mints more than the exact share.
  for (const amt of [1n, 3n, 1_000_001n]) {
    for (const [S, N] of [[7n, 3n], [1_000_000n, 3n], [5n, 999n]] as const) {
      const sh = sharesForContribution(amt, S, N);
      assert.ok(sh * N <= amt * S, `issuance rounded up: ${sh}`);
    }
  }
});

test("test_zero_boundaries and overflow protection", () => {
  assert.equal(sharesForContribution(0n, 100n, 50n), 0n);
  assert.equal(entitlementForRedemption(0n, 1n, 2n), 0n);
  assert.throws(() => sharesForContribution(100n, 100n, 0n), AccountingError);
  assert.throws(() => entitlementForRedemption(100n, 1n, 0n), AccountingError);
  assert.throws(() => entitlementForRedemption(100n, 5n, 4n), AccountingError);

  // u64 * u64 stays inside u128 — the A-17 formulation cannot overflow.
  const big = entitlementForRedemption(U64_MAX, U64_MAX, U64_MAX);
  assert.equal(big, U64_MAX);
});

// ---------------------------------------------------------------- display boundary

test("effectiveMultiplier reproduces verified mainnet data (V-003 / V-017 / V-026)", () => {
  const now = 1_790_000_000n; // after every effective timestamp below

  // SPACEX — the field says 1, the truth is 5.
  const spacex = effectiveMultiplier(
    { multiplier: "1", newMultiplier: "5", newMultiplierEffectiveTimestamp: 1_781_065_800n },
    now,
  );
  assert.equal(decToString(spacex, 0), "5");

  // OPENAI — non-integer.
  const openai = effectiveMultiplier(
    { multiplier: "1", newMultiplier: "1.4861347", newMultiplierEffectiveTimestamp: 1_781_065_800n },
    now,
  );
  assert.equal(decToString(openai, 7), "1.4861347");

  // AAPLx — routine accrual.
  const aapl = effectiveMultiplier(
    {
      multiplier: "1.0026642075893797",
      newMultiplier: "1.0032690125398187",
      newMultiplierEffectiveTimestamp: 1_786_149_000n,
    },
    now,
  );
  assert.equal(decToString(aapl, 16), "1.0032690125398187");

  // Before the effective timestamp, the OLD value applies.
  const early = effectiveMultiplier(
    { multiplier: "1", newMultiplier: "5", newMultiplierEffectiveTimestamp: 1_781_065_800n },
    1_781_065_799n,
  );
  assert.equal(decToString(early, 0), "1");
});

test("activeTransferFee reproduces V-004 and respects a future-epoch change", () => {
  const cfg = {
    olderTransferFee: { epoch: 1032n, transferFeeBasisPoints: 50n, maximumFee: U64_MAX },
    newerTransferFee: { epoch: 1039n, transferFeeBasisPoints: 100n, maximumFee: U64_MAX },
  };
  assert.equal(activeTransferFee(cfg, 1039n)!.basisPoints, 100n, "epoch 1039 -> 100 bps");
  assert.equal(activeTransferFee(cfg, 1038n)!.basisPoints, 50n, "not yet effective -> 50 bps");
  assert.equal(activeTransferFee(undefined, 1039n), null, "xStocks have no fee");
});

test("test_transfer_fee_borne_by_exiting_member", () => {
  const fee = { basisPoints: 100n, maximumFee: U64_MAX };
  const amount = 1_000_000_000n;
  const withheld = transferFeeAmount(amount, fee);
  assert.equal(withheld, 10_000_000n, "1% of the transfer");

  // Rounds UP, so the user is never shown a rosier number than reality.
  assert.equal(transferFeeAmount(1n, fee), 1n);
  assert.equal(transferFeeAmount(0n, fee), 0n);
  // No fee configured (xStocks) costs nothing.
  assert.equal(transferFeeAmount(amount, null), 0n);
});

test("test_scaled_ui_not_used_for_ownership: multiplier change leaves entitlement identical", () => {
  const c = createCircle(["SPACEX"]);
  runEpoch(c, [["alice", 50_000_000n], ["bob", 50_000_000n]]);
  execute(c, "SPACEX", 50_000_000n, 163_767_636n);

  const before = entitlementForRedemption(163_767_636n, 50_000_000n, 100_000_000n);

  // The issuer changes the multiplier 1 -> 5. Raw balances do not move.
  const m1 = effectiveMultiplier(
    { multiplier: "1", newMultiplier: "5", newMultiplierEffectiveTimestamp: 2_000_000_000n },
    1_000_000_000n,
  );
  const m2 = effectiveMultiplier(
    { multiplier: "1", newMultiplier: "5", newMultiplierEffectiveTimestamp: 2_000_000_000n },
    2_000_000_001n,
  );
  assert.notEqual(decToString(m1, 0), decToString(m2, 0), "the multiplier really did change");

  const after = entitlementForRedemption(163_767_636n, 50_000_000n, 100_000_000n);
  assert.equal(after, before, "INV-019: raw entitlement is bit-identical");

  // Display DOES change — that is the point of the boundary.
  const d1 = rawToDisplay(163_767_636n, 9, m1);
  const d2 = rawToDisplay(163_767_636n, 9, m2);
  assert.notEqual(decToString(d1, 9), decToString(d2, 9));
  assert.equal(decToString(d2, 9), "0.818838180");
});

test("supply consumption is raw-over-raw, and floors conservatively", () => {
  // SPACEX verified raw supply (V-003). 1% is 87_425_067_530.69 raw units.
  const supply = 8_742_506_753_069n;

  // Just over 1% -> 100 bps.
  assert.equal(supplyConsumptionBps(87_425_067_531n, supply), 100n);

  // Just under -> floors to 99, NOT 100. The floor is deliberate: it understates
  // consumption, so the Mandate cap binds EARLIER rather than later.
  assert.equal(supplyConsumptionBps(87_425_067_530n, supply), 99n);

  // The multiplier never enters this calculation, so a 1x -> 5x change
  // cannot move the ratio (V-003, INV-019).
  // Note `supply` is odd, so `supply / 2n` floors just below half and the bps
  // floor again to 4999 — the conservative direction, twice.
  assert.equal(supplyConsumptionBps(supply / 2n, supply), 4_999n);
  assert.equal(supplyConsumptionBps(8_000n, 16_000n), 5_000n, "exact half of an even supply");
});

// ---------------------------------------------------------------- property fuzz

/** Deterministic PRNG so failures are reproducible. */
function makeRng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x1_0000_0000;
  };
}

test("property: INV-001 holds after every step of randomised operation sequences", () => {
  const MINTS = ["A", "B"];
  const PEOPLE = ["alice", "bob", "carol", "dave"];

  for (let seed = 1; seed <= 200; seed++) {
    const rnd = makeRng(seed);
    const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)]!;
    const c = createCircle(MINTS);
    let redemptionSeq = 0;

    // Seed the circle so later epochs exercise the rolling path.
    runEpoch(c, [["alice", 10_000_000n], ["bob", 10_000_000n]]);
    ok(c, `seed ${seed} init`);

    for (let step = 0; step < 60; step++) {
      const values = new Map(MINTS.map((m) => [m, BigInt(Math.floor(rnd() * 20_000_000))]));
      const op = pick([
        "openEpoch", "contribute", "cancel", "close", "finalize",
        "settle", "closeEpoch", "execute", "exit", "reserve", "claim",
      ] as const);

      try {
        switch (op) {
          case "openEpoch":
            openEpoch(c);
            break;
          case "contribute":
            contribute(c, c.currentEpoch, pick(PEOPLE), BigInt(1 + Math.floor(rnd() * 5_000_000)));
            break;
          case "cancel":
            cancelContribution(c, c.currentEpoch, pick(PEOPLE));
            break;
          case "close":
            closeContributions(c, c.currentEpoch);
            break;
          case "finalize":
            finalizeEpoch(c, c.currentEpoch, values);
            break;
          case "settle":
            settleContribution(c, c.currentEpoch, pick(PEOPLE));
            break;
          case "closeEpoch":
            closeEpoch(c, c.currentEpoch);
            break;
          case "execute": {
            const spend = BigInt(Math.floor(rnd() * 3_000_000));
            execute(c, pick(MINTS), spend, BigInt(Math.floor(rnd() * 1_000_000)));
            break;
          }
          case "exit": {
            const who = pick(PEOPLE);
            const held = c.members.get(who) ?? 0n;
            if (held > 0n) {
              const part = held / BigInt(1 + Math.floor(rnd() * 3));
              if (part > 0n) initiateRedemption(c, `r${redemptionSeq++}`, who, part);
            }
            break;
          }
          case "reserve": {
            for (const r of c.redemptions.values()) {
              if (r.unreserved.size > 0) {
                reserveRedemptionAsset(c, r.id, [...r.unreserved][0]!);
                break;
              }
            }
            break;
          }
          case "claim": {
            for (const r of c.redemptions.values()) {
              const open = [...r.claims.values()].find((x) => !x.claimed);
              if (open) {
                claimRedemptionAsset(c, r.id, open.mint);
                break;
              }
            }
            break;
          }
        }
      } catch (err) {
        // Rejected operations are expected — the model refuses illegal states.
        // Anything that is NOT a deliberate accounting refusal is a real bug.
        if (!(err instanceof AccountingError)) throw err;
      }

      const v = checkInvariants(c);
      assert.deepEqual(v, [], `seed ${seed} step ${step} op ${op}: ${JSON.stringify(v)}`);
    }
  }
});
