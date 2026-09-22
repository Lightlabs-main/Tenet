import { useCallback, useEffect, useState } from "react";
import { useSelectedWalletAccount } from "@solana/react";
import type { Address } from "@solana/kit";
import { DEFAULT_CIRCLE, TOKEN_PROGRAM } from "./config.ts";
import { ataAddress, b58ToAddress, loadCircle, tokenBalance, type CircleView } from "./chain.ts";
import { Dashboard } from "./dashboard.tsx";
import { AddressLink, Badge, formatBps, Spinner, ToastProvider } from "./ui.tsx";
import { formatRaw } from "./money.ts";
import { WalletButton } from "./wallet.tsx";

export function App() {
  return (
    <ToastProvider>
      <Shell />
    </ToastProvider>
  );
}

function Shell() {
  const [account] = useSelectedWalletAccount();
  const me = (account?.address ?? null) as Address | null;
  const [theme, setTheme] = useState<ThemeChoice>(() => {
    try {
      const saved = localStorage.getItem("tenet:theme");
      return saved === "light" || saved === "dark" || saved === "system" ? saved : "system";
    } catch { return "system"; }
  });
  const [surface, setSurface] = useState<"home" | "circle" | "explore" | "mandate">("home");
  const [input, setInput] = useState(DEFAULT_CIRCLE);
  const [circle, setCircle] = useState<Address | null>(() => b58ToAddress(DEFAULT_CIRCLE));
  const [view, setView] = useState<CircleView | null>(null);
  const [usdcBalance, setUsdcBalance] = useState<bigint | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const reload = useCallback(async () => {
    if (!circle) return;
    setLoading(true);
    try {
      setError(null);
      const v = await loadCircle(circle, me);
      const bal = me
        ? await ataAddress(me, v.usdcMint, TOKEN_PROGRAM).then(tokenBalance)
        : null;
      setView(v);
      setUsdcBalance(bal);
    } catch (e) {
      setView(null);
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [circle, me]);

  useEffect(() => { void reload(); }, [reload]);

  useEffect(() => {
    if (theme === "system") delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = theme;
    try { localStorage.setItem("tenet:theme", theme); } catch { /* private mode */ }
  }, [theme]);

  const open = () => {
    try { setCircle(b58ToAddress(input.trim())); setError(null); } catch { setError("That is not a valid Solana address."); }
  };

  return (
    <>
      <nav className="nav">
        <button className="brand" type="button" onClick={() => setSurface("home")} aria-label="Tenet home">
          <div className="brand-mark">T</div>
          <div className="brand-copy">
            <span className="brand-name">Tenet</span>
            <span className="brand-tag">Collective investing, governed by rules</span>
          </div>
        </button>
        <span className="pill"><span className="dot" />Devnet network</span>
        <div className="nav-spacer" />
        <label className="theme-control">
          <span className="sr-only">Theme</span>
          <select value={theme} onChange={(e) => setTheme(e.target.value as ThemeChoice)} aria-label="Theme">
            <option value="system">System</option>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select>
        </label>
        <form className="circle-switch" aria-label="Open a Circle" onSubmit={(e) => { e.preventDefault(); open(); }}>
          <input className="plain mono" value={input} onChange={(e) => setInput(e.target.value)} spellCheck={false} aria-label="Circle address" placeholder="Circle address" />
          <button className="btn small ghost" type="submit">Open circle</button>
        </form>
        <WalletButton />
      </nav>

      <div className="workspace-layout">
        <aside className="workspace-sidebar" aria-label="Tenet workspace">
          <div className="sidebar-intro">
            <span className="eyebrow">Workspace</span>
            <strong>{surface === "home" ? "Investment workspace" : surface === "explore" ? "Discover Circles" : "Circle console"}</strong>
            <span>{surface === "home" ? "Pool capital around rules your group can inspect." : "Inspect the constitution, then decide how to participate."}</span>
          </div>
          <nav className="sidebar-nav" aria-label="Circle sections">
            <a className={surface === "home" ? "active" : ""} href="#home" onClick={() => setSurface("home")}><span className="nav-icon">⌂</span>Home</a>
            <a className={surface === "explore" ? "active" : ""} href="#explore" onClick={() => setSurface("explore")}><span className="nav-icon">⌕</span>Explore</a>
            <a className={surface === "circle" ? "active" : ""} href="#circle" onClick={() => setSurface("circle")}><span className="nav-icon">◈</span>My Circle</a>
            {surface === "circle" ? <>
              <a href="#holdings"><span className="nav-icon">◈</span>Holdings</a>
              <a href="#value"><span className="nav-icon">◒</span>Value</a>
              <a href="#rules"><span className="nav-icon">≡</span>Mandate</a>
              <a href="#actions"><span className="nav-icon">＋</span>Contribute</a>
              <a href="#actions"><span className="nav-icon">↗</span>Exit</a>
              <a href="#fork"><span className="nav-icon">⑂</span>Fork</a>
            </> : null}
            {view ? <a className={surface === "mandate" ? "active" : ""} href="#mandate-detail" onClick={() => setSurface("mandate")}><span className="nav-icon">≡</span>Mandate</a> : null}
          </nav>
          <div className="sidebar-bottom">
            <div className="sidebar-circle-label">OPEN CIRCLE</div>
            <span className="mono sidebar-address">{circle ? `${String(circle).slice(0, 6)}…${String(circle).slice(-5)}` : "No Circle loaded"}</span>
            <span className="sidebar-status"><span className="status-dot" />Devnet · read-only preview</span>
          </div>
        </aside>

        <main className="page" id="top">
          {surface !== "home" ? <div className="notice">
            <span className="notice-icon">!</span>
            <div className="notice-copy">
              <strong>Devnet preview</strong>
              <span>The USDC and assets shown here are test mints with no real-world value.</span>
            </div>
          </div> : null}

          {surface === "home" ? (
            <LandingSurface view={view} onExplore={() => setSurface("explore")} onCircle={() => setSurface("circle")} />
          ) : surface === "explore" ? (
            <ExploreSurface view={view} onOpen={() => setSurface("circle")} />
          ) : surface === "mandate" && view ? (
            <MandateSurface view={view} onOpenCircle={() => setSurface("circle")} onFork={() => {
              setSurface("circle");
              window.setTimeout(() => document.getElementById("fork")?.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
            }} />
          ) : error ? (
            <div className="card empty">
              <h2>Couldn't load that Circle</h2>
              <p className="error-text">{error}</p>
            </div>
          ) : view && circle ? (
            <Dashboard view={view} circle={circle} account={account} me={me} usdcBalance={usdcBalance} onChanged={reload} />
          ) : (
            <div className="card empty">{loading ? <><Spinner /> <p>Reading the Circle from devnet…</p></> : <p>Enter a Circle address above.</p>}</div>
          )}
        </main>
      </div>
    </>
  );
}

function ExploreSurface({ view, onOpen }: { view: CircleView | null; onOpen: () => void }) {
  return (
    <div className="explore-page" id="explore">
      <section className="explore-hero">
        <div>
          <span className="eyebrow">Discover</span>
          <h1>Collective capital, clear constitutions.</h1>
          <p>Explore Mandates by the rules they commit to — not by a performance number we cannot verify.</p>
        </div>
        <Badge tone="info">Live data only</Badge>
      </section>

      <div className="explore-toolbar">
        <div><span className="eyebrow">Available now</span><h2>Circles on this network</h2></div>
        <span className="muted">Devnet preview · directory indexing is not connected</span>
      </div>

      <div className="explore-grid">
        {view ? (
          <article className="card explore-card">
            <div className="explore-card-top"><Badge tone="good">On-chain</Badge><span className="mono">Circle</span></div>
            <h2>{view.mandate.name}</h2>
            <p>{view.mandate.description || "This Circle has not published a description yet."}</p>
            <div className="explore-meta"><span>{view.holdings.length} permitted asset{view.holdings.length === 1 ? "" : "s"}</span><span>{view.circle.memberCount.toString()} members</span><span>Mandate v{view.mandate.version}</span></div>
            <button className="btn primary" type="button" onClick={onOpen}>Open Circle workspace</button>
          </article>
        ) : null}
        <article className="card explore-empty">
          <div className="empty-orbit">T</div>
          <span className="eyebrow">Directory status</span>
          <h2>More Circles will appear here</h2>
          <p>Tenet does not invent discovery results. A verified indexer will populate this surface when it is connected to the current network.</p>
          <div className="explore-checks"><span>✓ Verified sources only</span><span>✓ No fabricated performance</span><span>✓ Rules before trades</span></div>
        </article>
      </div>

      <section className="explore-principles card">
        <span className="eyebrow">The Tenet loop</span>
        <div className="principle-row"><strong>POOL</strong><span>Capital enters through an Epoch.</span><i>→</i><strong>EXECUTE</strong><span>Mandates constrain the route.</span><i>→</i><strong>VALUE</strong><span>Verified observations only.</span><i>→</i><strong>EXIT</strong><span>In-kind claims stay available.</span></div>
      </section>
    </div>
  );
}

function LandingSurface({ view, onExplore, onCircle }: { view: CircleView | null; onExplore: () => void; onCircle: () => void }) {
  return (
    <div className="landing-page" id="home">
      <section className="landing-hero">
        <div className="landing-hero-copy">
          <span className="eyebrow">Collective investing, governed by rules</span>
          <h1>Invest together.<br /><em>Stay true to<br />the rules.</em></h1>
          <p>Tenet brings investment clubs on-chain. Members pool capital under an inspectable Mandate that governs how the Circle invests.</p>
          <div className="landing-actions">
            <button className="btn primary" type="button" onClick={onExplore}>Explore Circles <span aria-hidden>→</span></button>
            <button className="btn ghost" type="button" onClick={onCircle}>Open a Circle</button>
          </div>
          <span className="landing-note">Devnet preview · test assets have no real-world value</span>
        </div>
        <div className="landing-visual" aria-label="Tenet investment flow">
          <div className="visual-orbit orbit-one" /><div className="visual-orbit orbit-two" />
          <div className="visual-core"><span className="brand-mark">T</span><strong>One constitution</strong><small>shared by the Circle</small></div>
          <div className="visual-node node-members"><span>MEMBERS</span><strong>Pool together</strong></div>
          <div className="visual-node node-rules"><span>MANDATE</span><strong>Rules govern</strong></div>
          <div className="visual-node node-assets"><span>PORTFOLIO</span><strong>Capital acts</strong></div>
          <div className="visual-caption">POOL <i>→</i> EXECUTE <i>→</i> VALUE <i>→</i> EXIT</div>
        </div>
      </section>

      <section className="landing-thesis">
        <span className="eyebrow">A better way to invest together</span>
        <h2>Individual access is improving.<br /><em>Collective investing still needs better rails.</em></h2>
        <p>Tokenization is improving individual access to public equities and eligible private-market economic exposure. It does not solve group custody, shared investment rules or collective exits. Investment clubs, stokvels, savings groups and informal communities already pool money; Tenet gives those groups an explicit on-chain constitution, transparent pooled capital and a clear path to exit.</p>
      </section>

      <section className="landing-flow">
        <div className="landing-section-head"><div><span className="eyebrow">The Tenet model</span><h2>Five mechanics. One coherent system.</h2></div><span>Rules are portable. Capital stays independent.</span></div>
        <div className="mechanic-grid">
          {[
            ["01", "POOL", "Members contribute USDC through Epoch escrow. Shares settle together at a finalized rate."],
            ["02", "EXECUTE", "The Mandate defines eligible assets, target weights and risk limits before execution."],
            ["03", "VALUE", "Vault balances and verified market data inform the position. Missing prices stay unavailable."],
            ["04", "EXIT", "Members can establish an in-kind claim at the Tenet layer without a price or governance gate."],
            ["05", "FORK", "Copy a constitution and its lineage into a new independent Mandate and Circle."]
          ].map(([n, title, body]) => <article className="mechanic-card" key={title}><span>{n}</span><strong>{title}</strong><p>{body}</p></article>)}
        </div>
      </section>

      <section className="landing-contribution">
        <div><span className="eyebrow">Optional contribution rules</span><h2>Make pooling fit real life.</h2><p>Recurring, percentage and round-up contributions are planned for POOL. They only move authorized USDC into Epoch escrow; the Mandate still decides how capital may be invested.</p></div>
        <div className="contribution-callout"><span>CONTRIBUTION RULES</span><strong>How capital enters</strong><i>↓</i><span>MANDATE RULES</span><strong>What capital may do</strong><small>Manual contribution remains available while authorization is verified.</small></div>
      </section>

      <section className="landing-featured">
        <div className="landing-section-head"><div><span className="eyebrow">On this network</span><h2>{view ? "Inspect a live Circle" : "A Circle directory is coming"}</h2></div><button className="text-action" type="button" onClick={onExplore}>Explore <span aria-hidden>→</span></button></div>
        {view ? <article className="featured-circle card">
          <div className="featured-copy"><span className="badge good">On-chain · Devnet</span><h3>{view.mandate.name}</h3><p>{view.mandate.description || "This Mandate has not published a description."}</p><div className="featured-meta"><span>{view.circle.memberCount.toString()} members</span><span>{view.holdings.length} permitted assets</span><span>Mandate v{view.mandate.version}</span></div></div>
          <button className="btn primary" type="button" onClick={onCircle}>Inspect Circle <span aria-hidden>→</span></button>
        </article> : <div className="card directory-note"><strong>Verified Circle indexing is not connected.</strong><span>Tenet will show real network state here when directory data is available.</span></div>}
      </section>

      <footer className="landing-footer"><span className="brand-mark">T</span><span>Tenet</span><p>Don’t copy someone’s trades. Fork their investment constitution.</p><button className="text-action" type="button" onClick={onExplore}>Explore Tenet <span aria-hidden>→</span></button></footer>
    </div>
  );
}

function MandateSurface({ view, onOpenCircle, onFork }: { view: CircleView; onOpenCircle: () => void; onFork: () => void }) {
  const { mandate } = view;
  const limits = [
    ["Single asset", formatBps(BigInt(mandate.maxWeightPerAssetBps)), "Maximum allocation to one permitted asset"],
    ["Pre-IPO exposure", formatBps(BigInt(mandate.maxPreIpoWeightBps)), "Maximum combined eligible private-market exposure"],
    ["Issuer exposure", formatBps(BigInt(mandate.maxIssuerWeightBps)), "Maximum exposure to one token issuer"],
    ["Company exposure", formatBps(BigInt(mandate.maxUnderlyingWeightBps)), "Maximum exposure to one underlying company"],
    ["Supply consumption", formatBps(BigInt(mandate.maxSupplyConsumptionBps)), "Maximum share of supported mint supply"],
    ["Execution impact", formatBps(BigInt(mandate.maxPriceImpactBps)), "Maximum permitted execution price impact"]
  ];
  return (
    <div className="mandate-page" id="mandate-detail">
      <section className="mandate-hero card">
        <div className="mandate-hero-top"><button className="text-action" type="button" onClick={onOpenCircle}>← Back to Circle</button><Badge tone="good">Mandate v{mandate.version}</Badge></div>
        <span className="eyebrow">Investment constitution</span>
        <h1>{mandate.name}</h1>
        <p>{mandate.description || "No description has been published for this Mandate."}</p>
        <div className="mandate-lineage"><span>Author <AddressLink address={mandate.author} /></span><span>Forked from {mandate.forkedFrom.__option === "Some" ? <AddressLink address={mandate.forkedFrom.value} /> : "Original Mandate"}</span><span>Rules apply to this Circle's pooled capital</span></div>
      </section>

      <section className="card">
        <div className="card-head"><div><span className="eyebrow">Risk boundaries</span><h2>What this Mandate allows</h2><p className="card-intro">Limits are read from the on-chain Mandate account.</p></div><Badge tone="info">Inspectable rules</Badge></div>
        <div className="mandate-limit-grid">{limits.map(([label, value, help]) => <article className="mandate-limit" key={label}><span>{label}</span><strong>{value}</strong><small>{help}</small></article>)}</div>
      </section>

      <section className="card">
        <div className="card-head"><div><span className="eyebrow">Permitted universe</span><h2>Mandate assets</h2><p className="card-intro">Only enabled Mandate assets can receive execution output.</p></div><Badge tone="neutral">{view.assets.length} asset{view.assets.length === 1 ? "" : "s"}</Badge></div>
        <div className="mandate-assets">{view.holdings.length ? view.holdings.map(({ asset, registry, targetWeightBps }) => <div className="mandate-asset" key={asset.mint}>
          <div className="mandate-asset-icon">{registry.symbol.slice(0, 4)}</div><div className="mandate-asset-name"><strong>{registry.displayName}</strong><span>{registry.symbol} · {registry.assetClass === 2 ? "Pre-IPO economic exposure" : "Public tokenized equity"}</span></div>
          <div className="mandate-asset-weight"><span>Target weight</span><strong>{formatBps(BigInt(targetWeightBps))}</strong></div>
          <div className="mandate-asset-status"><span className="status-dot" />Enabled</div>
        </div>) : <div className="directory-note"><strong>No permitted asset data is available.</strong><span>The on-chain Circle asset records could not be read.</span></div>}</div>
      </section>

      <section className="mandate-controls card">
        <div><span className="eyebrow">Pool controls</span><h2>How the Circle operates</h2></div>
        <div className="mandate-control-grid">
          <div><span>Minimum contribution</span><strong>{formatRaw(mandate.minContributionUsdc, 6)} tUSDC</strong></div>
          <div><span>Maximum Circle size</span><strong>{formatRaw(mandate.maxPoolSizeUsdc, 6)} tUSDC</strong></div>
          <div><span>Epoch duration</span><strong>{mandate.epochDuration.toString()} seconds</strong></div>
          <div><span>Membership</span><strong>{mandate.membershipPolicy === 0 ? "Open" : "Invite only"}</strong></div>
          <div><span>Amendment threshold</span><strong>{formatBps(BigInt(mandate.amendmentThresholdBps))}</strong></div>
          <div><span>Amendment delay</span><strong>{mandate.amendmentDelaySeconds.toString()} seconds</strong></div>
        </div>
        <div className="mandate-actions"><span>Rules are portable. Capital is independent.</span><button className="btn primary" type="button" onClick={onFork}>Fork this Mandate</button></div>
      </section>
    </div>
  );
}

type ThemeChoice = "system" | "light" | "dark";
