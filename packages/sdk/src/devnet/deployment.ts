/**
 * What `pnpm devnet:setup` created on Devnet, read from deployment.json
 * (written by the setup script, committed so every client uses the same
 * instruments). Addresses only — no keys, nothing secret.
 */
import deployment from "./deployment.json";

export interface DevnetInstrumentDeployment {
  symbol: string;
  mint: string;
  tokenProgram: string;
  decimals: number;
  feed: string;
  market: string;
}

export interface DevnetDeployment {
  cluster: "devnet";
  tenetProgram: string;
  devnetProgram: string;
  operator: string;
  tusdcMint: string;
  config: string;
  instruments: DevnetInstrumentDeployment[];
  reference: { mandate: string; circle: string } | null;
  updatedAt: string;
}

/** `null` until `pnpm devnet:setup` has run against Devnet. */
export const DEVNET_DEPLOYMENT = (deployment as { instruments?: unknown[] }).instruments?.length
  ? (deployment as DevnetDeployment)
  : null;
