/**
 * Shared arithmetic vectors — U-12.
 *
 * The TypeScript domain model is the reference. This module turns it into a
 * table of `(function, arguments) -> result | error` cases, which
 * programs/tenet/src/math_vectors.rs replays against the on-chain math. If the
 * two ever disagree on a single case, the property-tested model stops being
 * evidence about the deployed code (REVIEW.md U-12).
 *
 * Deterministic: a fixed-seed PRNG, so the committed file can be regenerated
 * byte-for-byte and checked for drift.
 */
import {
  AccountingError,
  sharesForContribution,
  entitlementForRedemption,
  weightBps,
  U64_MAX,
  U128_MAX,
} from "../src/accounting.ts";
import { supplyConsumptionBps, transferFeeAmount } from "../src/display.ts";

/** TS failure code -> Rust `TenetError` variant name. */
const RUST_ERROR: Record<string, string> = {
  E_ZERO_NAV: "ZeroNav",
  E_DIV_ZERO: "DivisionByZero",
  E_TOO_MANY_SHARES: "InsufficientShares",
  E_OVERFLOW: "MathOverflow",
};

export interface Vector {
  fn: string;
  args: string[];
  ok?: string;
  err?: string;
}

const SEED = 0x7e4e72026n;

/** splitmix64 over bigint. */
function rng(seed: bigint) {
  let s = seed & U64_MAX;
  return (): bigint => {
    s = (s + 0x9e3779b97f4a7c15n) & U64_MAX;
    let z = s;
    z = ((z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n) & U64_MAX;
    z = ((z ^ (z >> 27n)) * 0x94d049bb133111ebn) & U64_MAX;
    return z ^ (z >> 31n);
  };
}

const U64_EDGES = [
  0n, 1n, 2n, 9_999n, 10_000n, 10_001n,
  1_000_000n, // $1 in micro-USDC, MIN_NAV_FOR_ISSUANCE
  (1n << 32n) - 1n, 1n << 32n, (1n << 32n) + 1n,
  (1n << 53n) + 1n, // first integer a JS number cannot hold
  (1n << 63n) - 1n, 1n << 63n,
  U64_MAX - 1n, U64_MAX,
];

function sampleU64(next: () => bigint): bigint {
  switch (Number(next() % 5n)) {
    case 0: return U64_EDGES[Number(next() % BigInt(U64_EDGES.length))];
    case 1: return next() % 1_000n;             // tiny
    case 2: return next() % 100_000_000_000n;   // realistic: up to $100k
    case 3: return next() >> (next() % 64n);    // any magnitude
    default: return next();                     // full width
  }
}

function sampleU128(next: () => bigint): bigint {
  switch (Number(next() % 4n)) {
    case 0: return sampleU64(next);
    case 1: return ((next() << 64n) | next()) >> (next() % 128n);
    case 2: return U128_MAX - (next() % 3n);
    default: return next() % 10n; // near-zero NAV, the collapsed-Circle case (A-17)
  }
}

function run(fn: string, args: bigint[], f: () => bigint): Vector {
  const v: Vector = { fn, args: args.map(String) };
  try {
    v.ok = f().toString();
  } catch (e) {
    if (!(e instanceof AccountingError)) throw e;
    const name = RUST_ERROR[e.code];
    if (!name) throw new Error(`no Rust mapping for ${e.code} in ${fn}(${args.join(", ")})`);
    v.err = name;
  }
  return v;
}

export function generateVectors(perFunction = 400): Vector[] {
  const next = rng(SEED);
  const out: Vector[] = [];

  const shares = (a: bigint, s: bigint, n: bigint) =>
    out.push(run("shares_for_contribution", [a, s, n], () => sharesForContribution(a, s, n)));
  const entitle = (a: bigint, r: bigint, t: bigint) =>
    out.push(run("entitlement_for_redemption", [a, r, t], () => entitlementForRedemption(a, r, t)));
  const supply = (v: bigint, s: bigint) =>
    out.push(run("supply_consumption_bps", [v, s], () => supplyConsumptionBps(v, s)));
  const weight = (p: bigint, n: bigint) =>
    out.push(run("weight_bps", [p, n], () => weightBps(p, n)));
  const fee = (a: bigint, b: bigint, m: bigint) =>
    out.push(run("transfer_fee_amount", [a, b, m], () =>
      transferFeeAmount(a, { basisPoints: b, maximumFee: m })));

  // ---- hand-picked: every branch at least once -----------------------------
  shares(30_000_000n, 0n, 0n);                      // epoch 0, exact
  shares(1n, 5n, 0n);                               // zero NAV refused
  shares(U64_MAX, U64_MAX, 1n);                     // result exceeds u64
  shares(U64_MAX, U64_MAX, U128_MAX);               // widest operands, floors to 0
  shares(10_000_000n, 100_000_000n, 125_000_000n);  // accounting.md worked example

  entitle(100n, 1n, 0n);                            // no shares outstanding
  entitle(100n, 6n, 5n);                            // more than total
  entitle(U64_MAX, U64_MAX, U64_MAX);               // everything, exactly
  entitle(99n, 1n, 100n);                           // dust stays in the Circle

  supply(1n, 0n);                                   // zero supply
  supply(U64_MAX, 1n);                              // exceeds u64
  supply(99n, 10_000n);                             // floors to 0 (conservative)

  weight(1n, 0n);
  weight(U128_MAX, 1n);                             // u128 multiply overflow
  weight(U64_MAX, 1n);                              // fits u128, exceeds u64

  fee(0n, 100n, U64_MAX);
  fee(1n, 1n, U64_MAX);                             // rounds UP to 1
  fee(10_000n, 100n, 50n);                          // capped at maximum
  fee(U64_MAX, 10_000n, U64_MAX);                   // 100% fee on the whole range
  fee(123n, 0n, 7n);

  // ---- seeded random -------------------------------------------------------
  for (let i = 0; i < perFunction; i++) {
    shares(sampleU64(next), sampleU64(next), sampleU128(next));

    const total = sampleU64(next);
    // Mostly valid redemptions; one in eight asks for one share too many.
    let redeemed = total === 0n ? 0n : next() % (total + 1n);
    if (next() % 8n === 0n && total < U64_MAX) redeemed = total + 1n;
    entitle(sampleU64(next), redeemed, total);

    supply(sampleU64(next), sampleU64(next));
    weight(sampleU128(next), sampleU128(next));
    fee(sampleU64(next), next() % 10_001n, sampleU64(next));
  }
  return out;
}

export function serialize(vectors: Vector[]): string {
  return JSON.stringify({
    _comment:
      "GENERATED by scripts/gen-math-vectors.ts from packages/domain. Do not edit. " +
      "Replayed by programs/tenet/src/math_vectors.rs (U-12).",
    count: vectors.length,
    vectors,
  }, null, 1) + "\n";
}
