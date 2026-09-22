/**
 * The committed vectors must equal what the model produces today. Without this,
 * a change to packages/domain could leave tests/vectors/math.json stale, and the
 * Rust replay would keep passing against a model that no longer exists.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { generateVectors, serialize } from "./vectors.ts";

test("tests/vectors/math.json matches the current domain model", () => {
  const committed = readFileSync(new URL("../../../tests/vectors/math.json", import.meta.url), "utf8");
  assert.equal(
    committed.replace(/\r\n/g, "\n"),
    serialize(generateVectors()),
    "vectors are stale: run `node scripts/gen-math-vectors.ts`",
  );
});

test("every fallible function has both success and failure coverage", () => {
  const vectors = generateVectors();
  for (const fn of new Set(vectors.map((v) => v.fn))) {
    const mine = vectors.filter((v) => v.fn === fn);
    assert.ok(mine.some((v) => v.ok !== undefined), `${fn}: no success case`);
    // transfer_fee_amount has no failure branch: the fee never exceeds the amount.
    if (fn !== "transfer_fee_amount")
      assert.ok(mine.some((v) => v.err !== undefined), `${fn}: no failure case`);
  }
});
