/**
 * Tenet — pure accounting domain model.
 *
 * A chain-free, dependency-free implementation of `docs/accounting.md`. Every
 * quantity is a `bigint` in raw base units. No floating point appears anywhere
 * (RULE 4), and the ScaledUiAmount multiplier appears nowhere at all — it lives
 * only at the display boundary (RULE 3, decision A-09, INV-019).
 *
 * This exists so the arithmetic can be property-tested before a single line of
 * Anchor code is written. The on-chain program must reproduce these results
 * exactly; the same vectors are replayed against it in `tests/invariants`.
 */

// ---------------------------------------------------------------- errors

export class AccountingError extends Error {
  // Written out longhand rather than as a TS parameter property: Node's
  // strip-only type stripping cannot emit runtime code, and keeping the domain
  // model runnable with plain `node --test` (no build step, no bundler) is worth
  // more than the shorthand.
  readonly code: string;

  constructor(code: string, message: string) {
    super(`${code}: ${message}`);
    this.name = "AccountingError";
    this.code = code;
  }
}

export const fail = (code: string, msg: string): never => {
  throw new AccountingError(code, msg);
};

// ---------------------------------------------------------------- constants

/** Shares are u64 with 6 decimals. 1 share = 1 micro-USDC at inception. */
export const SHARE_DECIMALS = 6n;

export const U64_MAX = (1n << 64n) - 1n;
export const U128_MAX = (1n << 128n) - 1n;

/**
 * A Circle whose NAV has collapsed toward zero cannot price new entrants:
 * the share price becomes absurd and rounding pathological. Issuance is
 * refused below this. Exit is never refused (INV-014).
 *
 * 1_000_000 micro-USDC = $1.00. Provisional — see docs/accounting.md §11.
 */
export const MIN_NAV_FOR_ISSUANCE = 1_000_000n;

// ---------------------------------------------------------------- checked math

/** Floor division on non-negative bigints. The only division in this module. */
export function floorDiv(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n) fail("E_DIV_ZERO", "denominator must be positive");
  if (numerator < 0n) fail("E_NEGATIVE", "numerator must be non-negative");
  return numerator / denominator; // bigint division truncates; both operands >= 0
}

/** Multiply in u128 space, trapping on overflow rather than wrapping. */
export function checkedMul(a: bigint, b: bigint): bigint {
  const r = a * b;
  if (r > U128_MAX) fail("E_OVERFLOW", `u128 overflow: ${a} * ${b}`);
  return r;
}

export function checkedAddU64(a: bigint, b: bigint): bigint {
  const r = a + b;
  if (r > U64_MAX) fail("E_OVERFLOW", `u64 overflow: ${a} + ${b}`);
  return r;
}

export function checkedSub(a: bigint, b: bigint): bigint {
  if (b > a) fail("E_UNDERFLOW", `underflow: ${a} - ${b}`);
  return a - b;
}

/** Narrow a u128 intermediate back to u64, refusing rather than truncating. */
export function toU64(v: bigint): bigint {
  if (v < 0n) fail("E_NEGATIVE", `negative: ${v}`);
  if (v > U64_MAX) fail("E_OVERFLOW", `exceeds u64: ${v}`);
  return v;
}

/**
 * Shares owed for a contribution.
 *
 * Epoch 0 (`sharesBefore == 0`) is exact and needs no division:
 *   shares = amount
 *
 * Rolling:
 *   shares = floor(amount * sharesBefore / navBefore)
 *
 * Note this deliberately does NOT use a precomputed fixed-point rate. See
 * docs/accounting.md §4.1 — the rate formulation overflows u128 when NAV has
 * collapsed, which is exactly the state an attacker would contribute into.
 */
export function sharesForContribution(
  amount: bigint,
  sharesBefore: bigint,
  navBefore: bigint,
): bigint {
  if (amount < 0n) fail("E_NEGATIVE", "amount must be non-negative");
  if (sharesBefore === 0n) return amount; // Epoch 0
  if (navBefore <= 0n) fail("E_ZERO_NAV", "cannot price entrants at zero NAV");
  return toU64(floorDiv(checkedMul(amount, sharesBefore), navBefore));
}

/**
 * Raw entitlement to one asset for a redemption.
 *
 * `available` must already have existing reservations subtracted, otherwise
 * concurrent redeemers are over-allocated (docs/accounting.md §6).
 */
export function entitlementForRedemption(
  available: bigint,
  sharesRedeemed: bigint,
  totalSharesAtSnapshot: bigint,
): bigint {
  if (totalSharesAtSnapshot <= 0n) fail("E_DIV_ZERO", "no shares outstanding");
  if (sharesRedeemed > totalSharesAtSnapshot)
    fail("E_TOO_MANY_SHARES", "redeeming more than total");
  if (available < 0n) fail("E_NEGATIVE", "available must be non-negative");
  return toU64(
    floorDiv(checkedMul(available, sharesRedeemed), totalSharesAtSnapshot),
  );
}

/**
 * Weight of a position in basis points of NAV. Floors.
 *
 * Mirrors `weight_bps` in programs/tenet/src/math.rs; until U-12 the Rust
 * function had no counterpart here, so nothing modelled it.
 */
export function weightBps(positionValue: bigint, nav: bigint): bigint {
  if (nav <= 0n) fail("E_ZERO_NAV", "cannot weigh against zero NAV");
  return toU64(floorDiv(checkedMul(positionValue, 10_000n), nav));
}

// ---------------------------------------------------------------- state

export type EpochPhase =
  | "Open"
  | "Closed"
  | "Finalized"
  | "Completed"
  | "Cancelled";

export interface Receipt {
  owner: string;
  amount: bigint;
  settled: boolean;
}

export interface Epoch {
  index: number;
  phase: EpochPhase;
  pendingUsdc: bigint;
  receipts: Map<string, Receipt>;
  /** Frozen at finalization; makes settlement reproducible and order-independent. */
  totalSharesBefore: bigint;
  navBefore: bigint;
  reservedShares: bigint;
  settledShares: bigint;
  settledCount: number;
}

export interface AssetState {
  mint: string;
  /** Canonical raw balance. The multiplier never touches this. */
  vault: bigint;
  reservedForRedemption: bigint;
}

export interface RedemptionAssetClaim {
  mint: string;
  amount: bigint;
  claimed: boolean;
}

export interface Redemption {
  id: string;
  owner: string;
  sharesRedeemed: bigint;
  totalSharesAtSnapshot: bigint;
  claims: Map<string, RedemptionAssetClaim>;
  /** Mints not yet reserved. Execution is frozen while any remain. */
  unreserved: Set<string>;
}

export interface Circle {
  totalShares: bigint;
  /** Derived aggregate: Σ over open epochs (reserved − settled). Decision A-14. */
  reservedShares: bigint;
  members: Map<string, bigint>;
  activeUsdc: bigint;
  /** Physically separate from activeUsdc — this is what makes INV-002 structural. */
  escrow: Map<number, bigint>;
  assets: Map<string, AssetState>;
  epochs: Map<number, Epoch>;
  redemptions: Map<string, Redemption>;
  currentEpoch: number;
}

export function createCircle(mints: string[] = []): Circle {
  return {
    totalShares: 0n,
    reservedShares: 0n,
    members: new Map(),
    activeUsdc: 0n,
    escrow: new Map(),
    assets: new Map(mints.map((m) => [m, { mint: m, vault: 0n, reservedForRedemption: 0n }])),
    epochs: new Map(),
    redemptions: new Map(),
    currentEpoch: 0,
  };
}

const epochOrFail = (c: Circle, i: number): Epoch =>
  c.epochs.get(i) ?? fail("E_NO_EPOCH", `epoch ${i} does not exist`);

/** USDC already promised to exiting members and not yet claimed. */
function usdcReserved(c: Circle): bigint {
  let total = 0n;
  for (const r of c.redemptions.values()) {
    const claim = r.claims.get("USDC");
    if (claim && !claim.claimed) total += claim.amount;
  }
  return total;
}

/** Active USDC that execution is actually allowed to spend. */
export function availableUsdc(c: Circle): bigint {
  return checkedSub(c.activeUsdc, usdcReserved(c));
}

/** True while any redemption still has unreserved assets — execution is frozen. */
export function hasPendingReservations(c: Circle): boolean {
  for (const r of c.redemptions.values()) if (r.unreserved.size > 0) return true;
  return false;
}

// ---------------------------------------------------------------- pool

export function openEpoch(c: Circle): Epoch {
  const prev = c.epochs.get(c.currentEpoch - 1);
  if (prev && prev.phase !== "Completed" && prev.phase !== "Cancelled")
    fail("E_PREV_EPOCH_OPEN", `epoch ${prev.index} is ${prev.phase}`);
  if (c.epochs.has(c.currentEpoch))
    fail("E_EPOCH_EXISTS", `epoch ${c.currentEpoch} already open`);

  const e: Epoch = {
    index: c.currentEpoch,
    phase: "Open",
    pendingUsdc: 0n,
    receipts: new Map(),
    totalSharesBefore: 0n,
    navBefore: 0n,
    reservedShares: 0n,
    settledShares: 0n,
    settledCount: 0,
  };
  c.epochs.set(e.index, e);
  c.escrow.set(e.index, 0n);
  return e;
}

/** USDC goes to the epoch escrow — never to activeUsdc. */
export function contribute(c: Circle, epochIndex: number, owner: string, amount: bigint): void {
  const e = epochOrFail(c, epochIndex);
  if (e.phase !== "Open") fail("E_EPOCH_NOT_OPEN", `epoch is ${e.phase}`);
  if (amount <= 0n) fail("E_ZERO_AMOUNT", "contribution must be positive");

  const r = e.receipts.get(owner) ?? { owner, amount: 0n, settled: false };
  if (r.settled) fail("E_ALREADY_SETTLED", "receipt already settled");
  r.amount = checkedAddU64(r.amount, amount);
  e.receipts.set(owner, r);

  e.pendingUsdc = checkedAddU64(e.pendingUsdc, amount);
  c.escrow.set(epochIndex, checkedAddU64(c.escrow.get(epochIndex) ?? 0n, amount));
}

/** Member-initiated. No admin approval exists in this path. */
export function cancelContribution(c: Circle, epochIndex: number, owner: string): bigint {
  const e = epochOrFail(c, epochIndex);
  if (e.phase !== "Open" && e.phase !== "Cancelled")
    fail("E_EPOCH_NOT_CANCELLABLE", `epoch is ${e.phase}`);
  const r = e.receipts.get(owner) ?? fail("E_NO_RECEIPT", "no receipt");
  if (r.settled) fail("E_ALREADY_SETTLED", "already settled");

  const refund = r.amount;
  e.receipts.delete(owner);
  e.pendingUsdc = checkedSub(e.pendingUsdc, refund);
  c.escrow.set(epochIndex, checkedSub(c.escrow.get(epochIndex) ?? 0n, refund));
  return refund;
}

export function closeContributions(c: Circle, epochIndex: number): void {
  const e = epochOrFail(c, epochIndex);
  if (e.phase !== "Open") fail("E_EPOCH_NOT_OPEN", `epoch is ${e.phase}`);
  e.phase = "Closed";
}

/**
 * `assetValues` maps mint -> realizable value in micro-USDC. Supplied by the
 * caller here because valuation is an oracle concern; on-chain it comes from a
 * NavSnapshot that validated each price. Pending escrow is excluded, and so are
 * tokens already reserved for redemption.
 */
export function activeNav(c: Circle, assetValues: Map<string, bigint>): bigint {
  // Redemption claims are fixed obligations, not active Circle value.  New
  // entrants must be priced only against what remains available after those
  // obligations, just as execution is limited to availableUsdc().
  let nav = availableUsdc(c);
  for (const a of c.assets.values()) {
    const v = assetValues.get(a.mint);
    // `return` so the compiler narrows `v`: `fail` is a const arrow returning
    // `never`, which TypeScript does not use for narrowing on its own.
    if (v === undefined) return fail("E_MISSING_PRICE", `no value for ${a.mint}`);
    if (v < 0n) fail("E_NEGATIVE", "asset value must be non-negative");
    if (a.reservedForRedemption > a.vault) {
      fail("E_UNDERFLOW", `reserved ${a.reservedForRedemption} exceeds vault ${a.vault}`);
    }

    // assetValues is the current value of the whole raw vault.  Convert the
    // already-reserved raw portion at that same boundary, then exclude it.
    // Ownership and redemption remain raw-unit canonical; this is valuation
    // arithmetic only.
    const reservedValue =
      a.vault === 0n
        ? 0n
        : floorDiv(checkedMul(v, a.reservedForRedemption), a.vault);
    nav += checkedSub(v, reservedValue);
  }
  return nav;
}

export function finalizeEpoch(
  c: Circle,
  epochIndex: number,
  assetValues: Map<string, bigint>,
): void {
  const e = epochOrFail(c, epochIndex);
  if (e.phase !== "Closed") fail("E_EPOCH_NOT_CLOSED", `epoch is ${e.phase}`);
  // A-22 inflow guard: sweeping new USDC into active capital while an exit is
  // unreserved would let that exit claim a slice of the newcomers' money, since
  // its share denominator was snapshotted before the money arrived.
  if (hasPendingReservations(c))
    fail("E_REDEMPTION_PENDING", "an exit has unreserved assets; reserve them first");

  const nav = activeNav(c, assetValues);

  // A Circle with shares outstanding but no value cannot price entrants.
  if (c.totalShares > 0n && nav < MIN_NAV_FOR_ISSUANCE) {
    e.phase = "Cancelled"; // contributors recover escrow; exit stays open
    return;
  }

  e.totalSharesBefore = c.totalShares;
  e.navBefore = nav;

  const reserved = sharesForContribution(e.pendingUsdc, c.totalShares, nav);
  e.reservedShares = reserved;

  c.totalShares = checkedAddU64(c.totalShares, reserved);
  c.reservedShares = checkedAddU64(c.reservedShares, reserved);

  // Sweep escrow into active capital.
  const swept = c.escrow.get(epochIndex) ?? 0n;
  c.activeUsdc = checkedAddU64(c.activeUsdc, swept);
  c.escrow.set(epochIndex, 0n);

  e.phase = "Finalized";
}

/** Permissionless. Cannot increase totalShares — only move reserved -> claimed. */
export function settleContribution(c: Circle, epochIndex: number, owner: string): bigint {
  const e = epochOrFail(c, epochIndex);
  if (e.phase !== "Finalized" && e.phase !== "Completed")
    fail("E_EPOCH_NOT_FINALIZED", `epoch is ${e.phase}`);
  const r = e.receipts.get(owner) ?? fail("E_NO_RECEIPT", "no receipt");
  if (r.settled) fail("E_ALREADY_SETTLED", "already settled");

  const shares = sharesForContribution(r.amount, e.totalSharesBefore, e.navBefore);

  r.settled = true;
  e.settledShares += shares;
  e.settledCount += 1;

  c.members.set(owner, (c.members.get(owner) ?? 0n) + shares);
  c.reservedShares = checkedSub(c.reservedShares, shares);
  return shares;
}

/** Releases the rounding residue so dust cannot sit in the denominator forever. */
export function closeEpoch(c: Circle, epochIndex: number): bigint {
  const e = epochOrFail(c, epochIndex);
  if (e.phase !== "Finalized") fail("E_EPOCH_NOT_FINALIZED", `epoch is ${e.phase}`);
  const unsettled = [...e.receipts.values()].filter((r) => !r.settled).length;
  if (unsettled > 0) fail("E_UNSETTLED_RECEIPTS", `${unsettled} receipts unsettled`);

  const residue = checkedSub(e.reservedShares, e.settledShares);
  c.totalShares = checkedSub(c.totalShares, residue);
  c.reservedShares = checkedSub(c.reservedShares, residue);
  e.phase = "Completed";
  c.currentEpoch = epochIndex + 1;
  return residue;
}

// ---------------------------------------------------------------- execute

/**
 * Spend active USDC to acquire an asset. Models only the accounting effect of a
 * verified execution — the on-chain instruction additionally proves the real
 * vault deltas and every Mandate cap (docs/instructions.md §5).
 */
export function execute(c: Circle, mint: string, spendUsdc: bigint, receiveRaw: bigint): void {
  if (hasPendingReservations(c))
    fail("E_RESERVATIONS_PENDING", "execution frozen while a redemption is unreserved");
  const a = c.assets.get(mint) ?? fail("E_NO_ASSET", `${mint} not in circle`);

  // Execution may only spend UNRESERVED capital.
  //
  // Found by the property fuzzer (seed 157): freezing execution while a
  // redemption is *unreserved* is not sufficient. Once reservations complete the
  // freeze lifts, but the reserved USDC is still owed to the exiting member — so
  // an execution could spend it and leave the claim unbackable, violating INV-004.
  //
  // The architecture already required `vault - reserved` for assets; the USDC
  // vault needs exactly the same treatment.
  const availableUsdc = checkedSub(c.activeUsdc, usdcReserved(c));
  if (spendUsdc > availableUsdc)
    fail(
      "E_INSUFFICIENT_UNRESERVED_USDC",
      `spend ${spendUsdc} exceeds unreserved ${availableUsdc}`,
    );

  c.activeUsdc = checkedSub(c.activeUsdc, spendUsdc);
  a.vault = checkedAddU64(a.vault, receiveRaw);
}

// ---------------------------------------------------------------- exit

/** Burns shares immediately and freezes the entitlement. No price, no oracle. */
export function initiateRedemption(
  c: Circle,
  id: string,
  owner: string,
  shares: bigint,
): Redemption {
  if (c.redemptions.has(id)) fail("E_REDEMPTION_EXISTS", id);
  // A-22 / REVIEW.md H-02. Exits are serialized: a second exit cannot start
  // while an earlier one still has unreserved assets. Otherwise the later exit
  // is sized against a vault that still holds the earlier exiter's unreserved
  // portion, and whichever reserves FIRST takes value from the other.
  // Reservation is permissionless and moves no tokens (it cannot be blocked by
  // an issuer), so anyone can always push a pending exit through.
  if (hasPendingReservations(c))
    fail("E_REDEMPTION_PENDING", "another exit has unreserved assets; reserve them first");
  const held = c.members.get(owner) ?? 0n;
  if (shares <= 0n) fail("E_ZERO_SHARES", "must redeem a positive amount");
  if (shares > held) fail("E_INSUFFICIENT_SHARES", `${owner} holds ${held}`);

  const r: Redemption = {
    id,
    owner,
    sharesRedeemed: shares,
    totalSharesAtSnapshot: c.totalShares,
    claims: new Map(),
    unreserved: new Set([...c.assets.keys(), "USDC"]),
  };

  c.members.set(owner, checkedSub(held, shares));
  c.totalShares = checkedSub(c.totalShares, shares);
  c.redemptions.set(id, r);
  return r;
}

/** Permissionless — anyone may complete anyone's reservations (R-20). */
export function reserveRedemptionAsset(c: Circle, id: string, mint: string): bigint {
  const r = c.redemptions.get(id) ?? fail("E_NO_REDEMPTION", id);
  if (!r.unreserved.has(mint)) fail("E_ALREADY_RESERVED", mint);

  let entitled: bigint;
  if (mint === "USDC") {
    // Escrow is excluded: it is not Circle capital yet (INV-002).
    const available = checkedSub(c.activeUsdc, usdcReserved(c));
    entitled = entitlementForRedemption(available, r.sharesRedeemed, r.totalSharesAtSnapshot);
  } else {
    const a = c.assets.get(mint) ?? fail("E_NO_ASSET", mint);
    const available = checkedSub(a.vault, a.reservedForRedemption);
    entitled = entitlementForRedemption(available, r.sharesRedeemed, r.totalSharesAtSnapshot);
    a.reservedForRedemption = checkedAddU64(a.reservedForRedemption, entitled);
  }

  r.claims.set(mint, { mint, amount: entitled, claimed: false });
  r.unreserved.delete(mint);
  return entitled;
}

/**
 * Transfers one asset out. A failure here is isolated to this claim: the claim
 * stays open and every other asset remains claimable (spec §65).
 */
export function claimRedemptionAsset(
  c: Circle,
  id: string,
  mint: string,
  opts: { willFail?: boolean } = {},
): bigint {
  const r = c.redemptions.get(id) ?? fail("E_NO_REDEMPTION", id);
  const claim = r.claims.get(mint) ?? fail("E_NOT_RESERVED", mint);
  if (claim.claimed) fail("E_ALREADY_CLAIMED", mint);

  // Models an issuer-side rejection: paused mint, frozen account, transfer hook.
  if (opts.willFail) fail("E_TRANSFER_REJECTED", `${mint} transfer rejected by issuer`);

  if (mint === "USDC") {
    c.activeUsdc = checkedSub(c.activeUsdc, claim.amount);
  } else {
    const a = c.assets.get(mint) ?? fail("E_NO_ASSET", mint);
    a.vault = checkedSub(a.vault, claim.amount);
    a.reservedForRedemption = checkedSub(a.reservedForRedemption, claim.amount);
  }
  claim.claimed = true;
  return claim.amount;
}

// ---------------------------------------------------------------- invariants

export interface InvariantViolation {
  id: string;
  detail: string;
}

/** Asserted after every step of the property harness. */
export function checkInvariants(c: Circle): InvariantViolation[] {
  const v: InvariantViolation[] = [];

  // INV-001: Σ member.shares + circle.reservedShares == circle.totalShares
  let claimed = 0n;
  for (const s of c.members.values()) claimed += s;
  if (claimed + c.reservedShares !== c.totalShares) {
    v.push({
      id: "INV-001",
      detail: `claimed ${claimed} + reserved ${c.reservedShares} != total ${c.totalShares}`,
    });
  }

  // reservedShares must equal the independently recomputed per-epoch sum.
  // Catches drift in the derived aggregate rather than trusting it (A-14).
  let perEpoch = 0n;
  for (const e of c.epochs.values()) {
    if (e.phase === "Finalized") perEpoch += e.reservedShares - e.settledShares;
  }
  if (perEpoch !== c.reservedShares) {
    v.push({
      id: "INV-001b",
      detail: `aggregate ${c.reservedShares} != per-epoch sum ${perEpoch}`,
    });
  }

  // INV-002: escrow is never spendable as Circle capital.
  for (const [i, amt] of c.escrow) {
    if (amt < 0n) v.push({ id: "INV-002", detail: `escrow[${i}] negative: ${amt}` });
  }

  // INV-004: reservations can never exceed the vault that backs them.
  for (const a of c.assets.values()) {
    if (a.reservedForRedemption > a.vault) {
      v.push({
        id: "INV-004",
        detail: `${a.mint}: reserved ${a.reservedForRedemption} > vault ${a.vault}`,
      });
    }
    if (a.vault < 0n) v.push({ id: "INV-004", detail: `${a.mint}: negative vault` });
  }
  if (usdcReserved(c) > c.activeUsdc) {
    v.push({ id: "INV-004", detail: `USDC reserved ${usdcReserved(c)} > active ${c.activeUsdc}` });
  }

  // No negative balances anywhere.
  if (c.activeUsdc < 0n) v.push({ id: "INV-000", detail: "negative activeUsdc" });
  if (c.totalShares < 0n) v.push({ id: "INV-000", detail: "negative totalShares" });
  if (c.reservedShares < 0n) v.push({ id: "INV-000", detail: "negative reservedShares" });
  for (const [o, s] of c.members) {
    if (s < 0n) v.push({ id: "INV-000", detail: `member ${o} negative shares` });
  }

  // INV-021 (A-22, REVIEW.md H-02): at most one exit may have unreserved
  // assets at a time. Two concurrently-unreserved exits is exactly the state in
  // which reservation order moves value from one exiter to another.
  const unreserved = [...c.redemptions.values()].filter((r) => r.unreserved.size > 0).length;
  if (unreserved > 1) {
    v.push({ id: "INV-021", detail: `${unreserved} exits have unreserved assets concurrently` });
  }

  return v;
}

/** Per-share backing of one asset, scaled to avoid a division that would floor to zero. */
export function backingPerShare(vault: bigint, totalShares: bigint, scale = 10n ** 18n): bigint {
  if (totalShares === 0n) return 0n;
  return floorDiv(checkedMul(vault, scale), totalShares);
}
