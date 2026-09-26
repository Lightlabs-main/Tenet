/**
 * Live Pyth market data — REAL data from Pyth Network (Hermes), served by
 * Tenet's own proxy (/api/pyth) so the API key never reaches the browser.
 *
 * Each price is judged by the SAME rules the Tenet program applies on
 * mainnet before any price may value a Circle or bound an execution
 * (programs/tenet/src/price.rs): publish time within 60 s, confidence within
 * 1% of price, positive price. Integers stay exact (bigint), never floats.
 */
import { useEffect, useState } from "react";
import { Badge } from "./ui.tsx";

interface PythFeed { symbol: string; id: string; price: string; conf: string; expo: number; publishTime: number }

const MAX_AGE_S = 60n; // MAINNET_MAX_PRICE_AGE_SECONDS
const MAX_CONF_BPS = 100n; // MAX_CONFIDENCE_BPS

/** Exact decimal string of price × 10^expo, trimmed to `places`. */
function decimal(raw: bigint, expo: number, places = 2): string {
  const neg = raw < 0n;
  let s = (neg ? -raw : raw).toString();
  if (expo >= 0) return (neg ? "-" : "") + s + "0".repeat(expo);
  const d = -expo;
  s = s.padStart(d + 1, "0");
  const whole = s.slice(0, s.length - d);
  const frac = s.slice(s.length - d).slice(0, places).padEnd(places, "0");
  return `${neg ? "-" : ""}${BigInt(whole).toLocaleString("en-US")}.${frac}`;
}

function verdict(f: PythFeed, now: bigint): { ok: boolean; text: string } {
  const price = BigInt(f.price);
  const conf = BigInt(f.conf);
  const age = now - BigInt(f.publishTime);
  if (price <= 0n) return { ok: false, text: "Refused: price not positive" };
  if (age > MAX_AGE_S) {
    const equity = f.symbol.startsWith("Equity.");
    return { ok: false, text: `Refused: ${age < 3600n ? `${age}s` : `${age / 3600n}h`} old${equity ? " — US market closed" : ""}` };
  }
  const bps = (conf * 10_000n + price - 1n) / price;
  if (bps > MAX_CONF_BPS) return { ok: false, text: `Refused: confidence ${bps} bps > 100` };
  return { ok: true, text: "Accepted by Tenet's rules" };
}

export function PythLivePanel() {
  const [feeds, setFeeds] = useState<PythFeed[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => BigInt(Math.floor(Date.now() / 1000)));
  useEffect(() => {
    let live = true;
    const load = () => fetch("/api/pyth", { cache: "no-store" })
      .then(async (r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() as Promise<{ feeds: PythFeed[] }>; })
      .then((b) => { if (live) { setFeeds(b.feeds); setError(null); } })
      .catch((e) => { if (live) setError((e as Error).message); });
    void load();
    const poll = setInterval(load, 5_000);
    const tick = setInterval(() => setNow(BigInt(Math.floor(Date.now() / 1000))), 1_000);
    return () => { live = false; clearInterval(poll); clearInterval(tick); };
  }, []);

  const usdc = feeds?.find((f) => f.symbol === "Crypto.USDC/USD");
  const peg = usdc ? (BigInt(usdc.price) * 10_000n) / 10n ** BigInt(-usdc.expo) - 10_000n : null;

  return (
    <section className="card value-card" id="pyth-live">
      <div className="card-head">
        <div><span className="eyebrow">Live market · Pyth Network</span><h2>Real prices, judged by Tenet's on-chain rules</h2>
          <p className="card-intro">Live Pyth feeds, refreshed every 5 seconds. Each one gets the verdict the Tenet program would give before letting a price value a Circle or bound a trade: no older than 60 s, confidence within 1%. Stale or uncertain prices are refused, never guessed.</p></div>
        <Badge tone="good">LIVE · REAL DATA</Badge>
      </div>
      {error ? <p className="muted">Pyth data is unavailable right now ({error}). Tenet shows nothing rather than a guess.</p> : feeds === null ? <p className="muted">Reading Pyth…</p> : (
        <table className="holdings">
          <thead><tr><th>Pyth feed</th><th className="r">Price</th><th className="r hide-sm">Confidence</th><th className="r">Age</th><th className="r">Tenet verdict</th></tr></thead>
          <tbody>
            {feeds.map((f) => {
              const v = verdict(f, now);
              const age = now - BigInt(f.publishTime);
              const bps = (BigInt(f.conf) * 10_000n + BigInt(f.price) - 1n) / BigInt(f.price);
              return <tr key={f.id}>
                <td><strong>{f.symbol}</strong><div className="asset-sub mono">{f.id.slice(0, 10)}…</div></td>
                <td className="r">${decimal(BigInt(f.price), f.expo, f.symbol.includes("USDC") ? 4 : 2)}</td>
                <td className="r hide-sm">±{decimal(BigInt(f.conf), f.expo, 4)} <div className="asset-sub">{bps.toString()} bps</div></td>
                <td className="r">{age < 120n ? `${age}s` : age < 7200n ? `${age / 60n} min` : `${age / 3600n} h`}</td>
                <td className="r"><span className={v.ok ? "premium" : "discount"}>{v.ok ? "✓ " : "✗ "}{v.text}</span></td>
              </tr>;
            })}
          </tbody>
        </table>
      )}
      {peg !== null ? <p className="honest value-note"><span>ⓘ</span><span>USDC peg per Pyth: {peg === 0n ? "exactly $1.0000" : `${peg > 0n ? "+" : "−"}${(peg < 0n ? -peg : peg).toString()} bps from $1`}. On mainnet Tenet Circles hold real USDC; on Devnet they hold TUSDC, which has no monetary value.</span></p> : null}
      <p className="honest value-note"><span>ⓘ</span><span>On mainnet Tenet reads tokenized-stock feeds (e.g. <code>Crypto.AAPLX/USD</code>) next to the underlying equity (<code>Equity.US.AAPL/USD</code>) through Pyth's on-chain receiver. This build's Pyth plan covers the feeds above. On Devnet, TTSLA and TVOO are priced from Equity.US.TSLA and Equity.US.VOO: a relay publishes each fresh Pyth price to their devnet feeds, and holds the last one while the US market is closed.</span></p>
    </section>
  );
}
