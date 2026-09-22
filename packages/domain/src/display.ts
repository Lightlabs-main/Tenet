/**
 * Tenet — the display / valuation boundary.
 *
 * This is the ONLY module where token decimals and the Token-2022
 * ScaledUiAmount multiplier are allowed to appear. Nothing here feeds back into
 * ownership, redemption or supply accounting (RULE 3, INV-019).
 *
 * Both functions below exist because the naive reading of each field is wrong
 * against real mainnet data:
 *   V-003/V-017/V-026 — `multiplier` is stale; `newMultiplier` is effective
 *   V-004             — `newerTransferFee` applies only once its epoch arrives
 */

import { fail, floorDiv, checkedMul, toU64 } from "./accounting.ts";

// ---------------------------------------------------------------- exact decimal

/** An exact decimal as mantissa + scale. No float, ever. */
export interface Dec {
  mant: bigint;
  scale: number;
}

export function dec(s: string | bigint | number): Dec {
  const t = String(s).trim();
  if (/[eE]/.test(t)) throw new Error(`refusing exponent-form number: ${t}`);
  if (!/^-?\d+(\.\d+)?$/.test(t)) throw new Error(`not a decimal: ${t}`);
  const neg = t.startsWith("-");
  const body = neg ? t.slice(1) : t;
  const [int, frac = ""] = body.split(".");
  return { mant: BigInt((neg ? "-" : "") + (int || "0") + frac), scale: frac.length };
}

export function decMul(a: Dec, b: Dec): Dec {
  return { mant: a.mant * b.mant, scale: a.scale + b.scale };
}

/** Render with `places` decimals, truncating toward zero. */
export function decToString(d: Dec, places: number): string {
  const neg = d.mant < 0n;
  let m = neg ? -d.mant : d.mant;
  if (places > d.scale) {
    m *= 10n ** BigInt(places - d.scale);
  } else if (places < d.scale) {
    m /= 10n ** BigInt(d.scale - places);
  }
  const s = m.toString().padStart(places + 1, "0");
  const whole = s.slice(0, s.length - places) || "0";
  const frac = places > 0 ? "." + s.slice(s.length - places) : "";
  return (neg ? "-" : "") + whole + frac;
}

// ---------------------------------------------------------------- mint state

export interface ScaledUiAmountConfig {
  multiplier: string;
  newMultiplier: string;
  newMultiplierEffectiveTimestamp: bigint;
}

export interface TransferFeeTier {
  epoch: bigint;
  transferFeeBasisPoints: bigint;
  maximumFee: bigint;
}

export interface TransferFeeConfig {
  olderTransferFee: TransferFeeTier;
  newerTransferFee: TransferFeeTier;
}

/**
 * The effective ScaledUiAmount multiplier.
 *
 * Reading `multiplier` alone is wrong. Verified on mainnet, every mint examined
 * with a non-trivial multiplier had `multiplier` stale and `newMultiplier`
 * already effective — SPACEX (5 vs 1), OPENAI (1.4861347 vs 1), and the xStocks,
 * where it is a recurring ~monthly accrual rather than a corporate action (V-026).
 */
export function effectiveMultiplier(
  cfg: ScaledUiAmountConfig | undefined,
  nowUnixSeconds: bigint,
): Dec {
  if (!cfg) return dec("1");
  return nowUnixSeconds >= cfg.newMultiplierEffectiveTimestamp
    ? dec(cfg.newMultiplier)
    : dec(cfg.multiplier);
}

/**
 * The transfer fee actually in force.
 *
 * Picking `newerTransferFee` unconditionally is wrong whenever the change is
 * scheduled for a future epoch.
 */
export function activeTransferFee(
  cfg: TransferFeeConfig | undefined,
  currentEpoch: bigint,
): { basisPoints: bigint; maximumFee: bigint } | null {
  if (!cfg) return null;
  const tier =
    currentEpoch >= cfg.newerTransferFee.epoch ? cfg.newerTransferFee : cfg.olderTransferFee;
  return { basisPoints: tier.transferFeeBasisPoints, maximumFee: tier.maximumFee };
}

/**
 * Fee withheld on a transfer of `amountRaw`.
 *
 * Rounds UP — the one deliberate exception to floor-toward-the-Circle. The user
 * is shown the worst case rather than a pleasant surprise (docs/accounting.md §7).
 */
export function transferFeeAmount(
  amountRaw: bigint,
  fee: { basisPoints: bigint; maximumFee: bigint } | null,
): bigint {
  if (!fee || fee.basisPoints === 0n) return 0n;
  const numerator = amountRaw * fee.basisPoints;
  const ceilDiv = numerator === 0n ? 0n : (numerator - 1n) / 10_000n + 1n;
  return ceilDiv > fee.maximumFee ? fee.maximumFee : ceilDiv;
}

/**
 * Raw base units -> human-readable quantity.
 *
 * The output of this function must never re-enter ownership accounting.
 */
export function rawToDisplay(rawAmount: bigint, decimals: number, multiplier: Dec): Dec {
  return decMul({ mant: rawAmount, scale: decimals }, multiplier);
}

/** Supply consumption in bps, computed raw-over-raw so the multiplier cancels. */
export function supplyConsumptionBps(vaultRaw: bigint, mintSupplyRaw: bigint): bigint {
  // Same failure codes and u64 narrowing as `supply_consumption_bps` in
  // programs/tenet/src/math.rs — checked by the shared vectors (U-12).
  if (mintSupplyRaw <= 0n) fail("E_DIV_ZERO", "supply must be positive");
  return toU64(floorDiv(checkedMul(vaultRaw, 10_000n), mintSupplyRaw));
}
