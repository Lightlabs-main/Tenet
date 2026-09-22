/**
 * @tenet/sdk — the client for the Tenet program, on @solana/kit (D-05).
 *
 * The program client in ./generated is produced from the Anchor IDL by Codama
 * (scripts/gen-client.mjs) and never edited by hand.
 *
 * ONE rule this module adds on top of it: amounts are `bigint`, never `number`.
 * The generated input types accept `number | bigint` for u64/i64 fields, and a
 * JavaScript `number` above 2^53 silently loses precision — the V-018 hazard,
 * applied to money. The builders below narrow every such field to `bigint` in
 * their types AND check it at runtime, for callers that bypass TypeScript.
 * Raw generated instruction builders are intentionally not exported from this
 * package root: their `number | bigint` inputs would bypass this boundary.
 */
import {
  getContributeInstructionAsync,
  getCreateMandateInstructionAsync,
  getInitiateRedemptionInstructionAsync,
  getOpenEpochInstructionAsync,
  type ContributeAsyncInput,
  type CreateMandateAsyncInput,
  type InitiateRedemptionAsyncInput,
  type OpenEpochAsyncInput,
} from "./generated/index";

// Account decoders, errors, PDAs, program metadata and enums are data-only
// exports. Amount-bearing instruction builders are exposed only through the
// checked wrappers below.
export * from "./generated/accounts/index";
export * from "./generated/errors/index";
export * from "./generated/pdas/index";
export * from "./generated/programs/index";
export * from "./generated/types/index";

// Preserve the stable SDK name used by the web client and existing callers.
// Codama names this PDA from the execution account field (`sourceVault`),
// while the product vocabulary calls it the active USDC vault.
export { findSourceVaultPda as findActiveUsdcVaultPda } from "./generated/pdas/sourceVault";

export {
  getAddCircleAssetInstruction,
  getAddCircleAssetInstructionAsync,
  getAddMandateAssetInstruction,
  getCancelContributionInstruction,
  getCancelContributionInstructionAsync,
  getClaimRedemptionAssetInstruction,
  getClaimRedemptionAssetInstructionAsync,
  getClaimRedemptionUsdcInstruction,
  getClaimRedemptionUsdcInstructionAsync,
  getCloseContributionsInstruction,
  getCloseEpochInstruction,
  getCancelEpochInstruction,
  getCreateCircleInstruction,
  getCreateCircleInstructionAsync,
  getFinalizeEpochInstruction,
  getFinalizeEpochInstructionAsync,
  getFinalizeMandateInstruction,
  getForkMandateInstruction,
  getForkMandateAssetInstruction,
  getForkMandateAssetInstructionAsync,
  getInitializeConfigInstruction,
  getInitializeConfigInstructionAsync,
  getOpenNavSnapshotInstruction,
  getOpenNavSnapshotInstructionAsync,
  getRecordAssetNavInstruction,
  getRecordAssetNavInstructionAsync,
  getReserveRedemptionAssetInstruction,
  getReserveRedemptionUsdcInstruction,
  getReserveRedemptionUsdcInstructionAsync,
  getSettleContributionInstruction,
  getUpsertRegistryEntryInstruction,
  getUpsertRegistryEntryInstructionAsync,
} from "./generated/instructions/index";

export type {
  ContributeAsyncInput,
  CreateMandateAsyncInput,
  InitiateRedemptionAsyncInput,
  OpenEpochAsyncInput,
} from "./generated/instructions/index";
export { PROGRAM_ID, SEED, seeds, u64le } from "./pda";

const U64_MAX = (1n << 64n) - 1n;
const I64_MIN = -(1n << 63n);
const I64_MAX = (1n << 63n) - 1n;

/** Refuse anything but an in-range bigint. Returns it unchanged. */
export function u64(value: unknown, field: string): bigint {
  if (typeof value !== "bigint") {
    throw new TypeError(`${field} must be a bigint (got ${typeof value}); numbers lose precision above 2^53`);
  }
  if (value < 0n || value > U64_MAX) throw new RangeError(`${field} is not a u64: ${value}`);
  return value;
}

export function i64(value: unknown, field: string): bigint {
  if (typeof value !== "bigint") {
    throw new TypeError(`${field} must be a bigint (got ${typeof value})`);
  }
  if (value < I64_MIN || value > I64_MAX) throw new RangeError(`${field} is not an i64: ${value}`);
  return value;
}

/** Replace the listed keys of T with `bigint`. */
type WithBigint<T, K extends keyof T> = Omit<T, K> & { [P in K]: bigint };

/** Contribute raw USDC into the current epoch's escrow. */
export function contribute(input: WithBigint<ContributeAsyncInput, "amount">) {
  return getContributeInstructionAsync({ ...input, amount: u64(input.amount, "amount") });
}

/** Begin an exit of `shares` raw shares. */
export function initiateRedemption(input: WithBigint<InitiateRedemptionAsyncInput, "shares">) {
  return getInitiateRedemptionInstructionAsync({ ...input, shares: u64(input.shares, "shares") });
}

export function openEpoch(input: WithBigint<OpenEpochAsyncInput, "index">) {
  return getOpenEpochInstructionAsync({ ...input, index: u64(input.index, "index") });
}

export function createMandate(
  input: WithBigint<
    CreateMandateAsyncInput,
    "minContributionUsdc" | "maxPoolSizeUsdc" | "epochDuration" | "amendmentDelaySeconds"
  >,
) {
  return getCreateMandateInstructionAsync({
    ...input,
    minContributionUsdc: u64(input.minContributionUsdc, "minContributionUsdc"),
    maxPoolSizeUsdc: u64(input.maxPoolSizeUsdc, "maxPoolSizeUsdc"),
    epochDuration: i64(input.epochDuration, "epochDuration"),
    amendmentDelaySeconds: i64(input.amendmentDelaySeconds, "amendmentDelaySeconds"),
  });
}
