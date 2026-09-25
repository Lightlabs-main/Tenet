/**
 * pnpm devnet:status — read-only health check of the Devnet deployment.
 * Needs no keypair. Exits non-zero if anything a user depends on is wrong.
 */
import type { Address } from "@solana/kit";
import { Network, PriceSource, TENET_PROGRAM_ADDRESS, fetchConfig, pda } from "../../src/index";
import {
  FAUCET_SUPPLY_CAP, INSTRUMENTS, MARKET_SPREAD_BPS, TENET_DEVNET_PROGRAM_ADDRESS, fetchFaucet, fetchMarket,
  fetchPriceFeed, findFaucetPda,
} from "../../src/devnet/index";
import { balance, connect, requireDeployment } from "./lib";

const MAX_AGE = 30n * 24n * 3600n;

async function main() {
  const d = requireDeployment();
  const ctx = await connect();
  const problems: string[] = [];
  const ok = (cond: boolean, msg: string) => { console.log(`${cond ? "  ✓" : "  ✗"} ${msg}`); if (!cond) problems.push(msg); };

  for (const [name, id] of [["tenet", TENET_PROGRAM_ADDRESS], ["tenet-devnet", TENET_DEVNET_PROGRAM_ADDRESS]] as const) {
    const { value } = await ctx.rpc.getAccountInfo(id, { encoding: "base64" }).send();
    ok(value?.executable === true, `${name} deployed at ${id}`);
  }
  const c = (await fetchConfig(ctx.rpc, (await pda.config())[0])).data;
  ok(c.network === Network.Devnet, "Config network = Devnet");
  ok(c.usdcMint === d.tusdcMint, `Config cash mint = TUSDC ${d.tusdcMint}`);
  ok(c.executionVenue === TENET_DEVNET_PROGRAM_ADDRESS && c.priceProgram === TENET_DEVNET_PROGRAM_ADDRESS && c.priceSource === PriceSource.DevnetFeed, "Config venue + price source = tenet-devnet");

  const faucet = (await fetchFaucet(ctx.rpc, (await findFaucetPda())[0])).data;
  ok(faucet.totalMintedRaw < FAUCET_SUPPLY_CAP, `faucet minted ${faucet.totalMintedRaw / 1_000_000n} TUSDC (cap ${FAUCET_SUPPLY_CAP / 1_000_000n})`);

  const slot = await ctx.rpc.getSlot().send();
  const now = BigInt((await ctx.rpc.getBlockTime(slot).send()) ?? Math.floor(Date.now() / 1000));
  for (const spec of INSTRUMENTS) {
    const i = d.instruments.find((x) => x.symbol === spec.symbol);
    if (!i) { ok(false, `${spec.symbol} deployed`); continue; }
    const f = (await fetchPriceFeed(ctx.rpc, i.feed as Address)).data;
    const age = now - f.publishTime;
    const m = (await fetchMarket(ctx.rpc, i.market as Address)).data;
    const inv = await balance(ctx, m.inventory);
    const invUnits = inv / 10n ** BigInt(spec.decimals);
    ok(age >= 0n && age < MAX_AGE, `${spec.symbol} price ${Number(f.price) / 1e6} published ${age / 3600n}h ago (on-chain limit ${MAX_AGE / 86400n} days)`);
    ok(m.spreadBps === MARKET_SPREAD_BPS, `${spec.symbol} market spread ${m.spreadBps} bps`);
    ok(invUnits > 1000n, `${spec.symbol} market inventory ${invUnits} units`);
  }
  if (d.reference) {
    const { value } = await ctx.rpc.getAccountInfo(d.reference.circle as Address, { encoding: "base64" }).send();
    ok(value !== null, `default Circle ${d.reference.circle} exists`);
  }
  console.log(problems.length ? `\n✗ ${problems.length} problem(s)` : "\n✓ Devnet deployment healthy");
  if (problems.length) process.exit(1);
}

main().catch((e) => { console.error(`✗ ${(e as Error).message}`); process.exit(1); });
