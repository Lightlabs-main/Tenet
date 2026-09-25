/**
 * Everything that talks to the chain: sending through the connected wallet,
 * loading a Circle's full state, and the transfer-fee lookup for exit claims.
 */
import {
  AccountRole, address, appendTransactionMessageInstructions, createSolanaRpc,
  createTransactionMessage, getAddressEncoder, getBase58Decoder, getBase58Encoder,
  getBase64Encoder, getProgramDerivedAddress, pipe, setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash, signAndSendTransactionMessageWithSigners,
  type Address, type Instruction, type TransactionSendingSigner,
} from "@solana/kit";
import {
  CIRCLE_ASSET_DISCRIMINATOR, TENET_PROGRAM_ADDRESS, seeds,
  fetchCircle, fetchMandate, fetchMaybeEpoch, fetchMaybeMember, fetchMaybeContributionReceipt,
  fetchMaybeNavSnapshot,
  fetchMaybeRedemption, fetchMaybeRedemptionAsset, getCircleAssetDecoder,
  fetchAssetRegistryEntry, fetchMandateAsset, fetchConfig,
  findActiveUsdcVaultPda, findConfigPda, findEpochPda, findMemberPda, findReceiptPda, findRegistryEntryPda,
  findNavSnapshotPda,
  type AssetRegistryEntry, type Circle, type CircleAsset, type Epoch, type Mandate, type Member,
  type ContributionReceipt, type Redemption, type RedemptionAsset, type NavSnapshot,
} from "@tenet/sdk";
import {
  activeTransferFee, transferFeeAmount, type TransferFeeConfig,
} from "../../../packages/domain/src/display.ts";
import { ATA_PROGRAM, RPC_URL, SYSTEM_PROGRAM, TRANSACTIONS_ENABLED } from "./config.ts";

export const rpc = createSolanaRpc(RPC_URL);

/** Read-only deployment check; an executable account is required before reads. */
export async function isTenetProgramDeployed(): Promise<boolean> {
  const { value } = await rpc.getAccountInfo(TENET_PROGRAM_ADDRESS, {
    encoding: "base64",
    commitment: "finalized",
  }).send();
  return value?.executable === true;
}

const DEVNET_TEST_MARKET_BINARY_SHA256 = "bac5398fc6e020b5c39692555ddb2d68a789cf6fc5367de8ef7f9d5fbc5d2ce2";
let testMarketBuildCheck: { at: number; current: boolean | null } | null = null;

/** Enable test-market wallet actions only when the exact tested program build is live. */
export async function isDevnetTestMarketBuildDeployed(): Promise<boolean | null> {
  if (testMarketBuildCheck && Date.now() - testMarketBuildCheck.at < 30_000) return testMarketBuildCheck.current;
  try {
    const { value: program } = await rpc.getAccountInfo(TENET_PROGRAM_ADDRESS, { encoding: "base64", commitment: "finalized" }).send();
    if (!program?.executable || !Array.isArray(program.data)) throw new Error("Program account is unavailable");
    const programState = getBase64Encoder().encode(program.data[0]);
    if (programState.length < 36 || new DataView(programState.buffer, programState.byteOffset, 4).getUint32(0, true) !== 2) {
      throw new Error("Program loader state is invalid");
    }
    const programDataAddress = address(getBase58Decoder().decode(programState.slice(4, 36)));
    const { value: programData } = await rpc.getAccountInfo(programDataAddress, { encoding: "base64", commitment: "finalized" }).send();
    if (!programData || !Array.isArray(programData.data)) throw new Error("ProgramData account is unavailable");
    const bytes = getBase64Encoder().encode(programData.data[0]);
    if (bytes.length < 45 || new DataView(bytes.buffer, bytes.byteOffset, 4).getUint32(0, true) !== 3) {
      throw new Error("ProgramData loader state is invalid");
    }
    const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes.slice(45));
    const hash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
    const current = hash === DEVNET_TEST_MARKET_BINARY_SHA256;
    testMarketBuildCheck = { at: Date.now(), current };
    return current;
  } catch {
    testMarketBuildCheck = { at: Date.now(), current: null };
    return null;
  }
}

const addrBytes = (a: Address) => new Uint8Array(getAddressEncoder().encode(a));

/** PDAs Codama did not generate, from the SDK's Rust-verified seeds. */
export async function tenetPda(seedList: Uint8Array[]): Promise<Address> {
  const [a] = await getProgramDerivedAddress({ programAddress: TENET_PROGRAM_ADDRESS, seeds: seedList });
  return a;
}
export const redemptionPda = (circle: Address, owner: Address, seq: bigint) =>
  tenetPda(seeds.redemption(addrBytes(circle), addrBytes(owner), seq));
export const redemptionAssetPda = (redemption: Address, mint: Address) =>
  tenetPda(seeds.redemptionAsset(addrBytes(redemption), addrBytes(mint)));

// ---------------------------------------------------------------- sending

/**
 * Sign and send through the wallet, then wait for confirmation. Returns the
 * signature. Throws with the program's logs attached when it fails.
 */
export async function send(signer: TransactionSendingSigner, ixs: Instruction[]): Promise<string> {
  if (!TRANSACTIONS_ENABLED) throw new Error("Devnet wallet transactions are disabled in this build.");
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
      const logs = tx?.meta?.logMessages?.slice(-6).join("\n") ?? "";
      throw new Error(`transaction failed: ${JSON.stringify(s.err, (_, v) => typeof v === "bigint" ? v.toString() : v)}\n${logs}`);
    }
    if (s?.confirmationStatus === "confirmed" || s?.confirmationStatus === "finalized") return signature;
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`not confirmed after 60s: ${signature}`);
}

// ---------------------------------------------------------------- token accounts

export async function ataAddress(owner: Address, mint: Address, tokenProgram: Address): Promise<Address> {
  const [a] = await getProgramDerivedAddress({
    programAddress: ATA_PROGRAM,
    seeds: [addrBytes(owner), addrBytes(tokenProgram), addrBytes(mint)],
  });
  return a;
}

/**
 * Associated Token Account "create idempotent" (instruction 1): a no-op if the
 * account exists. Built by hand to avoid pulling a token-program client into
 * the app for one instruction.
 */
export function createAtaIdempotent(
  payer: TransactionSendingSigner, ata: Address, owner: Address, mint: Address, tokenProgram: Address,
): Instruction {
  return {
    programAddress: ATA_PROGRAM,
    accounts: [
      { address: payer.address, role: AccountRole.WRITABLE_SIGNER, signer: payer } as never,
      { address: ata, role: AccountRole.WRITABLE },
      { address: owner, role: AccountRole.READONLY },
      { address: mint, role: AccountRole.READONLY },
      { address: SYSTEM_PROGRAM, role: AccountRole.READONLY },
      { address: tokenProgram, role: AccountRole.READONLY },
    ],
    data: new Uint8Array([1]),
  };
}

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

/** One asset the Circle holds: what it is, what the Mandate targets, and what
 * the vault actually contains. All values are read from the chain. */
export interface Holding {
  address: Address;
  asset: CircleAsset;
  registry: AssetRegistryEntry;
  targetWeightBps: number;
  vaultRaw: bigint;
}

export interface CircleView {
  circle: Circle;
  mandate: Mandate;
  usdcMint: Address;
  assets: { address: Address; asset: CircleAsset }[];
  holdings: Holding[];
  activeUsdcRaw: bigint;
  epoch: { address: Address; data: Epoch } | null;
  navSnapshot: { address: Address; data: NavSnapshot } | null;
  member: Member | null;
  receipt: ContributionReceipt | null;
  exits: ExitView[];
}

export async function loadCircle(circleAddr: Address, wallet: Address | null): Promise<CircleView> {
  const circle = (await fetchCircle(rpc, circleAddr)).data;
  const mandate = (await fetchMandate(rpc, circle.mandate)).data;
  const [configAddr] = await findConfigPda();
  const usdcMint = (await fetchConfig(rpc, configAddr)).data.usdcMint;

  // Every CircleAsset of this circle: discriminator + circle field (offset 8).
  const b58 = getBase58Decoder();
  const raw = await rpc.getProgramAccounts(TENET_PROGRAM_ADDRESS, {
    encoding: "base64",
    filters: [
      { memcmp: { offset: 0n, bytes: b58.decode(CIRCLE_ASSET_DISCRIMINATOR) as never, encoding: "base58" } },
      { memcmp: { offset: 8n, bytes: circleAddr as never, encoding: "base58" } },
    ],
  }).send();
  const b64 = getBase64Encoder();
  const assets = raw
    .map((r) => ({ address: r.pubkey, asset: getCircleAssetDecoder().decode(b64.encode(r.account.data[0])) }))
    .sort((a, b) => a.asset.index - b.asset.index);

  const [epochAddr] = await findEpochPda({ circle: circleAddr, index: circle.currentEpoch });
  const e = await fetchMaybeEpoch(rpc, epochAddr);
  const epoch = e.exists ? { address: epochAddr, data: e.data } : null;
  let navSnapshot: CircleView["navSnapshot"] = null;
  if (epoch) {
    const [snapshotAddr] = await findNavSnapshotPda({ epoch: epoch.address });
    const snapshot = await fetchMaybeNavSnapshot(rpc, snapshotAddr);
    navSnapshot = snapshot.exists ? { address: snapshotAddr, data: snapshot.data } : null;
  }

  let member: Member | null = null;
  let receipt: ContributionReceipt | null = null;
  const exits: ExitView[] = [];
  if (wallet) {
    const [memberAddr] = await findMemberPda({ circle: circleAddr, buyer: wallet });
    const m = await fetchMaybeMember(rpc, memberAddr);
    member = m.exists ? m.data : null;
    if (epoch) {
      const [receiptAddr] = await findReceiptPda({ epoch: epoch.address, contributor: wallet });
      const r = await fetchMaybeContributionReceipt(rpc, receiptAddr);
      receipt = r.exists ? r.data : null;
    }
    for (let seq = 0n; member && seq < member.nextRedemptionSeq; seq++) {
      const rAddr = await redemptionPda(circleAddr, wallet, seq);
      const r = await fetchMaybeRedemption(rpc, rAddr);
      if (!r.exists) continue;
      const claims: ExitView["claims"] = [];
      for (const mint of [...assets.map((a) => a.asset.mint), usdcMint]) {
        const raAddr = await redemptionAssetPda(rAddr, mint);
        const ra = await fetchMaybeRedemptionAsset(rpc, raAddr);
        if (ra.exists) claims.push({ mint, address: raAddr, asset: ra.data });
      }
      exits.push({ seq, address: rAddr, redemption: r.data, claims });
    }
  }
  const [activeUsdcVault] = await findActiveUsdcVaultPda({ circle: circleAddr });
  const [holdings, activeUsdcRaw] = await Promise.all([
    Promise.all(assets.map(async ({ address, asset }) => {
      const [registryAddr] = await findRegistryEntryPda({ testMint: asset.mint });
      const [registry, mandateAsset, vaultRaw] = await Promise.all([
        fetchAssetRegistryEntry(rpc, registryAddr),
        fetchMandateAsset(rpc, asset.mandateAsset),
        tokenBalance(asset.vault),
      ]);
      return {
        address, asset, registry: registry.data,
        targetWeightBps: mandateAsset.data.targetWeightBps, vaultRaw: vaultRaw ?? 0n,
      };
    })),
    tokenBalance(activeUsdcVault).then((b) => b ?? 0n),
  ]);

  return { circle, mandate, usdcMint, assets, holdings, activeUsdcRaw, epoch, navSnapshot, member, receipt, exits };
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
