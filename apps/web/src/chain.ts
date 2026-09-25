/**
 * Everything that talks to the chain: the Devnet guard, sending through the
 * connected wallet, loading a Circle's full state (vaults, prices, receipts),
 * the Circle directory with fork lineage, and recent activity.
 */
import {
  address, appendTransactionMessageInstructions, createTransactionMessage,
  getBase58Decoder, getBase58Encoder, getBase64Encoder, pipe, setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash, signAndSendTransactionMessageWithSigners,
  type Address, type Instruction, type TransactionSendingSigner,
} from "@solana/kit";
import {
  CIRCLE_ASSET_DISCRIMINATOR, CIRCLE_DISCRIMINATOR, CONTRIBUTION_RECEIPT_DISCRIMINATOR, MANDATE_DISCRIMINATOR,
  TENET_PROGRAM_ADDRESS, createAtaIdempotentIx, fetchAssetRegistryEntry, fetchCircle, fetchConfig, fetchMandate,
  fetchMandateAsset, fetchMaybeContributionReceipt, fetchMaybeEpoch, fetchMaybeMember, fetchMaybeNavSnapshot,
  fetchMaybeRedemption, fetchMaybeRedemptionAsset, findAta, getCircleAssetDecoder, getCircleDecoder,
  getContributionReceiptDecoder, getMandateDecoder, mintSupply, pda,
  type AssetRegistryEntry, type Circle, type CircleAsset, type ContributionReceipt, type Epoch, type Mandate,
  type Member, type NavSnapshot, type Redemption, type RedemptionAsset,
} from "@tenet/sdk";
import { assertDevnet } from "@tenet/sdk/devnet";
import {
  activeTransferFee, transferFeeAmount, type TransferFeeConfig,
} from "../../../packages/domain/src/display.ts";
import { TRANSACTIONS_ENABLED } from "./config.ts";
import { priceProvider, type PriceObservation } from "./adapters.ts";
import { rpc } from "./rpc.ts";

export { rpc };

let devnetChecked: Promise<void> | null = null;
/** Fail closed unless the RPC really is Solana Devnet (genesis hash, not URL). */
export function ensureDevnet(): Promise<void> {
  devnetChecked ??= assertDevnet(rpc).catch((e) => { devnetChecked = null; throw e; });
  return devnetChecked;
}

/** Read-only deployment check; an executable account is required before reads. */
export async function isTenetProgramDeployed(): Promise<boolean> {
  const { value } = await rpc.getAccountInfo(TENET_PROGRAM_ADDRESS, { encoding: "base64", commitment: "confirmed" }).send();
  return value?.executable === true;
}

// ---------------------------------------------------------------- sending

/**
 * Sign and send through the wallet, then wait for confirmation. Returns the
 * signature. Throws with the program's logs attached when it fails.
 */
export async function send(signer: TransactionSendingSigner, ixs: Instruction[]): Promise<string> {
  if (!TRANSACTIONS_ENABLED) throw new Error("Devnet is not set up for this build yet; no transaction was sent.");
  await ensureDevnet();
  const { value: blockhash } = await rpc.getLatestBlockhash({ commitment: "confirmed" }).send();
  const msg = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayerSigner(signer, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash(blockhash, m),
    (m) => appendTransactionMessageInstructions(ixs, m),
  );
  const sigBytes = await signAndSendTransactionMessageWithSigners(msg);
  const signature = getBase58Decoder().decode(sigBytes);
  for (let i = 0; i < 60; i++) {
    const { value } = await rpc.getSignatureStatuses([signature as never]).send();
    const s = value[0];
    if (s?.err) {
      const tx = await rpc.getTransaction(signature as never, {
        commitment: "confirmed", encoding: "json", maxSupportedTransactionVersion: 0,
      }).send();
      const logs = tx?.meta?.logMessages?.slice(-8).join("\n") ?? "";
      throw new Error(`transaction failed: ${JSON.stringify(s.err, (_, v) => typeof v === "bigint" ? v.toString() : v)}\n${logs}`);
    }
    if (s?.confirmationStatus === "confirmed" || s?.confirmationStatus === "finalized") return signature;
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`not confirmed after 60s: ${signature}`);
}

/** Send several transactions in order; returns every signature. */
export async function sendGroups(signer: TransactionSendingSigner, groups: Instruction[][], onStep?: (i: number, n: number) => void): Promise<string[]> {
  const sigs: string[] = [];
  for (const [i, g] of groups.entries()) {
    onStep?.(i + 1, groups.length);
    sigs.push(await send(signer, g));
  }
  return sigs;
}

// ---------------------------------------------------------------- token accounts

export const ataAddress = (owner: Address, mint: Address, tokenProgram: Address) => findAta(owner, mint, tokenProgram);
export const createAtaIdempotent = (payer: TransactionSendingSigner, owner: Address, mint: Address, tokenProgram: Address) =>
  createAtaIdempotentIx(payer, owner, mint, tokenProgram);

export async function tokenBalance(account: Address): Promise<bigint | null> {
  try {
    const { value } = await rpc.getTokenAccountBalance(account, { commitment: "confirmed" }).send();
    return BigInt(value.amount); // from the string — never a JS number
  } catch {
    return null; // account does not exist
  }
}

async function mintSupplyOf(mint: Address): Promise<bigint> {
  const { value } = await rpc.getAccountInfo(mint, { encoding: "base64" }).send();
  return value ? mintSupply(getBase64Encoder().encode(value.data[0]) as Uint8Array).supply : 0n;
}

// ---------------------------------------------------------------- circle state

export interface ExitView {
  seq: bigint;
  address: Address;
  redemption: Redemption;
  claims: { mint: Address; address: Address; asset: RedemptionAsset }[];
}

/** One asset the Mandate permits: what it is, its target, the real vault balance and its price. */
export interface Holding {
  address: Address;
  asset: CircleAsset;
  registry: AssetRegistryEntry;
  targetWeightBps: number;
  vaultRaw: bigint;
  mintSupplyRaw: bigint;
  price: PriceObservation | null;
}

export interface CircleView {
  circle: Circle;
  mandate: Mandate;
  mandateAddress: Address;
  usdcMint: Address;
  assets: { address: Address; asset: CircleAsset }[];
  holdings: Holding[];
  activeUsdcRaw: bigint;
  epoch: { address: Address; data: Epoch } | null;
  navSnapshot: { address: Address; data: NavSnapshot } | null;
  /** Every contribution receipt of the current epoch (for settling everyone). */
  receipts: { address: Address; data: ContributionReceipt }[];
  member: Member | null;
  receipt: ContributionReceipt | null;
  exits: ExitView[];
}

const b58 = getBase58Decoder();
const b64 = getBase64Encoder();
const memcmp = (offset: bigint, bytes: string) => ({ memcmp: { offset, bytes: bytes as never, encoding: "base58" as const } });

export async function loadCircle(circleAddr: Address, wallet: Address | null): Promise<CircleView> {
  const circle = (await fetchCircle(rpc, circleAddr)).data;
  const mandate = (await fetchMandate(rpc, circle.mandate)).data;
  const usdcMint = (await fetchConfig(rpc, (await pda.config())[0])).data.usdcMint;

  // Every CircleAsset of this circle: discriminator + circle field (offset 8).
  const raw = await rpc.getProgramAccounts(TENET_PROGRAM_ADDRESS, {
    encoding: "base64",
    filters: [memcmp(0n, b58.decode(CIRCLE_ASSET_DISCRIMINATOR)), memcmp(8n, circleAddr)],
  }).send();
  const assets = raw
    .map((r) => ({ address: r.pubkey, asset: getCircleAssetDecoder().decode(b64.encode(r.account.data[0])) }))
    .sort((a, b) => a.asset.index - b.asset.index);

  const [epochAddr] = await pda.epoch(circleAddr, circle.currentEpoch);
  const e = await fetchMaybeEpoch(rpc, epochAddr);
  const epoch = e.exists ? { address: epochAddr, data: e.data } : null;
  let navSnapshot: CircleView["navSnapshot"] = null;
  let receipts: CircleView["receipts"] = [];
  if (epoch) {
    const [snapshotAddr] = await pda.navSnapshot(epoch.address);
    const snapshot = await fetchMaybeNavSnapshot(rpc, snapshotAddr);
    navSnapshot = snapshot.exists ? { address: snapshotAddr, data: snapshot.data } : null;
    // Receipt layout: discriminator, circle (8), epoch (40), owner (72), ...
    const rr = await rpc.getProgramAccounts(TENET_PROGRAM_ADDRESS, {
      encoding: "base64",
      filters: [memcmp(0n, b58.decode(CONTRIBUTION_RECEIPT_DISCRIMINATOR)), memcmp(40n, epoch.address)],
    }).send();
    receipts = rr.map((r) => ({ address: r.pubkey, data: getContributionReceiptDecoder().decode(b64.encode(r.account.data[0])) }));
  }

  let member: Member | null = null;
  let receipt: ContributionReceipt | null = null;
  const exits: ExitView[] = [];
  if (wallet) {
    const m = await fetchMaybeMember(rpc, (await pda.member(circleAddr, wallet))[0]);
    member = m.exists ? m.data : null;
    if (epoch) {
      const r = await fetchMaybeContributionReceipt(rpc, (await pda.receipt(epoch.address, wallet))[0]);
      receipt = r.exists ? r.data : null;
    }
    for (let seq = 0n; member && seq < member.nextRedemptionSeq; seq++) {
      const [rAddr] = await pda.redemption(circleAddr, wallet, seq);
      const r = await fetchMaybeRedemption(rpc, rAddr);
      if (!r.exists) continue;
      const claims: ExitView["claims"] = [];
      for (const mint of [...assets.map((a) => a.asset.mint), usdcMint]) {
        const [raAddr] = await pda.redemptionAsset(rAddr, mint);
        const ra = await fetchMaybeRedemptionAsset(rpc, raAddr);
        if (ra.exists) claims.push({ mint, address: raAddr, asset: ra.data });
      }
      exits.push({ seq, address: rAddr, redemption: r.data, claims });
    }
  }
  const [activeUsdcVault] = await pda.usdcVault(circleAddr);
  const [holdings, activeUsdcRaw] = await Promise.all([
    Promise.all(assets.map(async ({ address, asset }) => {
      const [registryAddr] = await pda.registry(asset.mint);
      const [registry, mandateAsset, vaultRaw, mintSupplyRaw, price] = await Promise.all([
        fetchAssetRegistryEntry(rpc, registryAddr),
        fetchMandateAsset(rpc, asset.mandateAsset),
        tokenBalance(asset.vault),
        mintSupplyOf(asset.mint),
        priceProvider.get(asset.mint).catch(() => null),
      ]);
      return {
        address, asset, registry: registry.data, targetWeightBps: mandateAsset.data.targetWeightBps,
        vaultRaw: vaultRaw ?? 0n, mintSupplyRaw, price,
      };
    })),
    tokenBalance(activeUsdcVault).then((b) => b ?? 0n),
  ]);

  return {
    circle, mandate, mandateAddress: circle.mandate, usdcMint, assets, holdings, activeUsdcRaw, epoch, navSnapshot,
    receipts, member, receipt, exits,
  };
}

// ---------------------------------------------------------------- directory & lineage

export interface DirectoryEntry {
  circle: Address;
  data: Circle;
  mandateAddress: Address;
  mandate: Mandate;
}

/** Every Circle on this Tenet deployment, with its Mandate. */
export async function loadDirectory(): Promise<DirectoryEntry[]> {
  const [circles, mandates] = await Promise.all([
    rpc.getProgramAccounts(TENET_PROGRAM_ADDRESS, { encoding: "base64", filters: [memcmp(0n, b58.decode(CIRCLE_DISCRIMINATOR))] }).send(),
    rpc.getProgramAccounts(TENET_PROGRAM_ADDRESS, { encoding: "base64", filters: [memcmp(0n, b58.decode(MANDATE_DISCRIMINATOR))] }).send(),
  ]);
  const byAddress = new Map(mandates.map((m) => [m.pubkey, getMandateDecoder().decode(b64.encode(m.account.data[0]))]));
  return circles.flatMap((c) => {
    const data = getCircleDecoder().decode(b64.encode(c.account.data[0]));
    const mandate = byAddress.get(data.mandate);
    return mandate ? [{ circle: c.pubkey, data, mandateAddress: data.mandate, mandate }] : [];
  }).sort((a, b) => Number(b.data.createdAt - a.data.createdAt));
}

/** Ancestors (oldest first) and direct children of a Mandate, from the directory. */
export function lineage(dir: DirectoryEntry[], mandate: Address) {
  const byMandate = new Map(dir.map((d) => [d.mandateAddress, d]));
  const ancestors: DirectoryEntry[] = [];
  let cur = byMandate.get(mandate);
  const seen = new Set<Address>();
  while (cur && cur.mandate.forkedFrom.__option === "Some" && !seen.has(cur.mandateAddress)) {
    seen.add(cur.mandateAddress);
    const parent = byMandate.get(cur.mandate.forkedFrom.value);
    if (!parent) break;
    ancestors.unshift(parent);
    cur = parent;
  }
  const children = dir.filter((d) => d.mandate.forkedFrom.__option === "Some" && d.mandate.forkedFrom.value === mandate);
  return { ancestors, children };
}

// ---------------------------------------------------------------- activity

export interface ActivityItem {
  signature: string;
  slot: bigint;
  blockTime: bigint | null;
  ok: boolean;
  memo: string | null;
}

/** Recent transactions that touched this Circle account, newest first. */
export async function loadActivity(circle: Address, limit = 25): Promise<ActivityItem[]> {
  const sigs = await rpc.getSignaturesForAddress(circle, { limit }).send();
  return sigs.map((s) => ({ signature: s.signature, slot: s.slot, blockTime: s.blockTime ?? null, ok: s.err === null, memo: s.memo ?? null }));
}

// ---------------------------------------------------------------- transfer fee

/**
 * The fee Token-2022 will withhold when `amount` of `mint` is transferred NOW.
 * The mint is read with jsonParsed encoding (Kit returns its integers as
 * bigint), and the tier is chosen by the domain's `activeTransferFee`, which is
 * tested against real SPACEX data (V-004): the newer fee applies only once its
 * epoch has arrived.
 */
export async function withheldFee(mint: Address, amount: bigint): Promise<{ fee: bigint; bps: bigint } | null> {
  const [{ value }, epochInfo] = await Promise.all([
    rpc.getAccountInfo(mint, { encoding: "jsonParsed" }).send(),
    rpc.getEpochInfo().send(),
  ]);
  const parsed = (value?.data as { parsed?: { info?: { extensions?: { extension: string; state: Record<string, never> }[] } } })
    ?.parsed?.info;
  const ext = parsed?.extensions?.find((x) => x.extension === "transferFeeConfig");
  if (!ext) return null;
  const tier = (t: Record<string, unknown>) => ({
    epoch: BigInt(t.epoch as bigint), maximumFee: BigInt(t.maximumFee as bigint),
    transferFeeBasisPoints: BigInt(t.transferFeeBasisPoints as bigint),
  });
  const cfg: TransferFeeConfig = {
    olderTransferFee: tier(ext.state.olderTransferFee),
    newerTransferFee: tier(ext.state.newerTransferFee),
  };
  const active = activeTransferFee(cfg, BigInt(epochInfo.epoch));
  if (!active) return null;
  return { fee: transferFeeAmount(amount, active), bps: active.basisPoints };
}

export const b58ToAddress = (s: string): Address => {
  getBase58Encoder().encode(s); // throws on invalid base58
  return address(s);
};
