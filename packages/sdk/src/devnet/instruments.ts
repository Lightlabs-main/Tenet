/**
 * The devnet test instrument catalog — DEVNET TEST INSTRUMENTS, NOT REAL
 * STOCKS OR SECURITIES. One definition shared by `pnpm devnet:setup`, the
 * devnet end-to-end script and the web app's devnet profile.
 *
 * Prices are TUSDC per whole token at `PRICE_EXPONENT` (-6): 100_000_000n is
 * 100.00 TUSDC. `mark` is a PreStocks-style reference mark (0 = none);
 * `underlying` is the price of the thing the token references (0 = none).
 * These are devnet pricing simulations, not market data.
 */

export type InstrumentClass = "public" | "preIpo";
export type InstrumentExtension =
  | { kind: "none" }
  | { kind: "transferFee"; bps: number; maxFee: bigint }
  | { kind: "scaledUiAmount"; multiplier: number };

export interface InstrumentSpec {
  symbol: string;
  /** Registry display name (max 48 bytes on chain). */
  name: string;
  /** What it stands in for, for labels only. */
  reference: string;
  assetClass: InstrumentClass;
  decimals: number;
  extension: InstrumentExtension;
  price: bigint;
  mark: bigint;
  underlying: bigint;
  /** Stable 1-byte ids for the registry's issuer / underlying fields. */
  issuerId: number;
  underlyingId: number;
}

export const INSTRUMENTS: readonly InstrumentSpec[] = [
  {
    symbol: "TNVDA", name: "NVDA — DEVNET TEST INSTRUMENT", reference: "NVIDIA",
    assetClass: "public", decimals: 6, extension: { kind: "none" },
    price: 100_000_000n, mark: 0n, underlying: 102_000_000n, issuerId: 1, underlyingId: 1,
  },
  {
    symbol: "TAAPL", name: "AAPL — DEVNET TEST INSTRUMENT", reference: "Apple",
    assetClass: "public", decimals: 6, extension: { kind: "none" },
    price: 75_000_000n, mark: 0n, underlying: 75_000_000n, issuerId: 2, underlyingId: 2,
  },
  {
    symbol: "TSPY", name: "SPY — DEVNET TEST INSTRUMENT", reference: "S&P 500 ETF",
    assetClass: "public", decimals: 9, extension: { kind: "scaledUiAmount", multiplier: 1 },
    price: 50_000_000n, mark: 0n, underlying: 50_000_000n, issuerId: 3, underlyingId: 3,
  },
  {
    symbol: "TSPACEX", name: "SpaceX Exposure — DEVNET TEST INSTRUMENT", reference: "SpaceX (pre-IPO)",
    assetClass: "preIpo", decimals: 6, extension: { kind: "none" },
    price: 40_000_000n, mark: 50_000_000n, underlying: 0n, issuerId: 4, underlyingId: 4,
  },
  {
    symbol: "TOPENAI", name: "OpenAI Exposure — DEVNET TEST INSTRUMENT", reference: "OpenAI (pre-IPO)",
    assetClass: "preIpo", decimals: 6, extension: { kind: "transferFee", bps: 25, maxFee: 18_446_744_073_709_551_615n },
    price: 35_000_000n, mark: 0n, underlying: 0n, issuerId: 5, underlyingId: 5,
  },
  {
    symbol: "TANTHROPIC", name: "Anthropic Exposure — DEVNET TEST INSTRUMENT", reference: "Anthropic (pre-IPO)",
    assetClass: "preIpo", decimals: 6, extension: { kind: "none" },
    price: 30_000_000n, mark: 32_000_000n, underlying: 0n, issuerId: 6, underlyingId: 6,
  },
];

export function instrument(symbol: string): InstrumentSpec {
  const i = INSTRUMENTS.find((x) => x.symbol === symbol);
  if (!i) throw new RangeError(`unknown devnet instrument ${symbol}`);
  return i;
}

/** Whole tokens minted into each market's inventory. */
export const INVENTORY_UNITS = 1_000_000n;

/** Spread charged by every devnet market, in bps. */
export const MARKET_SPREAD_BPS = 30;

/**
 * The reference Mandate for devnet: five instruments, 30% pre-IPO cap, 5%
 * cash buffer. Targets in basis points.
 */
export const FRONTIER_TECHNOLOGY = {
  name: "Frontier Technology",
  description: "Public and pre-IPO frontier technology. DEVNET TEST — no real assets.",
  targets: [
    ["TNVDA", 2_500],
    ["TAAPL", 2_000],
    ["TSPY", 2_000],
    ["TSPACEX", 1_500],
    ["TOPENAI", 1_500],
  ] as const,
  maxWeightPerAssetBps: 3_000,
  maxPreIpoWeightBps: 3_000,
  maxIssuerWeightBps: 3_000,
  maxUnderlyingWeightBps: 3_000,
  maxSupplyConsumptionBps: 100,
  maxPriceImpactBps: 100,
};
