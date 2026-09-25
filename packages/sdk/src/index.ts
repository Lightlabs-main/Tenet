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
  getBuyDevnetTestEquityInstructionAsync,
  getCreateMandateInstructionAsync,
  getExecuteAmendmentInstructionAsync,
  getInitiateRedemptionInstructionAsync,
  getOpenEpochInstructionAsync,
  getProposeAmendmentInstructionAsync,
  getVoteAmendmentInstructionAsync,
  type ContributeAsyncInput,
  type BuyDevnetTestEquityAsyncInput,
  type CreateMandateAsyncInput,
  type InitiateRedemptionAsyncInput,
  type ProposeAmendmentAsyncInput,
  type OpenEpochAsyncInput,
  type VoteAmendmentAsyncInput,
} from "./generated/index";
import type { MandateParamsArgs } from "./generated/types";

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
  getCreateDevnetTestCircleInstructionAsync,
  getFinalizeEpochInstruction,
  getFinalizeEpochInstructionAsync,
  getFinalizeMandateInstruction,
  getForkMandateInstruction,
  getForkMandateAssetInstruction,
  getForkMandateAssetInstructionAsync,
  getInitializeConfigInstruction,
  getInitializeConfigInstructionAsync,
  getInitializeDevnetTestMarketInstructionAsync,
  getOpenNavSnapshotInstruction,
  getOpenNavSnapshotInstructionAsync,
  getExecuteAmendmentInstruction,
  getExecuteAmendmentInstructionAsync,
  getProposeAmendmentInstruction,
  getProposeAmendmentInstructionAsync,
  getRecordAssetNavInstruction,
  getRecordAssetNavInstructionAsync,
  getReserveRedemptionAssetInstruction,
  getReserveRedemptionUsdcInstruction,
  getReserveRedemptionUsdcInstructionAsync,
  getSettleContributionInstruction,
  getUpsertRegistryEntryInstruction,
  getUpsertRegistryEntryInstructionAsync,
  getVoteAmendmentInstruction,
  getVoteAmendmentInstructionAsync,
} from "./generated/instructions/index";

export type {
  ContributeAsyncInput,
  CreateDevnetTestCircleAsyncInput,
  InitializeDevnetTestMarketAsyncInput,
  CreateMandateAsyncInput,
  InitiateRedemptionAsyncInput,
  OpenEpochAsyncInput,
  ProposeAmendmentAsyncInput,
  VoteAmendmentAsyncInput,
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

/** Buy fixed-inventory, valueless Devnet test units from active Circle USDC. */
export function buyDevnetTestEquity(input: WithBigint<BuyDevnetTestEquityAsyncInput, "amountUsdcRaw">) {
  return getBuyDevnetTestEquityInstructionAsync({ ...input, amountUsdcRaw: u64(input.amountUsdcRaw, "amountUsdcRaw") });
}

/** Begin an exit of `shares` raw shares. */
export function initiateRedemption(input: WithBigint<InitiateRedemptionAsyncInput, "shares">) {
  return getInitiateRedemptionInstructionAsync({ ...input, shares: u64(input.shares, "shares") });
}

export function openEpoch(input: WithBigint<OpenEpochAsyncInput, "index">) {
  return getOpenEpochInstructionAsync({ ...input, index: u64(input.index, "index") });
}

type MandateParamsInput = Omit<
  MandateParamsArgs,
  "minContributionUsdc" | "maxPoolSizeUsdc" | "epochDuration" | "amendmentDelaySeconds"
> & {
  minContributionUsdc: bigint;
  maxPoolSizeUsdc: bigint;
  epochDuration: bigint;
  amendmentDelaySeconds: bigint;
};

export function createMandate(
  input: Omit<CreateMandateAsyncInput, "params"> & MandateParamsInput,
) {
  return getCreateMandateInstructionAsync({
    author: input.author,
    mandateSeed: input.mandateSeed,
    mandate: input.mandate,
    systemProgram: input.systemProgram,
    params: {
      name: input.name,
      description: input.description,
      maxWeightPerAssetBps: input.maxWeightPerAssetBps,
      maxPreIpoWeightBps: input.maxPreIpoWeightBps,
      maxIssuerWeightBps: input.maxIssuerWeightBps,
      maxUnderlyingWeightBps: input.maxUnderlyingWeightBps,
      maxSupplyConsumptionBps: input.maxSupplyConsumptionBps,
      maxPriceImpactBps: input.maxPriceImpactBps,
      minContributionUsdc: u64(input.minContributionUsdc, "minContributionUsdc"),
      maxPoolSizeUsdc: u64(input.maxPoolSizeUsdc, "maxPoolSizeUsdc"),
      epochDuration: i64(input.epochDuration, "epochDuration"),
      membershipPolicy: input.membershipPolicy,
      amendmentThresholdBps: input.amendmentThresholdBps,
      amendmentDelaySeconds: i64(input.amendmentDelaySeconds, "amendmentDelaySeconds"),
    },
  });
}

/** Propose a Mandate change without allowing numeric money fields to lose precision. */
export function proposeAmendment(
  input: Omit<ProposeAmendmentAsyncInput, "proposalId" | "params"> & {
    proposalId: bigint;
    params: MandateParamsInput;
  },
) {
  return getProposeAmendmentInstructionAsync({
    ...input,
    proposalId: u64(input.proposalId, "proposalId"),
    params: {
      ...input.params,
      minContributionUsdc: u64(input.params.minContributionUsdc, "params.minContributionUsdc"),
      maxPoolSizeUsdc: u64(input.params.maxPoolSizeUsdc, "params.maxPoolSizeUsdc"),
      epochDuration: i64(input.params.epochDuration, "params.epochDuration"),
      amendmentDelaySeconds: i64(input.params.amendmentDelaySeconds, "params.amendmentDelaySeconds"),
    },
  });
}

export function voteAmendment(input: VoteAmendmentAsyncInput) {
  return getVoteAmendmentInstructionAsync(input);
}

export function executeAmendment(input: Parameters<typeof getExecuteAmendmentInstructionAsync>[0]) {
  return getExecuteAmendmentInstructionAsync(input);
}
