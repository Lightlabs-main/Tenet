/**
 * The VALUE layer for one Circle: NAV, allocation against the Mandate,
 * market vs mark, token vs underlying, supply consumption and cap compliance.
 *
 * Inputs are raw chain values and integer prices; outputs are integers
 * (raw USDC, bps). The per-asset value is computed EXACTLY as the program's
 * `pyth_value_usdc_raw` does for NAV snapshots, so the page and the chain
 * agree to the unit:
 *
 *   scaled = floor(raw × multiplier_e18 / 1e18)
 *   value  = floor(scaled × price / 10^decimals)      (price: USDC raw per whole token)
 *
 * Display only: nothing here feeds back into ownership or redemption.
 */

const E18 = 1_000_000_000_000_000_000n;

export interface HoldingInput {
  symbol: string;
  assetClass: "public" | "preIpo";
  /** Stable identifiers for the issuer / underlying-company caps. */
  issuer: string;
  underlying: string;
  decimals: number;
  multiplierE18: bigint;
  vaultRaw: bigint;
  /** Tokens already owed to exits; not part of NAV. */
  reservedRaw: bigint;
  mintSupplyRaw: bigint;
  targetBps: number;
  /** USDC raw (1e-6) per whole token; null = no price available. */
  price: bigint | null;
  /** Reference mark (PreStocks-style); null or 0 = none. */
  mark: bigint | null;
  /** Price of the referenced underlying; null or 0 = none. */
  underlyingPrice: bigint | null;
}

export interface MandateCaps {
  perAssetBps: number;
  preIpoBps: number;
  issuerBps: number;
  underlyingBps: number;
  supplyBps: number;
}

export interface HoldingValue {
  symbol: string;
  valueRaw: bigint | null;
  weightBps: bigint | null;
  targetBps: number;
  /** weight − target, bps. */
  driftBps: bigint | null;
  marketVsMarkBps: bigint | null;
  tokenVsUnderlyingBps: bigint | null;
  supplyBps: bigint | null;
}

export interface ComplianceRow {
  rule: "perAsset" | "preIpo" | "issuer" | "underlying" | "supply";
  label: string;
  usedBps: bigint;
  capBps: bigint;
  ok: boolean;
}

export interface PortfolioValue {
  cashRaw: bigint;
  /** null when any HELD asset has no price: a partial NAV is never shown as NAV. */
  navRaw: bigint | null;
  holdings: HoldingValue[];
  compliance: ComplianceRow[] | null;
}

/** Program-identical asset value. */
export function assetValueRaw(raw: bigint, decimals: number, multiplierE18: bigint, price: bigint): bigint {
  if (raw < 0n || price <= 0n || multiplierE18 <= 0n) throw new RangeError("invalid valuation input");
  const scaled = (raw * multiplierE18) / E18;
  return (scaled * price) / 10n ** BigInt(decimals);
}

/** (a − b) / b in bps, truncated toward zero; null if b is absent. */
export function premiumBps(a: bigint, b: bigint | null): bigint | null {
  if (b === null || b <= 0n) return null;
  return ((a - b) * 10_000n) / b;
}

export function valuePortfolio(cashRaw: bigint, holdings: HoldingInput[], caps: MandateCaps): PortfolioValue {
  const values = holdings.map((h) => {
    const held = h.vaultRaw - h.reservedRaw;
    if (held < 0n) throw new RangeError(`${h.symbol}: reserved exceeds vault`);
    if (h.price === null || h.price <= 0n) return held === 0n ? 0n : null;
    return assetValueRaw(held, h.decimals, h.multiplierE18, h.price);
  });
  const complete = values.every((v) => v !== null);
  const navRaw = complete ? values.reduce<bigint>((a, v) => a + (v as bigint), cashRaw) : null;

  const rows: HoldingValue[] = holdings.map((h, i) => {
    const v = values[i] ?? null;
    const weight = navRaw !== null && navRaw > 0n && v !== null ? (v * 10_000n) / navRaw : null;
    return {
      symbol: h.symbol,
      valueRaw: v,
      weightBps: weight,
      targetBps: h.targetBps,
      driftBps: weight === null ? null : weight - BigInt(h.targetBps),
      marketVsMarkBps: h.price === null ? null : premiumBps(h.price, h.mark),
      tokenVsUnderlyingBps: h.price === null ? null : premiumBps(h.price, h.underlyingPrice),
      supplyBps: h.mintSupplyRaw > 0n ? (h.vaultRaw * 10_000n) / h.mintSupplyRaw : null,
    };
  });

  if (navRaw === null) return { cashRaw, navRaw, holdings: rows, compliance: null };

  const w = (i: number) => rows[i]!.weightBps ?? 0n;
  const maxBy = (key: (h: HoldingInput) => string) => {
    const sums = new Map<string, bigint>();
    holdings.forEach((h, i) => sums.set(key(h), (sums.get(key(h)) ?? 0n) + w(i)));
    return [...sums.values()].reduce((a, b) => (b > a ? b : a), 0n);
  };
  const row = (rule: ComplianceRow["rule"], label: string, used: bigint, cap: number): ComplianceRow =>
    ({ rule, label, usedBps: used, capBps: BigInt(cap), ok: used <= BigInt(cap) });
  const compliance = [
    row("perAsset", "Largest single asset", holdings.reduce((a, _, i) => (w(i) > a ? w(i) : a), 0n), caps.perAssetBps),
    row("preIpo", "Pre-IPO exposure", holdings.reduce((a, h, i) => (h.assetClass === "preIpo" ? a + w(i) : a), 0n), caps.preIpoBps),
    row("issuer", "Largest issuer", maxBy((h) => h.issuer), caps.issuerBps),
    row("underlying", "Largest company", maxBy((h) => h.underlying), caps.underlyingBps),
    row("supply", "Largest supply consumption", rows.reduce((a, r) => ((r.supplyBps ?? 0n) > a ? r.supplyBps ?? 0n : a), 0n), caps.supplyBps),
  ];
  return { cashRaw, navRaw, holdings: rows, compliance };
}
