import { test } from "node:test";
import assert from "node:assert/strict";

import { AccountingError } from "../src/accounting.ts";
import { verifyExecutionDeltas } from "../src/execution.ts";

const valid = {
  preInputRaw: 1_000n,
  postInputRaw: 700n,
  preOutputRaw: 50n,
  postOutputRaw: 1_250n,
  maxInputRaw: 300n,
  minOutputRaw: 1_200n,
};

function rejects(code: string, change: Partial<typeof valid>) {
  assert.throws(
    () => verifyExecutionDeltas({ ...valid, ...change }),
    (error: unknown) => error instanceof AccountingError && error.code === code,
  );
}

test("execution uses actual raw vault deltas", () => {
  assert.deepEqual(verifyExecutionDeltas(valid), {
    spentInputRaw: 300n,
    receivedOutputRaw: 1_200n,
  });
});

test("execution rejects input over-spend", () => {
  rejects("E_ABOVE_MAX_INPUT", { postInputRaw: 699n });
});

test("execution rejects output below the authorized floor", () => {
  rejects("E_BELOW_MIN_OUTPUT", { postOutputRaw: 1_249n });
});

test("execution rejects balance-direction violations", () => {
  rejects("E_INPUT_BALANCE_INCREASED", { postInputRaw: 1_001n });
  rejects("E_OUTPUT_BALANCE_DECREASED", { postOutputRaw: 49n });
});

test("execution refuses non-bigint or negative accounting inputs", () => {
  rejects("E_NOT_BIGINT", { postInputRaw: 700 as unknown as bigint });
  rejects("E_NEGATIVE", { maxInputRaw: -1n });
});

test("execution accepts exact authorization boundaries", () => {
  assert.deepEqual(verifyExecutionDeltas({
    ...valid,
    postInputRaw: 0n,
    postOutputRaw: 1_250n,
    maxInputRaw: 1_000n,
    minOutputRaw: 1_200n,
  }), {
    spentInputRaw: 1_000n,
    receivedOutputRaw: 1_200n,
  });
});
