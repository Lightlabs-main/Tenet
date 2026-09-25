/**
 * The Circle dashboard. Every number on it is read from the chain or computed
 * from chain values by the domain model — the same functions whose results are
 * cross-checked against the Rust program (tests/vectors/math.json). There are
 * market values appear only when the required verified observations are fresh;
 * the page says so rather than inventing any.
 */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useWalletAccountTransactionSendingSigner } from "@solana/react";
import type { UiWalletAccount } from "@wallet-standard/react";
import { AccountRole, generateKeyPairSigner } from "@solana/kit";
import type { Address, Instruction, TransactionSendingSigner } from "@solana/kit";
import {
  AssetClass, AssetStatus, EpochState, MandateState, buyDevnetTestEquity, contribute, initiateRedemption, openEpoch,
  findActiveUsdcVaultPda, findCircleAssetPda, findEpochEscrowPda, findEpochPda, findMemberPda,
  findNavSnapshotPda, findReceiptPda, findVaultAuthorityPda, findVaultPda,
  getCancelContributionInstruction, getClaimRedemptionAssetInstructionAsync,
  getClaimRedemptionUsdcInstructionAsync, getCloseContributionsInstruction, getCloseEpochInstruction,
  getOpenNavSnapshotInstructionAsync,
  getFinalizeEpochInstructionAsync, getReserveRedemptionAssetInstruction,
  getReserveRedemptionUsdcInstructionAsync, getSettleContributionInstruction,
  getFinalizeMandateInstruction, getForkMandateAssetInstruction, getForkMandateInstruction,
  getAddCircleAssetInstructionAsync, getCreateCircleInstructionAsync,
  findCirclePda, findConfigPda, findMandateAssetPda, findMandatePda, findTestEquityVaultPda, findTestMarketPda, findTestMintPda, fetchMaybeCircle, fetchMaybeCircleAsset, fetchMaybeDevnetTestMarket,
  findNewAssetPda, findNewMandatePda, findRegistryEntryPda,
  fetchMaybeMandate, fetchMaybeMandateAsset, getCreateDevnetTestCircleInstructionAsync, getInitializeDevnetTestMarketInstructionAsync, type DevnetTestMarket,
} from "@tenet/sdk";
import { entitlementForRedemption, sharesForContribution } from "../../../packages/domain/src/accounting.ts";
import { dec } from "../../../packages/domain/src/display.ts";
import { prestocksMarketMark } from "../../../packages/domain/src/valuation.ts";
import { CHAIN, CLUSTER, TOKEN_PROGRAM, TRANSACTIONS_ENABLED, USDC_DECIMALS, USDC_MINT } from "./config.ts";
import {
  ataAddress, b58ToAddress, createAtaIdempotent, redemptionAssetPda, redemptionPda, rpc, send, tokenBalance, withheldFee,
  isDevnetTestMarketBuildDeployed, type CircleView, type ExitView, type Holding,
} from "./chain.ts";
import { formatRaw, formatShares, parseAmount } from "./money.ts";
import { AddressLink, Badge, Meter, Spinner, Stepper, formatBps, ratioBps, useToast } from "./ui.tsx";

const usdc = (raw: bigint) => formatRaw(raw, USDC_DECIMALS);
/** Trim trailing zeros for display ("5.000000" -> "5"). */
const trim = (s: string) => (s.includes(".") ? s.replace(/\.?0+$/, "") : s);
const formatDuration = (seconds: bigint) => {
  if (seconds > 0n && seconds % 86_400n === 0n) return `${seconds / 86_400n} day${seconds === 86_400n ? "" : "s"}`;
  if (seconds > 0n && seconds % 3_600n === 0n) return `${seconds / 3_600n} hour${seconds === 3_600n ? "" : "s"}`;
  if (seconds > 0n && seconds % 60n === 0n) return `${seconds / 60n} minute${seconds === 60n ? "" : "s"}`;
  return `${seconds} second${seconds === 1n ? "" : "s"}`;
};

/** The share of `available` owned by `shares` of `total` — the exact floor the program computes. */
function slice(available: bigint, shares: bigint, total: bigint): bigint {
  if (total === 0n || shares === 0n) return 0n;
  return entitlementForRedemption(available, shares > total ? total : shares, total);
}

// ================================================================ page

export type CirclePanel = "overview" | "portfolio" | "prices" | "contribute" | "exit" | "fork";

export function Dashboard({ panel, navigate, view, circle, account, me, usdcBalance, onChanged, onOpenCircle }: {
  panel: CirclePanel; navigate: (panel: CirclePanel | "mandate") => void;
  view: CircleView; circle: Address; account: UiWalletAccount | undefined; me: Address | null;
  usdcBalance: bigint | null; onChanged: () => Promise<void>; onOpenCircle: (circle: Address) => void;
}) {
  const action = TRANSACTIONS_ENABLED && (panel === "contribute" || panel === "exit" || panel === "fork") && account && me;
  return (
    <div className="circle-screen">
      {panel === "overview" ? <>
        <Overview view={view} circle={circle} me={me} navigate={navigate} />
      </> : null}
      {panel === "portfolio" ? <><div className="screen-heading"><span className="eyebrow">Circle portfolio</span><h1>Portfolio</h1><p>These balances come from its on-chain vaults. Permitted assets are shown separately.</p></div><Holdings view={view} /><details className="deep-disclosure"><summary>Why are there no stocks?</summary><CircleReadout view={view} /></details><ExecutionCard view={view} circle={circle} account={account} me={me} onChanged={onChanged} onOpenCircle={onOpenCircle} /></> : null}
      {panel === "prices" ? <><div className="screen-heading"><span className="eyebrow">Verified observations</span><h1>Prices &amp; value</h1><p>We only display a market value when its source is current and verified.</p></div><ValueSurface view={view} /></> : null}
      {panel === "contribute" || panel === "exit" || panel === "fork" ? <>
        <div className="screen-heading"><span className="eyebrow">{panel === "contribute" ? "Pool" : panel === "exit" ? "Exit" : "Fork"}</span><h1>{panel === "contribute" ? "Add money together." : panel === "exit" ? "Leave on your terms." : "Make the rules your own."}</h1><p>{panel === "contribute" ? "Contributions enter a separate USDC funding window. Everyone in that window settles together." : panel === "exit" ? "Your proportional in-kind claim does not require a price feed or vote." : "A new Mandate and Circle keep their own assets and members."}</p></div>
        {action ? <Actions panel={panel} account={account} view={view} circle={circle} me={me} usdcBalance={usdcBalance} onChanged={onChanged} onOpenCircle={onOpenCircle} /> : !TRANSACTIONS_ENABLED ? <div className="card action-locked"><span className="eyebrow">Solana Devnet · test assets</span><h2>Transactions are disabled in this build</h2><p>This Devnet preview is read-only. No wallet transaction will be requested.</p><div className="action-locked-buttons"><button className="btn ghost" type="button" onClick={() => navigate("overview")}>Back to overview</button></div></div> : <div className="card action-locked"><span className="eyebrow">Solana Devnet · test assets</span><h2>Connect your wallet to continue</h2><p>Connect a Solana wallet set to Devnet. Transactions use only test tokens with no real-world value.</p><div className="action-locked-buttons"><button className="btn ghost" type="button" onClick={() => navigate("overview")}>Back to overview</button></div></div>}
      </> : null}
    </div>
  );
}

function Overview({ view, circle, me, navigate }: { view: CircleView; circle: Address; me: Address | null; navigate: (panel: CirclePanel | "mandate") => void }) {
  const held = view.holdings.filter((h) => h.vaultRaw > 0n);
  const member = view.member;
  const activeCash = view.activeUsdcRaw - view.circle.usdcReservedRaw;
  return <>
    <section className="overview-intro">
      <div><span className="eyebrow">Your shared portfolio</span><h1>{CLUSTER === "devnet" ? "Devnet test Circle" : view.mandate.name}</h1><p>{CLUSTER === "devnet" ? "A live on-chain practice Circle. Its assets and USDC are test tokens with no real-world value." : view.mandate.description}</p></div>
      <div className="overview-actions"><button className="btn primary" type="button" onClick={() => navigate("contribute")}>Add money <span aria-hidden>→</span></button><button className="btn ghost" type="button" onClick={() => navigate("exit")}>Exit Circle</button><button className="btn ghost" type="button" onClick={() => navigate("fork")}>Fork rules</button></div>
    </section>
    <div className="overview-metrics">
      <article className="overview-metric"><span>Circle value</span><strong>{held.length === 0 ? `${trim(usdc(activeCash))} USDC` : "Unavailable"}</strong><p>{held.length === 0 ? "Cash only. No asset prices are needed for this amount." : `Verified asset prices are not connected. Active cash: ${trim(usdc(activeCash))} USDC.`}</p></article>
      <article className="overview-metric"><span>Your position</span><strong>{member && member.shares > 0n ? formatBps(ratioBps(member.shares, view.circle.totalShares)) : me ? "No active position" : "Connect wallet"}</strong><p>{member && member.shares > 0n ? `${trim(formatShares(member.shares))} settled shares` : "Pending contributions are separate from active holdings."}</p></article>
      <article className="overview-metric"><span>Mandate</span><strong>{view.mandate.state === MandateState.Active ? "Active rules" : "Rules pending"}</strong><p>{view.holdings.length} permitted asset{view.holdings.length === 1 ? "" : "s"}. Read the limits before contributing.</p><button type="button" onClick={() => navigate("mandate")}>View rules →</button></article>
    </div>
    <section className="overview-portfolio card"><div className="card-head"><div><span className="eyebrow">Portfolio</span><h2>What is actually in the Circle</h2></div><button className="text-action" type="button" onClick={() => navigate("portfolio")}>Open portfolio →</button></div><div className="overview-holding"><span className="asset-icon usdc">$</span><div><strong>USDC</strong><small>On-chain active vault</small></div><strong>{trim(usdc(view.activeUsdcRaw))}</strong></div>{held.map((h) => <div className="overview-holding" key={h.address}><span className="asset-icon">{h.registry.symbol.slice(0, 4)}</span><div><strong>{h.registry.displayName}</strong><small>{h.registry.symbol} · Devnet vault balance</small></div><strong>{trim(formatRaw(h.vaultRaw, h.registry.decimals))}</strong></div>)}{held.length === 0 ? <div className="overview-empty">No stock tokens are held. {view.holdings.length ? `${view.holdings.map((h) => h.registry.symbol).join(", ")} is allowed by the Mandate, but has not been bought.` : "No assets are configured yet."}</div> : null}</section>
    <section className="overview-next"><div><span className="eyebrow">How Tenet works</span><h2>People pool capital. Rules govern it.</h2><p>Contributions enter an Epoch. The Mandate controls purchases. Members can claim their proportional assets or fork the rules into a separate Circle.</p></div><button className="btn ghost" type="button" onClick={() => navigate("mandate")}>Read this Mandate</button><details><summary>On-chain Circle address</summary><AddressLink address={circle} /></details></section>
    <details className="deep-disclosure"><summary>Detailed Mandate limit checks</summary><Rules view={view} /></details>
  </>;
}

function CircleReadout({ view }: { view: CircleView }) {
  const held = view.holdings.filter((h) => h.vaultRaw > 0n);
  const allowed = view.holdings;
  const empty = view.activeUsdcRaw === 0n && held.length === 0;
  const allowedNames = allowed.map((h) => `${h.registry.symbol} · ${h.registry.displayName}`);
  return (
    <section className="card circle-readout" aria-label="What this Circle holds">
      <div className="circle-readout-head">
        <div>
          <span className="eyebrow">Your Circle, in plain language</span>
          <h2>{empty ? "This Circle has not invested yet" : "What this Circle holds"}</h2>
          <p>{empty
            ? "No assets are currently held in the active Circle vaults. An asset allowed by the Mandate is not automatically owned."
            : "The amounts below are what is actually in the Circle’s on-chain vaults. An asset allowed by the rules is not automatically owned."}</p>
        </div>
        <Badge tone="neutral">On-chain Circle state</Badge>
      </div>
      <div className="circle-readout-grid">
        <div><span>Cash in the Circle</span><strong>{trim(usdc(view.activeUsdcRaw))} USDC</strong><small>Raw token-vault balance</small></div>
        <div><span>Tokens actually held</span><strong>{held.length === 0 ? "None" : `${held.length} test token${held.length === 1 ? "" : "s"}`}</strong><small>Held means a token balance exists in the vault</small></div>
        <div><span>Allowed by its rules</span><strong>{allowed.length === 0 ? "No assets" : allowed.map((h) => h.registry.symbol).join(", ")}</strong><small>{allowedNames.length ? `${allowedNames.join("; ")} · test token only` : "No enabled assets are recorded"}</small></div>
      </div>
      {empty ? <p className="circle-readout-why"><strong>Why don’t I see stocks?</strong> This Circle has no non-zero stock-token vault balances. Mandate permissions are not holdings; supported assets appear here only after a verified execution delivers tokens to the Circle’s vault.</p> : null}
      <div className="circle-vocabulary"><span><strong>Circle</strong> shared portfolio</span><span><strong>Mandate</strong> the Circle’s investment rules</span><span><strong>Epoch</strong> a timed window for pooling contributions</span></div>
    </section>
  );
}

// ================================================================ holdings

function Holdings({ view }: { view: CircleView }) {
  const { circle: c, member, mandate } = view;
  const mine = member?.shares ?? 0n;
  const usdcAvail = view.activeUsdcRaw - c.usdcReservedRaw;
  const heldAssets = view.holdings.filter((h) => h.vaultRaw > 0n);
  return (
    <section className="card" id="holdings">
      <div className="card-head">
        <div><span className="eyebrow">Vault balances</span><h2>Assets in the Circle</h2><p className="card-intro">Only assets with an actual vault balance appear here.</p></div>
        <Badge tone="good">Live vault balances</Badge>
      </div>
      <table className="holdings">
        <thead>
          <tr>
            <th>Asset</th>
            <th className="hide-sm">Target by rules</th>
            <th className="r">In Circle</th>
            <th className="r">Your portion</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <div className="asset">
                <div className="asset-icon usdc">$</div>
                <div>
                <div className="asset-name">USDC</div>
                  <div className="asset-sub">cash in Circle · Devnet vault</div>
                </div>
              </div>
            </td>
            <td className="hide-sm muted">remainder</td>
            <td className="r">{trim(usdc(view.activeUsdcRaw))}</td>
            <td className="r">{mine > 0n ? trim(usdc(slice(usdcAvail, mine, c.totalShares))) : "—"}</td>
          </tr>
          {heldAssets.map((h) => <HoldingRow key={h.address} h={h} mine={mine} total={c.totalShares} capBps={BigInt(mandate.maxWeightPerAssetBps)} />)}
        </tbody>
      </table>
      {heldAssets.length === 0 ? <p className="holdings-empty">No stock tokens are held. {view.holdings.length ? `${view.holdings.map((h) => h.registry.symbol).join(", ")} is permitted by the Mandate but has not been bought.` : "No assets are permitted by the current Mandate."}</p> : null}
      <details className="portfolio-method"><summary>How these amounts are calculated</summary><p>These are raw vault balances shown in token units. Your portion uses your settled shares. Price estimates appear only with fresh verified observations. An outside transfer fee may reduce the amount received on exit.</p></details>
    </section>
  );
}

function HoldingRow({ h, mine, total, capBps }: { h: Holding; mine: bigint; total: bigint; capBps: bigint }) {
  const pre = h.registry.assetClass === AssetClass.PreIpo;
  const d = h.registry.decimals;
  const avail = h.vaultRaw - h.asset.reservedForRedemptionRaw;
  const metadataVerified = h.registry.lastVerifiedTs > 0n;
  return (
    <tr>
      <td>
        <div className="asset">
          <div className="asset-icon">{h.registry.symbol.slice(0, 4)}</div>
          <div style={{ minWidth: 0 }}>
            <div className="asset-name">{h.registry.symbol} <Badge tone={CLUSTER === "devnet" ? "warn" : pre ? "pre" : "info"}>{CLUSTER === "devnet" ? "Test token" : pre ? "Pre-IPO exposure" : "Public tokenized equity"}</Badge></div>
            <div className="asset-sub">{h.registry.displayName} · {CLUSTER === "devnet" ? (h.vaultRaw > 0n ? "test balance · no real-world value" : "allowed by rules · not held") : <span className={metadataVerified ? "verified" : "pending"}>{metadataVerified ? "metadata verified" : "metadata pending"}</span>}</div>
          </div>
        </div>
      </td>
      <td className="hide-sm weight">
        <Meter bps={BigInt(h.targetWeightBps)} capBps={capBps} tone={pre ? "pre" : undefined} />
        <div className="meter-label"><span>{formatBps(BigInt(h.targetWeightBps))} target</span><span>cap {formatBps(capBps)}</span></div>
      </td>
      <td className="r">
        {trim(formatRaw(h.vaultRaw, d))}
        {h.asset.reservedForRedemptionRaw > 0n ? <div className="asset-sub">{trim(formatRaw(h.asset.reservedForRedemptionRaw, d))} owed to exits</div> : null}
      </td>
      <td className="r">{mine > 0n ? trim(formatRaw(slice(avail, mine, total), d)) : "—"}</td>
    </tr>
  );
}

// ================================================================ value

/**
 * VALUE is intentionally explicit about what is and is not known. The page
 * never turns a missing oracle, issuer mark, or paired feed into a made-up NAV.
 * Once verified observations are wired in, this surface is the home for them.
 */
function ValueSurface({ view }: { view: CircleView }) {
  const active = view.activeUsdcRaw - view.circle.usdcReservedRaw;
  const hasHeldAssets = view.holdings.some((h) => h.vaultRaw > 0n);
  const preIpoCount = view.holdings.filter((h) => h.registry.assetClass === AssetClass.PreIpo && h.vaultRaw > 0n).length;
  return (
    <section className="card value-card" id="value">
      <div className="card-head">
        <div>
          <span className="eyebrow">Value</span>
          <h2>Current data availability</h2>
          <p className="card-intro">Prices appear only when Tenet can verify a current source. No estimate is shown when data is missing.</p>
        </div>
        <Badge tone="warn">Asset prices unavailable</Badge>
      </div>
      <div className="value-grid">
        <div className="value-item">
          <span className="value-label">Circle cash</span>
          <strong>{trim(usdc(active))} <small>USDC</small></strong>
          <span className="value-state good">On-chain balance</span>
        </div>
        <div className="value-item">
          <span className="value-label">Circle value</span>
          <strong className={hasHeldAssets ? "unavailable" : undefined}>{hasHeldAssets ? "Unavailable" : `${trim(usdc(active))} USDC`}</strong>
          <span className="value-state">{hasHeldAssets ? "Live, verified asset prices are not connected" : "Cash only; no asset pricing is needed"}</span>
        </div>
        <div className="value-item">
          <span className="value-label">Stock price comparison</span>
          <strong className="unavailable">Unavailable</strong>
          <span className="value-state">Live stock-price sources are not connected</span>
        </div>
        <div className="value-item">
          <span className="value-label">Private-market price vs reference</span>
          <strong className="unavailable">Unavailable</strong>
          <span className="value-state">{preIpoCount ? `${preIpoCount} private-market holding${preIpoCount === 1 ? "" : "s"} · live mark pending` : "No private-market holdings"}</span>
        </div>
      </div>
      <p className="honest value-note">
        <span>ⓘ</span>
        <span>Your exit is based on the tokens held in the Circle, not an estimated price. You can start an exit without price data or a member vote; an external token issuer may still restrict transfers.</span>
      </p>
      <PreStocksMarketSurface holdings={view.holdings} />
    </section>
  );
}

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

// ================================================================ rules

function Rules({ view }: { view: CircleView }) {
  const m = view.mandate;
  const hs = view.holdings;
  const sumBy = (key: (h: Holding) => string) => {
    const acc = new Map<string, bigint>();
    for (const h of hs) acc.set(key(h), (acc.get(key(h)) ?? 0n) + BigInt(h.targetWeightBps));
    return [...acc.values()].reduce((a, b) => (b > a ? b : a), 0n);
  };
  const hex = (b: ArrayLike<number>) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  const rows: { label: string; used: bigint; cap: bigint; pre?: boolean; hint: string }[] = [
    { label: "One asset", used: hs.reduce((a, h) => (BigInt(h.targetWeightBps) > a ? BigInt(h.targetWeightBps) : a), 0n), cap: BigInt(m.maxWeightPerAssetBps), hint: "maximum portfolio share in a single asset" },
    { label: "Private-market exposure", used: hs.filter((h) => h.registry.assetClass === AssetClass.PreIpo).reduce((a, h) => a + BigInt(h.targetWeightBps), 0n), cap: BigInt(m.maxPreIpoWeightBps), pre: true, hint: "maximum across all eligible pre-IPO assets" },
    { label: "One issuer", used: sumBy((h) => h.registry.issuer), cap: BigInt(m.maxIssuerWeightBps), hint: "maximum across assets from one token issuer" },
    { label: "One company", used: sumBy((h) => hex(h.registry.underlyingId)), cap: BigInt(m.maxUnderlyingWeightBps), hint: "maximum across all tokens linked to one company" },
  ];
  return (
    <section className="card" id="rules">
      <div className="card-head">
        <div><span className="eyebrow">Investment rules</span><h2>What this Circle is allowed to buy</h2><p className="card-intro">The first percentage is the Mandate’s planned allocation; the second is its maximum. This is the plan, not a list of things the Circle owns. See “What is actually held” above for live balances.</p></div>
        <Badge tone="info">Enforced</Badge>
      </div>
      <div className="rules">
        {rows.map((r) => (
          <div key={r.label}>
            <div className="rule-label">
              <span>{r.label}</span>
              <strong className={r.used >= r.cap && r.cap > 0n ? "rule-at-cap" : undefined}>{formatBps(r.used)} / {formatBps(r.cap)}</strong>
            </div>
            <Meter bps={r.used} capBps={r.cap} tone={r.used >= r.cap && r.cap > 0n ? "cap" : r.pre ? "pre" : undefined} />
            <div className="rule-hint">{r.hint}{r.used >= r.cap && r.cap > 0n ? " · at the limit" : ""}</div>
          </div>
        ))}
      </div>
      <div className="hero-meta" style={{ marginTop: 16 }}>
        <Badge>minimum {trim(usdc(m.minContributionUsdc))} USDC</Badge>
        <Badge>Circle limit {trim(usdc(m.maxPoolSizeUsdc))} USDC</Badge>
        <Badge>{formatDuration(m.epochDuration)} contribution window</Badge>
        <Badge>amendments need {formatBps(BigInt(m.amendmentThresholdBps))}</Badge>
      </div>
    </section>
  );
}

// ================================================================ actions

type Run = (label: string, build: () => Promise<Instruction[]>) => Promise<boolean>;
type RunStep = { label: string; instructions: Instruction[] };
type RunMany = (label: string, build: () => Promise<{ steps: RunStep[]; verify: () => Promise<void> }>) => Promise<boolean>;

/** Human-readable program error from a failed transaction. */
function explain(e: unknown): string {
  const msg = (e as Error)?.message ?? String(e);
  const anchor = /Error Message: ([^\n]+?)\.?(\n|$)/.exec(msg);
  if (anchor) return anchor[1];
  if (/User rejected|rejected the request/i.test(msg)) return "You rejected the request in your wallet.";
  if (/Unexpected error|simulation|revert/i.test(msg)) return "The wallet could not simulate this step. Cancel any prompt marked unsafe; do not submit a transaction that your wallet says will revert.";
  return msg.length > 400 ? msg.slice(0, 400) + "…" : msg;
}

function useRunner(signer: TransactionSendingSigner, onChanged: () => Promise<void>) {
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const run: Run = async (label, build) => {
    setBusy(label);
    try {
      const sig = await send(signer, await build());
      toast({ kind: "ok", title: `${label} — confirmed`, sig });
      await onChanged();
      return true;
    } catch (e) {
      toast({ kind: "bad", title: `${label} failed`, body: explain(e) });
      return false;
    } finally {
      setBusy(null);
    }
  };
  const runMany: RunMany = async (label, build) => {
    setBusy(label);
    let stepLabel = "Preparing setup";
    try {
      let lastSignature = "";
      const plan = await build();
      for (const step of plan.steps) {
        stepLabel = step.label;
        setBusy(`${label}: ${step.label}`);
        lastSignature = await send(signer, step.instructions);
      }
      stepLabel = "Verifying the new Circle and vaults";
      await plan.verify();
      toast({ kind: "ok", title: `${label} — confirmed`, body: "The new Circle and its rule-bound asset vaults were found on-chain.", sig: lastSignature || undefined });
      return true;
    } catch (e) {
      toast({ kind: "bad", title: `${stepLabel} was not confirmed`, body: `${explain(e)} Fork setup is resumable; retry checks for confirmed accounts before building any remaining steps.` });
      return false;
    } finally {
      setBusy(null);
    }
  };
  return { busy, run, runMany };
}

function Actions({ panel, account, view, circle, me, usdcBalance, onChanged, onOpenCircle }: {
  panel: "contribute" | "exit" | "fork";
  account: UiWalletAccount; view: CircleView; circle: Address; me: Address;
  usdcBalance: bigint | null; onChanged: () => Promise<void>; onOpenCircle: (circle: Address) => void;
}) {
  const signer = useWalletAccountTransactionSendingSigner(account, CHAIN);
  const { busy, run, runMany } = useRunner(signer, onChanged);
  return (
    <>
      {panel === "contribute" ? <EpochCard view={view} circle={circle} me={me} signer={signer} usdcBalance={usdcBalance} run={run} busy={busy} /> : null}
      {panel === "exit" ? <ExitCard view={view} circle={circle} me={me} signer={signer} run={run} busy={busy} /> : null}
      {panel === "fork" ? <ForkCard view={view} signer={signer} runMany={runMany} busy={busy} onOpenCircle={onOpenCircle} /> : null}
    </>
  );
}

function ActionButton({ label, busy, onClick, kind = "primary", block = true, disabled }: {
  label: ReactNode; busy: string | null; onClick: () => void; kind?: "primary" | "ghost"; block?: boolean; disabled?: boolean;
}) {
  return (
    <button className={`btn ${kind}${block ? " block" : ""}`} disabled={!!busy || disabled} onClick={onClick}>
      {busy ? <Spinner /> : null}{label}
    </button>
  );
}

function ExecutionCard({ view, circle, account, me, onChanged, onOpenCircle }: {
  view: CircleView; circle: Address; account: UiWalletAccount | undefined; me: Address | null;
  onChanged: () => Promise<void>; onOpenCircle: (circle: Address) => void;
}) {
  return <>
    <section className="card" id="execute">
      <div className="card-head">
        <div><span className="eyebrow">Public tokenized equities</span><h2>Trading is not enabled</h2><p className="card-intro">Live public-equity execution remains off until verified pricing, routing, and vault checks are deployed.</p></div>
        <Badge tone="neutral">Not enabled</Badge>
      </div>
      <p className="muted" style={{ marginTop: 0 }}>The test instrument below is a separate Devnet simulation. It is not a stock, has no market price, and does not represent shareholder rights or economic exposure.</p>
      <details className="execution-details"><summary>What must be verified for real public-equity execution?</summary><ul>
        <li>A supported tokenized-equity mint and its transfer rules</li>
        <li>Fresh price observations and limits from the Circle Mandate</li>
        <li>A constrained swap whose output is confirmed in the Circle's own vault</li>
      </ul></details>
    </section>
    <DevnetTestInstrument view={view} circle={circle} account={account} me={me} onChanged={onChanged} onOpenCircle={onOpenCircle} />
  </>;
}

function DevnetTestInstrument({ view, circle, account, me, onChanged, onOpenCircle }: {
  view: CircleView; circle: Address; account: UiWalletAccount | undefined; me: Address | null;
  onChanged: () => Promise<void>; onOpenCircle: (circle: Address) => void;
}) {
  const [market, setMarket] = useState<DevnetTestMarket | null>(null);
  const [inventoryRaw, setInventoryRaw] = useState<bigint | null>(null);
  const [status, setStatus] = useState<"checking" | "ready" | "missing" | "upgrade" | "error">("checking");
  const [programReady, setProgramReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const holding = view.holdings.find((h) => h.registry.assetClass === AssetClass.DevnetTestEquity);
  const refresh = useCallback(async () => {
    try {
      const currentBuild = await isDevnetTestMarketBuildDeployed();
      setProgramReady(currentBuild === true);
      if (currentBuild === null) {
        setMarket(null); setInventoryRaw(null); setStatus("error");
        setError("Devnet RPC could not verify the deployed program build. Wallet actions remain disabled.");
        return;
      }
      if (!currentBuild) {
        setMarket(null); setInventoryRaw(null); setStatus("upgrade"); setError(null); return;
      }
      const [address] = await findTestMarketPda();
      const result = await fetchMaybeDevnetTestMarket(rpc, address);
      if (!result.exists) { setMarket(null); setInventoryRaw(null); setStatus("missing"); setError(null); return; }
      setMarket(result.data);
      setInventoryRaw(await tokenBalance(result.data.inventoryVault));
      setStatus("ready"); setError(null);
    } catch (e) { setStatus("error"); setError((e as Error).message); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  return <section className="card" id="devnet-test-instrument">
    <div className="card-head">
      <div><span className="eyebrow">Devnet-only | no real-world value</span><h2>Test instrument</h2><p className="card-intro">Create a separate practice Circle and move fixed-inventory TST-EQ units through real on-chain vaults.</p></div>
      <Badge tone={status === "ready" ? "info" : "neutral"}>{status === "ready" ? "Market initialized" : status === "missing" ? "Setup needed" : status === "upgrade" ? "Program update needed" : status === "error" ? "Read unavailable" : "Checking"}</Badge>
    </div>
    <div className="overview-metrics">
      <article className="overview-metric"><span>Instrument</span><strong>TST-EQ</strong><p>Token-2022 test units; not a stock or stock exposure.</p></article>
      <article className="overview-metric"><span>Test conversion</span><strong>1 : 1</strong><p>One test unit per USDC unit at six decimals. Not a price or valuation.</p></article>
      <article className="overview-metric"><span>Live inventory</span><strong>{inventoryRaw === null ? "Unavailable" : trim(formatRaw(inventoryRaw, 6)) + " TST-EQ"}</strong><p>Read from the Devnet inventory vault.</p></article>
    </div>
    {market ? <p className="muted">Test mint: <AddressLink address={market.mint} />. Units have no market price, redemption promise, or real-world value.</p> : null}
    {status === "upgrade" ? <div className="test-market-upgrade-note"><strong>Waiting for the Devnet program update.</strong><p>The tested test-market instructions are not in the deployed program yet. The on-chain upgrade authority is the wallet <code>F5WouUdTmk6n4SaSTZLrE9PCUrArnWdGYwykqPH2jBiK</code>. This page verifies the exact program build before enabling wallet actions, so it will not send a transaction to the older code.</p></div> : null}
    {error ? <p className="inline-error">Could not read the test-market account: {error}</p> : null}
    {holding ? <DevnetTestMarketWalletActions view={view} circle={circle} me={me} account={account} market={market} inventoryRaw={inventoryRaw} programReady={programReady} onChanged={onChanged} onRefresh={refresh} /> :
      <div>
        <p className="muted">This creates a separate Circle and does not change your current rules or holdings. Fund its Epoch 0 with this project's Devnet test-USDC before allocating units.</p>
        {TRANSACTIONS_ENABLED && account && me && programReady
          ? <DevnetTestCircleCreator account={account} onOpenCircle={onOpenCircle} onRefresh={refresh} />
          : status !== "upgrade" ? <p className="muted">Connect a Devnet wallet with SOL for network fees to set up the test market and Circle.</p> : null}
      </div>}
  </section>;
}

function DevnetTestCircleCreator({ account, onOpenCircle, onRefresh }: {
  account: UiWalletAccount; onOpenCircle: (circle: Address) => void; onRefresh: () => Promise<void>;
}) {
  const signer = useWalletAccountTransactionSendingSigner(account, CHAIN);
  const { busy, runMany } = useRunner(signer, async () => {});
  const create = async () => {
    let nextCircle: Address | null = null;
    const ok = await runMany("Create Devnet test Circle", async () => {
      const [testMint] = await findTestMintPda();
      const [marketAddress] = await findTestMarketPda();
      const currentMarket = await fetchMaybeDevnetTestMarket(rpc, marketAddress);
      const steps: RunStep[] = [];
      if (!currentMarket.exists) steps.push({
        label: "Initialize fixed test inventory",
        instructions: [await getInitializeDevnetTestMarketInstructionAsync({ payer: signer, usdcMint: USDC_MINT })],
      });
      const mandateSeed = (await generateKeyPairSigner()).address;
      const [mandate] = await findMandatePda({ mandateSeed });
      const [circleAddress] = await findCirclePda({ mandate });
      nextCircle = circleAddress;
      if ((await fetchMaybeCircle(rpc, circleAddress)).exists) throw new Error("Generated Circle already exists; retry setup.");
      steps.push({
        label: "Create separate test Circle and Epoch 0",
        instructions: [await getCreateDevnetTestCircleInstructionAsync({ creator: signer, testMint, mandateSeed })],
      });
      return { steps, verify: async () => {
        const [freshMarketAddress] = await findTestMarketPda();
        const [freshMarket, freshCircle] = await Promise.all([
          fetchMaybeDevnetTestMarket(rpc, freshMarketAddress), fetchMaybeCircle(rpc, circleAddress),
        ]);
        if (!freshMarket.exists || !freshCircle.exists || freshCircle.data.mandate !== mandate) {
          throw new Error("Test market or new Circle could not be verified on Devnet.");
        }
      }};
    });
    if (ok && nextCircle) { await onRefresh(); onOpenCircle(nextCircle); }
  };
  return <div>
    <ActionButton busy={busy} label="Create separate Devnet test Circle" onClick={() => { void create(); }} />
    <p className="muted">You still need test-USDC from its issuer to fund Epoch 0. This app does not invent balances or pretend a faucet exists.</p>
  </div>;
}

function DevnetTestMarketWalletActions({ view, circle, me, account, market, inventoryRaw, programReady, onChanged, onRefresh }: {
  view: CircleView; circle: Address; me: Address | null; account: UiWalletAccount | undefined;
  market: DevnetTestMarket | null; inventoryRaw: bigint | null; programReady: boolean; onChanged: () => Promise<void>; onRefresh: () => Promise<void>;
}) {
  if (!programReady) return <p className="muted">Test-unit allocation stays disabled until the exact Devnet program update is confirmed.</p>;
  if (!account || !me || !TRANSACTIONS_ENABLED) return <p className="muted">Connect the wallet holding this Circle's settled Member shares to allocate test units.</p>;
  return <DevnetTestMarketConnected view={view} circle={circle} me={me} account={account} market={market} inventoryRaw={inventoryRaw} onChanged={onChanged} onRefresh={onRefresh} />;
}

function DevnetTestMarketConnected({ view, circle, me, account, market, inventoryRaw, onChanged, onRefresh }: {
  view: CircleView; circle: Address; me: Address; account: UiWalletAccount; market: DevnetTestMarket | null;
  inventoryRaw: bigint | null; onChanged: () => Promise<void>; onRefresh: () => Promise<void>;
}) {
  const signer = useWalletAccountTransactionSendingSigner(account, CHAIN);
  const { busy, run } = useRunner(signer, async () => { await onChanged(); await onRefresh(); });
  const [amount, setAmount] = useState("1");
  const holding = view.holdings.find((h) => h.registry.assetClass === AssetClass.DevnetTestEquity);
  const activeCash = view.activeUsdcRaw > view.circle.usdcReservedRaw ? view.activeUsdcRaw - view.circle.usdcReservedRaw : 0n;
  const shares = view.member?.shares ?? 0n;
  let raw = 0n; let parseError: string | null = null;
  try { raw = parseAmount(amount || "0", USDC_DECIMALS); } catch (e) { parseError = (e as Error).message; }
  const canAllocate = Boolean(market && holding && view.usdcMint === USDC_MINT && shares > 0n && raw > 0n && raw <= activeCash && inventoryRaw !== null && raw <= inventoryRaw);
  const allocate = () => run("Allocate Devnet test units", async () => {
    if (!market || !holding || !canAllocate) throw new Error("Need a settled Member position, active test-USDC, and available test inventory.");
    const [config] = await findConfigPda();
    const [testMarket] = await findTestMarketPda();
    const [mandateAsset] = await findMandateAssetPda({ mandate: view.circle.mandate, testMint: market.mint });
    const [registryEntry] = await findRegistryEntryPda({ testMint: market.mint });
    const [activeUsdcVault] = await findActiveUsdcVaultPda({ circle });
    const [member] = await findMemberPda({ circle, buyer: me });
    const [testEquityVault] = await findTestEquityVaultPda({ circle, testMint: market.mint });
    const [vaultAuthority] = await findVaultAuthorityPda({ circle });
    return [await buyDevnetTestEquity({
      buyer: signer, circle, mandate: view.circle.mandate, member, config, testMarket, mandateAsset, registryEntry,
      usdcMint: view.usdcMint, testMint: market.mint, activeUsdcVault, circleAsset: holding.address,
      testEquityVault, inventoryVault: market.inventoryVault, usdcReserveVault: market.usdcReserveVault,
      vaultAuthority, amountUsdcRaw: raw,
    })];
  });
  return <div className="test-market-allocation">
    <div className="overview-metric"><span>Active test-USDC cash</span><strong>{trim(usdc(activeCash))} USDC</strong><p>Pending Epoch escrow is excluded. Only settled Circle cash can be allocated.</p></div>
    <label className="field"><span>Test-USDC amount</span><input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} aria-invalid={!!parseError} /><small>One TST-EQ unit is delivered for each USDC unit at six decimals.</small></label>
    {parseError ? <p className="inline-error">{parseError}</p> : null}
    {!market ? <p className="muted">Test market is not initialized yet.</p> : null}
    {shares === 0n ? <p className="muted">Settle a contribution first; pending contributions cannot claim active assets.</p> : null}
    {activeCash === 0n ? <p className="muted">This Circle has no active test-USDC. Add test-USDC through Epoch 0, then settle it.</p> : null}
    {market && inventoryRaw === 0n ? <p className="muted">The fixed test inventory is exhausted.</p> : null}
    <ActionButton busy={busy} disabled={!canAllocate} label="Allocate test units to this Circle" onClick={() => { void allocate(); }} />
    <p className="muted">TST-EQ is valueless test inventory, not a stock. Exit returns the Circle's proportional test-token balance, not guaranteed USDC.</p>
  </div>;
}

// ================================================================ epoch

const STEP_OF: Record<number, number> = {
  [EpochState.Open]: 0, [EpochState.Closed]: 1, [EpochState.Finalized]: 2,
  [EpochState.Executing]: 2, [EpochState.Completed]: 3, [EpochState.Cancelled]: 1,
};

function useNow() {
  const [now, setNow] = useState(() => BigInt(Math.floor(Date.now() / 1000)));
  useEffect(() => {
    const t = setInterval(() => setNow(BigInt(Math.floor(Date.now() / 1000))), 1000);
    return () => clearInterval(t);
  }, []);
  return now;
}

function EpochCard({ view, circle, me, signer, usdcBalance, run, busy }: {
  view: CircleView; circle: Address; me: Address; signer: TransactionSendingSigner;
  usdcBalance: bigint | null; run: Run; busy: string | null;
}) {
  const now = useNow();
  const [amount, setAmount] = useState("5");
  const { circle: c, epoch, receipt, mandate, usdcMint } = view;
  const index = c.currentEpoch;

  const pdas = async () => {
    const [epochAddr] = await findEpochPda({ circle, index });
    const [epochEscrow] = await findEpochEscrowPda({ circle, index });
    const [activeUsdcVault] = await findActiveUsdcVaultPda({ circle });
    const [vaultAuthority] = await findVaultAuthorityPda({ circle });
    const [navSnapshot] = await findNavSnapshotPda({ epoch: epochAddr });
    return { epochAddr, epochEscrow, activeUsdcVault, vaultAuthority, navSnapshot };
  };

  let parsed: bigint | null = null;
  let parseError: string | null = null;
  try { parsed = parseAmount(amount || "0", USDC_DECIMALS); } catch (e) { parseError = (e as Error).message; }

  const header = (
    <div className="card-head">
      <div><span className="eyebrow">Add money</span><h2>Contribute to this Circle</h2><p className="card-intro">USDC enters a separate funding window. The Mandate—not this form—sets how money can be invested.</p></div>
      <Badge tone="info">Contribution window {index.toString()}</Badge>
    </div>
  );

  if (!epoch) {
    return (
      <section className="card">
        {header}
        {c.totalShares === 0n ? (
          <>
            <p className="muted" style={{ margin: 0 }}>
              No contribution window is open. Starting it lets members add USDC to separate custody. When the window ends, everyone’s ownership shares are calculated together. It lasts {formatDuration(mandate.epochDuration)}.
            </p>
            <ActionButton busy={busy} label={`Start funding window ${index}`} onClick={() => run(`Start funding window ${index}`, async () => {
              const p = await pdas();
              return [await openEpoch({
                payer: signer, circle, mandate: c.mandate, epoch: p.epochAddr, epochEscrow: p.epochEscrow,
                activeUsdcVault: p.activeUsdcVault, usdcMint, vaultAuthority: p.vaultAuthority,
                tokenProgram: TOKEN_PROGRAM, index,
              })];
            })} />
          </>
        ) : (
          <p className="muted" style={{ margin: 0 }}>
            This Circle already has members. New contributions stay separate until the window closes; everyone in it receives ownership shares at the same rate. If the required prices cannot be verified, shares cannot be issued and contributions remain refundable.
          </p>
        )}
      </section>
    );
  }

  const e = epoch.data;
  const open = e.state === EpochState.Open;
  const remaining = e.closesAt - now;
  const span = e.closesAt - e.openedAt;
  const elapsedBps = span > 0n ? ratioBps(span - (remaining > 0n ? remaining : 0n), span) : 10_000n;
  const minOk = parsed !== null && parsed >= mandate.minContributionUsdc;
  const balOk = parsed !== null && usdcBalance !== null && parsed <= usdcBalance;

  return (
    <section className="card">
      {header}
      <Stepper steps={["Taking contributions", "Window closed", "Shares ready", "Complete"]} current={STEP_OF[e.state] ?? 0} />

      {open ? (
        <div className="countdown">
          <div className="countdown-top">
            <span>{remaining > 0n ? "Window closes in" : "Window closed"}</span>
            <strong className="num">{remaining > 0n ? `${remaining}s` : "—"}</strong>
          </div>
          <Meter bps={elapsedBps} />
        </div>
      ) : null}

      <div className="preview" style={{ marginTop: 0, marginBottom: 14 }}>
        <div className="preview-row"><span className="k">Not yet part of the portfolio</span><span className="v">{trim(usdc(e.pendingUsdcRaw))} USDC</span></div>
        <div className="preview-row"><span className="k">People contributing</span><span className="v">{e.receiptCount}</span></div>
        {receipt ? (
          <div className="preview-row"><span className="k">Your contribution</span><span className="v">{trim(usdc(receipt.amountUsdcRaw))} USDC</span></div>
        ) : null}
      </div>

      {open && remaining > 0n ? (
        <>
          <div className="field">
            <div className="field-label">
              <span>Amount</span>
              <span>Your USDC balance: {usdcBalance === null ? "—" : trim(usdc(usdcBalance))}</span>
            </div>
            <div className="input-wrap">
              <input inputMode="decimal" value={amount} onChange={(ev) => setAmount(ev.target.value)} aria-label="amount in USDC" />
              <span className="suffix">USDC</span>
            </div>
            <div className="chips">
              {[["Min", trim(usdc(mandate.minContributionUsdc))], ["5", "5"], ["10", "10"], ["25", "25"]].map(([l, v]) => (
                <button key={l} className="chip" onClick={() => setAmount(v)}>{l}</button>
              ))}
              {usdcBalance !== null && usdcBalance > 0n ? <button className="chip" onClick={() => setAmount(trim(usdc(usdcBalance)))}>Max</button> : null}
            </div>
          </div>
          <div className="preview">
            <div className="preview-row">
              <span className="k">You'll receive</span>
              <span className="v">{parsed !== null && e.totalSharesBefore === 0n ? `${trim(formatShares(sharesForContribution(parsed, 0n, 0n)))} shares` : "—"}</span>
            </div>
            <div className="preview-row"><span className="k">How shares are set</span><span className="v">The first funding window sets the starting ownership basis</span></div>
            <div className="preview-row"><span className="k">Before ownership is set</span><span className="v">kept separate · you can cancel and get it back</span></div>
            {parseError ? <div className="error-text">{parseError}</div> : null}
            {parsed !== null && !minOk ? <div className="error-text">Below the minimum contribution of {trim(usdc(mandate.minContributionUsdc))} USDC.</div> : null}
            {parsed !== null && usdcBalance !== null && !balOk ? <div className="error-text">More than your balance.</div> : null}
          </div>
          <ActionButton busy={busy} disabled={!minOk || !balOk} label="Add USDC to funding window" onClick={() => run(`Contribute ${amount} USDC`, async () => {
            const raw = parseAmount(amount, USDC_DECIMALS);
            const p = await pdas();
            const [receiptAddr] = await findReceiptPda({ epoch: p.epochAddr, contributor: me });
            return [await contribute({
              contributor: signer, circle, mandate: c.mandate, epoch: p.epochAddr, receipt: receiptAddr,
              contributorUsdc: await ataAddress(me, usdcMint, TOKEN_PROGRAM), epochEscrow: p.epochEscrow,
              activeUsdcVault: p.activeUsdcVault, usdcMint, tokenProgram: TOKEN_PROGRAM, amount: raw,
            })];
          })} />
          {receipt && !receipt.settled ? (
            <ActionButton kind="ghost" busy={busy} label="Cancel & refund my contribution" onClick={() => run("Cancel contribution", async () => {
              const p = await pdas();
              const [receiptAddr] = await findReceiptPda({ epoch: p.epochAddr, contributor: me });
              return [getCancelContributionInstruction({
                contributor: signer, circle, epoch: p.epochAddr, receipt: receiptAddr, epochEscrow: p.epochEscrow,
                contributorUsdc: await ataAddress(me, usdcMint, TOKEN_PROGRAM), usdcMint,
                vaultAuthority: p.vaultAuthority, tokenProgram: TOKEN_PROGRAM,
              })];
            })} />
          ) : null}
        </>
      ) : null}

      {open && remaining <= 0n ? (
          <ActionButton busy={busy} label="End contribution window" onClick={() => run("End contribution window", async () => {
          const p = await pdas();
          return [getCloseContributionsInstruction({ payer: signer, epoch: p.epochAddr })];
        })} />
      ) : null}

      {e.state === EpochState.Closed ? (
        c.pendingReservations > 0 ? (
          <p className="muted">An earlier exit is being prepared. This pauses contribution settlement so that exit cannot include newer members’ money. Anyone can finish preparing it in the Leave this Circle section.</p>
        ) : c.totalShares > 0n && !view.navSnapshot ? (
          <>
            <p className="muted">This Circle already has members, so new contributions need a current value for its existing holdings. Check the portfolio value before setting everyone’s share amount.</p>
            <ActionButton busy={busy} label="Check current portfolio value" onClick={() => run("Check current portfolio value", async () => {
              const p = await pdas();
              return [await getOpenNavSnapshotInstructionAsync({
                payer: signer, circle, epoch: p.epochAddr, navSnapshot: p.navSnapshot,
                activeUsdcVault: p.activeUsdcVault, vaultAuthority: p.vaultAuthority,
              })];
            })} />
          </>
        ) : c.totalShares > 0n && view.navSnapshot && view.navSnapshot.data.assetsRemaining > 0 ? (
          <>
            <div className="preview">
              <div className="preview-row"><span className="k">Assets still needing a verified price</span><span className="v">{view.navSnapshot.data.assetsRemaining}</span></div>
              <div className="preview-row"><span className="k">Price sources</span><span className="v">Current and verified</span></div>
            </div>
            <p className="muted">New member shares cannot be calculated until every holding has a current, verified price. If prices are missing or out of date, contributions remain refundable.</p>
          </>
        ) : (
          <ActionButton busy={busy} label="Set shares for this funding window" onClick={() => run("Set shares for funding window", async () => {
            const p = await pdas();
            return [await getFinalizeEpochInstructionAsync({
              payer: signer, circle, epoch: p.epochAddr, epochEscrow: p.epochEscrow,
              navSnapshot: c.totalShares > 0n ? view.navSnapshot?.address : undefined,
              activeUsdcVault: p.activeUsdcVault, usdcMint, vaultAuthority: p.vaultAuthority, tokenProgram: TOKEN_PROGRAM,
            })];
          })} />
        )
      ) : null}

      {e.state === EpochState.Finalized ? (
        <>
          {receipt && !receipt.settled ? (
            <ActionButton busy={busy} label={`Claim ${trim(formatShares(sharesForContribution(receipt.amountUsdcRaw, e.totalSharesBefore, e.navBefore)))} Circle shares`}
              onClick={() => run("Claim Circle shares", async () => {
                const p = await pdas();
                const [receiptAddr] = await findReceiptPda({ epoch: p.epochAddr, contributor: me });
                const [member] = await findMemberPda({ circle, buyer: me });
                return [getSettleContributionInstruction({ payer: signer, circle, epoch: p.epochAddr, receipt: receiptAddr, owner: me, member })];
              })} />
          ) : null}
          {e.settledCount === e.receiptCount ? (
            <ActionButton kind="ghost" busy={busy} label="Finish funding window" onClick={() => run("Finish funding window", async () => {
              const p = await pdas();
              return [getCloseEpochInstruction({ payer: signer, circle, epoch: p.epochAddr })];
            })} />
          ) : (
            <p className="muted">{e.receiptCount - e.settledCount} contributor(s) still need to claim their Circle shares.</p>
          )}
        </>
      ) : null}

      <AutomationPreview />
    </section>
  );
}

function ForkCard({ view, signer, runMany, busy, onOpenCircle }: {
  view: CircleView; signer: TransactionSendingSigner; runMany: RunMany; busy: string | null;
  onOpenCircle: (circle: Address) => void;
}) {
  const parent = view.circle.mandate;
  const seedStorageKey = `tenet:fork-seed:${parent}:${signer.address}`;
  const [childSeed, setChildSeed] = useState<Address | null>(() => {
    try {
      const saved = sessionStorage.getItem(seedStorageKey);
      return saved ? b58ToAddress(saved) : null;
    } catch { return null; }
  });
  const [childMandateAddress, setChildMandateAddress] = useState<Address | null>(null);
  const [childCircleAddress, setChildCircleAddress] = useState<Address | null>(null);
  const [setupComplete, setSetupComplete] = useState(false);

  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(seedStorageKey);
      setChildSeed(saved ? b58ToAddress(saved) : null);
    } catch { setChildSeed(null); }
    setChildMandateAddress(null);
    setChildCircleAddress(null);
    setSetupComplete(false);
  }, [seedStorageKey]);

  useEffect(() => {
    if (!childSeed) return;
    let current = true;
    void (async () => {
      const [mandate] = await findNewMandatePda({ newMandateSeed: childSeed });
      const [circleAddress] = await findCirclePda({ mandate });
      if (current) {
        setChildMandateAddress(mandate);
        setChildCircleAddress(circleAddress);
      }
    })().catch(() => { if (current) setSetupComplete(false); });
    return () => { current = false; };
  }, [childSeed]);

  return (
    <section className="card" id="fork">
      <div className="card-head">
        <div><span className="eyebrow">Fork · copy rules</span><h2>Start a new Circle with these rules</h2><p className="card-intro">The new Circle is independent. Its money and members start separately.</p></div>
        <Badge tone="pre">Money stays here</Badge>
      </div>
      <p className="muted" style={{ marginTop: 0 }}>
        Fork means copying the investment rules and recording where they came from. It does not copy this Circle’s money, holdings, members, or trades.
      </p>
      <div className="preview">
        <div className="preview-row"><span className="k">Rules copied from</span><span className="v">{CLUSTER === "devnet" ? "Devnet test Circle" : view.mandate.name}</span></div>
        <div className="preview-row"><span className="k">What is copied</span><span className="v">{view.assets.length} asset rule{view.assets.length === 1 ? "" : "s"} and all investment limits</span></div>
        <div className="preview-row"><span className="k">What is not copied</span><span className="v">money, holdings, members or trades</span></div>
      </div>
      <details className="execution-details"><summary>Show on-chain rule address</summary><AddressLink address={parent} /></details>
      <ActionButton busy={busy} disabled={setupComplete} label={setupComplete ? "Circle ready" : childSeed ? "Continue fork setup" : "Create Circle with these rules"} onClick={async () => {
        setSetupComplete(false);
        const ok = await runMany("Create Circle from copied rules", async () => {
        const seedAddress = childSeed ?? (await generateKeyPairSigner()).address;
        setChildSeed(seedAddress);
        try { sessionStorage.setItem(seedStorageKey, String(seedAddress)); } catch { /* tab may block storage; in-memory resume still works */ }
        const [child] = await findNewMandatePda({ newMandateSeed: seedAddress });
        const [childCircle] = await findCirclePda({ mandate: child });
        setChildMandateAddress(child);
        setChildCircleAddress(childCircle);

        if (view.assets.length === 0) throw new Error("The source Circle has no verified asset rules to copy.");
        const steps: RunStep[] = [];
        const existingChild = await fetchMaybeMandate(rpc, child);
        const childNeedsActivation = !existingChild.exists || existingChild.data.state === MandateState.Draft;
        if (!existingChild.exists) {
          steps.push({ label: "Create the child Mandate", instructions: [getForkMandateInstruction({
            forker: signer, parentMandate: parent, newMandateSeed: seedAddress, newMandate: child,
          })] });
        } else if (
          existingChild.data.author !== signer.address
          || existingChild.data.forkedFrom.__option !== "Some"
          || existingChild.data.forkedFrom.value !== parent
        ) {
          throw new Error("That fork address belongs to a different source or wallet.");
        } else if (existingChild.data.state !== MandateState.Draft && existingChild.data.state !== MandateState.Active) {
          throw new Error("The child Mandate is in an unsupported state. No further transactions were sent.");
        }

        const copied: { newAsset: Address; registryEntry: Address; mint: Address; tokenProgram: Address; targetWeightBps: number; index: number }[] = [];
        for (const { asset } of view.assets) {
          const parentRule = await fetchMaybeMandateAsset(rpc, asset.mandateAsset);
          if (!parentRule.exists || parentRule.data.mandate !== parent || parentRule.data.mint !== asset.mint || !parentRule.data.enabled) {
            throw new Error("The source Circle’s asset rules could not be verified. No new Circle was created.");
          }
          const [newAsset] = await findNewAssetPda({ newMandate: child, mint: asset.mint });
          const [registryEntry] = await findRegistryEntryPda({ testMint: asset.mint });
          copied.push({ newAsset, registryEntry, mint: asset.mint, tokenProgram: asset.tokenProgram, targetWeightBps: parentRule.data.targetWeightBps, index: parentRule.data.index });
          const existingAsset = await fetchMaybeMandateAsset(rpc, newAsset);
          if (!existingAsset.exists) {
            if (existingChild.exists && existingChild.data.state === MandateState.Active) {
              throw new Error("The child Mandate is already active but a copied asset rule is missing. For safety, this fork cannot be repaired automatically.");
            }
            steps.push({ label: "Copy an asset rule", instructions: [getForkMandateAssetInstruction({
              forker: signer, parentMandate: parent, mint: asset.mint, parentAsset: asset.mandateAsset,
              newMandate: child, newAsset, registryEntry,
            })] });
          } else {
            const rule = existingAsset.data;
            if (rule.mandate !== child || rule.mint !== asset.mint || !rule.enabled
              || rule.targetWeightBps !== parentRule.data.targetWeightBps || rule.index !== parentRule.data.index) {
              throw new Error("A copied asset rule does not match its parent. The fork was stopped before creating a Circle.");
            }
          }
        }

        if (childNeedsActivation) {
          const finalize = getFinalizeMandateInstruction({ author: signer, mandate: child });
          const remaining = copied.flatMap(({ newAsset, registryEntry }) => [
            { address: newAsset, role: AccountRole.READONLY },
            { address: registryEntry, role: AccountRole.READONLY },
          ]);
          steps.push({ label: "Activate the copied Mandate", instructions: [{ ...finalize, accounts: [...finalize.accounts, ...remaining] } as Instruction] });
        }
        const existingCircle = await fetchMaybeCircle(rpc, childCircle);
        if (!existingCircle.exists) {
          steps.push({ label: "Create the independent Circle", instructions: [await getCreateCircleInstructionAsync({
            creator: signer, mandate: child, usdcMint: view.usdcMint, tokenProgram: TOKEN_PROGRAM,
          })] });
        } else if (existingCircle.data.mandate !== child) {
          throw new Error("The derived Circle address is bound to a different Mandate. No asset vaults were created.");
        }

        for (const { newAsset, mint, tokenProgram } of copied) {
          const [circleAssetAddress] = await findCircleAssetPda({ circle: childCircle, mint });
          const existingCircleAsset = await fetchMaybeCircleAsset(rpc, circleAssetAddress);
          if (existingCircleAsset.exists) {
            const createdAsset = existingCircleAsset.data;
            if (createdAsset.circle !== childCircle || createdAsset.mandateAsset !== newAsset
              || createdAsset.mint !== mint || createdAsset.tokenProgram !== tokenProgram || createdAsset.status !== AssetStatus.Active) {
              throw new Error("A child Circle vault does not match the copied Mandate rule. The fork was stopped.");
            }
          } else {
            steps.push({ label: "Create an asset vault", instructions: [await getAddCircleAssetInstructionAsync({
              payer: signer, circle: childCircle, mandateAsset: newAsset, mint, tokenProgram,
            })] });
          }
        }

        return {
          steps,
          verify: async () => {
            const [mandateCheck, circleCheck] = await Promise.all([
              fetchMaybeMandate(rpc, child), fetchMaybeCircle(rpc, childCircle),
            ]);
            if (!mandateCheck.exists || mandateCheck.data.state !== MandateState.Active
              || mandateCheck.data.forkedFrom.__option !== "Some" || mandateCheck.data.forkedFrom.value !== parent) {
              throw new Error("The copied Mandate is not active or its lineage does not match the source.");
            }
            if (!circleCheck.exists || circleCheck.data.mandate !== child) throw new Error("The independent Circle account was not found after confirmation.");
            const [childUsdcVault] = await findActiveUsdcVaultPda({ circle: childCircle });
            await rpc.getTokenAccountBalance(childUsdcVault, { commitment: "confirmed" }).send();
            for (const { newAsset, mint, tokenProgram, targetWeightBps, index } of copied) {
              const [mandateAssetAddress] = await findNewAssetPda({ newMandate: child, mint });
              const mandateAsset = await fetchMaybeMandateAsset(rpc, mandateAssetAddress);
              const [circleAssetAddress] = await findCircleAssetPda({ circle: childCircle, mint });
              const [expectedVault] = await findVaultPda({ circle: childCircle, mint });
              const circleAsset = await fetchMaybeCircleAsset(rpc, circleAssetAddress);
              if (!mandateAsset.exists || mandateAsset.data.mandate !== child || mandateAsset.data.mint !== mint
                || mandateAsset.data.targetWeightBps !== targetWeightBps || mandateAsset.data.index !== index || !mandateAsset.data.enabled
                || !circleAsset.exists || circleAsset.data.circle !== childCircle || circleAsset.data.mandateAsset !== newAsset
                || circleAsset.data.mint !== mint || circleAsset.data.vault !== expectedVault
                || circleAsset.data.tokenProgram !== tokenProgram || circleAsset.data.status !== AssetStatus.Active) {
                throw new Error("One or more copied rules or Mandate-bound asset vaults could not be verified.");
              }
              await rpc.getTokenAccountBalance(expectedVault, { commitment: "confirmed" }).send();
            }
          },
        };
        });
        if (ok) setSetupComplete(true);
      }} />
      {childMandateAddress && childCircleAddress ? (
        <div className="fork-result">
          <span className="status-dot" />
          <div>{setupComplete
            ? <>Fork complete · independent Circle verified <AddressLink address={childCircleAddress} /></>
            : <>Fork setup can be resumed · these are derived addresses, not proof the on-chain accounts exist.</>}
            <details className="execution-details">
              <summary>Show fork addresses</summary>
              <div className="preview-row"><span className="k">Child Mandate</span><AddressLink address={childMandateAddress} /></div>
              <div className="preview-row"><span className="k">Child Circle</span><AddressLink address={childCircleAddress} /></div>
            </details>
            {setupComplete ? <button className="btn small primary" type="button" onClick={() => onOpenCircle(childCircleAddress)}>Open new Circle</button> : null}
          </div>
        </div>
      ) : null}
      <p className="automation-foot">Each confirmed step is retained on-chain and can be resumed. Review the wallet’s transaction details; cancel any prompt that reports a failed simulation—never choose “Confirm unsafe.”</p>
    </section>
  );
}

function AutomationPreview() {
  return (
    <div className="automation">
      <div className="automation-head">
        <div>
          <span className="eyebrow">Optional</span>
          <h3>Automate contributions</h3>
        </div>
        <Badge tone="neutral">Coming after authorization review</Badge>
      </div>
      <p className="muted automation-copy">
        Your contribution rule decides how money enters. The Mandate decides how it is invested.
        Tenet will only enable this when a real, revocable USDC authorization path is available.
      </p>
      <div className="automation-options">
        <div className="automation-option"><strong>Recurring</strong><span>Choose an amount and schedule</span></div>
        <div className="automation-option"><strong>Percentage</strong><span>Choose a share of incoming USDC</span></div>
        <div className="automation-option"><strong>Round-up</strong><span>Round supported payments</span></div>
      </div>
      <div className="automation-foot">Not available yet. Manual contributions are available; this preview does not request permission to spend from your wallet.</div>
    </div>
  );
}

// ================================================================ exit

function ExitCard({ view, circle, me, signer, run, busy }: {
  view: CircleView; circle: Address; me: Address; signer: TransactionSendingSigner; run: Run; busy: string | null;
}) {
  const { member, circle: c } = view;
  const [pct, setPct] = useState(50);
  const held = member?.shares ?? 0n;
  const shares = (held * BigInt(pct)) / 100n;

  return (
    <section className="card">
      <div className="card-head">
        <div><span className="eyebrow">Your position</span><h2>Leave this Circle</h2><p className="card-intro">Start an exit without a member vote or price feed. Outside token issuer or program transfer limits may still apply.</p></div>
        <Badge tone="good">No vote or price needed</Badge>
      </div>

      {held > 0n ? (
        c.pendingReservations > 0 ? (
          <p className="muted" style={{ margin: 0 }}>
            Another member’s exit is being prepared. This prevents two people from claiming the same assets; anyone can finish preparing it in the exit below.
          </p>
        ) : (
          <>
            <div className="field">
              <div className="field-label"><span>How much of your position to leave</span><span className="num">{pct}% · {trim(formatShares(shares))} of {trim(formatShares(held))} shares</span></div>
              <input type="range" min={1} max={100} value={pct} onChange={(e) => setPct(Number(e.target.value))} aria-label="percent of your shares" />
              <div className="chips">
                {[25, 50, 75, 100].map((p) => <button key={p} className="chip" onClick={() => setPct(p)}>{p}%</button>)}
              </div>
            </div>
            <ExitPreview view={view} shares={shares} />
            <ActionButton busy={busy} disabled={shares === 0n} label="Confirm share and start exit" onClick={() => run("Start Circle exit", async () => {
              const [memberAddr] = await findMemberPda({ circle, buyer: me });
              const redemption = await redemptionPda(circle, me, member!.nextRedemptionSeq);
              return [await initiateRedemption({ memberOwner: signer, circle, member: memberAddr, redemption, shares })];
            })} />
          </>
        )
      ) : (
        <p className="muted" style={{ margin: 0 }}>This wallet does not hold any Circle shares yet.</p>
      )}

      {view.exits.map((x) => <ExitItem key={x.seq.toString()} exit={x} view={view} circle={circle} me={me} signer={signer} run={run} busy={busy} />)}
    </section>
  );
}

/** What an exit of `shares` would pay, per asset, net of issuer fees — BEFORE starting it. */
function ExitPreview({ view, shares }: { view: CircleView; shares: bigint }) {
  const { circle: c } = view;
  const usdcOut = slice(view.activeUsdcRaw - c.usdcReservedRaw, shares, c.totalShares);
  const rows = useMemo(() => view.holdings.map((h) => ({
    h, amount: slice(h.vaultRaw - h.asset.reservedForRedemptionRaw, shares, c.totalShares),
  })), [view.holdings, shares, c.totalShares]);

  return (
    <div className="preview">
      <div className="preview-row"><span className="k">USDC</span><span className="v">{trim(usdc(usdcOut))}</span></div>
      {rows.map(({ h, amount }) => <PreviewAsset key={h.address} h={h} amount={amount} />)}
      <div className="preview-row"><span className="k">Rounding</span><span className="v">Any tiny remainder stays with the Circle</span></div>
      <p className="exit-explainer">These are token amounts from the Circle’s current vault balances, not dollar values. Any external transfer fee is shown separately.</p>
    </div>
  );
}

function PreviewAsset({ h, amount }: { h: Holding; amount: bigint }) {
  const fee = useFee(h.asset.mint, amount);
  const d = h.registry.decimals;
  return (
    <>
      <div className="preview-row"><span className="k">{h.registry.symbol}</span><span className="v">{trim(formatRaw(fee ? amount - fee.fee : amount, d))}</span></div>
      {fee && fee.fee > 0n ? <div className="fee-note">after the issuer's {formatBps(fee.bps)} transfer fee ({trim(formatRaw(fee.fee, d))}) — paid by you</div> : null}
    </>
  );
}

function useFee(mint: Address, amount: bigint) {
  const [fee, setFee] = useState<{ fee: bigint; bps: bigint } | null>(null);
  useEffect(() => {
    let live = true;
    if (amount === 0n) { setFee(null); return; }
    void withheldFee(mint, amount).then((f) => { if (live) setFee(f); }).catch(() => { if (live) setFee(null); });
    return () => { live = false; };
  }, [mint, amount]);
  return fee;
}

function ExitItem({ exit, view, circle, me, signer, run, busy }: {
  exit: ExitView; view: CircleView; circle: Address; me: Address; signer: TransactionSendingSigner; run: Run; busy: string | null;
}) {
  const r = exit.redemption;
  const reserved = new Set(exit.claims.map((cl) => cl.mint));
  const done = r.assetsRemaining === 0 && exit.claims.length === 0;
  return (
    <div className="exit">
      <div className="exit-head">
        <strong>Your exit · {trim(formatShares(r.sharesRedeemed))} shares</strong>
        {r.assetsRemaining > 0 ? <Badge tone="warn">preparing</Badge> : done ? <Badge tone="good">complete</Badge> : <Badge tone="info">ready to send</Badge>}
      </div>
      {r.assetsRemaining > 0 ? (
        <ActionButton block={false} kind="ghost" busy={busy} label={`Prepare remaining assets (${r.assetsRemaining})`} onClick={() => run("Prepare remaining exit assets", async () => {
          const ixs: Instruction[] = [];
          for (const { asset } of view.assets) {
            if (!((r.assetBitmapAtSnapshot >> asset.index) & 1) || reserved.has(asset.mint)) continue;
            const [circleAsset] = await findCircleAssetPda({ circle, mint: asset.mint });
            ixs.push(getReserveRedemptionAssetInstruction({
              payer: signer, circle, redemption: exit.address, circleAsset, vault: asset.vault,
              redemptionAsset: await redemptionAssetPda(exit.address, asset.mint),
            }));
          }
          if (!reserved.has(view.usdcMint)) {
            const [activeUsdcVault] = await findActiveUsdcVaultPda({ circle });
            ixs.push(await getReserveRedemptionUsdcInstructionAsync({
              payer: signer, circle, redemption: exit.address, activeUsdcVault,
              redemptionAsset: await redemptionAssetPda(exit.address, view.usdcMint),
            }));
          }
          return ixs;
        })} />
      ) : null}
      {exit.claims.map((cl) => <Claim key={cl.mint} claim={cl} exit={exit} view={view} circle={circle} me={me} signer={signer} run={run} busy={busy} />)}
    </div>
  );
}

function Claim({ claim, exit, view, circle, me, signer, run, busy }: {
  claim: ExitView["claims"][number]; exit: ExitView; view: CircleView; circle: Address; me: Address;
  signer: TransactionSendingSigner; run: Run; busy: string | null;
}) {
  const isUsdc = claim.mint === view.usdcMint;
  const h = view.holdings.find((x) => x.asset.mint === claim.mint);
  const d = isUsdc ? USDC_DECIMALS : h?.registry.decimals ?? 0;
  const amount = claim.asset.amountRaw;
  const fee = useFee(claim.mint, amount);
  const name = isUsdc ? "USDC" : h?.registry.symbol ?? "asset";
  return (
    <div className="claim">
      <div>
        <div className="claim-amt">{trim(formatRaw(fee ? amount - fee.fee : amount, d))} {name}</div>
        {fee && fee.fee > 0n ? (
          <div className="fee-note" style={{ textAlign: "left" }}>
            The token issuer’s {formatBps(fee.bps)} transfer fee ({trim(formatRaw(fee.fee, d))}) comes out of your exit amount. The Circle does not cover it.
          </div>
        ) : <div className="asset-sub">Your claim: {trim(formatRaw(amount, d))}</div>}
      </div>
      <button className="btn small primary" disabled={!!busy} onClick={() => run(`Send ${name} to wallet`, async () => {
        const tokenProgram = isUsdc ? TOKEN_PROGRAM : h!.asset.tokenProgram;
        const to = await ataAddress(me, claim.mint, tokenProgram);
        const [vaultAuthority] = await findVaultAuthorityPda({ circle });
        const create = createAtaIdempotent(signer, to, me, claim.mint, tokenProgram);
        if (isUsdc) {
          const [activeUsdcVault] = await findActiveUsdcVaultPda({ circle });
          return [create, await getClaimRedemptionUsdcInstructionAsync({
            memberOwner: signer, circle, redemption: exit.address, activeUsdcVault, redemptionAsset: claim.address,
            usdcMint: view.usdcMint, tokenProgram, memberUsdc: to, vaultAuthority,
          })];
        }
        const [circleAsset] = await findCircleAssetPda({ circle, mint: claim.mint });
        const [vault] = await findVaultPda({ circle, mint: claim.mint });
        return [create, await getClaimRedemptionAssetInstructionAsync({
          memberOwner: signer, circle, redemption: exit.address, circleAsset, redemptionAsset: claim.address,
          vault, mint: claim.mint, tokenProgram, memberTokenAccount: to, vaultAuthority,
        })];
      })}>Send to my wallet</button>
    </div>
  );
}
