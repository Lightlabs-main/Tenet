/**
 * Amounts in the UI. RULE 4 / V-018: a money value NEVER passes through a
 * JavaScript `number`. User input is parsed from its string form by the
 * domain's exact decimal parser; raw values are formatted from `bigint`.
 */
import { dec, decToString } from "../../../packages/domain/src/display.ts";

/**
 * "5.25" with 6 decimals -> 5_250_000n. Refuses negatives, exponent form, and
 * more fractional digits than the token has (rather than silently rounding).
 */
export function parseAmount(input: string, decimals: number): bigint {
  const d = dec(input.trim()); // throws on anything that is not a plain decimal
  if (d.mant < 0n) throw new Error("amount must be positive");
  if (d.scale > decimals) throw new Error(`at most ${decimals} decimal places`);
  return d.mant * 10n ** BigInt(decimals - d.scale);
}

/** 5_250_000n with 6 decimals -> "5.250000". */
export function formatRaw(raw: bigint, decimals: number): string {
  return decToString({ mant: raw, scale: decimals }, decimals);
}

/** Shares: 6 decimals, 1 share = 1 micro-USDC at Epoch 0. */
export const formatShares = (raw: bigint) => formatRaw(raw, 6);
