/**
 * Network profile: Solana Devnet. Everything this build shows is DEVNET TEST
 * DATA — TUSDC and the test instruments have no monetary value, and prices
 * are a devnet pricing simulation.
 *
 * The instruments, TUSDC mint and program addresses come from the SDK's
 * deployment record (written by `pnpm devnet:setup`). Until that exists the
 * app stays read-only and says so.
 */
import { address, type Address } from "@solana/kit";
import { DEVNET_DEPLOYMENT, type DevnetInstrumentDeployment } from "@tenet/sdk/devnet";

export const CLUSTER = "devnet" as const;
export const CHAIN = "solana:devnet" as const;
export const RPC_URL = import.meta.env.VITE_SOLANA_RPC_URL || "https://api.devnet.solana.com";

export const DEPLOYMENT = DEVNET_DEPLOYMENT;
/** TUSDC — "Tenet Devnet USDC — no monetary value". */
export const USDC_MINT: Address | null = DEPLOYMENT ? address(DEPLOYMENT.tusdcMint) : null;
export const USDC_DECIMALS = 6;
export const CASH_TICKER = "TUSDC";
export const TRANSACTIONS_ENABLED = DEPLOYMENT !== null;
export const INSTRUMENTS: DevnetInstrumentDeployment[] = DEPLOYMENT?.instruments ?? [];

export const TOKEN_PROGRAM = address("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
export const TOKEN_2022_PROGRAM = address("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");
export const ATA_PROGRAM = address("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
export const SYSTEM_PROGRAM = address("11111111111111111111111111111111");

const rpcUrl = new URL(RPC_URL);
if (rpcUrl.protocol !== "https:" || !rpcUrl.hostname.toLowerCase().includes("devnet")) {
  throw new Error("REFUSING: Tenet Devnet build must use an HTTPS Devnet RPC");
}
