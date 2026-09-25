/**
 * The two seams between Tenet and the outside market, as interfaces. The
 * product code (VALUE layer, Execute Epoch) talks only to these; which
 * implementation sits behind them is decided by the network profile.
 *
 * | seam              | Devnet (this build)             | Mainnet (not wired here)      |
 * |-------------------|---------------------------------|-------------------------------|
 * | PriceProvider     | tenet-devnet PriceFeed accounts | Pyth PriceUpdateV2 / PreStocks|
 * | ExecutionProvider | tenet-devnet Market `buy`       | Jupiter route                 |
 *
 * The on-chain program enforces the same checks on both (A-23): the Config
 * names the only venue and price program it will accept.
 */
import type { Address, Instruction, TransactionSigner } from "@solana/kit";
import { fetchEncodedAccount, type MaybeEncodedAccount } from "@solana/kit";
import { circleBuyIx, decodePriceFeed, feedAddress, fetchMaybeMarket, findMarketPda, quoteBuy } from "@tenet/sdk/devnet";
import { CLUSTER } from "./config.ts";
import { rpc } from "./rpc.ts";

export interface PriceObservation {
  /** USDC raw (1e-6) per whole token. */
  price: bigint;
  conf: bigint;
  publishTime: bigint;
  /** PreStocks-style reference mark, if the source has one. */
  mark: bigint | null;
  /** Price of the referenced underlying, if the source has one. */
  underlyingPrice: bigint | null;
  /** The account the program will read for this price. */
  account: Address;
}

export interface PriceProvider {
  readonly name: string;
  /** True for any source that is not real market data. */
  readonly testData: boolean;
  readonly label: string;
  get(mint: Address): Promise<PriceObservation | null>;
  /** The account the program reads this mint's price from (batched reads). */
  accountFor(mint: Address): Promise<Address>;
  /** Decode that account, fetched in a batch; null when missing. */
  decode(account: Address, encoded: MaybeEncodedAccount): PriceObservation | null;
}

export interface VenueQuote {
  amountInRaw: bigint;
  /** What the venue will deliver before any token transfer fee. */
  outRaw: bigint;
  spreadBps: number;
}

export interface ExecutionProvider {
  readonly name: string;
  readonly testVenue: boolean;
  quote(input: { mint: Address; decimals: number; amountInRaw: bigint; price: bigint }): Promise<VenueQuote>;
  /** Venue instructions that spend from the Circle's USDC vault and deliver into its asset vault. */
  venue(input: { executor: TransactionSigner; circle: Address; mint: Address; tokenProgram: Address; amountInRaw: bigint; minOutRaw: bigint }): Promise<Instruction[]>;
}

// ---------------------------------------------------------------- devnet

export const devnetPriceProvider: PriceProvider = {
  name: "tenet-devnet feed",
  testData: true,
  label: "DEVNET TEST DATA · devnet pricing simulation",
  async get(mint) {
    const account = await feedAddress(mint);
    return this.decode(account, await fetchEncodedAccount(rpc, account));
  },
  accountFor: (mint) => feedAddress(mint),
  decode(account, encoded) {
    if (!encoded.exists) return null;
    const d = decodePriceFeed(encoded).data;
    return {
      price: d.price, conf: d.conf, publishTime: d.publishTime, account,
      mark: d.referenceMark > 0n ? d.referenceMark : null,
      underlyingPrice: d.underlyingPrice > 0n ? d.underlyingPrice : null,
    };
  },
};

export const devnetExecutionProvider: ExecutionProvider = {
  name: "tenet-devnet market",
  testVenue: true,
  async quote({ mint, decimals, amountInRaw, price }) {
    const m = await fetchMaybeMarket(rpc, (await findMarketPda({ mint }))[0]);
    if (!m.exists) throw new Error("No devnet market for this instrument.");
    return { amountInRaw, outRaw: quoteBuy(amountInRaw, price, decimals, m.data.spreadBps), spreadBps: m.data.spreadBps };
  },
  async venue({ executor, circle, mint, tokenProgram, amountInRaw, minOutRaw }) {
    return [await circleBuyIx({ executor, circle, mint, assetTokenProgram: tokenProgram, amountInRaw, minOutRaw })];
  },
};

// ---------------------------------------------------------------- mainnet (not in this build)

const notInThisBuild = (what: string) => () => {
  throw new Error(`${what} is not enabled in this build. Mainnet uses Pyth and Jupiter, verified separately.`);
};

export const pythPriceProvider: PriceProvider = {
  name: "Pyth", testData: false, label: "Pyth", get: async () => null,
  accountFor: notInThisBuild("Pyth price accounts"), decode: () => null,
};

export const jupiterExecutionProvider: ExecutionProvider = {
  name: "Jupiter", testVenue: false, quote: notInThisBuild("Jupiter execution"), venue: notInThisBuild("Jupiter execution"),
};

export const priceProvider: PriceProvider = CLUSTER === "devnet" ? devnetPriceProvider : pythPriceProvider;
export const executionProvider: ExecutionProvider = CLUSTER === "devnet" ? devnetExecutionProvider : jupiterExecutionProvider;
