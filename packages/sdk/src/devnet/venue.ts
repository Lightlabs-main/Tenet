/**
 * tenet-devnet as an execution venue and faucet. DEVNET ONLY.
 */
import type { Address, Instruction, TransactionSigner } from "@solana/kit";
import { pda } from "../address";
import { TOKEN_PROGRAM, createAtaIdempotentIx, findAta } from "../spl";
import {
  findAdminPda, findClaimPda, findFaucetPda, findFeedPda, findInventoryPda, findMarketPda,
  findTusdcMintPda, findUsdcVaultPda,
} from "./generated/pdas/index";
import { getRequestTusdcInstruction } from "./generated/instructions/index";
import { buy } from "./index";

export async function tusdcMint(): Promise<Address> {
  return (await findTusdcMintPda())[0];
}

export async function feedAddress(mint: Address): Promise<Address> {
  return (await findFeedPda({ mint }))[0];
}

export async function marketAccounts(mint: Address) {
  return {
    admin: (await findAdminPda())[0],
    market: (await findMarketPda({ mint }))[0],
    feed: (await findFeedPda({ mint }))[0],
    inventory: (await findInventoryPda({ mint }))[0],
    usdcVault: (await findUsdcVaultPda({ mint }))[0],
    tusdcMint: (await findTusdcMintPda())[0],
  };
}

/**
 * The venue leg of a Circle execution: the executor, as the Circle's bounded
 * delegate, pays TUSDC from the Circle's USDC vault and the market delivers
 * the instrument straight into the Circle's asset vault.
 */
export async function circleBuyIx(input: {
  executor: TransactionSigner;
  circle: Address;
  mint: Address;
  assetTokenProgram: Address;
  amountInRaw: bigint;
  minOutRaw: bigint;
}): Promise<Instruction> {
  const m = await marketAccounts(input.mint);
  return buy({
    payer: input.executor, admin: m.admin, market: m.market, feed: m.feed, inventory: m.inventory,
    usdcVault: m.usdcVault, source: (await pda.usdcVault(input.circle))[0],
    destination: (await pda.assetVault(input.circle, input.mint))[0], mint: input.mint, tusdcMint: m.tusdcMint,
    assetTokenProgram: input.assetTokenProgram, usdcTokenProgram: TOKEN_PROGRAM,
    amountInRaw: input.amountInRaw, minOutRaw: input.minOutRaw,
  });
}

/** "Get test USDC": create the caller's TUSDC account if needed, then claim 1,000 TUSDC. */
export async function faucetIxs(owner: TransactionSigner): Promise<Instruction[]> {
  const mint = await tusdcMint();
  return [
    await createAtaIdempotentIx(owner, owner.address, mint, TOKEN_PROGRAM),
    getRequestTusdcInstruction({
      owner, faucet: (await findFaucetPda())[0], claim: (await findClaimPda({ owner: owner.address }))[0],
      tusdcMint: mint, destination: await findAta(owner.address, mint, TOKEN_PROGRAM), tokenProgram: TOKEN_PROGRAM,
      systemProgram: "11111111111111111111111111111111" as Address,
    }),
  ];
}
