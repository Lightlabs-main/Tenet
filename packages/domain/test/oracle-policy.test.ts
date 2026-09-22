import { test } from "node:test";
import assert from "node:assert/strict";
import { admitPythObservation } from "../src/oracle-policy.ts";

const FEED = "0x" + "ab".repeat(32);
const base = (overrides: Partial<Parameters<typeof admitPythObservation>[0]> = {}) => ({
  feedId: FEED,
  price: 10_000n,
  expo: -2,
  confidence: 1n,
  publishTime: 1_000n,
  slot: 42n,
  ...overrides,
});
const policy = (overrides: Partial<Parameters<typeof admitPythObservation>[1]> = {}) => ({
  expectedFeedId: FEED,
  nowUnixSeconds: 1_010n,
  maxAgeSeconds: 60n,
  maxConfidenceBps: 10n,
  ...overrides,
});

test("Pyth admission binds the observation to the registry feed", () => {
  const result = admitPythObservation(base({ feedId: "0x" + "cd".repeat(32) }), policy());
  assert.deepEqual(result, { accepted: false, reason: "feed_mismatch" });
});

test("Pyth admission rejects stale and future observations", () => {
  assert.equal(admitPythObservation(base({ publishTime: 900n }), policy({ maxAgeSeconds: 50n })).reason, "stale");
  assert.equal(admitPythObservation(base({ publishTime: 2_000n }), policy()).reason, "future");
});

test("Pyth admission rejects wide confidence intervals", () => {
  const result = admitPythObservation(base({ confidence: 25n }), policy({ maxConfidenceBps: 20n }));
  assert.deepEqual(result, { accepted: false, reason: "confidence_too_wide" });
});

test("Pyth admission returns the exact converted observation", () => {
  const result = admitPythObservation(base(), policy());
  assert.equal(result.accepted, true);
  assert.equal(result.observation?.price.mant, 10000n);
  assert.equal(result.observation?.price.scale, 2);
  assert.equal(result.observation?.slot, 42n);
});
