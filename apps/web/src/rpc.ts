import { createSolanaRpc } from "@solana/kit";
import { RPC_URL } from "./config.ts";

export const rpc = createSolanaRpc(RPC_URL);
