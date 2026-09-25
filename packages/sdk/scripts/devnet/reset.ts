/**
 * pnpm devnet:reset — return the devnet test market to its reference state.
 * DEVNET ONLY; operator only.
 *
 * On-chain history cannot be deleted, and Circles belong to their members, so
 * "reset" restores what the operator controls: every feed back to the
 * catalog price / mark / underlying (fresh publish_time), every market spread
 * back to the default, every inventory topped up. Mandates and Circles are
 * untouched; create new ones to start over.
 */
import {
  INSTRUMENTS, INVENTORY_UNITS, MARKET_SPREAD_BPS, fetchMarket, findAdminPda, getSetSpreadInstruction, updateFeed,
} from "../../src/devnet/index";
import { TOKEN_2022_PROGRAM, mintToIx } from "../../src/spl";
import type { Instruction } from "@solana/kit";
import { balance, connect, loadKeypair, requireDeployment, send } from "./lib";

async function main() {
  const d = requireDeployment();
  const ctx = await connect();
  const op = await loadKeypair();
  const [admin] = await findAdminPda();
  for (const spec of INSTRUMENTS) {
    const inst = d.instruments.find((i) => i.symbol === spec.symbol);
    if (!inst) {
      console.log(`  ${spec.symbol}: not deployed — run devnet:setup`);
      continue;
    }
    const ixs: Instruction[] = [await updateFeed({
      operator: op, admin, feed: inst.feed as never,
      prices: { price: spec.price, conf: 0n, referenceMark: spec.mark, underlyingPrice: spec.underlying },
    })];
    const market = await fetchMarket(ctx.rpc, inst.market as never);
    if (market.data.spreadBps !== MARKET_SPREAD_BPS) {
      ixs.push(getSetSpreadInstruction({ operator: op, admin, market: inst.market as never, spreadBps: MARKET_SPREAD_BPS }));
    }
    const want = INVENTORY_UNITS * 10n ** BigInt(spec.decimals);
    const have = await balance(ctx, market.data.inventory);
    if (have < want) ixs.push(mintToIx(TOKEN_2022_PROGRAM, inst.mint as never, market.data.inventory, op, want - have));
    await send(ctx, op, ixs, `${spec.symbol}: price ${Number(spec.price) / 1e6}, spread ${MARKET_SPREAD_BPS} bps, inventory ${INVENTORY_UNITS}`);
  }
}

main().catch((e) => {
  console.error(`✗ ${(e as Error).message}`);
  process.exit(1);
});
