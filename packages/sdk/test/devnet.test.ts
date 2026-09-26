/**
 * The devnet client: its quote must be the program's quote to the unit, and
 * its guard must refuse any cluster but Devnet.
 *
 *   node --import tsx --test packages/sdk/test/devnet.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  assertDevnet, buy, DEVNET_GENESIS_HASH, FRONTIER_TECHNOLOGY, INSTRUMENTS, MAINNET_GENESIS_HASH,
  quoteBuy, TENET_DEVNET_PROGRAM_ADDRESS, transferFee,
} from "../src/devnet/index.ts";

test("quoteBuy reproduces the Rust quote_buy vectors", () => {
  // programs/tenet-devnet/src/lib.rs `quote_buy_is_exact_and_floors`.
  assert.equal(quoteBuy(100_000_000n, 40_000_000n, 6, 0), 2_500_000n);
  assert.equal(quoteBuy(100_000_000n, 40_000_000n, 9, 0), 2_500_000_000n);
  assert.equal(quoteBuy(100_000_000n, 40_000_000n, 6, 30), 2_492_500n);
  assert.equal(quoteBuy(1n, 3_000_000n, 0, 0), 0n);
  assert.throws(() => quoteBuy(1n, 0n, 6, 0), RangeError);
});

test("transfer fee is a capped ceiling, like Token-2022", () => {
  assert.equal(transferFee(10_000n, 25, 1n << 60n), 25n);
  assert.equal(transferFee(10_001n, 25, 1n << 60n), 26n);
  assert.equal(transferFee(10_000_000n, 25, 100n), 100n);
});

test("assertDevnet refuses mainnet and accepts devnet", async () => {
  const rpc = (hash: string) => ({ getGenesisHash: () => ({ send: async () => hash }) });
  await assertDevnet(rpc(DEVNET_GENESIS_HASH));
  await assert.rejects(assertDevnet(rpc(MAINNET_GENESIS_HASH)), /REFUSING/);
});

test("catalog: eight labelled test instruments, and the reference Mandate fits its own caps", () => {
  assert.equal(INSTRUMENTS.length, 8);
  assert.equal(new Set(INSTRUMENTS.map((i) => i.symbol)).size, 8, "symbols are unique");
  for (const i of INSTRUMENTS) {
    assert.match(i.name, /DEVNET TEST INSTRUMENT$/);
    assert.ok(new TextEncoder().encode(i.name).length <= 48, `${i.symbol} name fits the registry`);
    assert.ok(i.symbol.startsWith("T"));
  }
  const bySymbol = new Map(INSTRUMENTS.map((i) => [i.symbol, i]));
  let total = 0, preIpo = 0;
  for (const [sym, bps] of FRONTIER_TECHNOLOGY.targets) {
    assert.ok(bps <= FRONTIER_TECHNOLOGY.maxWeightPerAssetBps);
    total += bps;
    if (bySymbol.get(sym)!.assetClass === "preIpo") preIpo += bps;
  }
  assert.ok(total <= 10_000);
  assert.ok(preIpo <= FRONTIER_TECHNOLOGY.maxPreIpoWeightBps);
});

test("amounts must be bigint", () => {
  assert.equal(TENET_DEVNET_PROGRAM_ADDRESS, "6ZXVyvYPPLhoMTF4BDa2M3SLpWRvHxPCLjD9WFQzBdNm");
  assert.throws(() => buy({ amountInRaw: 1, minOutRaw: 1n } as never), TypeError);
});

test("Pyth -> devnet feed scaling is exact and floors", async () => {
  const { toMicros } = await import("../scripts/devnet/pyth-relay.ts");
  assert.equal(toMicros(37_250_999n, -5), 372_509_990n); // TSLA 372.50999 at expo -5
  assert.equal(toMicros(9_999_123_456n, -8), 99_991_234n); // expo -8 floors to 1e-6
  assert.equal(toMicros(12n, -6), 12n);
  assert.equal(toMicros(3n, 0), 3_000_000n);
});
