/**
 * Devnet configuration. DEVNET ONLY until Phase 4.
 *
 * The addresses below are public devnet state from the e2e run
 * (PROGRESS.md "DEVNET"). The test USDC is a devnet mint created for testing —
 * NOT Circle USDC — and the UI says so wherever it appears.
 */
import { address } from "@solana/kit";

export const CLUSTER = "devnet" as const;
export const CHAIN = "solana:devnet" as const;
export const RPC_URL = "https://api.devnet.solana.com";

export const TEST_USDC = address("GXcCAwkuxFYeyHji4EiD4H4iy1dbKbuPNgXjoAYHhbMy");
export const USDC_DECIMALS = 6;
// A Circle with no shares yet, prepared for a browser-wallet run (devnet-e2e.ts --setup-only).
export const DEFAULT_CIRCLE = "GcAB7dpPG4H9QeVDci9A5V92WNCADCQm7SeS5bKnSECS";

export const TOKEN_PROGRAM = address("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
export const TOKEN_2022_PROGRAM = address("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");
export const ATA_PROGRAM = address("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
export const SYSTEM_PROGRAM = address("11111111111111111111111111111111");

if (!RPC_URL.includes("devnet")) throw new Error("REFUSING: this build is devnet-only");
