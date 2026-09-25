/** Devnet profile: all configured mints and balances are test assets with no real-world value. */
import { address } from "@solana/kit";

export const CLUSTER = "devnet" as const;
export const CHAIN = "solana:devnet" as const;
// Use the public Devnet endpoint directly; the VPS /api/solana proxy is mainnet read-only.
export const RPC_URL = import.meta.env.VITE_SOLANA_RPC_URL || "https://api.devnet.solana.com";

export const USDC_MINT = address("8XcK83nbTAtdvfHCFWLCAEHigHDBAGuEachzQss9oCkt");
export const USDC_DECIMALS = 6;
// Empty Epoch-0 Circle created for wallet testing; it contains no active assets.
export const DEFAULT_CIRCLE: string | null = "6UB4NCMKLZbMAJ2uS9ynmQ8m8TsaCjFDnURQfmpE5rK2";
// Devnet-only contribution, exit and Fork paths passed the on-chain E2E suite.
// Stock purchases remain explicitly disabled until Jupiter/Pyth vault execution is verified.
export const TRANSACTIONS_ENABLED = true;

export const TOKEN_PROGRAM = address("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
export const TOKEN_2022_PROGRAM = address("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");
export const ATA_PROGRAM = address("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
export const SYSTEM_PROGRAM = address("11111111111111111111111111111111");

const rpcUrl = new URL(RPC_URL);
if (rpcUrl.protocol !== "https:" || !rpcUrl.hostname.toLowerCase().includes("devnet")) {
  throw new Error("REFUSING: Tenet Devnet build must use an HTTPS Devnet RPC");
}
