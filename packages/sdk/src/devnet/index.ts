/**
 * @tenet/sdk/devnet — client for the tenet-devnet program. DEVNET ONLY.
 *
 * TUSDC ("Tenet Devnet USDC — no monetary value"), the test price feeds and
 * the test market exist only on Solana Devnet. Every entry point that sends a
 * transaction must first prove it is talking to Devnet with
 * `assertDevnet(rpc)`, which checks the cluster's genesis hash — a URL can lie,
 * the genesis hash cannot.
 *
 * Amounts are bigint, as in the package root.
 */
import type { Address } from "@solana/kit";
import {
  getBuyInstruction,
  getCreateFeedInstructionAsync,
  getUpdateFeedInstructionAsync,
  type BuyInput,
  type CreateFeedAsyncInput,
  type UpdateFeedAsyncInput,
} from "./generated/instructions/index";
import type { FeedPricesArgs } from "./generated/types/index";

export * from "./generated/accounts/index";
export * from "./generated/errors/index";
export * from "./generated/pdas/index";
export * from "./generated/programs/index";
export * from "./generated/types/index";
export {
  getCreateMarketInstruction,
  getCreateMarketInstructionAsync,
  getInitializeInstruction,
  getInitializeInstructionAsync,
  getRequestTusdcInstruction,
  getRequestTusdcInstructionAsync,
  getSetSpreadInstruction,
  getSetSpreadInstructionAsync,
} from "./generated/instructions/index";
export * from "./instruments";
export * from "./venue";
export { DEVNET_DEPLOYMENT, type DevnetDeployment, type DevnetInstrumentDeployment } from "./deployment";

/** Solana Devnet's genesis hash. */
export const DEVNET_GENESIS_HASH = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
/** Solana Mainnet Beta's genesis hash — the one cluster these tools must never touch. */
export const MAINNET_GENESIS_HASH = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";

export const TUSDC_DECIMALS = 6;
export const FAUCET_CLAIM_RAW = 1_000_000_000n;
export const FAUCET_COOLDOWN_SECONDS = 60;
export const PRICE_EXPONENT = -6;

/** Fail closed unless `rpc` is Solana Devnet. */
export async function assertDevnet(rpc: { getGenesisHash(): { send(): Promise<string> } }): Promise<void> {
  const hash = await rpc.getGenesisHash().send();
  if (hash !== DEVNET_GENESIS_HASH) {
    throw new Error(`REFUSING: not Solana Devnet (genesis ${hash}). Devnet test tools never run elsewhere.`);
  }
}

function u64(value: unknown, field: string): bigint {
  if (typeof value !== "bigint") throw new TypeError(`${field} must be a bigint (got ${typeof value})`);
  if (value < 0n || value >= 1n << 64n) throw new RangeError(`${field} is not a u64: ${value}`);
  return value;
}
function i64(value: unknown, field: string): bigint {
  if (typeof value !== "bigint") throw new TypeError(`${field} must be a bigint (got ${typeof value})`);
  if (value < -(1n << 63n) || value >= 1n << 63n) throw new RangeError(`${field} is not an i64: ${value}`);
  return value;
}

export interface FeedPricesInput {
  price: bigint;
  conf: bigint;
  referenceMark: bigint;
  underlyingPrice: bigint;
}

function prices(p: FeedPricesInput): FeedPricesArgs {
  return {
    price: i64(p.price, "price"),
    conf: u64(p.conf, "conf"),
    referenceMark: i64(p.referenceMark, "referenceMark"),
    underlyingPrice: i64(p.underlyingPrice, "underlyingPrice"),
  };
}

export function createFeed(input: Omit<CreateFeedAsyncInput, "prices"> & { prices: FeedPricesInput }) {
  return getCreateFeedInstructionAsync({ ...input, prices: prices(input.prices) });
}

export function updateFeed(input: Omit<UpdateFeedAsyncInput, "prices"> & { prices: FeedPricesInput }) {
  return getUpdateFeedInstructionAsync({ ...input, prices: prices(input.prices) });
}

/** Buy from a devnet market. All accounts are explicit (see `marketAccounts`). */
export function buy(input: Omit<BuyInput, "amountInRaw" | "minOutRaw"> & { amountInRaw: bigint; minOutRaw: bigint }) {
  return getBuyInstruction({
    ...input,
    amountInRaw: u64(input.amountInRaw, "amountInRaw"),
    minOutRaw: u64(input.minOutRaw, "minOutRaw"),
  });
}

/**
 * The market's quote, exactly as the program computes it:
 * floor(floor(amountIn × 10^decimals / price) × (10000 − spread) / 10000).
 */
export function quoteBuy(amountInRaw: bigint, price: bigint, decimals: number, spreadBps: number): bigint {
  if (price <= 0n) throw new RangeError("price must be positive");
  const gross = (amountInRaw * 10n ** BigInt(decimals)) / price;
  return (gross * BigInt(10_000 - spreadBps)) / 10_000n;
}

/** Token-2022 transfer fee on `amount` (ceiling, capped), as the token program charges it. */
export function transferFee(amount: bigint, bps: number, maxFee: bigint): bigint {
  const fee = (amount * BigInt(bps) + 9_999n) / 10_000n;
  return fee > maxFee ? maxFee : fee;
}

export type { Address };
