import { useCallback, useEffect, useState } from "react";
import { useSelectedWalletAccount } from "@solana/react";
import type { Address } from "@solana/kit";
import { DEFAULT_CIRCLE, TOKEN_PROGRAM } from "./config.ts";
import { ataAddress, b58ToAddress, loadCircle, tokenBalance, type CircleView } from "./chain.ts";
import { Dashboard } from "./dashboard.tsx";
import { Badge, Spinner, ToastProvider } from "./ui.tsx";
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
  const [surface, setSurface] = useState<"circle" | "explore">("circle");
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
        <div className="brand">
          <div className="brand-mark">T</div>
          <div className="brand-copy">
            <span className="brand-name">Tenet</span>
            <span className="brand-tag">Collective investing, governed by rules</span>
          </div>
        </div>
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
            <strong>Circle console</strong>
            <span>Inspect the constitution, then decide how to participate.</span>
          </div>
          <nav className="sidebar-nav" aria-label="Circle sections">
            <a className={surface === "circle" ? "active" : ""} href="#top" onClick={() => setSurface("circle")}><span className="nav-icon">⌂</span>Overview</a>
            <a className={surface === "explore" ? "active" : ""} href="#explore" onClick={() => setSurface("explore")}><span className="nav-icon">⌕</span>Explore</a>
            <a href="#holdings"><span className="nav-icon">◈</span>Holdings</a>
            <a href="#value"><span className="nav-icon">◒</span>Value</a>
            <a href="#rules"><span className="nav-icon">≡</span>Mandate</a>
            <a href="#actions"><span className="nav-icon">＋</span>Contribute</a>
            <a href="#actions"><span className="nav-icon">↗</span>Exit</a>
            <a href="#fork"><span className="nav-icon">⑂</span>Fork</a>
          </nav>
          <div className="sidebar-bottom">
            <div className="sidebar-circle-label">OPEN CIRCLE</div>
            <span className="mono sidebar-address">{circle ? `${String(circle).slice(0, 6)}…${String(circle).slice(-5)}` : "No Circle loaded"}</span>
            <span className="sidebar-status"><span className="status-dot" />Devnet · read-only preview</span>
          </div>
        </aside>

        <main className="page" id="top">
          <div className="notice">
            <span className="notice-icon">!</span>
            <div className="notice-copy">
              <strong>Devnet preview</strong>
              <span>The USDC and assets shown here are test mints with no real-world value.</span>
            </div>
          </div>

          {surface === "explore" ? (
            <ExploreSurface view={view} onOpen={() => setSurface("circle")} />
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

type ThemeChoice = "system" | "light" | "dark";
