/**
 * Shared plumbing for the devnet scripts. DEVNET ONLY.
 *
 * - Every entry point calls `connect()`, which refuses to continue unless the
 *   RPC's genesis hash is Solana Devnet's.
 * - Keys are only ever READ from a keypair file on this machine
 *   (TENET_DEVNET_KEYPAIR, default ~/.config/solana/tenet-devnet-deployer.json).
 *   Nothing here prints, copies or transmits a secret key.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  appendTransactionMessageInstructions, createKeyPairSignerFromBytes, createSolanaRpc,
  createSolanaRpcSubscriptions, createTransactionMessage, getBase64EncodedWireTransaction,
  getSignatureFromTransaction, pipe, sendAndConfirmTransactionFactory, setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash, signTransactionMessageWithSigners,
  type Address, type Instruction, type KeyPairSigner, type TransactionSigner,
} from "@solana/kit";
import { DEVNET_GENESIS_HASH, MAINNET_GENESIS_HASH, assertDevnet, type DevnetDeployment } from "../../src/devnet/index";

export const RPC_URL = process.env.TENET_DEVNET_RPC_URL ?? "https://api.devnet.solana.com";
export const WS_URL = process.env.TENET_DEVNET_WS_URL ?? RPC_URL.replace(/^http/, "ws");

export type Ctx = Awaited<ReturnType<typeof connect>>;

/**
 * Rehearsal on a local `solana-test-validator` is allowed only when BOTH the
 * RPC is loopback AND TENET_LOCAL_VALIDATOR=1. Anything else must be Devnet.
 */
function isLocalRehearsal(): boolean {
  const host = new URL(RPC_URL).hostname;
  return process.env.TENET_LOCAL_VALIDATOR === "1" && (host === "127.0.0.1" || host === "localhost");
}

/** Every `rpc.x(...).send()` retried through public-RPC rate limits. */
function withRetries<T extends object>(rpc: T): T {
  return new Proxy(rpc, {
    get(target, prop, recv) {
      const f = Reflect.get(target, prop, recv);
      if (typeof f !== "function") return f;
      return (...args: unknown[]) => {
        const req = f.apply(target, args) as { send: (o?: unknown) => Promise<unknown> };
        return { ...req, send: (o?: unknown) => retry(() => req.send(o)) };
      };
    },
  });
}

export async function connect() {
  const base = createSolanaRpc(RPC_URL);
  const rpc: typeof base = withRetries(base);
  const rpcSubscriptions = createSolanaRpcSubscriptions(WS_URL);
  if (isLocalRehearsal()) {
    const hash = await rpc.getGenesisHash().send();
    if (hash === MAINNET_GENESIS_HASH || hash === DEVNET_GENESIS_HASH) throw new Error("REFUSING: loopback RPC is proxying a public cluster");
    console.log(`(local validator rehearsal, genesis ${hash})`);
  } else {
    await assertDevnet(rpc);
  }
  const sendAndConfirm = sendAndConfirmTransactionFactory({ rpc, rpcSubscriptions });
  return { rpc, rpcSubscriptions, sendAndConfirm };
}

export function keypairPath(): string {
  return process.env.TENET_DEVNET_KEYPAIR ?? join(homedir(), ".config", "solana", "tenet-devnet-deployer.json");
}

export async function loadKeypair(path = keypairPath()): Promise<KeyPairSigner> {
  if (!existsSync(path)) throw new Error(`keypair file not found: ${path} (set TENET_DEVNET_KEYPAIR)`);
  return createKeyPairSignerFromBytes(Uint8Array.from(JSON.parse(readFileSync(path, "utf8")) as number[]));
}

export const explorer = (sig: string) => `https://explorer.solana.com/tx/${sig}?cluster=devnet`;
export const explorerAddress = (a: string) => `https://explorer.solana.com/address/${a}?cluster=devnet`;

/** Pull program logs out of a Kit error, wherever they are nested. */
function logsOf(e: unknown): string[] {
  const seen = new Set<unknown>();
  const walk = (x: unknown): string[] => {
    if (!x || typeof x !== "object" || seen.has(x)) return [];
    seen.add(x);
    const o = x as { context?: { logs?: string[] }; cause?: unknown };
    return o.context?.logs ?? walk(o.cause);
  };
  return walk(e);
}

/** Retry a public-RPC call through rate limits (429) and transient network errors. */
export async function retry<T>(f: () => Promise<T>, tries = 8): Promise<T> {
  for (let i = 0; ; i++) {
    try {
      return await f();
    } catch (e) {
      const m = String((e as Error)?.message ?? e);
      if (i >= tries || !/429|Too Many|fetch failed|ECONNRESET|ETIMEDOUT|socket/i.test(m)) throw e;
      await sleep(1500 * (i + 1));
    }
  }
}

export async function send(ctx: Ctx, feePayer: TransactionSigner, ixs: Instruction[], label: string): Promise<string> {
  const { value: blockhash } = await ctx.rpc.getLatestBlockhash({ commitment: "confirmed" }).send();
  const msg = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayerSigner(feePayer, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash(blockhash, m),
    (m) => appendTransactionMessageInstructions(ixs, m),
  );
  const tx = await signTransactionMessageWithSigners(msg);
  const sig = getSignatureFromTransaction(tx);
  try {
    // Send, then poll the signature: the public Devnet WebSocket is not
    // reliable enough to depend on for confirmations.
    const wire = getBase64EncodedWireTransaction(tx);
    await ctx.rpc.sendTransaction(wire, { encoding: "base64", preflightCommitment: "confirmed" }).send();
    for (let i = 0; ; i++) {
      const { value } = await ctx.rpc.getSignatureStatuses([sig]).send();
      const st = value[0];
      if (st?.err) throw new Error(`transaction failed: ${JSON.stringify(st.err, (_, v) => (typeof v === "bigint" ? v.toString() : v))}`);
      if (st?.confirmationStatus === "confirmed" || st?.confirmationStatus === "finalized") break;
      if (i > 90) throw new Error(`not confirmed after 90s: ${sig}`);
      await sleep(1500);
    }
  } catch (e) {
    const logs = logsOf(e);
    const size = getBase64EncodedWireTransaction(tx).length;
    throw new Error(`${label} failed (${(e as Error).message}); tx base64 ${size} chars\n${logs.join("\n")}`);
  }
  console.log(`  ✓ ${label}  ${explorer(sig)}`);
  return sig;
}

export async function sendGroups(ctx: Ctx, feePayer: TransactionSigner, groups: Instruction[][], label: string): Promise<string[]> {
  const sigs: string[] = [];
  for (const [i, g] of groups.entries()) sigs.push(await send(ctx, feePayer, g, groups.length > 1 ? `${label} (${i + 1}/${groups.length})` : label));
  return sigs;
}

export async function exists(ctx: Ctx, a: Address): Promise<boolean> {
  const { value } = await ctx.rpc.getAccountInfo(a, { encoding: "base64" }).send();
  return value !== null;
}

export async function accountData(ctx: Ctx, a: Address): Promise<Uint8Array | null> {
  const { value } = await ctx.rpc.getAccountInfo(a, { encoding: "base64" }).send();
  return value ? Uint8Array.from(Buffer.from(value.data[0], "base64")) : null;
}

export async function balance(ctx: Ctx, tokenAccount: Address): Promise<bigint> {
  const d = await accountData(ctx, tokenAccount);
  if (!d) return 0n;
  return new DataView(d.buffer, d.byteOffset + 64, 8).getBigUint64(0, true);
}

// ---------------------------------------------------------------- deployment record

// A local rehearsal records into its own file so it can never overwrite the
// real Devnet deployment record.
const DEPLOYMENT = process.env.TENET_DEPLOYMENT_FILE
  ?? fileURLToPath(new URL(isLocalRehearsal() ? "../../.local-deployment.json" : "../../src/devnet/deployment.json", import.meta.url));

export function readDeployment(): Partial<DevnetDeployment> {
  return existsSync(DEPLOYMENT) ? (JSON.parse(readFileSync(DEPLOYMENT, "utf8")) as Partial<DevnetDeployment>) : {};
}

export function writeDeployment(d: Partial<DevnetDeployment>): void {
  writeFileSync(DEPLOYMENT, JSON.stringify({ ...d, updatedAt: new Date().toISOString() }, null, 2) + "\n");
}

export function requireDeployment(): DevnetDeployment {
  const d = readDeployment();
  if (!d.instruments?.length || !d.tusdcMint) throw new Error("no devnet deployment recorded: run `pnpm devnet:setup` first");
  return d as DevnetDeployment;
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Wait until the cluster clock passes `unix` (epochs close on chain time). */
export async function waitForChainTime(ctx: Ctx, unix: bigint, why: string): Promise<void> {
  for (;;) {
    const slot = await ctx.rpc.getSlot({ commitment: "confirmed" }).send();
    const t = await ctx.rpc.getBlockTime(slot).send().catch(() => null);
    if (t !== null && BigInt(t) >= unix) return;
    const left = t === null ? 5n : unix - BigInt(t);
    process.stdout.write(`  … waiting ${left}s for ${why}\r`);
    await sleep(Math.min(Number(left) * 1000 + 1500, 10_000));
  }
}

/** "110.5" -> 110_500_000n at the feed's 1e-6 scale, exactly (no floats). */
export function toMicros(s: string): bigint {
  const m = /^(\d+)(?:\.(\d{1,6}))?$/.exec(s);
  if (!m) throw new Error(`not a price: ${s}`);
  return BigInt(m[1]!) * 1_000_000n + BigInt((m[2] ?? "").padEnd(6, "0"));
}
