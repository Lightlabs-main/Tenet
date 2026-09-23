/**
 * Solana mainnet configuration. This initial mainnet profile is deliberately
 * read-only: the configured Tenet program has not been deployed here and the
 * unresolved release gates do not permit wallet transactions.
 */
import { address } from "@solana/kit";

export const CLUSTER: "devnet" | "mainnet-beta" = "mainnet-beta";
export const CHAIN = "solana:mainnet" as const;
// The local Vite server proxies a strict read-only JSON-RPC allowlist to avoid
// browser-origin blocks on public RPCs. Production must supply a browser-safe
// endpoint or a same-origin server proxy; never embed private RPC credentials.
export const RPC_URL = import.meta.env.DEV
  ? "/api/solana"
  : import.meta.env.VITE_SOLANA_RPC_URL || "/api/solana";

export const USDC_MINT = address("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
export const USDC_DECIMALS = 6;
// Mainnet has no default Tenet Circle; never carry a devnet PDA into this build.
export const DEFAULT_CIRCLE: string | null = null;
// Keep all signing paths closed until deployment and independent release review.
export const TRANSACTIONS_ENABLED = false;

export const TOKEN_PROGRAM = address("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
export const TOKEN_2022_PROGRAM = address("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");
export const ATA_PROGRAM = address("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
export const SYSTEM_PROGRAM = address("11111111111111111111111111111111");

if (RPC_URL.includes("devnet")) throw new Error("REFUSING: mainnet build cannot use a devnet RPC");
