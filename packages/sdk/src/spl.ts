/**
 * Hand-encoded System, SPL Token / Token-2022, Associated Token Account and
 * Compute Budget instructions — just the few Tenet's clients need, so the SDK
 * carries no extra program-client dependencies.
 *
 * Each layout below is the program's own, byte for byte (spl-token-2022
 * interface 2.1 `instruction.rs` / `extension/<name>/instruction.rs`). Setup code
 * that uses them reads the resulting accounts back from chain and checks
 * them, so a wrong encoding fails loudly rather than silently.
 */
import {
  AccountRole,
  address,
  getAddressEncoder,
  getProgramDerivedAddress,
  type Address,
  type Instruction,
  type TransactionSigner,
} from "@solana/kit";

export const SYSTEM_PROGRAM = address("11111111111111111111111111111111");
export const TOKEN_PROGRAM = address("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
export const TOKEN_2022_PROGRAM = address("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");
export const ATA_PROGRAM = address("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
export const COMPUTE_BUDGET_PROGRAM = address("ComputeBudget111111111111111111111111111111");
export const INSTRUCTIONS_SYSVAR = address("Sysvar1nstructions1111111111111111111111111");
export const BPF_LOADER_UPGRADEABLE = address("BPFLoaderUpgradeab1e11111111111111111111111");

const enc = getAddressEncoder();
const key = (a: Address) => enc.encode(a);

function bytes(...parts: ArrayLike<number>[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}
const u16 = (n: number) => { const b = new Uint8Array(2); new DataView(b.buffer).setUint16(0, n, true); return b; };
const u32 = (n: number) => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, n, true); return b; };
const u64 = (n: bigint) => { const b = new Uint8Array(8); new DataView(b.buffer).setBigUint64(0, n, true); return b; };
const f64 = (n: number) => { const b = new Uint8Array(8); new DataView(b.buffer).setFloat64(0, n, true); return b; };

const signerMeta = (s: TransactionSigner, writable = true) => ({
  address: s.address,
  role: writable ? AccountRole.WRITABLE_SIGNER : AccountRole.READONLY_SIGNER,
  signer: s,
});
const w = (a: Address) => ({ address: a, role: AccountRole.WRITABLE });
const r = (a: Address) => ({ address: a, role: AccountRole.READONLY });

// ---------------------------------------------------------------- system

export function createAccountIx(payer: TransactionSigner, account: TransactionSigner, lamports: bigint, space: number, owner: Address): Instruction {
  return {
    programAddress: SYSTEM_PROGRAM,
    accounts: [signerMeta(payer), signerMeta(account)],
    data: bytes(u32(0), u64(lamports), u64(BigInt(space)), key(owner)),
  };
}

export function transferSolIx(from: TransactionSigner, to: Address, lamports: bigint): Instruction {
  return { programAddress: SYSTEM_PROGRAM, accounts: [signerMeta(from), w(to)], data: bytes(u32(2), u64(lamports)) };
}

// ---------------------------------------------------------------- compute budget

export function setComputeUnitLimitIx(units: number): Instruction {
  return { programAddress: COMPUTE_BUDGET_PROGRAM, accounts: [], data: bytes([2], u32(units)) };
}

// ---------------------------------------------------------------- token / token-2022

/** Mint account sizes: base 82; with extensions 165 + account-type byte + TLV. */
export const MINT_SIZE = {
  plain: 82,
  // 166 + (2 type + 2 len + 108 TransferFeeConfig)
  transferFee: 278,
  // 166 + (2 type + 2 len + 56 ScaledUiAmountConfig)
  scaledUiAmount: 226,
} as const;

export function initializeMint2Ix(tokenProgram: Address, mint: Address, decimals: number, mintAuthority: Address, freezeAuthority: Address | null = null): Instruction {
  return {
    programAddress: tokenProgram,
    accounts: [w(mint)],
    data: bytes([20, decimals], key(mintAuthority), freezeAuthority ? bytes([1], key(freezeAuthority)) : [0]),
  };
}

/** TokenInstruction::TransferFeeExtension (26) / InitializeTransferFeeConfig (0). */
export function initializeTransferFeeConfigIx(mint: Address, authority: Address, bps: number, maxFee: bigint): Instruction {
  const opt = bytes([1], key(authority));
  return { programAddress: TOKEN_2022_PROGRAM, accounts: [w(mint)], data: bytes([26, 0], opt, opt, u16(bps), u64(maxFee)) };
}

/** TokenInstruction::ScaledUiAmountExtension (43) / Initialize (0). */
export function initializeScaledUiAmountIx(mint: Address, authority: Address, multiplier: number): Instruction {
  return { programAddress: TOKEN_2022_PROGRAM, accounts: [w(mint)], data: bytes([43, 0], key(authority), f64(multiplier)) };
}

export function mintToIx(tokenProgram: Address, mint: Address, destination: Address, authority: TransactionSigner, amount: bigint): Instruction {
  return { programAddress: tokenProgram, accounts: [w(mint), w(destination), signerMeta(authority, false)], data: bytes([7], u64(amount)) };
}

// ---------------------------------------------------------------- associated token accounts

export async function findAta(owner: Address, mint: Address, tokenProgram: Address): Promise<Address> {
  const [ata] = await getProgramDerivedAddress({ programAddress: ATA_PROGRAM, seeds: [key(owner), key(tokenProgram), key(mint)] });
  return ata;
}

/** CreateIdempotent (1): a no-op when the account already exists. */
export async function createAtaIdempotentIx(payer: TransactionSigner, owner: Address, mint: Address, tokenProgram: Address): Promise<Instruction> {
  const ata = await findAta(owner, mint, tokenProgram);
  return {
    programAddress: ATA_PROGRAM,
    accounts: [signerMeta(payer), w(ata), r(owner), r(mint), r(SYSTEM_PROGRAM), r(tokenProgram)],
    data: new Uint8Array([1]),
  };
}

export async function programDataAddress(program: Address): Promise<Address> {
  const [pd] = await getProgramDerivedAddress({ programAddress: BPF_LOADER_UPGRADEABLE, seeds: [key(program)] });
  return pd;
}

/** Raw `amount` of an SPL / Token-2022 token account (offset 64). */
export function tokenAmount(data: Uint8Array): bigint {
  return new DataView(data.buffer, data.byteOffset + 64, 8).getBigUint64(0, true);
}

/** Raw `supply` of a mint (offset 36) and its decimals (offset 44). */
export function mintSupply(data: Uint8Array): { supply: bigint; decimals: number } {
  const v = new DataView(data.buffer, data.byteOffset, data.length);
  return { supply: v.getBigUint64(36, true), decimals: data[44]! };
}
