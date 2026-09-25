/**
 * Product flows as instruction groups: POOL, EXECUTE, VALUE, EXIT, FORK.
 *
 * Each function returns `Instruction[][]`, one inner array per transaction,
 * in order. Every account is passed explicitly (addresses from `pda`), so
 * nothing depends on Codama's partial auto-derivation. The same builders
 * drive the web app and scripts/devnet-e2e.ts, so the script exercises
 * exactly what the UI sends.
 *
 * Venue-agnostic: `execute` takes the venue instructions (a Jupiter route on
 * mainnet, a tenet-devnet `buy` on Devnet) and wraps them in Tenet's window.
 */
import type { Address, Instruction, TransactionSigner } from "@solana/kit";
import { pda } from "./address";
import {
  getAddCircleAssetInstruction,
  getAddMandateAssetInstruction,
  getBeginExecutionInstruction,
  getCancelContributionInstruction,
  getClaimRedemptionAssetInstruction,
  getClaimRedemptionUsdcInstruction,
  getCloseContributionsInstruction,
  getCloseEpochInstruction,
  getContributeInstruction,
  getCreateCircleInstruction,
  getCreateMandateInstruction,
  getEndExecutionInstruction,
  getFinalizeEpochInstruction,
  getFinalizeMandateInstruction,
  getForkMandateAssetInstruction,
  getForkMandateInstruction,
  getInitiateRedemptionInstruction,
  getOpenEpochInstruction,
  getOpenNavSnapshotInstruction,
  getRecordAssetNavInstruction,
  getRefreshAssetMetadataInstruction,
  getReserveRedemptionAssetInstruction,
  getReserveRedemptionUsdcInstruction,
  getSettleContributionInstruction,
} from "./generated/instructions/index";
import { AccountRole } from "@solana/kit";
import { i64, u64 } from "./num";
import type { MandateParamsInput } from "./index";
import {
  INSTRUCTIONS_SYSVAR, SYSTEM_PROGRAM, TOKEN_PROGRAM, createAtaIdempotentIx, findAta, setComputeUnitLimitIx,
} from "./spl";

export type Groups = Instruction[][];

export interface AssetRef {
  mint: Address;
  tokenProgram: Address;
}

export interface TargetedAsset extends AssetRef {
  targetWeightBps: number;
}

function chunk<T>(xs: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
}

function params(p: MandateParamsInput) {
  return {
    ...p,
    minContributionUsdc: u64(p.minContributionUsdc, "minContributionUsdc"),
    maxPoolSizeUsdc: u64(p.maxPoolSizeUsdc, "maxPoolSizeUsdc"),
    epochDuration: i64(p.epochDuration, "epochDuration"),
    amendmentDelaySeconds: i64(p.amendmentDelaySeconds, "amendmentDelaySeconds"),
  };
}

// ================================================================ POOL

async function finalizeMandateIx(author: TransactionSigner, mandate: Address, mints: Address[]): Promise<Instruction> {
  const ix = getFinalizeMandateInstruction({ author, mandate });
  const rest = [];
  for (const m of mints) {
    rest.push({ address: (await pda.mandateAsset(mandate, m))[0], role: AccountRole.READONLY });
    rest.push({ address: (await pda.registry(m))[0], role: AccountRole.READONLY });
  }
  return { ...ix, accounts: [...ix.accounts, ...rest] };
}

/** Circle + CircleAssets for an Active Mandate, then Epoch 0 opened. */
export async function circleForMandate(input: {
  creator: TransactionSigner;
  mandate: Address;
  assets: AssetRef[];
  usdcMint: Address;
  /** Open Epoch 0 now (scripts). The UI leaves it to the first contribution. */
  openFirstEpoch?: boolean;
}): Promise<Groups> {
  const { creator, mandate, usdcMint } = input;
  const [circle] = await pda.circle(mandate);
  const [vaultAuthority] = await pda.vaultAuthority(circle);
  const [activeUsdcVault] = await pda.usdcVault(circle);
  const create = getCreateCircleInstruction({
    creator, config: (await pda.config())[0], mandate, usdcMint, tokenProgram: TOKEN_PROGRAM,
    circle, vaultAuthority, activeUsdcVault, systemProgram: SYSTEM_PROGRAM,
  });
  const adds: Instruction[] = [];
  for (const a of input.assets) {
    adds.push(getAddCircleAssetInstruction({
      payer: creator, circle, mandateAsset: (await pda.mandateAsset(mandate, a.mint))[0], mint: a.mint,
      tokenProgram: a.tokenProgram, vaultAuthority, circleAsset: (await pda.circleAsset(circle, a.mint))[0],
      vault: (await pda.assetVault(circle, a.mint))[0], systemProgram: SYSTEM_PROGRAM,
    }));
  }
  if (input.openFirstEpoch === false) return [[create], ...chunk(adds, 3)];
  const open = await openEpoch({ payer: creator, circle, mandate, usdcMint, index: 0n });
  return [[create], ...chunk(adds, 3), open];
}

/** Draft -> assets -> finalize (Active) -> Circle -> Epoch 0. */
export async function createMandateAndCircle(input: {
  author: TransactionSigner;
  mandateSeed: Address;
  params: MandateParamsInput;
  assets: TargetedAsset[];
  usdcMint: Address;
  openFirstEpoch?: boolean;
}): Promise<{ mandate: Address; circle: Address; groups: Groups }> {
  const { author, mandateSeed, assets } = input;
  const [mandate] = await pda.mandate(mandateSeed);
  const draft: Instruction[] = [
    getCreateMandateInstruction({ author, mandateSeed, mandate, systemProgram: SYSTEM_PROGRAM, params: params(input.params) }),
  ];
  for (const a of assets) {
    draft.push(getAddMandateAssetInstruction({
      author, mandate, mandateAsset: (await pda.mandateAsset(mandate, a.mint))[0],
      registryEntry: (await pda.registry(a.mint))[0], systemProgram: SYSTEM_PROGRAM,
      targetWeightBps: a.targetWeightBps,
    }));
  }
  const finalize = await finalizeMandateIx(author, mandate, assets.map((a) => a.mint));
  const circleGroups = await circleForMandate({ creator: author, mandate, assets, usdcMint: input.usdcMint, openFirstEpoch: input.openFirstEpoch });
  return { mandate, circle: (await pda.circle(mandate))[0], groups: [draft, [finalize], ...circleGroups] };
}

export async function openEpoch(input: { payer: TransactionSigner; circle: Address; mandate: Address; usdcMint: Address; index: bigint }): Promise<Instruction[]> {
  const { payer, circle, mandate, usdcMint, index } = input;
  return [getOpenEpochInstruction({
    payer, circle, mandate, epoch: (await pda.epoch(circle, index))[0], activeUsdcVault: (await pda.usdcVault(circle))[0],
    usdcMint, vaultAuthority: (await pda.vaultAuthority(circle))[0], tokenProgram: TOKEN_PROGRAM,
    epochEscrow: (await pda.epochEscrow(circle, index))[0], systemProgram: SYSTEM_PROGRAM, index: u64(index, "index"),
  })];
}

/** Contribute raw USDC into the open epoch's escrow, from the contributor's ATA. */
export async function contribute(input: { contributor: TransactionSigner; circle: Address; mandate: Address; usdcMint: Address; index: bigint; amount: bigint }): Promise<Instruction[]> {
  const { contributor, circle, mandate, usdcMint, index } = input;
  const [epoch] = await pda.epoch(circle, index);
  return [getContributeInstruction({
    contributor, circle, mandate, epoch, receipt: (await pda.receipt(epoch, contributor.address))[0],
    contributorUsdc: await findAta(contributor.address, usdcMint, TOKEN_PROGRAM),
    epochEscrow: (await pda.epochEscrow(circle, index))[0], activeUsdcVault: (await pda.usdcVault(circle))[0],
    usdcMint, tokenProgram: TOKEN_PROGRAM, systemProgram: SYSTEM_PROGRAM, amount: u64(input.amount, "amount"),
  })];
}

/** Withdraw the whole contribution back to the contributor's ATA (Open or Cancelled epochs). */
export async function cancelContribution(input: { contributor: TransactionSigner; circle: Address; usdcMint: Address; index: bigint }): Promise<Instruction[]> {
  const { contributor, circle, usdcMint, index } = input;
  const [epoch] = await pda.epoch(circle, index);
  return [getCancelContributionInstruction({
    contributor, circle, epoch, receipt: (await pda.receipt(epoch, contributor.address))[0],
    epochEscrow: (await pda.epochEscrow(circle, index))[0],
    contributorUsdc: await findAta(contributor.address, usdcMint, TOKEN_PROGRAM),
    usdcMint, vaultAuthority: (await pda.vaultAuthority(circle))[0], tokenProgram: TOKEN_PROGRAM,
  })];
}

export async function closeContributions(input: { payer: TransactionSigner; circle: Address; index: bigint }): Promise<Instruction[]> {
  return [getCloseContributionsInstruction({ payer: input.payer, epoch: (await pda.epoch(input.circle, input.index))[0] })];
}

/** Epoch 0 finalization: no oracle, shares = micro-USDC. */
/**
 * Finalization while the Circle has no shares yet: no oracle, 1 share per
 * micro-USDC. Usually window 0; a later index if earlier windows had nobody.
 */
export async function finalizeEpochZero(input: { payer: TransactionSigner; circle: Address; usdcMint: Address; index?: bigint }): Promise<Instruction[]> {
  return [await finalizeEpochIx({ ...input, index: input.index ?? 0n, withSnapshot: false })];
}

async function finalizeEpochIx(input: { payer: TransactionSigner; circle: Address; usdcMint: Address; index: bigint; withSnapshot: boolean }): Promise<Instruction> {
  const { payer, circle, usdcMint, index } = input;
  const [epoch] = await pda.epoch(circle, index);
  return getFinalizeEpochInstruction({
    payer, circle, epoch, epochEscrow: (await pda.epochEscrow(circle, index))[0],
    navSnapshot: input.withSnapshot ? (await pda.navSnapshot(epoch))[0] : undefined,
    activeUsdcVault: (await pda.usdcVault(circle))[0], usdcMint,
    vaultAuthority: (await pda.vaultAuthority(circle))[0], tokenProgram: TOKEN_PROGRAM,
  });
}

/**
 * Rolling-epoch finalization at an on-chain NAV: refresh registry metadata,
 * open the snapshot (freezes execution), record every asset from its real
 * vault and price account, then finalize. The snapshot must complete within
 * ~150 slots, so send the groups back to back.
 */
export async function finalizeRollingEpoch(input: {
  payer: TransactionSigner;
  circle: Address;
  mandate: Address;
  usdcMint: Address;
  index: bigint;
  assets: (AssetRef & { priceAccount: Address })[];
}): Promise<Groups> {
  const { payer, circle, mandate, index } = input;
  const [epoch] = await pda.epoch(circle, index);
  const [navSnapshot] = await pda.navSnapshot(epoch);
  const [vaultAuthority] = await pda.vaultAuthority(circle);
  const [config] = await pda.config();
  const refresh: Instruction[] = [];
  const record: Instruction[] = [];
  for (const a of input.assets) {
    const [registryEntry] = await pda.registry(a.mint);
    refresh.push(getRefreshAssetMetadataInstruction({ payer, registryEntry, mint: a.mint }));
    record.push(getRecordAssetNavInstruction({
      payer, circle, epoch, navSnapshot, circleAsset: (await pda.circleAsset(circle, a.mint))[0],
      mandateAsset: (await pda.mandateAsset(mandate, a.mint))[0], registryEntry,
      vault: (await pda.assetVault(circle, a.mint))[0], mint: a.mint, config, priceAccount: a.priceAccount, vaultAuthority,
    }));
  }
  const open = getOpenNavSnapshotInstruction({
    payer, circle, epoch, navSnapshot, activeUsdcVault: (await pda.usdcVault(circle))[0], vaultAuthority, systemProgram: SYSTEM_PROGRAM,
  });
  const finalize = await finalizeEpochIx({ payer, circle, usdcMint: input.usdcMint, index, withSnapshot: true });
  return [[...refresh, open], ...chunk(record, 3), [finalize]];
}

/** Issue shares to each contributor of a finalized epoch (permissionless). */
export async function settle(input: { payer: TransactionSigner; circle: Address; index: bigint; owners: Address[] }): Promise<Groups> {
  const { payer, circle, index } = input;
  const [epoch] = await pda.epoch(circle, index);
  const ixs: Instruction[] = [];
  for (const owner of input.owners) {
    ixs.push(getSettleContributionInstruction({
      payer, circle, epoch, receipt: (await pda.receipt(epoch, owner))[0], owner,
      member: (await pda.member(circle, owner))[0], systemProgram: SYSTEM_PROGRAM,
    }));
  }
  return chunk(ixs, 4);
}

export async function closeEpoch(input: { payer: TransactionSigner; circle: Address; index: bigint }): Promise<Instruction[]> {
  return [getCloseEpochInstruction({ payer: input.payer, circle: input.circle, epoch: (await pda.epoch(input.circle, input.index))[0] })];
}

// ================================================================ EXECUTE

/**
 * One execution: [compute limit, begin_execution, ...venue, end_execution].
 * `epochIndex` is the most recently COMPLETED epoch (circle.current_epoch - 1);
 * its NAV bounds the post-trade target weight. The venue must spend from the
 * Circle's USDC vault (the executor is its delegate for `maxIn` inside the
 * window) and deliver into the Circle's asset vault.
 */
export async function execute(input: {
  executor: TransactionSigner;
  circle: Address;
  mandate: Address;
  usdcMint: Address;
  epochIndex: bigint;
  asset: AssetRef;
  priceAccount: Address;
  nonce: bigint;
  maxIn: bigint;
  minOut: bigint;
  expiresAt: bigint;
  venue: Instruction[];
}): Promise<Instruction[]> {
  const { executor, circle, mandate, usdcMint, asset } = input;
  const [epoch] = await pda.epoch(circle, input.epochIndex);
  const [executionAuth] = await pda.execAuth(circle, epoch, input.nonce);
  const shared = {
    executor, circle, mandate, epoch, executionAuth,
    circleAssetOut: (await pda.circleAsset(circle, asset.mint))[0],
    sourceVault: (await pda.usdcVault(circle))[0],
    destVault: (await pda.assetVault(circle, asset.mint))[0],
    inMint: usdcMint, outMint: asset.mint,
    mandateAssetOut: (await pda.mandateAsset(mandate, asset.mint))[0],
    sourceTokenProgram: TOKEN_PROGRAM,
    vaultAuthority: (await pda.vaultAuthority(circle))[0],
    config: (await pda.config())[0],
  };
  const begin = getBeginExecutionInstruction({
    ...shared, destTokenProgram: asset.tokenProgram, instructionsSysvar: INSTRUCTIONS_SYSVAR, systemProgram: SYSTEM_PROGRAM,
    nonce: u64(input.nonce, "nonce"), maxIn: u64(input.maxIn, "maxIn"), minOut: u64(input.minOut, "minOut"),
    expiresAt: i64(input.expiresAt, "expiresAt"),
  });
  const end = getEndExecutionInstruction({
    ...shared, registryEntry: (await pda.registry(asset.mint))[0], priceAccount: input.priceAccount,
  });
  // The window rule is "begin, venue..., end": the compute-budget
  // instruction therefore goes BEFORE begin.
  return [setComputeUnitLimitIx(600_000), begin, ...input.venue, end];
}

// ================================================================ EXIT

/**
 * Exit `shares` in kind: initiate, reserve every asset and USDC (a
 * snapshot of the member's pro-rata slice), then claim each into the
 * member's own associated token accounts (created if missing).
 */
export async function exitInKind(input: {
  owner: TransactionSigner;
  circle: Address;
  seq: bigint;
  shares: bigint;
  assets: AssetRef[];
  usdcMint: Address;
}): Promise<Groups> {
  const { owner, circle, seq } = input;
  const [redemption] = await pda.redemption(circle, owner.address, seq);
  const [vaultAuthority] = await pda.vaultAuthority(circle);
  const [activeUsdcVault] = await pda.usdcVault(circle);
  const initiate = getInitiateRedemptionInstruction({
    memberOwner: owner, circle, member: (await pda.member(circle, owner.address))[0], redemption,
    systemProgram: SYSTEM_PROGRAM, shares: u64(input.shares, "shares"),
  });
  const reserves: Instruction[] = [];
  const claims: Instruction[][] = [];
  for (const a of input.assets) {
    const circleAsset = (await pda.circleAsset(circle, a.mint))[0];
    const vault = (await pda.assetVault(circle, a.mint))[0];
    const redemptionAsset = (await pda.redemptionAsset(redemption, a.mint))[0];
    reserves.push(getReserveRedemptionAssetInstruction({ payer: owner, circle, redemption, circleAsset, vault, redemptionAsset, systemProgram: SYSTEM_PROGRAM }));
    claims.push([
      await createAtaIdempotentIx(owner, owner.address, a.mint, a.tokenProgram),
      getClaimRedemptionAssetInstruction({
        memberOwner: owner, circle, redemption, circleAsset, redemptionAsset, vault, mint: a.mint,
        tokenProgram: a.tokenProgram, memberTokenAccount: await findAta(owner.address, a.mint, a.tokenProgram), vaultAuthority,
      }),
    ]);
  }
  const usdcRedemptionAsset = (await pda.redemptionAsset(redemption, input.usdcMint))[0];
  reserves.push(getReserveRedemptionUsdcInstruction({ payer: owner, circle, redemption, activeUsdcVault, redemptionAsset: usdcRedemptionAsset, systemProgram: SYSTEM_PROGRAM }));
  claims.push([
    await createAtaIdempotentIx(owner, owner.address, input.usdcMint, TOKEN_PROGRAM),
    getClaimRedemptionUsdcInstruction({
      memberOwner: owner, circle, redemption, activeUsdcVault, redemptionAsset: usdcRedemptionAsset, usdcMint: input.usdcMint,
      tokenProgram: TOKEN_PROGRAM, memberUsdc: await findAta(owner.address, input.usdcMint, TOKEN_PROGRAM), vaultAuthority,
    }),
  ]);
  // Initiate and reserve in as few transactions as fit; claims two per tx.
  const [first, ...rest] = chunk(reserves, 3);
  return [[initiate, ...(first ?? [])], ...rest, ...chunk(claims, 2).map((g) => g.flat())];
}

// ================================================================ FORK

/**
 * Fork an Active Mandate with the forker's own rules and targets, activate
 * it, and stand up its own Circle with Epoch 0 open. Nothing of the parent's
 * Circle is touched: the child starts with empty, independent vaults.
 */
export async function forkMandateAndCircle(input: {
  forker: TransactionSigner;
  parentMandate: Address;
  newMandateSeed: Address;
  params: MandateParamsInput;
  /** In the PARENT's asset order (fork copies asset i to index i). */
  assets: TargetedAsset[];
  usdcMint: Address;
  openFirstEpoch?: boolean;
}): Promise<{ mandate: Address; circle: Address; groups: Groups }> {
  const { forker, parentMandate, newMandateSeed } = input;
  const [newMandate] = await pda.mandate(newMandateSeed);
  const fork: Instruction[] = [
    getForkMandateInstruction({ forker, parentMandate, newMandateSeed, newMandate, systemProgram: SYSTEM_PROGRAM, params: params(input.params) }),
  ];
  for (const a of input.assets) {
    fork.push(getForkMandateAssetInstruction({
      forker, parentMandate, mint: a.mint, parentAsset: (await pda.mandateAsset(parentMandate, a.mint))[0], newMandate,
      newAsset: (await pda.mandateAsset(newMandate, a.mint))[0], registryEntry: (await pda.registry(a.mint))[0],
      systemProgram: SYSTEM_PROGRAM, targetWeightBps: a.targetWeightBps,
    }));
  }
  const finalize = await finalizeMandateIx(forker, newMandate, input.assets.map((a) => a.mint));
  const circleGroups = await circleForMandate({ creator: forker, mandate: newMandate, assets: input.assets, usdcMint: input.usdcMint, openFirstEpoch: input.openFirstEpoch });
  return { mandate: newMandate, circle: (await pda.circle(newMandate))[0], groups: [fork, [finalize], ...circleGroups] };
}
