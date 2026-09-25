/**
 * Everything that talks to the chain: the Devnet guard, sending through the
 * connected wallet, loading a Circle's full state (vaults, prices, receipts),
 * the Circle directory with fork lineage, and recent activity.
 */
import {
  address, appendTransactionMessageInstructions, createTransactionMessage, fetchEncodedAccounts,
  getBase58Decoder, getBase58Encoder, getBase64Encoder, pipe, setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash, signAndSendTransactionMessageWithSigners,
  type Address, type Instruction, type TransactionSendingSigner,
} from "@solana/kit";
import {
  CIRCLE_ASSET_DISCRIMINATOR, CIRCLE_DISCRIMINATOR, CONTRIBUTION_RECEIPT_DISCRIMINATOR, MANDATE_DISCRIMINATOR,
  TENET_PROGRAM_ADDRESS, createAtaIdempotentIx, decodeAssetRegistryEntry, decodeCircleAsset, decodeMandateAsset, fetchCircle, fetchConfig,
  fetchMandate, fetchMaybeContributionReceipt, tokenAmount, fetchMaybeEpoch, fetchMaybeMember, fetchMaybeNavSnapshot,
  fetchMaybeRedemption, fetchMaybeRedemptionAsset, findAta, getCircleAssetDecoder, getCircleDecoder,
  getContributionReceiptDecoder, getMandateDecoder, mintSupply, pda,
  type AssetRegistryEntry, type Circle, type CircleAsset, type ContributionReceipt, type Epoch, type Mandate,
  type Member, type NavSnapshot, type Redemption, type RedemptionAsset,
} from "@tenet/sdk";
import { assertDevnet } from "@tenet/sdk/devnet";
import {
  activeTransferFee, transferFeeAmount, type TransferFeeConfig,
} from "../../../packages/domain/src/display.ts";
import { INSTRUMENTS, TRANSACTIONS_ENABLED } from "./config.ts";
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
    // The wallet simulates each step on ITS OWN RPC node, which can lag ours
    // by a few slots; without a pause it simulates step N+1 against state from
    // before step N and shows a false "failed to simulate" warning.
    if (i > 0) await new Promise((r) => setTimeout(r, 4_000));
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

  // This Circle's assets. With a known instrument list, derive the
  // CircleAsset PDAs and read them in one batch; getProgramAccounts is the
  // most heavily rate-limited call on the public RPC.
  let assets: { address: Address; asset: CircleAsset }[];
  if (INSTRUMENTS.length) {
    const addrs = await Promise.all(INSTRUMENTS.map(async (i) => (await pda.circleAsset(circleAddr, address(i.mint)))[0]));
    const found = await fetchEncodedAccounts(rpc, addrs);
    assets = found.flatMap((a, i) => (a.exists ? [{ address: addrs[i]!, asset: decodeCircleAsset(a).data }] : []));
  } else {
    const raw = await rpc.getProgramAccounts(TENET_PROGRAM_ADDRESS, {
      encoding: "base64",
      filters: [memcmp(0n, b58.decode(CIRCLE_ASSET_DISCRIMINATOR)), memcmp(8n, circleAddr)],
    }).send();
    assets = raw.map((r) => ({ address: r.pubkey, asset: getCircleAssetDecoder().decode(b64.encode(r.account.data[0])) }));
  }
  assets.sort((a, b) => a.asset.index - b.asset.index);

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
  // Everything per asset — registry, mandate target, vault, mint, price —
  // in ONE getMultipleAccounts request (the public RPC rate-limits bursts).
  const [activeUsdcVault] = await pda.usdcVault(circleAddr);
  const perAsset = await Promise.all(assets.map(async ({ asset }) => [
    (await pda.registry(asset.mint))[0], asset.mandateAsset, asset.vault, asset.mint, await priceProvider.accountFor(asset.mint),
  ] as const));
  const batch = await fetchEncodedAccounts(rpc, [activeUsdcVault, ...perAsset.flat()]);
  const data = (i: number) => { const a = batch[i]!; return a.exists ? (a.data as Uint8Array) : null; };
  const activeUsdcRaw = data(0) ? tokenAmount(data(0)!) : 0n;
  const holdings: Holding[] = assets.map(({ address, asset }, k) => {
    const o = 1 + k * 5;
    const registry = decodeAssetRegistryEntry(batch[o]!);
    const mandateAsset = decodeMandateAsset(batch[o + 1]!);
    if (!registry.exists || !mandateAsset.exists) throw new Error(`asset ${asset.mint} is missing its registry or Mandate entry`);
    return {
      address, asset, registry: registry.data, targetWeightBps: mandateAsset.data.targetWeightBps,
      vaultRaw: data(o + 2) ? tokenAmount(data(o + 2)!) : 0n,
      mintSupplyRaw: data(o + 3) ? mintSupply(data(o + 3)!).supply : 0n,
      price: priceProvider.decode(perAsset[k]![4], batch[o + 4]!),
    };
  });

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

let directoryCache: { at: number; value: Promise<DirectoryEntry[]> } | null = null;

/** Every Circle on this Tenet deployment, with its Mandate (cached 30 s). */
export function loadDirectory(fresh = false): Promise<DirectoryEntry[]> {
  if (!fresh && directoryCache && Date.now() - directoryCache.at < 30_000) return directoryCache.value;
  const value = scanDirectory().catch((e) => { directoryCache = null; throw e; });
  directoryCache = { at: Date.now(), value };
  return value;
}

async function scanDirectory(): Promise<DirectoryEntry[]> {
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
const feeConfigs = new Map<string, Promise<TransferFeeConfig | null>>();
let epochCache: { at: number; epoch: bigint } | null = null;

export async function withheldFee(mint: Address, amount: bigint): Promise<{ fee: bigint; bps: bigint } | null> {
  // The mint's fee schedule is fetched once per page; the epoch at most once a minute.
  if (!feeConfigs.has(mint)) {
    feeConfigs.set(mint, rpc.getAccountInfo(mint, { encoding: "jsonParsed" }).send().then(({ value }) => {
      const parsed = (value?.data as { parsed?: { info?: { extensions?: { extension: string; state: Record<string, never> }[] } } })?.parsed?.info;
      const ext = parsed?.extensions?.find((x) => x.extension === "transferFeeConfig");
      if (!ext) return null;
      const tier = (t: Record<string, unknown>) => ({
        epoch: BigInt(t.epoch as bigint), maximumFee: BigInt(t.maximumFee as bigint),
        transferFeeBasisPoints: BigInt(t.transferFeeBasisPoints as bigint),
      });
      return { olderTransferFee: tier(ext.state.olderTransferFee), newerTransferFee: tier(ext.state.newerTransferFee) };
    }).catch((e) => { feeConfigs.delete(mint); throw e; }));
  }
  const cfg = await feeConfigs.get(mint)!;
  if (!cfg) return null;
  if (!epochCache || Date.now() - epochCache.at > 60_000) {
    epochCache = { at: Date.now(), epoch: BigInt((await rpc.getEpochInfo().send()).epoch) };
  }
  const active = activeTransferFee(cfg, epochCache.epoch);
  if (!active) return null;
  return { fee: transferFeeAmount(amount, active), bps: active.basisPoints };
}

export const b58ToAddress = (s: string): Address => {
  getBase58Encoder().encode(s); // throws on invalid base58
  return address(s);
};
