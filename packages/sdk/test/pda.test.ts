/**
 * Client-side PDA checks. The decisive check — that these seeds produce the
 * addresses the program derives — is the Rust replay of tests/vectors/pda.json.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { seeds, u64le } from "../src/pda.ts";
import { base58Decode, isOnCurve, generatePdaVectors, serializePda } from "./pda-vectors.ts";

test("tests/vectors/pda.json matches the current seed builders", () => {
  const committed = readFileSync(new URL("../../../tests/vectors/pda.json", import.meta.url), "utf8");
  assert.equal(
    committed.replace(/\r\n/g, "\n"),
    serializePda(generatePdaVectors()),
    "PDA vectors are stale: run `node scripts/gen-pda-vectors.ts`",
  );
});

test("vectors cover every seed builder", () => {
  const snake = (s: string) => s.replace(/[A-Z]/g, (c) => "_" + c.toLowerCase());
  const covered = new Set(generatePdaVectors().vectors.map((v) => v.fn));
  for (const name of Object.keys(seeds)) assert.ok(covered.has(snake(name)), `${name} has no vector`);
});

test("u64 seeds are little-endian and range-checked", () => {
  assert.deepEqual([...u64le(1n)], [1, 0, 0, 0, 0, 0, 0, 0]);
  assert.deepEqual([...u64le(0x0102n)], [2, 1, 0, 0, 0, 0, 0, 0]);
  assert.throws(() => u64le(-1n), RangeError);
  assert.throws(() => u64le(1n << 64n), RangeError);
});

test("seed builders refuse keys that are not 32 bytes", () => {
  assert.throws(() => seeds.circle(new Uint8Array(31)), RangeError);
});

test("program id decodes to 32 bytes", () => {
  assert.equal(base58Decode("FJt9WntCGo6suyjH4cndwgKjQ8rDSau1JxLA91UFB49v").length, 32);
});

test("on-curve check agrees with known points", () => {
  // The ed25519 base point, y = 4/5 mod p, little-endian with sign bit 0.
  const B = new Uint8Array(32);
  const P = (1n << 255n) - 19n;
  let inv5 = 1n, b = 5n, e = P - 2n;
  while (e > 0n) { if (e & 1n) inv5 = (inv5 * b) % P; b = (b * b) % P; e >>= 1n; }
  let y = (4n * inv5) % P;
  for (let i = 0; i < 32; i++) { B[i] = Number(y & 0xffn); y >>= 8n; }
  assert.equal(isOnCurve(B), true);
  // y = 0 gives x² = -1 / 1 ... = -1, a square since p ≡ 1 mod 4: on curve.
  assert.equal(isOnCurve(new Uint8Array(32)), true);
});
