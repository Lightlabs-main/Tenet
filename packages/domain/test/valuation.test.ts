import { test } from "node:test";
import assert from "node:assert/strict";
import { dec, decToString } from "../src/display.ts";
import {
  pairedFeedComparison,
  prestocksMarketMark,
  pythPrice,
  valueUsdcRaw,
} from "../src/valuation.ts";

const basePyth = (price: bigint, publishTime = 1_000n) => pythPrice({
  price,
  expo: -2,
  confidence: 1n,
  publishTime,
  slot: 42n,
});

test("Pyth integer/exponent conversion stays exact", () => {
  const p = basePyth(12345n);
  assert.equal(decToString(p.price, 2), "123.45");
  assert.equal(decToString(p.confidence, 2), "0.01");
});

test("valuation applies decimals and ScaledUiAmount only at the value boundary", () => {
  const p = basePyth(2500n); // $25.00
  // 2 raw units, 2 decimals, multiplier 1.5 => 0.03 units x $25 = $0.75.
  assert.equal(valueUsdcRaw(2n, 2, dec("1.5"), p), 750_000n);
});

test("paired feed divergence is unavailable when either feed is stale", () => {
  const underlying = basePyth(10000n);
  const stale = basePyth(10100n, 1n);
  const result = pairedFeedComparison(underlying, stale, { nowUnixSeconds: 1_000n, maxAgeSeconds: 60n });
  assert.equal(result.available, false);
  assert.equal(result.reason, "stale");
});

test("paired feed divergence is exact and signed", () => {
  const underlying = basePyth(10000n);
  const tokenized = basePyth(10100n);
  const result = pairedFeedComparison(underlying, tokenized, { nowUnixSeconds: 1_010n, maxAgeSeconds: 60n });
  assert.equal(result.available, true);
  assert.equal(result.differenceBps, 100n);
});

test("PreStocks market price is not replaced by issuer mark", () => {
  const result = prestocksMarketMark(dec("12.50"), dec("10.00"), {
    supply: dec("1000"),
    multiplier: dec("1.5"),
  });
  assert.equal(result.premiumDiscountBps, 2500n);
  assert.equal(decToString(result.marketImpliedValue!, 2), "18750.00");
  assert.equal(decToString(result.referenceValue!, 2), "15000.00");
});

test("PreStocks premium supports exact source decimals beyond twelve places", () => {
  const result = prestocksMarketMark(dec("153.21175861819114"), dec("152.76162347"));
  assert.equal(result.premiumDiscountBps, 29n);
});
