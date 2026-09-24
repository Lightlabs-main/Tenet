/**
 * Tenet VALUE boundary.
 *
 * This module consumes verified observations; it never creates them and never
 * feeds a calculated value back into ownership, redemption, or supply state.
 * Every amount stays exact: Pyth's integer price/exponent, Token-2022 display
 * scaling, confidence, and premium/discount arithmetic are all bigint/Dec.
 */

import { decMul, rawToDisplay, type Dec } from "./display.ts";

export interface PythObservation {
  /** Pyth's signed integer price, before applying `expo`. */
  price: bigint;
  /** Pyth exponent. Negative values represent decimal places. */
  expo: number;
  /** Pyth confidence interval, expressed with the same exponent. */
  confidence: bigint;
  publishTime: bigint;
  slot: bigint;
}

export interface PriceObservation {
  price: Dec;
  confidence: Dec;
  publishTime: bigint;
  slot: bigint;
}

export interface FreshnessPolicy {
  nowUnixSeconds: bigint;
  maxAgeSeconds: bigint;
}

export interface PriceAvailability {
  available: boolean;
  reason?: "missing" | "stale" | "future" | "invalid";
}

export interface PairedFeedComparison extends PriceAvailability {
  underlying?: PriceObservation;
  tokenized?: PriceObservation;
  difference?: Dec;
  differenceBps?: bigint;
  confidenceBps?: { underlying: bigint; tokenized: bigint };
}

export interface PreStocksMarketMark {
  marketPrice: Dec;
  issuerReferenceMark: Dec;
  premiumDiscountBps: bigint;
  marketImpliedValue?: Dec;
  referenceValue?: Dec;
}

function pow10(exp: number): bigint {
  if (!Number.isInteger(exp) || exp < 0 || exp > 36) {
    throw new RangeError(`decimal exponent out of supported range: ${exp}`);
  }
  return 10n ** BigInt(exp);
}

function align(a: Dec, b: Dec): [bigint, bigint, number] {
  const scale = Math.max(a.scale, b.scale);
  return [a.mant * pow10(scale - a.scale), b.mant * pow10(scale - b.scale), scale];
}

function decSub(a: Dec, b: Dec): Dec {
  const [am, bm, scale] = align(a, b);
  return { mant: am - bm, scale };
}

function bpsFromRatio(numerator: Dec, denominator: Dec): bigint {
  if (denominator.mant <= 0n) throw new RangeError("ratio denominator must be positive");
  const [nm, dm] = align(numerator, denominator);
  return (nm * 10_000n) / dm;
}

/** Convert Pyth's integer price/exponent pair without going through Number. */
export function pythPrice(observation: PythObservation): PriceObservation {
  if (!Number.isInteger(observation.expo) || observation.expo < -36 || observation.expo > 18) {
    throw new RangeError(`unsupported Pyth exponent: ${observation.expo}`);
  }
  if (observation.price <= 0n || observation.confidence < 0n) {
    throw new RangeError("Pyth price must be positive and confidence non-negative");
  }
  const scale = observation.expo < 0 ? -observation.expo : 0;
  const factor = observation.expo > 0 ? pow10(observation.expo) : 1n;
  return {
    price: { mant: observation.price * factor, scale },
    confidence: { mant: observation.confidence * factor, scale },
    publishTime: observation.publishTime,
    slot: observation.slot,
  };
}

export function isFresh(observation: PriceObservation, policy: FreshnessPolicy): PriceAvailability {
  if (observation.price.mant <= 0n || observation.confidence.mant < 0n) return { available: false, reason: "invalid" };
  if (observation.publishTime > policy.nowUnixSeconds) return { available: false, reason: "future" };
  if (policy.nowUnixSeconds - observation.publishTime > policy.maxAgeSeconds) return { available: false, reason: "stale" };
  return { available: true };
}

/** Confidence expressed in basis points of the quoted price, rounded down. */
export function confidenceBps(observation: PriceObservation): bigint {
  return bpsFromRatio(observation.confidence, observation.price);
}

/** Raw vault balance -> exact USDC base units at the valuation boundary. */
export function valueUsdcRaw(
  rawAmount: bigint,
  decimals: number,
  multiplier: Dec,
  price: PriceObservation,
): bigint {
  if (rawAmount < 0n || !Number.isInteger(decimals) || decimals < 0 || decimals > 36) {
    throw new RangeError("invalid raw balance or decimals");
  }
  const quantity = rawToDisplay(rawAmount, decimals, multiplier);
  const usd = decMul(quantity, price.price);
  if (usd.mant < 0n) throw new RangeError("valuation cannot be negative");
  // USDC has six decimal base units. This is display/valuation output only.
  return (usd.mant * 1_000_000n) / pow10(usd.scale);
}

/** Compare verified underlying and tokenized feeds. Missing/stale feeds stay unavailable. */
export function pairedFeedComparison(
  underlying: PriceObservation | undefined,
  tokenized: PriceObservation | undefined,
  policy: FreshnessPolicy,
): PairedFeedComparison {
  if (!underlying || !tokenized) return { available: false, reason: "missing" };
  const underlyingFresh = isFresh(underlying, policy);
  const tokenizedFresh = isFresh(tokenized, policy);
  if (!underlyingFresh.available) return { available: false, reason: underlyingFresh.reason };
  if (!tokenizedFresh.available) return { available: false, reason: tokenizedFresh.reason };

  return {
    available: true,
    underlying,
    tokenized,
    difference: decSub(tokenized.price, underlying.price),
    differenceBps: bpsFromRatio(decSub(tokenized.price, underlying.price), underlying.price),
    confidenceBps: {
      underlying: confidenceBps(underlying),
      tokenized: confidenceBps(tokenized),
    },
  };
}

/** Market/executable value and issuer mark are deliberately separate surfaces. */
export function prestocksMarketMark(
  marketPrice: Dec,
  issuerReferenceMark: Dec,
  opts?: { supply?: Dec; multiplier?: Dec },
): PreStocksMarketMark {
  if (marketPrice.mant <= 0n || issuerReferenceMark.mant <= 0n) {
    throw new RangeError("PreStocks prices must be positive");
  }
  const result: PreStocksMarketMark = {
    marketPrice,
    issuerReferenceMark,
    premiumDiscountBps: bpsFromRatio(decSub(marketPrice, issuerReferenceMark), issuerReferenceMark),
  };
  if (opts?.supply && opts.multiplier) {
    result.marketImpliedValue = decMul(decMul(opts.supply, opts.multiplier), marketPrice);
    result.referenceValue = decMul(decMul(opts.supply, opts.multiplier), issuerReferenceMark);
  }
  return result;
}
