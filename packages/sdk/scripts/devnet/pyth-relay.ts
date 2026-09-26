/**
 * pnpm devnet:pyth-relay — publish live Pyth prices into the devnet feeds of
 * the instruments that follow Pyth (INSTRUMENTS[].pyth: TTSLA, TVOO).
 * DEVNET ONLY; operator only. Run by cron every couple of minutes.
 *
 * Source: Tenet's own server-side Pyth proxy (TENET_PYTH_URL, default
 * http://127.0.0.1:8504/api/pyth on the operator host) — this script never
 * handles the Pyth API key.
 *
 * A price is relayed only if it passes the SAME rules the Tenet program
 * applies to Pyth on mainnet: published within 60 s, confidence ≤ 1%,
 * positive. Outside US market hours the equity feeds stop publishing, so
 * nothing is relayed and the devnet feed keeps its last Pyth price (its
 * on-chain publish_time shows how old it is). This is an operator relay of
 * Pyth data, not Pyth's own on-chain verification.
 */
import type { Address, Instruction } from "@solana/kit";
import { INSTRUMENTS, fetchPriceFeed, findAdminPda, updateFeed } from "../../src/devnet/index";
import { connect, loadKeypair, requireDeployment, send } from "./lib";

const PYTH_URL = process.env.TENET_PYTH_URL ?? "http://127.0.0.1:8504/api/pyth";
const MAX_AGE_S = 60n;
const MAX_CONF_BPS = 100n;

interface PythFeed { symbol: string; price: string; conf: string; expo: number; publishTime: number }

/** Pyth integer at `expo` -> the devnet feed's 1e-6 scale, floored. */
export function toMicros(raw: bigint, expo: number): bigint {
  const shift = 6 + expo;
  return shift >= 0 ? raw * 10n ** BigInt(shift) : raw / 10n ** BigInt(-shift);
}

async function main() {
  const d = requireDeployment();
  const res = await fetch(PYTH_URL, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`Pyth proxy returned HTTP ${res.status}`);
  const feeds = ((await res.json()) as { feeds: PythFeed[] }).feeds;
  const now = BigInt(Math.floor(Date.now() / 1000));

  const ctx = await connect();
  const op = await loadKeypair();
  const [admin] = await findAdminPda();
  const ixs: Instruction[] = [];
  const notes: string[] = [];
  for (const spec of INSTRUMENTS.filter((i) => i.pyth)) {
    const inst = d.instruments.find((i) => i.symbol === spec.symbol);
    const f = feeds.find((x) => x.symbol === spec.pyth);
    if (!inst || !f) { notes.push(`${spec.symbol}: ${inst ? "no Pyth data" : "not deployed"}`); continue; }
    const price = BigInt(f.price);
    const conf = BigInt(f.conf);
    const age = now - BigInt(f.publishTime);
    if (price <= 0n || age > MAX_AGE_S || conf * 10_000n > price * MAX_CONF_BPS) {
      notes.push(`${spec.symbol}: skipped, Pyth ${spec.pyth} is ${age}s old (market closed?)`);
      continue;
    }
    const micros = toMicros(price, f.expo);
    const cur = (await fetchPriceFeed(ctx.rpc, inst.feed as Address)).data;
    ixs.push(await updateFeed({
      operator: op, admin, feed: inst.feed as Address,
      prices: { price: micros, conf: toMicros(conf, f.expo), referenceMark: cur.referenceMark, underlyingPrice: micros },
    }));
    notes.push(`${spec.symbol}: ${Number(cur.price) / 1e6} -> ${Number(micros) / 1e6} (Pyth ${spec.pyth}, ${age}s old)`);
  }
  if (ixs.length) await send(ctx, op, ixs, `relay Pyth -> devnet feeds: ${notes.join("; ")}`);
  else console.log(`nothing relayed: ${notes.join("; ")}`);
}

if (process.argv[1]?.endsWith("pyth-relay.ts")) {
  main().catch((e) => { console.error(`✗ ${(e as Error).message}`); process.exit(1); });
}
