/**
 * @tenet/sdk — the client for the Tenet program, on @solana/kit (D-05).
 *
 * The program client in ./generated is produced from the Anchor IDL by Codama
 * (scripts/gen-client.mjs) and never edited by hand. Devnet test
 * infrastructure (faucet, feeds, market) lives in a separate entry point,
 * `@tenet/sdk/devnet`, so a mainnet build never imports it.
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
  getBeginExecutionInstructionAsync,
  getContributeInstructionAsync,
  getCreateMandateInstructionAsync,
  getExecuteAmendmentInstructionAsync,
  getForkMandateInstructionAsync,
  getInitializeConfigInstructionAsync,
  getInitiateRedemptionInstructionAsync,
  getOpenEpochInstructionAsync,
  getProposeAmendmentInstructionAsync,
  getVoteAmendmentInstructionAsync,
  type BeginExecutionAsyncInput,
  type ContributeAsyncInput,
  type CreateMandateAsyncInput,
  type ForkMandateAsyncInput,
  type InitializeConfigAsyncInput,
  type InitiateRedemptionAsyncInput,
  type OpenEpochAsyncInput,
  type ProposeAmendmentAsyncInput,
  type VoteAmendmentAsyncInput,
} from "./generated/index";
import type { MandateParamsArgs } from "./generated/types";
import { i64, u64 } from "./num";
import { PROGRAM_ID, SEED, seeds, u64le } from "./pda";

// Account decoders, errors, PDAs, program metadata and enums are data-only
// exports. Amount-bearing instruction builders are exposed only through the
// checked wrappers below.
export * from "./generated/accounts/index";
export * from "./generated/errors/index";
export * from "./generated/pdas/index";
export * from "./generated/programs/index";
export * from "./generated/types/index";
export { pda } from "./address";
export * as flows from "./flows";
export * from "./spl";
export { i64, u64 };

// Preserve the stable SDK name used by the web client and existing callers.
// Codama names this PDA from the execution account field (`sourceVault`),
// while the product vocabulary calls it the active USDC vault.
export { findSourceVaultPda as findActiveUsdcVaultPda } from "./generated/pdas/sourceVault";

// Builders whose arguments carry no amounts.
export {
  getAddCircleAssetInstruction,
  getAddCircleAssetInstructionAsync,
  getAddMandateAssetInstruction,
  getCancelContributionInstruction,
  getCancelContributionInstructionAsync,
  getCancelEpochInstruction,
  getClaimRedemptionAssetInstruction,
  getClaimRedemptionAssetInstructionAsync,
  getClaimRedemptionUsdcInstruction,
  getClaimRedemptionUsdcInstructionAsync,
  getCloseContributionsInstruction,
  getCloseEpochInstruction,
  getCreateCircleInstruction,
  getCreateCircleInstructionAsync,
  getEndExecutionInstruction,
  getEndExecutionInstructionAsync,
  getExecuteAmendmentInstruction,
  getExecuteAmendmentInstructionAsync,
  getFinalizeEpochInstruction,
  getFinalizeEpochInstructionAsync,
  getFinalizeMandateInstruction,
  getForkMandateAssetInstruction,
  getForkMandateAssetInstructionAsync,
  getOpenNavSnapshotInstruction,
  getOpenNavSnapshotInstructionAsync,
  getProposeAmendmentInstruction,
  getProposeAmendmentInstructionAsync,
  getRecordAssetNavInstruction,
  getRecordAssetNavInstructionAsync,
  getRefreshAssetMetadataInstruction,
  getRefreshAssetMetadataInstructionAsync,
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
  BeginExecutionAsyncInput,
  ContributeAsyncInput,
  CreateMandateAsyncInput,
  ForkMandateAsyncInput,
  InitializeConfigAsyncInput,
  InitiateRedemptionAsyncInput,
  OpenEpochAsyncInput,
  ProposeAmendmentAsyncInput,
  VoteAmendmentAsyncInput,
} from "./generated/instructions/index";
export { PROGRAM_ID, SEED, seeds, u64le };


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

/** One-time Config creation by the program's upgrade authority (A-18, A-23). */
export function initializeConfig(input: WithBigint<InitializeConfigAsyncInput, "maxPriceAgeSeconds">) {
  return getInitializeConfigInstructionAsync({
    ...input,
    maxPriceAgeSeconds: u64(input.maxPriceAgeSeconds, "maxPriceAgeSeconds"),
  });
}

/**
 * Open an execution window. Must be followed in the SAME transaction by
 * venue instructions only and then `end_execution`; the program refuses
 * anything else.
 */
export function beginExecution(
  input: WithBigint<BeginExecutionAsyncInput, "nonce" | "maxIn" | "minOut" | "expiresAt">,
) {
  return getBeginExecutionInstructionAsync({
    ...input,
    nonce: u64(input.nonce, "nonce"),
    maxIn: u64(input.maxIn, "maxIn"),
    minOut: u64(input.minOut, "minOut"),
    expiresAt: i64(input.expiresAt, "expiresAt"),
  });
}

export type MandateParamsInput = Omit<
  MandateParamsArgs,
  "minContributionUsdc" | "maxPoolSizeUsdc" | "epochDuration" | "amendmentDelaySeconds"
> & {
  minContributionUsdc: bigint;
  maxPoolSizeUsdc: bigint;
  epochDuration: bigint;
  amendmentDelaySeconds: bigint;
};

function checkedParams(p: MandateParamsInput, at: string): MandateParamsArgs {
  return {
    name: p.name,
    description: p.description,
    maxWeightPerAssetBps: p.maxWeightPerAssetBps,
    maxPreIpoWeightBps: p.maxPreIpoWeightBps,
    maxIssuerWeightBps: p.maxIssuerWeightBps,
    maxUnderlyingWeightBps: p.maxUnderlyingWeightBps,
    maxSupplyConsumptionBps: p.maxSupplyConsumptionBps,
    maxPriceImpactBps: p.maxPriceImpactBps,
    minContributionUsdc: u64(p.minContributionUsdc, `${at}minContributionUsdc`),
    maxPoolSizeUsdc: u64(p.maxPoolSizeUsdc, `${at}maxPoolSizeUsdc`),
    epochDuration: i64(p.epochDuration, `${at}epochDuration`),
    membershipPolicy: p.membershipPolicy,
    amendmentThresholdBps: p.amendmentThresholdBps,
    amendmentDelaySeconds: i64(p.amendmentDelaySeconds, `${at}amendmentDelaySeconds`),
  };
}

export function createMandate(
  input: Omit<CreateMandateAsyncInput, "params"> & MandateParamsInput,
) {
  return getCreateMandateInstructionAsync({
    author: input.author,
    mandateSeed: input.mandateSeed,
    mandate: input.mandate,
    systemProgram: input.systemProgram,
    params: checkedParams(input, ""),
  });
}

/**
 * Fork an Active Mandate into a new Draft with the forker's OWN rules; the
 * parent is recorded in `forked_from`. Copy each asset afterwards with
 * `getForkMandateAssetInstructionAsync`, choosing targets that fit the new
 * rules, then finalize.
 */
export function forkMandate(
  input: Omit<ForkMandateAsyncInput, "params"> & { params: MandateParamsInput },
) {
  return getForkMandateInstructionAsync({ ...input, params: checkedParams(input.params, "params.") });
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
    params: checkedParams(input.params, "params."),
  });
}

export function voteAmendment(input: VoteAmendmentAsyncInput) {
  return getVoteAmendmentInstructionAsync(input);
}

export function executeAmendment(input: Parameters<typeof getExecuteAmendmentInstructionAsync>[0]) {
  return getExecuteAmendmentInstructionAsync(input);
}
