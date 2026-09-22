/**
 * PDA seeds for every Tenet account — the client half of programs/tenet/src/pda.rs.
 *
 * Deliberately returns SEEDS, not addresses. Deriving an address needs a Solana
 * library, and which one (web3.js or Kit) is still open decision D-05. Whichever
 * wins takes these seeds unchanged:
 *
 *   web3.js  PublicKey.findProgramAddressSync(seeds.circle(m), programId)
 *   Kit      getProgramDerivedAddress({ programAddress, seeds: seeds.circle(m) })
 *
 * so the part that can silently diverge from the program — seed strings, order
 * and integer encoding — is defined once here and checked against the Rust
 * derivations by tests/vectors/pda.json.
 *
 * Every argument is a raw 32-byte public key. Integers are little-endian u64.
 */

export const PROGRAM_ID = "FJt9WntCGo6suyjH4cndwgKjQ8rDSau1JxLA91UFB49v";

export type Key = Uint8Array; // 32 bytes

const utf8 = (s: string) => new TextEncoder().encode(s);

/** Mirrors programs/tenet/src/constants.rs. */
export const SEED = {
  config: utf8("config"),
  mandate: utf8("mandate"),
  mandateAsset: utf8("mandate_asset"),
  registry: utf8("registry"),
  circle: utf8("circle"),
  circleAsset: utf8("circle_asset"),
  vaultAuthority: utf8("vault_authority"),
  vault: utf8("vault"),
  usdcVault: utf8("usdc_vault"),
  epoch: utf8("epoch"),
  epochEscrow: utf8("epoch_escrow"),
  receipt: utf8("receipt"),
  member: utf8("member"),
  navSnapshot: utf8("nav_snapshot"),
  redemption: utf8("redemption"),
  redemptionAsset: utf8("redemption_asset"),
  execAuth: utf8("exec_auth"),
} as const;

const U64_MAX = (1n << 64n) - 1n;

/** Little-endian u64, matching Rust's `to_le_bytes`. */
export function u64le(n: bigint): Uint8Array {
  if (n < 0n || n > U64_MAX) throw new RangeError(`not a u64: ${n}`);
  const out = new Uint8Array(8);
  for (let i = 0; i < 8; i++) out[i] = Number((n >> BigInt(8 * i)) & 0xffn);
  return out;
}

function key(k: Key): Key {
  if (k.length !== 32) throw new RangeError(`expected a 32-byte key, got ${k.length}`);
  return k;
}

/** One builder per row of docs/architecture.md §2, in the same order as pda.rs. */
export const seeds = {
  /** Program-wide settings: registry authority and USDC mint (A-18). */
  config: () => [SEED.config],
  mandate: (mandateSeed: Key) => [SEED.mandate, key(mandateSeed)],
  mandateAsset: (mandate: Key, mint: Key) => [SEED.mandateAsset, key(mandate), key(mint)],
  registry: (mint: Key) => [SEED.registry, key(mint)],
  circle: (mandate: Key) => [SEED.circle, key(mandate)],
  circleAsset: (circle: Key, mint: Key) => [SEED.circleAsset, key(circle), key(mint)],
  vaultAuthority: (circle: Key) => [SEED.vaultAuthority, key(circle)],
  assetVault: (circle: Key, mint: Key) => [SEED.vault, key(circle), key(mint)],
  usdcVault: (circle: Key) => [SEED.usdcVault, key(circle)],
  epoch: (circle: Key, index: bigint) => [SEED.epoch, key(circle), u64le(index)],
  epochEscrow: (circle: Key, index: bigint) => [SEED.epochEscrow, key(circle), u64le(index)],
  receipt: (epoch: Key, owner: Key) => [SEED.receipt, key(epoch), key(owner)],
  member: (circle: Key, owner: Key) => [SEED.member, key(circle), key(owner)],
  navSnapshot: (epoch: Key) => [SEED.navSnapshot, key(epoch)],
  redemption: (circle: Key, owner: Key, seq: bigint) =>
    [SEED.redemption, key(circle), key(owner), u64le(seq)],
  redemptionAsset: (redemption: Key, mint: Key) =>
    [SEED.redemptionAsset, key(redemption), key(mint)],
  /** `epoch` is the Epoch ACCOUNT address, not its index. */
  execAuth: (circle: Key, epoch: Key, nonce: bigint) =>
    [SEED.execAuth, key(circle), key(epoch), u64le(nonce)],
} satisfies Record<string, (...a: never[]) => Uint8Array[]>;
