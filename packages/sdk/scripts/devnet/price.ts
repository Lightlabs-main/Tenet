/**
 * pnpm devnet:price — publish devnet test prices. DEVNET ONLY; operator only
 * (the program refuses anyone else).
 *
 *   pnpm devnet:price TNVDA 110                  price 110.00 TUSDC
 *   pnpm devnet:price TSPACEX 40 --mark 50       market vs mark: -20%
 *   pnpm devnet:price TNVDA 100 --underlying 102 token vs underlying: -1.96%
 *   pnpm devnet:price --refresh                  republish every feed as-is
 *                                                (resets publish_time)
 *
 * These are devnet pricing simulations, not market data.
 */
import { fetchPriceFeed, updateFeed, findAdminPda } from "../../src/devnet/index";
import { connect, loadKeypair, requireDeployment, send, toMicros } from "./lib";

async function main() {
  const args = process.argv.slice(2);
  const flag = (name: string) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const d = requireDeployment();
  const ctx = await connect();
  const op = await loadKeypair();
  const [admin] = await findAdminPda();
  const targets = args[0] === "--refresh" ? d.instruments : d.instruments.filter((i) => i.symbol === args[0]);
  if (!targets.length) throw new Error(`usage: devnet:price <SYMBOL> <price> [--mark N] [--underlying N] | --refresh`);
  for (const inst of targets) {
    const cur = (await fetchPriceFeed(ctx.rpc, inst.feed as never)).data;
    const next = {
      price: args[0] === "--refresh" ? cur.price : toMicros(args[1] ?? ""),
      conf: cur.conf,
      referenceMark: flag("--mark") ? toMicros(flag("--mark")!) : cur.referenceMark,
      underlyingPrice: flag("--underlying") ? toMicros(flag("--underlying")!) : cur.underlyingPrice,
    };
    await send(ctx, op, [await updateFeed({ operator: op, admin, feed: inst.feed as never, prices: next })],
      `${inst.symbol}: ${Number(cur.price) / 1e6} -> ${Number(next.price) / 1e6} TUSDC (devnet pricing simulation)`);
  }
}

main().catch((e) => {
  console.error(`✗ ${(e as Error).message}`);
  process.exit(1);
});
