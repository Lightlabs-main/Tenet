/**
 * Exact post-balance checks for a guarded execution.
 *
 * This is deliberately independent of Jupiter, RPC clients, quotes and UI
 * values. The eventual on-chain end_execution instruction must reproduce this
 * rule against the source and destination vault balances it observes after
 * the router has run.
 */

import { fail } from "./accounting.ts";

export interface ExecutionBalanceWindow {
  preInputRaw: bigint;
  postInputRaw: bigint;
  preOutputRaw: bigint;
  postOutputRaw: bigint;
  maxInputRaw: bigint;
  minOutputRaw: bigint;
}

export interface ExecutionDeltas {
  spentInputRaw: bigint;
  receivedOutputRaw: bigint;
}

function requireRaw(name: string, value: bigint): void {
  if (typeof value !== "bigint")
    fail("E_NOT_BIGINT", `${name} must be a bigint raw token amount`);
  if (value < 0n) fail("E_NEGATIVE", `${name} must be non-negative`);
}

/**
 * Verify the effects of a router call using raw token-account balances.
 *
 * A quote, price-impact field, displayed amount or route description is not
 * part of this function and cannot satisfy these checks. An input vault may
 * only decrease, the intended output vault may only increase, and the actual
 * deltas must respect the authorization bounds.
 */
export function verifyExecutionDeltas(
  window: ExecutionBalanceWindow,
): ExecutionDeltas {
  for (const [name, value] of Object.entries(window)) requireRaw(name, value);

  if (window.postInputRaw > window.preInputRaw)
    fail("E_INPUT_BALANCE_INCREASED", "source vault increased during execution");
  if (window.postOutputRaw < window.preOutputRaw)
    fail("E_OUTPUT_BALANCE_DECREASED", "destination vault decreased during execution");

  const spentInputRaw = window.preInputRaw - window.postInputRaw;
  const receivedOutputRaw = window.postOutputRaw - window.preOutputRaw;

  if (spentInputRaw > window.maxInputRaw)
    fail("E_ABOVE_MAX_INPUT", `spent ${spentInputRaw} exceeds ${window.maxInputRaw}`);
  if (receivedOutputRaw < window.minOutputRaw)
    fail("E_BELOW_MIN_OUTPUT", `received ${receivedOutputRaw} is below ${window.minOutputRaw}`);

  return { spentInputRaw, receivedOutputRaw };
}
