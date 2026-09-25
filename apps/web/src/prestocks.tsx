/**
 * Live PreStocks market data — REAL mainnet data from the PreStocks
 * first-party API (proxied at /api/prestocks), shown next to the Devnet test
 * portfolio. Market price and issuer reference mark are kept separate and the
 * premium/discount is exact decimal arithmetic; nothing here is Circle NAV.
 */
import { useEffect, useState } from "react";
import { dec } from "../../../packages/domain/src/display.ts";
import { prestocksMarketMark } from "../../../packages/domain/src/valuation.ts";
import type { Holding } from "./chain.ts";

type PreStocksQuote = {
  symbol: string;
  name: string;
  mint: string;
  marketPrice: string;
  issuerMark: string;
  marketValuation: string;
  referenceValuation: string;
  supply: string;
};

type PreStocksSnapshot = { quotes: PreStocksQuote[]; loading: boolean; error: string | null; observedAt: number | null };
type PreStocksState = PreStocksSnapshot & { refresh: () => void };

/** Parse API JSON without allowing IEEE-754 numbers to become financial inputs. */
function parseExactJson(text: string): unknown {
  let observedExactNumber = false;
  const value = JSON.parse(text, ((_key: string, current: unknown, context?: { source?: string }) => {
    if (context?.source && typeof current === "number") {
      observedExactNumber = true;
      return context.source;
    }
    return current;
  }) as never);
  if (!observedExactNumber) throw new Error("The source did not expose exact numeric fields.");
  return value;
}

function usePreStocksQuotes(): PreStocksState {
  const [state, setState] = useState<PreStocksSnapshot>({ quotes: [], loading: true, error: null, observedAt: null });
  const [refreshNonce, setRefreshNonce] = useState(0);
  useEffect(() => {
    setState((previous) => ({ ...previous, loading: true, error: null }));
    let cancelled = false;
    void fetch("/api/prestocks", { cache: "no-store", headers: { accept: "application/json" } })
      .then(async (response) => {
        if (!response.ok) throw new Error(`PreStocks returned HTTP ${response.status}.`);
        const raw = await response.text();
        const rows = parseExactJson(raw);
        if (!Array.isArray(rows)) throw new Error("PreStocks returned an unexpected response.");
        const quotes = rows.flatMap((row: unknown) => {
          if (!row || typeof row !== "object") return [];
          const item = row as Record<string, unknown>;
          const fields = ["symbol", "name", "contract_address", "markPrice", "tokenPrice", "markValuation", "impliedValuation", "supply"];
          if (fields.some((field) => typeof item[field] !== "string")) return [];
          return [{
            symbol: item.symbol as string,
            name: item.name as string,
            mint: item.contract_address as string,
            marketPrice: item.tokenPrice as string,
            issuerMark: item.markPrice as string,
            marketValuation: item.impliedValuation as string,
            referenceValuation: item.markValuation as string,
            supply: item.supply as string,
          }];
        });
        if (quotes.length === 0) throw new Error("PreStocks returned no usable quotes.");
        if (!cancelled) setState({ quotes, loading: false, error: null, observedAt: Date.now() });
      })
      .catch(() => {
        if (!cancelled) setState({ quotes: [], loading: false, error: "The first-party source is unavailable through Tenet.", observedAt: null });
      });
    return () => { cancelled = true; };
  }, [refreshNonce]);
  return { ...state, refresh: () => setRefreshNonce((value) => value + 1) };
}

function premiumBps(market: string, mark: string): bigint | null {
  try {
    return prestocksMarketMark(dec(market), dec(mark)).premiumDiscountBps;
  } catch {
    return null;
  }
}

function formatDecimal(value: string): string {
  return value.replace(/(\.\d*?[1-9])0+$/, "$1").replace(/\.0+$/, "");
}

function formatBpsSigned(value: bigint | null): string {
  if (value === null) return "Unavailable";
  const sign = value < 0n ? "−" : "+";
  const absolute = value < 0n ? -value : value;
  return `${sign}${absolute / 100n}.${(absolute % 100n).toString().padStart(2, "0")}%`;
}

function groupDecimal(value: string): string {
  const exact = formatDecimal(value);
  if (!/^\d+(?:\.\d+)?$/.test(exact)) return exact;
  const [whole, fraction] = exact.split(".");
  const grouped = BigInt(whole).toLocaleString("en-US");
  return fraction ? `${grouped}.${fraction}` : grouped;
}

export function PreStocksMarketSurface({ holdings }: { holdings: Holding[] }) {
  const { quotes, loading, error, observedAt, refresh } = usePreStocksQuotes();
  const retrieved = observedAt === null ? null : new Date(observedAt).toLocaleString();
  return (
    <div className="prestocks-surface">
      <div className="prestocks-head">
        <div>
          <span className="eyebrow">Private-market exposure | PreStocks</span>
          <h3>Market price vs issuer reference</h3>
          <p>Source-reported economic exposure. The issuer reference is informational, not a guaranteed sale price.</p>
        </div>
        <div className="prestocks-head-actions">
          <span className={`source-status ${loading ? "loading" : error ? "bad" : "live"}`}><span />{loading ? "Checking source" : error ? "Unavailable" : "Source response"}</span>
          <button className="btn small ghost" type="button" disabled={loading} onClick={refresh}>Refresh</button>
        </div>
      </div>
      {error ? <div className="prestocks-unavailable">PreStocks data is unavailable through Tenet right now. No price comparison is shown.</div> : loading ? <div className="prestocks-unavailable">Checking the current first-party PreStocks source...</div> : quotes.length === 0 ? <div className="prestocks-unavailable">The source returned no current products.</div> : (
        <div className="prestocks-table" role="table" aria-label="PreStocks market price versus issuer reference">
          <div className="prestocks-row prestocks-row-head" role="row"><span>Economic exposure</span><span>Market price</span><span>Issuer reference</span><span>Premium / discount</span></div>
          {quotes.map((quote) => {
            const held = holdings.some((holding) => holding.registry.mint === quote.mint && holding.vaultRaw > 0n);
            const premium = premiumBps(quote.marketPrice, quote.issuerMark);
            return <div className="prestocks-row" role="row" key={quote.mint}>
              <span className="prestocks-exposure"><strong>{quote.symbol}</strong><small>{quote.name} | {held ? "Held by this Circle" : "Source universe; not a Circle holding"}</small><small>Market implied valuation: ${groupDecimal(quote.marketValuation)} | Reference valuation: ${groupDecimal(quote.referenceValuation)} | Token supply: {groupDecimal(quote.supply)}</small></span>
              <span>${formatDecimal(quote.marketPrice)}</span>
              <span>${formatDecimal(quote.issuerMark)}</span>
              <span className={premium !== null && premium < 0n ? "discount" : "premium"}>{formatBpsSigned(premium)}</span>
            </div>;
          })}
        </div>
      )}
      <div className="prestocks-foot">Source: PreStocks first-party endpoint{retrieved ? ` | retrieved ${retrieved}` : ""}. The endpoint does not provide a publish timestamp, executable quote, liquidity, transferability or corporate-action state; these values are not Circle NAV or a guaranteed exit price.</div>
    </div>
  );
}
