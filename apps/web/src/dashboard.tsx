/**
 * The Circle dashboard. Every number on it is read from the chain or computed
 * from chain values by the domain model — the same functions whose results are
 * cross-checked against the Rust program (tests/vectors/math.json). There are
 * market values appear only when the required verified observations are fresh;
 * the page says so rather than inventing any.
 */
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useWalletAccountTransactionSendingSigner } from "@solana/react";
import type { UiWalletAccount } from "@wallet-standard/react";
import { AccountRole, generateKeyPairSigner } from "@solana/kit";
import type { Address, Instruction, TransactionSendingSigner } from "@solana/kit";
import {
  AssetClass, CircleState, EpochState, MandateState, contribute, initiateRedemption, openEpoch,
  findActiveUsdcVaultPda, findCircleAssetPda, findEpochEscrowPda, findEpochPda, findMemberPda,
  findNavSnapshotPda, findReceiptPda, findVaultAuthorityPda, findVaultPda,
  getCancelContributionInstruction, getClaimRedemptionAssetInstructionAsync,
  getClaimRedemptionUsdcInstructionAsync, getCloseContributionsInstruction, getCloseEpochInstruction,
  getOpenNavSnapshotInstructionAsync,
  getFinalizeEpochInstructionAsync, getReserveRedemptionAssetInstruction,
  getReserveRedemptionUsdcInstructionAsync, getSettleContributionInstruction,
  getFinalizeMandateInstruction, getForkMandateAssetInstruction, getForkMandateInstruction,
  findNewAssetPda, findNewMandatePda, findRegistryEntryPda,
  fetchMaybeMandate, fetchMaybeMandateAsset,
} from "@tenet/sdk";
import { entitlementForRedemption, sharesForContribution } from "../../../packages/domain/src/accounting.ts";
import { CHAIN, TOKEN_PROGRAM, USDC_DECIMALS } from "./config.ts";
import {
  ataAddress, createAtaIdempotent, redemptionAssetPda, redemptionPda, rpc, send, withheldFee,
  type CircleView, type ExitView, type Holding,
} from "./chain.ts";
import { formatRaw, formatShares, parseAmount } from "./money.ts";
import { AddressLink, Badge, Meter, Spinner, Stat, Stepper, formatBps, ratioBps, useToast } from "./ui.tsx";

const usdc = (raw: bigint) => formatRaw(raw, USDC_DECIMALS);
/** Trim trailing zeros for display ("5.000000" -> "5"). */
const trim = (s: string) => (s.includes(".") ? s.replace(/\.?0+$/, "") : s);

/** The share of `available` owned by `shares` of `total` — the exact floor the program computes. */
function slice(available: bigint, shares: bigint, total: bigint): bigint {
  if (total === 0n || shares === 0n) return 0n;
  return entitlementForRedemption(available, shares > total ? total : shares, total);
}

// ================================================================ page

export function Dashboard({ view, circle, account, me, usdcBalance, onChanged }: {
  view: CircleView; circle: Address; account: UiWalletAccount | undefined; me: Address | null;
  usdcBalance: bigint | null; onChanged: () => Promise<void>;
}) {
  return (
    <>
      <nav className="dashboard-nav" aria-label="Circle workspace">
        <span className="dashboard-nav-label">Circle workspace</span>
        <a href="#holdings">Holdings</a>
        <a href="#value">Value</a>
        <a href="#rules">Mandate</a>
        <a href="#actions">Contribute / exit</a>
        <a href="#execute">Execute</a>
        <a href="#fork">Fork</a>
        <span className="dashboard-nav-state"><span className="status-dot" />Read-only preview</span>
      </nav>
      <div className="grid">
        <div className="col">
          <Hero view={view} circle={circle} me={me} />
          <ThesisStrip />
          <Holdings view={view} />
          <ValueSurface view={view} />
          <Rules view={view} />
        </div>
        <div className="col col-side" id="actions">
          {account && me ? (
            <Actions account={account} view={view} circle={circle} me={me} usdcBalance={usdcBalance} onChanged={onChanged} />
          ) : (
            <div className="card onboarding-card">
              <div className="card-head">
                <div><span className="eyebrow">Get started</span><h2>Join this Circle</h2></div>
                <Badge tone="info">Wallet required</Badge>
              </div>
              <p className="onboarding-lede">Explore the constitution first. Connect only when you are ready to contribute or manage a position.</p>
              <div className="onboarding-steps">
                <div className="onboarding-step"><span>01</span><div><strong>Inspect</strong><small>Rules, limits, and current vault balances</small></div></div>
                <div className="onboarding-step"><span>02</span><div><strong>Connect</strong><small>Your wallet stays yours; Tenet requests signatures</small></div></div>
                <div className="onboarding-step"><span>03</span><div><strong>Participate</strong><small>Contribute through an Epoch or exit in kind</small></div></div>
              </div>
              <div className="onboarding-foot"><span className="status-dot" />Read-only preview · no wallet connected</div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function ThesisStrip() {
  return (
    <section className="thesis-strip" aria-label="Tenet product principle">
      <div className="thesis-main">
        <span className="eyebrow">The Tenet principle</span>
        <h2>Don’t copy someone’s trades. Fork their investment constitution.</h2>
        <p>Members pool capital under inspectable rules. Contributions enter through an Epoch, the Mandate governs execution, and exit remains available at the Tenet layer.</p>
      </div>
      <div className="thesis-points">
        <div><span>01</span><strong>Pool together</strong><small>Collective capital, visible to members</small></div>
        <div><span>02</span><strong>Follow rules</strong><small>Mandate constraints before trades</small></div>
        <div><span>03</span><strong>Fork ideas</strong><small>Rules travel; capital stays independent</small></div>
      </div>
    </section>
  );
}

// ================================================================ hero

function Hero({ view, circle, me }: { view: CircleView; circle: Address; me: Address | null }) {
  const { circle: c, mandate, member } = view;
  const ownBps = member && c.totalShares > 0n ? ratioBps(member.shares, c.totalShares) : 0n;
  const yourUsdc = member ? slice(view.activeUsdcRaw - c.usdcReservedRaw, member.shares, c.totalShares) : 0n;
  const state = CircleState[c.state];
  return (
    <section className="card hero">
      <div className="hero-top">
        <div style={{ minWidth: 0 }}>
          <div className="hero-kicker"><span className="eyebrow">Investment circle</span><Badge tone={c.state === CircleState.Active ? "good" : "info"}>{state}</Badge></div>
          <h1>{mandate.name}</h1>
          {mandate.description ? <p className="hero-desc">{mandate.description}</p> : null}
          <div className="hero-meta">
            <span>Circle <AddressLink address={circle} /></span>
            <span>·</span>
            <span>Mandate v{mandate.version} by <AddressLink address={mandate.author} /></span>
          </div>
        </div>
        <div className="hero-token" aria-label="Tenet product loop">
          <span className="hero-token-label">THE CONSTITUTION</span>
          <strong>Rules before trades.</strong>
          <div className="hero-loop"><span>POOL</span><i>→</i><span>EXECUTE</span><i>→</i><span>VALUE</span><i>→</i><span>EXIT</span></div>
        </div>
      </div>
      <div className="stats">
        <Stat label="Active capital" value={trim(usdc(view.activeUsdcRaw))} unit="tUSDC"
          sub={c.usdcReservedRaw > 0n ? `${trim(usdc(c.usdcReservedRaw))} owed to exits` : "held in USDC"} />
        <Stat label="Total shares" value={trim(formatShares(c.totalShares))}
          sub={c.reservedShares > 0n ? `${trim(formatShares(c.reservedShares))} awaiting settlement` : "all settled"} />
        <Stat label="Members" value={c.memberCount.toString()} sub={`${view.holdings.length} asset vault${view.holdings.length === 1 ? "" : "s"}`} />
        {me ? (
          <Stat you label="Your position" value={member ? trim(formatShares(member.shares)) : "0"} unit="shares"
            sub={member && member.shares > 0n ? `${formatBps(ownBps)} of the Circle · ${trim(usdc(yourUsdc))} tUSDC` : "not a member yet"} />
        ) : (
          <Stat label="Your position" value="—" sub="connect a wallet" />
        )}
      </div>
    </section>
  );
}

// ================================================================ holdings

function Holdings({ view }: { view: CircleView }) {
  const { circle: c, member, mandate } = view;
  const mine = member?.shares ?? 0n;
  const usdcAvail = view.activeUsdcRaw - c.usdcReservedRaw;
  return (
    <section className="card" id="holdings">
      <div className="card-head">
        <div><span className="eyebrow">Portfolio</span><h2>Holdings</h2><p className="card-intro">What the Circle's vaults hold right now.</p></div>
        <Badge tone="good">On-chain</Badge>
      </div>
      <table className="holdings">
        <thead>
          <tr>
            <th>Asset</th>
            <th className="hide-sm">Target weight</th>
            <th className="r">Held</th>
            <th className="r">Your share</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <div className="asset">
                <div className="asset-icon usdc">$</div>
                <div>
                <div className="asset-name">USDC</div>
                  <div className="asset-sub">active Circle capital</div>
                </div>
              </div>
            </td>
            <td className="hide-sm muted">remainder</td>
            <td className="r">{trim(usdc(view.activeUsdcRaw))}</td>
            <td className="r">{mine > 0n ? trim(usdc(slice(usdcAvail, mine, c.totalShares))) : "—"}</td>
          </tr>
          {view.holdings.map((h) => <HoldingRow key={h.address} h={h} mine={mine} total={c.totalShares} capBps={BigInt(mandate.maxWeightPerAssetBps)} />)}
        </tbody>
      </table>
      <p className="honest">
        <span>ⓘ</span>
        <span>
          Quantities are exact vault balances. Market values appear only when fresh verified observations are available;
          until then this page shows no prices rather than invented ones. "Your share" is exactly what an exit would entitle you to today.
        </span>
      </p>
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
            <div className="asset-name">{h.registry.symbol} <Badge tone={pre ? "pre" : "info"}>{pre ? "Pre-IPO" : "Public"}</Badge></div>
            <div className="asset-sub">{h.registry.displayName} · <span className={metadataVerified ? "verified" : "pending"}>{metadataVerified ? "metadata verified" : "metadata pending"}</span></div>
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
  const preIpoCount = view.holdings.filter((h) => h.registry.assetClass === AssetClass.PreIpo).length;
  const { quotes, loading, error } = usePreStocksQuotes();
  return (
    <section className="card value-card" id="value">
      <div className="card-head">
        <div>
          <span className="eyebrow">Value</span>
          <h2>What can be valued right now</h2>
          <p className="card-intro">Executable value and analytical reference data stay separate.</p>
        </div>
        <Badge tone="warn">Prices unavailable</Badge>
      </div>
      <div className="value-grid">
        <div className="value-item">
          <span className="value-label">Active USDC</span>
          <strong>{trim(usdc(active))} <small>tUSDC</small></strong>
          <span className="value-state good">On-chain balance</span>
        </div>
        <div className="value-item">
          <span className="value-label">Market NAV</span>
          <strong className="unavailable">Unavailable</strong>
          <span className="value-state">Verified price feeds required</span>
        </div>
        <div className="value-item">
          <span className="value-label">Paired-feed divergence</span>
          <strong className="unavailable">Unavailable</strong>
          <span className="value-state">Underlying/tokenized feeds not connected</span>
        </div>
        <div className="value-item">
          <span className="value-label">PreStocks market vs mark</span>
          <strong className="unavailable">Unavailable</strong>
          <span className="value-state">{preIpoCount ? `${preIpoCount} Pre-IPO holding${preIpoCount === 1 ? "" : "s"} · live mark pending` : "No Pre-IPO holdings"}</span>
        </div>
      </div>
      <p className="honest value-note">
        <span>ⓘ</span>
        <span>Market NAV is not used for exit entitlement. Exits use exact raw vault balances and remain available at the Tenet layer even when pricing is unavailable.</span>
      </p>
      <PreStocksMarketSurface quotes={quotes} loading={loading} error={error} holdings={view.holdings} />
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

type PreStocksState = { quotes: PreStocksQuote[]; loading: boolean; error: string | null };

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
  const [state, setState] = useState<PreStocksState>({ quotes: [], loading: true, error: null });
  useEffect(() => {
    let cancelled = false;
    const source = import.meta.env.DEV ? "/api/prestocks" : "https://prestocks.com/api/prestocks";
    void fetch(source, { headers: { accept: "application/json" } })
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
        if (!cancelled) setState({ quotes, loading: false, error: null });
      })
      .catch(() => {
        if (!cancelled) setState({ quotes: [], loading: false, error: "The public source is unavailable from this browser." });
      });
    return () => { cancelled = true; };
  }, []);
  return state;
}

function decimalScaled(value: string, places = 12): bigint | null {
  if (!/^\d+(?:\.\d+)?$/.test(value)) return null;
  const [whole, fraction = ""] = value.split(".");
  if (fraction.length > places) return null;
  return BigInt(whole) * 10n ** BigInt(places) + BigInt(fraction.padEnd(places, "0"));
}

function premiumBps(market: string, mark: string): bigint | null {
  const marketScaled = decimalScaled(market);
  const markScaled = decimalScaled(mark);
  if (marketScaled === null || markScaled === null || markScaled === 0n) return null;
  return ((marketScaled - markScaled) * 10_000n) / markScaled;
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

function PreStocksMarketSurface({ quotes, loading, error, holdings }: { quotes: PreStocksQuote[]; loading: boolean; error: string | null; holdings: Holding[] }) {
  const relevant = quotes.filter((quote) => holdings.some((holding) => holding.registry.mint === quote.mint));
  const rows = relevant.length > 0 ? relevant : quotes.slice(0, 3);
  return (
    <div className="prestocks-surface">
      <div className="prestocks-head">
        <div><span className="eyebrow">PreStocks</span><h3>Market vs issuer reference mark</h3><p>Market price is executable-market context. The issuer mark is reference data, not guaranteed exit value.</p></div>
        <span className={`source-status ${loading ? "loading" : error ? "bad" : "live"}`}><span />{loading ? "Reading source" : error ? "Unavailable" : "Live source"}</span>
      </div>
      {error ? <div className="prestocks-unavailable">{error} Market-vs-mark comparison unavailable.</div> : rows.length === 0 ? <div className="prestocks-unavailable">No PreStocks quotes available.</div> : (
        <div className="prestocks-table" role="table" aria-label="PreStocks market versus issuer mark">
          <div className="prestocks-row prestocks-row-head" role="row"><span>Asset</span><span>Market</span><span>Mark</span><span>Premium / discount</span></div>
          {rows.map((quote) => <div className="prestocks-row" role="row" key={quote.mint}>
            <strong>{quote.symbol}</strong>
            <span>${formatDecimal(quote.marketPrice)}</span>
            <span>${formatDecimal(quote.issuerMark)}</span>
            <span className={premiumBps(quote.marketPrice, quote.issuerMark) !== null && premiumBps(quote.marketPrice, quote.issuerMark)! < 0n ? "discount" : "premium"}>{formatBpsSigned(premiumBps(quote.marketPrice, quote.issuerMark))}</span>
          </div>)}
        </div>
      )}
      <div className="prestocks-foot">Source: PreStocks API · {relevant.length ? "Circle allocation highlighted" : "showing current supported universe"} · refresh on page load</div>
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
    { label: "Largest single asset", used: hs.reduce((a, h) => (BigInt(h.targetWeightBps) > a ? BigInt(h.targetWeightBps) : a), 0n), cap: BigInt(m.maxWeightPerAssetBps), hint: "per asset" },
    { label: "Pre-IPO total", used: hs.filter((h) => h.registry.assetClass === AssetClass.PreIpo).reduce((a, h) => a + BigInt(h.targetWeightBps), 0n), cap: BigInt(m.maxPreIpoWeightBps), pre: true, hint: "all pre-IPO" },
    { label: "Largest issuer", used: sumBy((h) => h.registry.issuer), cap: BigInt(m.maxIssuerWeightBps), hint: "counterparty" },
    { label: "Largest company", used: sumBy((h) => hex(h.registry.underlyingId)), cap: BigInt(m.maxUnderlyingWeightBps), hint: "across issuers" },
  ];
  return (
    <section className="card" id="rules">
      <div className="card-head">
        <div><span className="eyebrow">Constitution</span><h2>Mandate rules</h2><p className="card-intro">Enforced on-chain: target weights versus caps.</p></div>
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
        <Badge>min {trim(usdc(m.minContributionUsdc))} tUSDC</Badge>
        <Badge>pool cap {trim(usdc(m.maxPoolSizeUsdc))} tUSDC</Badge>
        <Badge>{m.epochDuration.toString()}s contribution window</Badge>
        <Badge>amendments need {formatBps(BigInt(m.amendmentThresholdBps))}</Badge>
      </div>
    </section>
  );
}

// ================================================================ actions

type Run = (label: string, build: () => Promise<Instruction[]>) => Promise<boolean>;
type RunMany = (label: string, build: () => Promise<Instruction[][]>) => Promise<boolean>;

/** Human-readable program error from a failed transaction. */
function explain(e: unknown): string {
  const msg = (e as Error)?.message ?? String(e);
  const anchor = /Error Message: ([^\n]+?)\.?(\n|$)/.exec(msg);
  if (anchor) return anchor[1];
  if (/User rejected|rejected the request/i.test(msg)) return "You rejected the request in your wallet.";
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
    try {
      let lastSignature = "";
      const batches = await build();
      if (batches.length === 0) {
        toast({ kind: "info", title: `${label} — already complete` });
        await onChanged();
        return true;
      }
      for (const instructions of batches) {
        lastSignature = await send(signer, instructions);
      }
      toast({ kind: "ok", title: `${label} — confirmed`, sig: lastSignature });
      await onChanged();
      return true;
    } catch (e) {
      toast({ kind: "bad", title: `${label} failed`, body: explain(e) });
      return false;
    } finally {
      setBusy(null);
    }
  };
  return { busy, run, runMany };
}

function Actions({ account, view, circle, me, usdcBalance, onChanged }: {
  account: UiWalletAccount; view: CircleView; circle: Address; me: Address;
  usdcBalance: bigint | null; onChanged: () => Promise<void>;
}) {
  const signer = useWalletAccountTransactionSendingSigner(account, CHAIN);
  const { busy, run, runMany } = useRunner(signer, onChanged);
  return (
    <>
      <EpochCard view={view} circle={circle} me={me} signer={signer} usdcBalance={usdcBalance} run={run} busy={busy} />
      <ExecutionCard view={view} />
      <ExitCard view={view} circle={circle} me={me} signer={signer} run={run} busy={busy} />
      <ForkCard view={view} signer={signer} runMany={runMany} busy={busy} />
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

function ExecutionCard({ view }: { view: CircleView }) {
  return (
    <section className="card" id="execute">
      <div className="card-head">
        <div><span className="eyebrow">Execute</span><h2>Put the Circle to work</h2><p className="card-intro">Jupiter routes USDC into assets allowed by this Mandate.</p></div>
        <Badge tone="neutral">Safety review</Badge>
      </div>
      <p className="muted" style={{ marginTop: 0 }}>
        The execution boundary is live in staged form. Price-dependent checks remain gated until target feeds and a controlled Token-2022 vault-delta route are verified.
      </p>
      <div className="preview">
        <div className="preview-row"><span className="k">Router</span><span className="v">Jupiter Swap V2 · Router</span></div>
        <div className="preview-row"><span className="k">Source</span><span className="v">Circle USDC vault</span></div>
        <div className="preview-row"><span className="k">Destination</span><span className="v">{view.assets.length} Mandate-approved vault{view.assets.length === 1 ? "" : "s"}</span></div>
        <div className="preview-row"><span className="k">Protection</span><span className="v">raw pre/post vault deltas</span></div>
        <div className="preview-row"><span className="k">Supply cap</span><span className="v">live raw mint supply · enforced at settlement</span></div>
      </div>
      <ActionButton busy={null} disabled label="Execution gated" onClick={() => {}} kind="ghost" />
      <p className="automation-foot">Quotes and UI amounts never authorize a swap. Raw supply consumption is enforced; price-impact, issuer, and pre-IPO checks remain gated until their verified observations are available.</p>
    </section>
  );
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
      <div><span className="eyebrow">Pool</span><h2>Contribute</h2><p className="card-intro">Add USDC to the next settlement window.</p></div>
      <Badge tone="info">Epoch {index.toString()}</Badge>
    </div>
  );

  if (!epoch) {
    return (
      <section className="card">
        {header}
        {c.totalShares === 0n ? (
          <>
            <p className="muted" style={{ margin: 0 }}>
              No epoch is open. Opening Epoch 0 starts a {mandate.epochDuration.toString()}-second contribution window —
              anyone can open it.
            </p>
            <ActionButton busy={busy} label={`Open epoch ${index}`} onClick={() => run(`Open epoch ${index}`, async () => {
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
            This Circle already has members, so the next Epoch prices entrants against a bounded NAV snapshot.
            Fresh verified observations are required before settlement; if the window expires, contributions remain
            refundable from isolated escrow.
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
      <Stepper steps={["Open", "Closed", "Finalized", "Completed"]} current={STEP_OF[e.state] ?? 0} />

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
        <div className="preview-row"><span className="k">Pending in escrow</span><span className="v">{trim(usdc(e.pendingUsdcRaw))} tUSDC</span></div>
        <div className="preview-row"><span className="k">Contributors</span><span className="v">{e.receiptCount}</span></div>
        {receipt ? (
          <div className="preview-row"><span className="k">Your contribution</span><span className="v">{trim(usdc(receipt.amountUsdcRaw))} tUSDC</span></div>
        ) : null}
      </div>

      {open && remaining > 0n ? (
        <>
          <div className="field">
            <div className="field-label">
              <span>Amount</span>
              <span>Balance {usdcBalance === null ? "—" : trim(usdc(usdcBalance))} tUSDC</span>
            </div>
            <div className="input-wrap">
              <input inputMode="decimal" value={amount} onChange={(ev) => setAmount(ev.target.value)} aria-label="amount in test USDC" />
              <span className="suffix">tUSDC</span>
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
            <div className="preview-row"><span className="k">Pricing</span><span className="v">exact — 1 share per micro-USDC</span></div>
            <div className="preview-row"><span className="k">Until settlement</span><span className="v">held in escrow · refundable</span></div>
            {parseError ? <div className="error-text">{parseError}</div> : null}
            {parsed !== null && !minOk ? <div className="error-text">Below the {trim(usdc(mandate.minContributionUsdc))} tUSDC minimum.</div> : null}
            {parsed !== null && usdcBalance !== null && !balOk ? <div className="error-text">More than your balance.</div> : null}
          </div>
          <ActionButton busy={busy} disabled={!minOk || !balOk} label="Contribute" onClick={() => run(`Contribute ${amount} tUSDC`, async () => {
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
        <ActionButton busy={busy} label="Close contributions" onClick={() => run("Close contributions", async () => {
          const p = await pdas();
          return [getCloseContributionsInstruction({ payer: signer, epoch: p.epochAddr })];
        })} />
      ) : null}

      {e.state === EpochState.Closed ? (
        c.pendingReservations > 0 ? (
          <p className="muted">An exit is still reserving its assets. Finalization waits so the exit cannot take newcomers' money — anyone can finish it in the Exit panel.</p>
        ) : c.totalShares > 0n && !view.navSnapshot ? (
          <>
            <p className="muted">Rolling pricing is ready to start. Open the bounded NAV snapshot, then record one fresh verified observation per held asset.</p>
            <ActionButton busy={busy} label="Open NAV snapshot" onClick={() => run("Open NAV snapshot", async () => {
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
              <div className="preview-row"><span className="k">NAV snapshot</span><span className="v">{view.navSnapshot.data.assetsRemaining} asset observation{view.navSnapshot.data.assetsRemaining === 1 ? "" : "s"} remaining</span></div>
              <div className="preview-row"><span className="k">Pricing source</span><span className="v">fresh registry-bound Pyth feeds</span></div>
            </div>
            <p className="muted">Finalization is locked until every held asset is recorded exactly once. Missing or stale observations never become a client-supplied NAV.</p>
          </>
        ) : (
          <ActionButton busy={busy} label="Finalize epoch" onClick={() => run("Finalize epoch", async () => {
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
            <ActionButton busy={busy} label={`Settle — receive ${trim(formatShares(sharesForContribution(receipt.amountUsdcRaw, e.totalSharesBefore, e.navBefore)))} shares`}
              onClick={() => run("Settle contribution", async () => {
                const p = await pdas();
                const [receiptAddr] = await findReceiptPda({ epoch: p.epochAddr, contributor: me });
                const [member] = await findMemberPda({ circle, memberOwner: me });
                return [getSettleContributionInstruction({ payer: signer, circle, epoch: p.epochAddr, receipt: receiptAddr, owner: me, member })];
              })} />
          ) : null}
          {e.settledCount === e.receiptCount ? (
            <ActionButton kind="ghost" busy={busy} label="Close epoch" onClick={() => run("Close epoch", async () => {
              const p = await pdas();
              return [getCloseEpochInstruction({ payer: signer, circle, epoch: p.epochAddr })];
            })} />
          ) : (
            <p className="muted">{e.receiptCount - e.settledCount} contribution(s) still to settle — anyone can settle anyone's.</p>
          )}
        </>
      ) : null}

      <AutomationPreview />
    </section>
  );
}

function ForkCard({ view, signer, runMany, busy }: {
  view: CircleView; signer: TransactionSendingSigner; runMany: RunMany; busy: string | null;
}) {
  const [childAddress, setChildAddress] = useState<Address | null>(null);
  const [childSeed, setChildSeed] = useState<Address | null>(null);
  const parent = view.circle.mandate;

  return (
    <section className="card" id="fork">
      <div className="card-head">
        <div><span className="eyebrow">Fork</span><h2>Take the rules with you</h2><p className="card-intro">Create an independent Mandate from this constitution.</p></div>
        <Badge tone="pre">No capital moves</Badge>
      </div>
      <p className="muted" style={{ marginTop: 0 }}>
        A Fork copies the rules, configuration, and lineage. It does not copy this Circle's money, members, holdings, or transaction history.
      </p>
      <div className="preview">
        <div className="preview-row"><span className="k">Source Mandate</span><span className="v"><AddressLink address={parent} /></span></div>
        <div className="preview-row"><span className="k">Rules copied</span><span className="v">{view.assets.length} permitted asset{view.assets.length === 1 ? "" : "s"} + all caps</span></div>
        <div className="preview-row"><span className="k">New capital</span><span className="v">none — starts independently</span></div>
      </div>
      <ActionButton busy={busy} label={childAddress ? "Resume fork" : "Fork this Mandate"} onClick={() => runMany("Fork Mandate", async () => {
        const seedAddress = childSeed ?? (await generateKeyPairSigner()).address;
        setChildSeed(seedAddress);
        const [child] = await findNewMandatePda({ newMandateSeed: seedAddress });
        setChildAddress(child);

        const batches: Instruction[][] = [];
        const existingChild = await fetchMaybeMandate(rpc, child);
        const childNeedsActivation = !existingChild.exists || existingChild.data.state === MandateState.Draft;
        if (!existingChild.exists) {
          batches.push([getForkMandateInstruction({
            forker: signer, parentMandate: parent, newMandateSeed: seedAddress, newMandate: child,
          })]);
        } else if (
          existingChild.data.author !== signer.address
          || existingChild.data.forkedFrom.__option !== "Some"
          || existingChild.data.forkedFrom.value !== parent
        ) {
          throw new Error("That fork address belongs to a different source or wallet.");
        }

        const copied: { newAsset: Address; registryEntry: Address }[] = [];
        for (const { asset } of view.assets) {
          const [newAsset] = await findNewAssetPda({ newMandate: child, mint: asset.mint });
          const [registryEntry] = await findRegistryEntryPda({ mint: asset.mint });
          copied.push({ newAsset, registryEntry });
          const existingAsset = await fetchMaybeMandateAsset(rpc, newAsset);
          if (!existingAsset.exists) {
            batches.push([getForkMandateAssetInstruction({
              forker: signer, parentMandate: parent, mint: asset.mint, parentAsset: asset.mandateAsset,
              newMandate: child, newAsset, registryEntry,
            })]);
          }
        }

        if (childNeedsActivation) {
          const finalize = getFinalizeMandateInstruction({ author: signer, mandate: child });
          const remaining = copied.flatMap(({ newAsset, registryEntry }) => [
            { address: newAsset, role: AccountRole.READONLY },
            { address: registryEntry, role: AccountRole.READONLY },
          ]);
          batches.push([{ ...finalize, accounts: [...finalize.accounts, ...remaining] } as Instruction]);
        }
        return batches;
      })} />
      {childAddress ? (
        <div className="fork-result">
          <span className="status-dot" />
          <span>Fork destination <AddressLink address={childAddress} /></span>
        </div>
      ) : null}
      <p className="automation-foot">Fork setup uses separate transactions for the child Mandate, each asset rule, and final activation so an 8-asset constitution stays within Solana transaction limits.</p>
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
        <div className="automation-option"><strong>Recurring</strong><span>$10 every Friday</span></div>
        <div className="automation-option"><strong>Percentage</strong><span>5% of eligible USDC</span></div>
        <div className="automation-option"><strong>Round-up</strong><span>Round supported spending</span></div>
      </div>
      <div className="automation-foot">Manual contribution is active. No wallet authority is requested by this preview.</div>
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
        <div><span className="eyebrow">Your position</span><h2>Exit</h2><p className="card-intro">Redeem in kind without a governance or price gate.</p></div>
        <Badge tone="good">Always available</Badge>
      </div>

      {held > 0n ? (
        c.pendingReservations > 0 ? (
          <p className="muted" style={{ margin: 0 }}>
            Another exit is reserving its assets. Exits go one at a time so neither can take value from the other — anyone
            can finish it below.
          </p>
        ) : (
          <>
            <div className="field">
              <div className="field-label"><span>Shares to redeem</span><span className="num">{trim(formatShares(shares))} of {trim(formatShares(held))}</span></div>
              <input type="range" min={1} max={100} value={pct} onChange={(e) => setPct(Number(e.target.value))} aria-label="percent of your shares" />
              <div className="chips">
                {[25, 50, 75, 100].map((p) => <button key={p} className="chip" onClick={() => setPct(p)}>{p}%</button>)}
              </div>
            </div>
            <ExitPreview view={view} shares={shares} />
            <ActionButton busy={busy} disabled={shares === 0n} label="Start exit" onClick={() => run("Start exit", async () => {
              const [memberAddr] = await findMemberPda({ circle, memberOwner: me });
              const redemption = await redemptionPda(circle, me, member!.nextRedemptionSeq);
              return [await initiateRedemption({ memberOwner: signer, circle, member: memberAddr, redemption, shares })];
            })} />
          </>
        )
      ) : (
        <p className="muted" style={{ margin: 0 }}>You hold no shares in this Circle.</p>
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
      <div className="preview-row"><span className="k">Rounding</span><span className="v">floors toward the Circle</span></div>
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
        <strong>Exit #{exit.seq.toString()} · {trim(formatShares(r.sharesRedeemed))} shares</strong>
        {r.assetsRemaining > 0 ? <Badge tone="warn">reserving</Badge> : done ? <Badge tone="good">complete</Badge> : <Badge tone="info">ready to claim</Badge>}
      </div>
      {r.assetsRemaining > 0 ? (
        <ActionButton block={false} kind="ghost" busy={busy} label={`Reserve remaining (${r.assetsRemaining}) — anyone can`} onClick={() => run("Reserve exit assets", async () => {
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
  const name = isUsdc ? "Test USDC" : h?.registry.symbol ?? "asset";
  return (
    <div className="claim">
      <div>
        <div className="claim-amt">{trim(formatRaw(fee ? amount - fee.fee : amount, d))} {name}</div>
        {fee && fee.fee > 0n ? (
          <div className="fee-note" style={{ textAlign: "left" }}>
            you receive this after the issuer's {formatBps(fee.bps)} transfer fee ({trim(formatRaw(fee.fee, d))}) — not reimbursed by the Circle
          </div>
        ) : <div className="asset-sub">entitled {trim(formatRaw(amount, d))}</div>}
      </div>
      <button className="btn small primary" disabled={!!busy} onClick={() => run(`Claim ${name}`, async () => {
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
      })}>Claim</button>
    </div>
  );
}
