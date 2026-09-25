/**
 * PDA vectors: derive every account address from the SDK's seed builders and
 * record the result for programs/tenet/src/pda_vectors.rs to reproduce with the
 * runtime's own `find_program_address`.
 *
 * The derivation below is test-only and Node-only (node:crypto). It exists so
 * the check needs no Solana library while D-05 is open. It is itself verified
 * by the Rust replay: a wrong on-curve test would change the bumps.
 */
import { createHash } from "node:crypto";
import { PROGRAM_ID, seeds, type Key } from "../src/pda.ts";

// ---------------------------------------------------------------- base58

const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

export function base58Decode(s: string): Uint8Array {
  let n = 0n;
  for (const c of s) {
    const i = ALPHABET.indexOf(c);
    if (i < 0) throw new Error(`invalid base58 character: ${c}`);
    n = n * 58n + BigInt(i);
  }
  const bytes: number[] = [];
  while (n > 0n) { bytes.unshift(Number(n & 0xffn)); n >>= 8n; }
  for (const c of s) { if (c !== "1") break; bytes.unshift(0); }
  return Uint8Array.from(bytes);
}

// ---------------------------------------------------------------- ed25519

const P = (1n << 255n) - 19n;
const mod = (a: bigint) => ((a % P) + P) % P;
function pow(b: bigint, e: bigint): bigint {
  let r = 1n; b = mod(b);
  while (e > 0n) { if (e & 1n) r = mod(r * b); b = mod(b * b); e >>= 1n; }
  return r;
}
const D = mod(-121665n * pow(121666n, P - 2n));

/**
 * Whether 32 bytes decompress to an ed25519 point — the same test as
 * curve25519-dalek's `CompressedEdwardsY::decompress().is_some()`, which is what
 * Solana uses to reject a PDA candidate. The top bit is the sign of x and is
 * ignored for validity; y is reduced mod p (dalek does not reject
 * non-canonical y). Valid iff (y² − 1) / (d·y² + 1) is a square mod p.
 */
export function isOnCurve(bytes: Uint8Array): boolean {
  let y = 0n;
  for (let i = 31; i >= 0; i--) y = (y << 8n) | BigInt(bytes[i]);
  y &= (1n << 255n) - 1n;
  const y2 = mod(y * y);
  const u = mod(y2 - 1n);
  const v = mod(D * y2 + 1n);
  const w = mod(u * pow(v, P - 2n));
  return w === 0n || pow(w, (P - 1n) / 2n) === 1n;
}

export function findProgramAddress(seedList: Uint8Array[], programId: Uint8Array): [Uint8Array, number] {
  for (let bump = 255; bump >= 0; bump--) {
    const h = createHash("sha256");
    for (const s of seedList) h.update(s);
    h.update(Uint8Array.of(bump));
    h.update(programId);
    h.update("ProgramDerivedAddress");
    const addr = new Uint8Array(h.digest());
    if (!isOnCurve(addr)) return [addr, bump];
  }
  throw new Error("no viable bump");
}

// ---------------------------------------------------------------- vectors

const hex = (b: Uint8Array) => Buffer.from(b).toString("hex");

export interface PdaVector {
  fn: string;
  args: string[]; // 64-char hex for keys, decimal for u64
  address: string; // hex
  bump: number;
}

export function generatePdaVectors(perFunction = 6): { programId: string; vectors: PdaVector[] } {
  const programId = base58Decode(PROGRAM_ID);
  if (programId.length !== 32) throw new Error("PROGRAM_ID is not 32 bytes");

  let counter = 0;
  const k = (): Key => new Uint8Array(createHash("sha256").update(`tenet-pda-${counter++}`).digest());
  const ints = [0n, 1n, 255n, 256n, (1n << 32n) + 7n, (1n << 64n) - 1n];

  const vectors: PdaVector[] = [];
  const add = (fn: string, args: (Key | bigint)[], s: Uint8Array[]) => {
    const [addr, bump] = findProgramAddress(s, programId);
    vectors.push({
      fn,
      args: args.map((a) => (typeof a === "bigint" ? a.toString() : hex(a))),
      address: hex(addr),
      bump,
    });
  };

  for (let i = 0; i < perFunction; i++) {
    const [a, b] = [k(), k()];
    const n = ints[i % ints.length];
    if (i === 0) add("config", [], seeds.config()); // takes no inputs: one vector
    if (i === 0) add("devnet_test_market", [], seeds.devnetTestMarket());
    if (i === 0) add("devnet_test_mint", [], seeds.devnetTestMint());
    add("mandate", [a], seeds.mandate(a));
    add("mandate_asset", [a, b], seeds.mandateAsset(a, b));
    add("registry", [a], seeds.registry(a));
    add("circle", [a], seeds.circle(a));
    add("circle_asset", [a, b], seeds.circleAsset(a, b));
    add("vault_authority", [a], seeds.vaultAuthority(a));
    add("asset_vault", [a, b], seeds.assetVault(a, b));
    add("usdc_vault", [a], seeds.usdcVault(a));
    add("epoch", [a, n], seeds.epoch(a, n));
    add("epoch_escrow", [a, n], seeds.epochEscrow(a, n));
    add("receipt", [a, b], seeds.receipt(a, b));
    add("member", [a, b], seeds.member(a, b));
    add("nav_snapshot", [a], seeds.navSnapshot(a));
    add("redemption", [a, b, n], seeds.redemption(a, b, n));
    add("redemption_asset", [a, b], seeds.redemptionAsset(a, b));
    add("exec_auth", [a, b, n], seeds.execAuth(a, b, n));
    add("amendment", [a, n], seeds.amendment(a, n));
    add("amendment_vote", [a, b], seeds.amendmentVote(a, b));
  }
  return { programId: PROGRAM_ID, vectors };
}

export function serializePda(v: ReturnType<typeof generatePdaVectors>): string {
  return JSON.stringify({
    _comment:
      "GENERATED by scripts/gen-pda-vectors.ts from packages/sdk/src/pda.ts. Do not edit. " +
      "Replayed by programs/tenet/src/pda_vectors.rs.",
    programId: v.programId,
    count: v.vectors.length,
    vectors: v.vectors,
  }, null, 1) + "\n";
}
