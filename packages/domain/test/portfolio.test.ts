/**
 * VALUE layer: program-identical NAV, the brief's premium examples, and cap
 * compliance on actual (value-based) weights.
 *
 *   node --test packages/domain/test/portfolio.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { assetValueRaw, premiumBps, valuePortfolio, type HoldingInput } from "../src/portfolio.ts";

const E18 = 1_000_000_000_000_000_000n;
const caps = { perAssetBps: 3_000, preIpoBps: 3_000, issuerBps: 3_000, underlyingBps: 3_000, supplyBps: 100 };

function h(over: Partial<HoldingInput> & { symbol: string }): HoldingInput {
  return {
    assetClass: "public", issuer: over.symbol, underlying: over.symbol, decimals: 6, multiplierE18: E18,
    vaultRaw: 0n, reservedRaw: 0n, mintSupplyRaw: 1_000_000_000_000n, targetBps: 0, price: null, mark: null,
    underlyingPrice: null, ...over,
  };
}

test("asset value matches the program's pyth_value_usdc_raw", () => {
  // Same vectors as programs/tenet/src/instructions/execution.rs tests,
  // restated at a 1e-6 price scale: 1.5 units at $20 = $30.
  assert.equal(assetValueRaw(1_500_000n, 6, E18, 20_000_000n), 30_000_000n);
  assert.equal(assetValueRaw(1_500_000n, 6, 2n * E18, 20_000_000n), 60_000_000n);
  // 9-decimal token: 2.5 TSPY at 50.00 = 125 TUSDC.
  assert.equal(assetValueRaw(2_500_000_000n, 9, E18, 50_000_000n), 125_000_000n);
});

test("the brief's examples: market vs mark and token vs underlying", () => {
  // TSPACEX market 40 / mark 50 -> -20.00%.
  assert.equal(premiumBps(40_000_000n, 50_000_000n), -2_000n);
  // TNVDA token 100 vs underlying 102 -> -1.96%.
  assert.equal(premiumBps(100_000_000n, 102_000_000n), -196n);
  assert.equal(premiumBps(1n, null), null);
  assert.equal(premiumBps(1n, 0n), null);
});

test("NAV, weights, drift and compliance", () => {
  const v = valuePortfolio(100_000_000n, [
    h({ symbol: "TNVDA", vaultRaw: 3_000_000n, price: 100_000_000n, targetBps: 3_000, underlyingPrice: 102_000_000n }),
    h({ symbol: "TSPACEX", assetClass: "preIpo", vaultRaw: 5_000_000n, price: 40_000_000n, mark: 50_000_000n, targetBps: 2_000 }),
    h({ symbol: "TAAPL", targetBps: 2_000 }), // not held, no price: fine
  ], caps);
  // 100 cash + 300 TNVDA + 200 TSPACEX = 600
  assert.equal(v.navRaw, 600_000_000n);
  assert.equal(v.holdings[0]!.weightBps, 5_000n);
  assert.equal(v.holdings[0]!.driftBps, 2_000n);
  assert.equal(v.holdings[1]!.marketVsMarkBps, -2_000n);
  const byRule = Object.fromEntries(v.compliance!.map((c) => [c.rule, c]));
  assert.equal(byRule.perAsset!.ok, false, "TNVDA at 50% breaches a 30% cap after appreciation");
  assert.equal(byRule.preIpo!.usedBps, 3_333n);
  assert.equal(byRule.preIpo!.ok, false);
});

test("a held asset without a price makes NAV unavailable, never partial", () => {
  const v = valuePortfolio(1n, [h({ symbol: "X", vaultRaw: 1n })], caps);
  assert.equal(v.navRaw, null);
  assert.equal(v.compliance, null);
});

test("reserved exit tokens are excluded from NAV", () => {
  const v = valuePortfolio(0n, [h({ symbol: "X", vaultRaw: 10_000_000n, reservedRaw: 4_000_000n, price: 1_000_000n })], caps);
  assert.equal(v.navRaw, 6_000_000n);
});
