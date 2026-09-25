import { useCallback, useEffect, useState } from "react";
import { useSelectedWalletAccount } from "@solana/react";
import type { Address } from "@solana/kit";
import { CASH_TICKER, CLUSTER, DEPLOYMENT, TOKEN_PROGRAM, USDC_DECIMALS } from "./config.ts";
import { ataAddress, b58ToAddress, isTenetProgramDeployed, loadCircle, loadDirectory, tokenBalance, type CircleView, type DirectoryEntry } from "./chain.ts";
import { Dashboard, FirstCircleSetup, type CirclePanel } from "./dashboard.tsx";
import { AddressLink, Badge, formatBps, Spinner, ToastProvider } from "./ui.tsx";
import { formatRaw } from "./money.ts";
import { TENET_PROGRAM_ADDRESS } from "@tenet/sdk";
import { WalletButton } from "./wallet.tsx";

const circleStorageKey = `tenet:devnet:circle:${TENET_PROGRAM_ADDRESS}`;
function initialCircleAddress(): Address | null {
  try {
    const saved = localStorage.getItem(circleStorageKey);
    if (saved) return b58ToAddress(saved);
    return DEPLOYMENT?.reference ? b58ToAddress(DEPLOYMENT.reference.circle) : null;
  } catch {
    return null;
  }
}

export function App() {
  return (
    <ToastProvider>
      <AppRouter />
    </ToastProvider>
  );
}

function AppRouter() {
  const [path, setPath] = useState(() => window.location.pathname);
  const [theme, setTheme] = useState<ThemeChoice>(() => {
    try {
      const saved = localStorage.getItem("tenet:theme");
      return saved === "light" || saved === "dark" || saved === "system" ? saved : "system";
    } catch { return "system"; }
  });
  useEffect(() => {
    const syncPath = () => setPath(window.location.pathname);
    window.addEventListener("popstate", syncPath);
    return () => window.removeEventListener("popstate", syncPath);
  }, []);

  useEffect(() => {
    if (theme === "system") delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = theme;
    try { localStorage.setItem("tenet:theme", theme); } catch { /* private mode */ }
  }, [theme]);

  return path === "/app" || path.startsWith("/app/")
    ? <Shell theme={theme} setTheme={setTheme} />
    : <PublicLanding theme={theme} setTheme={setTheme} />;
}

function PublicLanding({ theme, setTheme }: { theme: ThemeChoice; setTheme: (theme: ThemeChoice) => void }) {
  // No Devnet Circle exists yet. Never carry the former devnet demo into this page.
  const view: CircleView | null = null;
  const circleLoadStatus = "failed" as const;

  return (
    <div className="public-site">
      <header className="public-nav">
        <a className="brand" href="/" aria-label="Tenet home">
          <span className="brand-mark">T</span>
          <span className="brand-copy"><span className="brand-name">Tenet</span><span className="brand-tag">Invest together, by shared rules</span></span>
        </a>
        <nav className="public-links" aria-label="Public site navigation">
          <a href="#why-tenet">Why Tenet</a>
          <a href="#model">How it works</a>
          <a href="#asset-universe">Markets</a>
        </nav>
        <div className="public-nav-actions">
          <label className="theme-control public-theme-control">
            <span className="sr-only">Theme</span>
            <select value={theme} onChange={(e) => setTheme(e.target.value as ThemeChoice)} aria-label="Theme">
              <option value="system">System</option><option value="light">Light</option><option value="dark">Dark</option>
            </select>
          </label>
          <a className="btn primary public-enter" href="/app#top">Open Devnet workspace <span aria-hidden>→</span></a>
        </div>
      </header>
      <main className="public-main">
        <LandingSurface
          view={view}
          circleLoadStatus={circleLoadStatus}
          onExplore={() => { window.location.assign("/app#explore"); }}
          onCircle={() => { window.location.assign("/app#top"); }}
          onMandate={() => { window.location.assign("/app#mandate-detail"); }}
          onContribute={() => { window.location.assign("/app#contribute"); }}
          onExit={() => { window.location.assign("/app#exit"); }}
          onFork={() => { window.location.assign("/app#fork"); }}
        />
      </main>
    </div>
  );
}

function Shell({ theme, setTheme }: { theme: ThemeChoice; setTheme: (theme: ThemeChoice) => void }) {
  const [account] = useSelectedWalletAccount();
  const me = (account?.address ?? null) as Address | null;
  const [surface, setSurface] = useState<Surface>(() => surfaceFromHash());
  const [addressError, setAddressError] = useState<string | null>(null);
  const [circle, setCircle] = useState<Address | null>(initialCircleAddress);
  const [input, setInput] = useState(() => circle ? String(circle) : "");
  const [view, setView] = useState<CircleView | null>(null);
  const [usdcBalance, setUsdcBalance] = useState<bigint | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [programStatus, setProgramStatus] = useState<"checking" | "deployed" | "missing" | "unavailable">("checking");
  const [programError, setProgramError] = useState<string | null>(null);

  const checkProgram = useCallback(async () => {
    setProgramStatus("checking");
    setProgramError(null);
    try {
      setProgramStatus(await isTenetProgramDeployed() ? "deployed" : "missing");
    } catch (e) {
      setProgramStatus("unavailable");
      const message = e instanceof Error ? e.message : "Unknown RPC error";
      setProgramError(message.match(/HTTP error \((\d{3})\)/)?.[0] ?? "Network request failed (RPC/CORS). Check the configured Devnet endpoint.");
    }
  }, []);

  useEffect(() => { void checkProgram(); }, [checkProgram]);

  const navigate = (next: Surface) => {
    setSurface(next);
    const nextUrl = `/app#${next === "overview" ? "top" : next === "mandate" ? "mandate-detail" : next}`;
    if (`${window.location.pathname}${window.location.hash}` !== nextUrl) window.history.pushState(null, "", nextUrl);
    window.scrollTo({ top: 0, behavior: "instant" });
  };

  useEffect(() => {
    const syncHash = () => setSurface(surfaceFromHash());
    window.addEventListener("hashchange", syncHash);
    window.addEventListener("popstate", syncHash);
    return () => { window.removeEventListener("hashchange", syncHash); window.removeEventListener("popstate", syncHash); };
  }, []);

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

  const open = () => {
    try {
      const nextCircle = b58ToAddress(input.trim());
      setCircle(nextCircle);
      try { localStorage.setItem(circleStorageKey, String(nextCircle)); } catch { /* private mode */ }
      setAddressError(null);
      setError(null);
    } catch {
      setAddressError("Enter a valid Solana Circle address.");
    }
  };

  const openResolvedCircle = (nextCircle: Address) => {
    setInput(String(nextCircle));
    setCircle(nextCircle);
    try { localStorage.setItem(circleStorageKey, String(nextCircle)); } catch { /* private mode */ }
    setAddressError(null);
    setError(null);
    navigate("overview");
  };

  return (
    <>
      <nav className="nav">
        <a className="brand" href="/" aria-label="Tenet home">
          <div className="brand-mark">T</div>
          <div className="brand-copy">
            <span className="brand-name">Tenet</span>
            <span className="brand-tag">Group portfolio · Solana Devnet</span>
          </div>
        </a>
        <span className="pill"><span className="dot" />Solana Devnet · test network</span>
        <div className="nav-spacer" />
        <label className="theme-control">
          <span className="sr-only">Theme</span>
          <select value={theme} onChange={(e) => setTheme(e.target.value as ThemeChoice)} aria-label="Theme">
            <option value="system">System</option>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select>
        </label>
        {programStatus === "deployed" ? <details className="circle-switch">
          <summary className="btn small ghost">Open Circle</summary>
          <form className="circle-switch-form" aria-label="Open a Circle" onSubmit={(e) => { e.preventDefault(); open(); }}>
            <input className="plain mono" value={input} onChange={(e) => { setInput(e.target.value); setAddressError(null); }} spellCheck={false} aria-label="Circle address" placeholder="Paste Circle address" />
            <button className="btn small primary" type="submit">Open</button>
            {addressError ? <span className="circle-switch-error" role="alert">{addressError}</span> : null}
          </form>
        </details> : <span className="pill">Transactions disabled</span>}
        {programStatus === "deployed" ? <WalletButton /> : null}
      </nav>

      <div className="workspace-layout">
        <aside className="workspace-sidebar" aria-label="Tenet workspace">
          <div className="sidebar-intro"><span className="eyebrow">TENET / APP</span><strong>Invest together.</strong><span>One Circle. Shared rules. Your own exit.</span></div>
          {programStatus === "deployed" ? <nav className="sidebar-nav" aria-label="Circle sections">
            {([ ["overview", "Overview", "◈"], ["explore", "Explore", "⌕"], ["portfolio", "Holdings", "▦"], ["prices", "Prices & value", "◒"], ["mandate", "Mandate", "≡"] ] as const).map(([target, label, icon]) => <a key={target} className={surface === target ? "active" : ""} href={`#${target === "overview" ? "top" : target === "mandate" ? "mandate-detail" : target}`} onClick={(event) => { event.preventDefault(); navigate(target); }}><span className="nav-icon" aria-hidden="true">{icon}</span>{label}</a>)}
          </nav> : <p className="Devnet-sidebar-note">Circle navigation appears when the Tenet program is deployed.</p>}
          <div className="sidebar-bottom">
            <div className="sidebar-circle-label">OPEN CIRCLE</div>
            <span className="sidebar-address">{circle ? `${String(circle).slice(0, 6)}…${String(circle).slice(-5)}` : programStatus === "missing" ? "Program not deployed" : "No Circle selected"}</span>
            <span className="sidebar-status"><span className="status-dot" />Solana Devnet · test assets</span>
            <a className="sidebar-public" href="/">← Public site</a>
          </div>
        </aside>

        <main className="page" id="top">
          {programStatus !== "deployed" ? <>
          <section className="card empty load-error Devnet-gate" aria-live="polite">
            <span className="eyebrow">Solana Devnet · setup</span>
            <h1>{programStatus === "checking" ? "Checking Tenet on Devnet…" : programStatus === "missing" ? "Tenet isn't live on Devnet yet" : "Couldn't reach Solana Devnet"}</h1>
            <p>{programStatus === "checking"
              ? "Reading the Tenet program account. No wallet or transaction is involved."
              : programStatus === "missing"
                ? "Once the operator deploys the two programs and runs the setup script, this page becomes the full workspace. Nothing is simulated in the meantime."
                : "The Devnet RPC did not answer. Check your connection and try again."}</p>
            {programStatus === "missing" ? <ol className="first-circle-steps">
              <li><strong>Deploy</strong><span><code>anchor deploy --provider.cluster devnet</code> (tenet + tenet-devnet)</span></li>
              <li><strong>Set up</strong><span><code>pnpm devnet:setup</code> — TUSDC faucet, 6 test instruments, feeds, markets</span></li>
              <li><strong>Demo</strong><span>Get TUSDC → create a Circle → contribute → execute → value → exit → fork</span></li>
            </ol> : null}
            <div className="Devnet-gate-meta"><span>Tenet program</span><AddressLink address={TENET_PROGRAM_ADDRESS} /></div>
            <button className="btn ghost" type="button" disabled={programStatus === "checking"} onClick={() => { void checkProgram(); }}>{programStatus === "checking" ? "Checking…" : "Check again"}</button>
            {programError ? <p className="error-text" role="status">RPC read failed: {programError}</p> : null}
          </section>
                    </> : <>
          <div className="notice">
            <span className="notice-icon">!</span>
            <div className="notice-copy">
              <strong>Solana Devnet · test assets only</strong>
              <span>Everything here is a real Devnet transaction with valueless test tokens: TUSDC and DEVNET TEST INSTRUMENTS, priced by a devnet pricing simulation.</span>
            </div>
          </div>

          {surface === "explore" ? (
            <ExploreSurface current={circle} onOpenCircle={openResolvedCircle} onCreate={() => { setCircle(null); setView(null); try { localStorage.removeItem(circleStorageKey); } catch { /* private mode */ } navigate("overview"); }} />
          ) : surface === "mandate" && view ? (
            <MandateSurface view={view} onOpenCircle={() => navigate("overview")} onFork={() => navigate("fork")} />
          ) : error ? (
            <div className="card empty load-error">
              <span className="eyebrow">Circle not loaded</span>
              <h2>We couldn’t open this Circle</h2>
              <p>Tenet couldn’t read this Circle from Solana Devnet. Check that the address belongs to a Circle on the selected network, then try again. No transaction was sent and nothing was changed.</p>
              <button className="btn primary" type="button" disabled={loading} onClick={() => { void reload(); }}>{loading ? "Trying again…" : "Try again"}</button>
              <details><summary>Technical error details</summary><pre>{error}</pre></details>
            </div>
          ) : view && circle ? (
            <Dashboard panel={surface === "mandate" ? "overview" : surface} navigate={navigate} view={view} circle={circle} account={account} me={me} usdcBalance={usdcBalance} onChanged={reload} onOpenCircle={openResolvedCircle} />
          ) : (
            loading ? <div className="card empty"><Spinner /> <p>Reading the Circle from Solana Devnet…</p></div> : <FirstCircleSetup account={account} onOpenCircle={openResolvedCircle} />
          )}
          </>}
        </main>
        {programStatus === "deployed" ? <nav className="mobile-nav" aria-label="Primary navigation">
          {([ ["overview", "Home", "⌂"], ["explore", "Explore", "⌕"], ["contribute", "Add money", "+"], ["portfolio", "Portfolio", "▦"], ["exit", "Exit", "↗"] ] as const).map(([target, label, icon]) => <a key={target} className={surface === target ? "active" : ""} href={`#${target === "overview" ? "top" : target}`} onClick={(event) => { event.preventDefault(); navigate(target); }}><span aria-hidden="true">{icon}</span>{label}</a>)}
        </nav> : null}
      </div>
    </>
  );
}

type Surface = CirclePanel | "explore" | "mandate";
function surfaceFromHash(): Surface {
  const hash = window.location.hash.slice(1);
  if (hash === "explore") return "explore";
  if (hash === "mandate" || hash === "mandate-detail" || hash === "rules") return "mandate";
  if (hash === "portfolio" || hash === "holdings") return "portfolio";
  if (hash === "prices" || hash === "value") return "prices";
  if (hash === "contribute" || hash === "actions") return "contribute";
  if (hash === "exit" || hash === "fork") return hash;
  return "overview";
}

const displayCircleName = (onChainName: string) => onChainName;
const displayAmount = (raw: bigint, decimals: number) => {
  const value = formatRaw(raw, decimals);
  return value.includes(".") ? value.replace(/\.?0+$/, "") : value;
};
const formatDuration = (seconds: bigint) => {
  if (seconds > 0n && seconds % 86_400n === 0n) return `${seconds / 86_400n} day${seconds === 86_400n ? "" : "s"}`;
  if (seconds > 0n && seconds % 3_600n === 0n) return `${seconds / 3_600n} hour${seconds === 3_600n ? "" : "s"}`;
  if (seconds > 0n && seconds % 60n === 0n) return `${seconds / 60n} minute${seconds === 60n ? "" : "s"}`;
  return `${seconds} second${seconds === 1n ? "" : "s"}`;
};

function ExploreSurface({ current, onOpenCircle, onCreate }: { current: Address | null; onOpenCircle: (c: Address) => void; onCreate: () => void }) {
  const [dir, setDir] = useState<DirectoryEntry[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { void loadDirectory().then(setDir).catch((e) => setErr((e as Error).message)); }, []);
  return (
    <div className="explore-page" id="explore">
      <section className="explore-hero">
        <div>
          <span className="eyebrow">Discover</span>
          <h1>Every Circle on Tenet Devnet.</h1>
          <p>Read straight from the program: each Circle, its Mandate, members and where its rules were forked from. Open one, or create your own.</p>
        </div>
        <button className="btn primary" type="button" onClick={onCreate}>Create a Circle</button>
      </section>
      {err ? <div className="card explore-load-error"><h2>Could not list Circles</h2><pre>{err}</pre></div> : dir === null ? <div className="card empty"><Spinner /> <p>Reading Circles from Solana Devnet…</p></div> : dir.length === 0 ? <div className="card empty"><h2>No Circles yet</h2><p>Be the first: create a Circle.</p></div> : (
        <div className="explore-grid">
          {dir.map((d) => {
            const parent = d.mandate.forkedFrom.__option === "Some" ? dir.find((x) => x.mandateAddress === (d.mandate.forkedFrom as { value: Address }).value) : undefined;
            return <article className="card explore-card" key={d.circle}>
              <div className="explore-card-top"><Badge tone={d.circle === current ? "good" : "warn"}>{d.circle === current ? "Open now" : "Devnet test Circle"}</Badge><span>{parent ? `Fork of ${parent.mandate.name}` : "Original rules"}</span></div>
              <h2>{d.mandate.name}</h2>
              <p>{d.mandate.description}</p>
              <div className="explore-meta"><span>{d.data.memberCount.toString()} members</span><span>epoch {d.data.currentEpoch.toString()}</span><span>pre-IPO cap {formatBps(BigInt(d.mandate.maxPreIpoWeightBps))}</span></div>
              <button className="btn primary" type="button" onClick={() => onOpenCircle(d.circle)}>Open Circle</button>
            </article>;
          })}
        </div>
      )}
    </div>
  );
}

function LandingSurface({ view, circleLoadStatus, onExplore, onCircle, onMandate, onContribute, onExit, onFork }: {
  view: CircleView | null;
  circleLoadStatus: "loading" | "ready" | "failed";
  onExplore: () => void;
  onCircle: () => void;
  onMandate: () => void;
  onContribute: () => void;
  onExit: () => void;
  onFork: () => void;
}) {
  const limits = view ? [
    ["One asset", formatBps(BigInt(view.mandate.maxWeightPerAssetBps))],
    ["Pre-IPO exposure", formatBps(BigInt(view.mandate.maxPreIpoWeightBps))],
    ["One issuer", formatBps(BigInt(view.mandate.maxIssuerWeightBps))],
    ["Supply consumption", formatBps(BigInt(view.mandate.maxSupplyConsumptionBps))],
  ] : [];
  const allowedAssets = view?.holdings ?? [];
  const heldCount = allowedAssets.filter((asset) => asset.vaultRaw > 0n).length;

  return (
    <div className="landing-page" id="home">
      <section className="landing-hero" aria-labelledby="landing-title">
        <div className="landing-hero-copy">
          <span className="eyebrow">PEOPLE <i>+</i> CAPITAL <i>+</i> RULES</span>
          <h1 id="landing-title">Collective investing,<br /><em>governed by rules.</em></h1>
          <p className="landing-manifesto">Don’t copy someone’s trades.<br /><em>Fork their investment constitution.</em></p>
          <p>Pool USDC with people you trust. The Mandate sets what the Circle may invest in. See what is actually held, and leave with your proportional claim or fork the rules into a new Circle.</p>
          <div className="landing-actions">
            <button className="btn primary" type="button" onClick={onExplore}>Explore Circles <span aria-hidden>→</span></button>
            <a className="btn ghost" href="#model">See how Tenet works <span aria-hidden>↓</span></a>
          </div>
          <div className="landing-principles"><span><i>◎</i> People pool together</span><span><i>≡</i> Rules govern capital</span><span><i>⑂</i> Rules can be forked</span></div>
          <span className="landing-note">{CLUSTER === "devnet" ? "Devnet preview · test assets have no real-world value" : "Solana Devnet · read-only · no sample Circle or test balances"}</span>
        </div>
        <div className="landing-visual" aria-label="People pooling into a Circle governed by a Mandate">
          <div className="flow-glow" aria-hidden="true" />
          <div className="flow-members-label">PEOPLE INVEST TOGETHER</div>
          <div className="flow-members"><img src="/tenet-community-hero.png" alt="Editorial illustration of four people gathered around a shared investment Circle" width="1536" height="1024" fetchPriority="high" /></div>
          <div className="flow-lines" aria-hidden="true"><span /><span /><span /><span /></div>
          <div className="human-contribution">Contributions enter together</div>
          <div className="flow-circle"><span className="flow-circle-mark"><span className="brand-mark">T</span></span><span className="flow-circle-overline">SHARED PORTFOLIO</span><strong>A Circle</strong><small>Independent pooled capital</small></div>
          <div className="flow-mandate"><span className="flow-card-icon">≡</span><div><span className="flow-card-label">THE CONSTITUTION</span><strong>Mandate</strong></div><span className="flow-card-detail">{view ? `${view.holdings.length} permitted asset${view.holdings.length === 1 ? "" : "s"} · limits are on-chain` : circleLoadStatus === "loading" ? "Reading current on-chain rules…" : "Verified rule data unavailable"}</span></div>
          <div className="flow-branches" aria-hidden="true"><i /><i /><i /></div>
          <div className="flow-assets" aria-label="Investment categories, not current Circle holdings">
            <div className="flow-asset"><span className="flow-asset-icon public-icon">◫</span><strong>Public equities</strong><small>Tokenized exposure</small></div>
            <div className="flow-asset"><span className="flow-asset-icon private-icon">✳</span><strong>PreStocks</strong><small>Economic exposure</small></div>
            <div className="flow-asset"><span className="flow-asset-icon reserve-icon">◉</span><strong>{CLUSTER === "devnet" ? "Test USDC" : "USDC"}</strong><small>Contribution asset</small></div>
          </div>
          <div className="flow-caption"><span>POOL</span><i>→</i><span>EXECUTE</span><i>→</i><span>VALUE</span><i>→</i><span>EXIT</span><i>→</i><span>FORK</span></div>
          <p className="landing-visual-note">{CLUSTER === "devnet" ? "Conceptual illustration · this demo has no stock holdings" : "Conceptual illustration · not a statement of current holdings"}</p>
        </div>
      </section>

      <section className="asset-marquee" aria-label="Tenet investment model categories">
        <span className="sr-only">Public tokenized equities, eligible PreStocks economic exposure, USDC contribution Epochs and rule-governed Circles.</span>
        <div className="marquee-track" aria-hidden="true"><span>PUBLIC TOKENIZED EQUITIES</span><i>·</i><span>ELIGIBLE PRESTOCKS ECONOMIC EXPOSURE</span><i>·</i><span>USDC CONTRIBUTION EPOCHS</span><i>·</i><span>RULE-GOVERNED CIRCLES</span><i>·</i><span>PUBLIC TOKENIZED EQUITIES</span><i>·</i><span>ELIGIBLE PRESTOCKS ECONOMIC EXPOSURE</span><i>·</i><span>USDC CONTRIBUTION EPOCHS</span><i>·</i><span>RULE-GOVERNED CIRCLES</span><i aria-hidden="true">·</i></div>
      </section>

      <section className="landing-thesis" id="why-tenet">
        <span className="eyebrow">The problem is collective investing</span>
        <h2>Individual access is improving.<br /><em>Collective capital still needs better rails.</em></h2>
        <p>Historically, direct access to high-demand private-company investments has been constrained by accreditation requirements, large minimums and limited distribution. Tokenization is beginning to improve individual access to public equities and private-market economic exposure. But individual access does not solve collective investing. Investment clubs, stokvels and savings groups still commonly rely on bank accounts, spreadsheets, chats and trust in one person. Tenet moves that behavior on-chain: shared capital under an inspectable Mandate.</p>
        <strong className="thesis-close">The new primitive is collective capital governed by programmable investment rules.</strong>
        <p className="thesis-novelty">Tenet brings together retail-sized collective capital, public tokenized equities, eligible PreStocks economic exposure, enforceable on-chain Mandates, protocol-level exit and forkable investment constitutions.</p>
      </section>

      <section className="landing-flow" id="model">
        <div className="landing-section-head"><div><span className="eyebrow">The Tenet model</span><h2>From people to possibility.</h2></div><span>Capital follows rules instead of personalities.</span></div>
        <div className="mechanic-grid">
          {[
            ["01", "POOL", "Contribute USDC to a Circle’s separate Epoch funding window."],
            ["02", "EXECUTE", "The Mandate sets what the Circle may buy and the limits it must follow."],
            ["03", "VALUE", "See actual vault balances and verified prices when available."],
            ["04", "EXIT", "Establish a proportional in-kind claim without a Tenet vote or price gate."],
            ["05", "FORK", "Copy the rules into a new Mandate. Capital and members stay independent."]
          ].map(([n, title, body]) => <article className="mechanic-card" key={title}><span>{n}</span><strong>{title}</strong><p>{body}</p></article>)}
        </div>
      </section>

      <section className="rule-marquee" aria-label="Tenet principles">
        <span className="sr-only">Pool capital. Follow the Mandate. Value transparently. Exit in kind. Fork the rules.</span>
        <div className="rule-marquee-track" aria-hidden="true"><span>POOL CAPITAL</span><i>·</i><span>FOLLOW THE MANDATE</span><i>·</i><span>VALUE TRANSPARENTLY</span><i>·</i><span>EXIT IN KIND</span><i>·</i><span>FORK THE RULES</span><i>·</i><span>POOL CAPITAL</span><i>·</i><span>FOLLOW THE MANDATE</span><i>·</i><span>VALUE TRANSPARENTLY</span><i>·</i><span>EXIT IN KIND</span><i>·</i><span>FORK THE RULES</span><i>·</i></div>
      </section>

      <section className="landing-story" aria-labelledby="story-title">
        <div className="story-heading"><span className="eyebrow">One Circle, one clear journey</span><h2 id="story-title">People. Capital. Rules.</h2><p>Follow the money from contribution to portfolio—and see how every step stays distinct.</p></div>
        <div className="story-layout">
          <ol className="story-steps">
            <li><span>01</span><div><strong>People invest together.</strong><p>Members choose to contribute to a shared Circle.</p></div></li>
            <li><span>02</span><div><strong>Capital enters an Epoch.</strong><p>Pending USDC is kept separate until the contribution window settles.</p></div></li>
            <li><span>03</span><div><strong>The Mandate governs execution.</strong><p>Contribution Rules decide how money enters; Mandate Rules decide what it may do.</p></div></li>
            <li><span>04</span><div><strong>The Circle becomes visible.</strong><p>Holdings come from vault balances; valuations appear only with verified market data.</p></div></li>
            <li><span>05</span><div><strong>Exit or fork.</strong><p>Claim your proportional assets, or take the constitution—not the capital—into a new Circle.</p></div></li>
          </ol>
          <div className="story-visual"><span className="story-visual-kicker">THE CIRCLE JOURNEY</span><div className="story-visual-flow"><span>PEOPLE</span><i>↓</i><span>POOL</span><i>↓</i><span>MANDATE</span><i>↓</i><span>PORTFOLIO</span></div><div className="story-bottom"><span>RULES ARE PORTABLE</span><strong>Capital stays independent.</strong></div></div>
        </div>
      </section>

      <section className="mandate-feature" id="mandate">
        <div className="mandate-feature-copy"><span className="eyebrow">The investment constitution</span><h2>The rules are the product.</h2><p>Every Circle has a Mandate: permitted assets, planned weights and hard limits. It is the shared rulebook—not a promise about what the Circle currently holds.</p><button className="text-action" type="button" onClick={onMandate}>Read a Mandate <span aria-hidden>→</span></button></div>
        <article className="mandate-preview">
          <div className="mandate-preview-head"><span className="brand-mark">≡</span><div><span>ON-CHAIN CONSTITUTION</span><strong>{view ? displayCircleName(view.mandate.name) : circleLoadStatus === "loading" ? "Reading current Mandate…" : "Circle Mandate"}</strong></div><Badge tone={view ? "good" : "neutral"}>{view ? `Version ${view.mandate.version}` : circleLoadStatus === "loading" ? "Loading" : "Unavailable"}</Badge></div>
          <div className="mandate-preview-rules">{limits.length ? limits.map(([label, value]) => <div key={label}><span>{label}</span><strong>{value}</strong></div>) : <p>{circleLoadStatus === "loading" ? "Reading Mandate limits from Solana…" : "Mandate limits are not available. No example values are being substituted."}</p>}</div>
          <p className="mandate-preview-note">{view ? `${view.holdings.length} asset${view.holdings.length === 1 ? "" : "s"} permitted · ${heldCount} currently held` : circleLoadStatus === "loading" ? "Waiting for the Circle account read." : "No live Mandate data is being substituted."}</p>
          <button className="btn ghost" type="button" onClick={onFork}>Fork these rules <span aria-hidden>→</span></button>
        </article>
      </section>

      <section className="universe-section" id="asset-universe">
        <div className="landing-section-head"><div><span className="eyebrow">Investment universe</span><h2>Public equities. Eligible private-market exposure.</h2></div><span>Allowed by rules does not mean held by the Circle.</span></div>
        <div className="universe-grid">
          <article className="universe-card"><span className="universe-symbol">01</span><span className="universe-type">PUBLIC MARKETS</span><h3>Tokenized equity exposure</h3><p>Supported public-equity tokens may be added when their mint, token program, pricing source and transfer behavior are verified.</p></article>
          <article className="universe-card"><span className="universe-symbol">02</span><span className="universe-type">PRIVATE MARKETS</span><h3>PreStocks economic exposure</h3><p>Eligible PreStocks products represent economic exposure under their current product structure—not direct shareholder rights.</p></article>
          <article className="universe-card universe-state">
            <span className="universe-type">THIS CIRCLE · {CLUSTER.toUpperCase()}</span>
            <h3>{view ? `${allowedAssets.length} permitted asset${allowedAssets.length === 1 ? "" : "s"}` : circleLoadStatus === "loading" ? "Reading the asset list" : "Asset list unavailable"}</h3>
            {allowedAssets.length ? <ul>{allowedAssets.slice(0, 4).map(({ asset, registry }) => <li key={asset.mint}><span><strong>{registry.displayName}</strong><small>{registry.symbol} · {CLUSTER === "devnet" ? "Devnet test asset" : registry.assetClass === 2 ? "PreStocks economic exposure" : "Tokenized public-company exposure"}</small></span><Badge tone={CLUSTER === "devnet" ? "warn" : "neutral"}>{CLUSTER === "devnet" ? "Test token" : "Permitted"}</Badge></li>)}</ul> : <p>{circleLoadStatus === "loading" ? "Reading the current Mandate registry from Solana…" : "Verified on-chain asset metadata is unavailable. No names or prices have been filled in."}</p>}
            {view && CLUSTER === "devnet" ? <p className="universe-footnote">This is a test Circle; its permitted test assets have no real-world value. It currently holds {heldCount} non-zero token balances.</p> : null}
          </article>
        </div>
      </section>

      <section className="market-feature" id="market-data">
        <div><span className="eyebrow">Market intelligence</span><h2>Price is not always value.</h2><p>Public tokenized equities need a verified token price and, where available, an underlying-equity comparison. PreStocks need a clear separation between executable market price and issuer reference mark.</p><div className="market-tags"><span>Underlying vs token</span><span>Market vs reference mark</span><span>Supply & liquidity</span><span>Corporate actions</span></div></div>
        <div className="market-data-column"><div className="market-readout"><div><span>Underlying ↔ token · market ↔ mark</span><strong>Live in the app</strong><small>On Devnet, computed from on-chain test price feeds and labelled DEVNET TEST DATA.</small></div></div></div>
      </section>

      <section className="landing-contribution" id="contributions">
        <div><span className="eyebrow">POOL · contribution rules</span><h2>Make pooling fit real life.</h2><p>Contribution Rules control how USDC enters. They do not choose investments. Every contribution still goes through the Circle’s Epoch before Mandate-constrained execution.</p><strong className="contribution-principle">Your contribution rule decides how money enters. The Mandate decides how it is invested.</strong></div>
        <div className="automation-options">
          {[ ["Recurring", "Set a schedule", "Not enabled"], ["Percentage", "Share of incoming USDC", "Not enabled"], ["Round-up", "Supported spending", "Not enabled"] ].map(([kind, detail, state]) => <article key={kind}><span>{kind}</span><strong>{detail}</strong><Badge tone="neutral">{state}</Badge></article>)}
          <small>For now, contribute manually. Tenet does not have arbitrary wallet access.</small>
          <button className="btn primary" type="button" onClick={onContribute}>Contribute manually <span aria-hidden>→</span></button>
        </div>
      </section>

      <section className="exit-feature" id="exit">
        <div className="exit-feature-copy"><span className="eyebrow">EXIT · your share, your choice</span><h2>Leave without asking the group to sell.</h2><p>Tenet itself never imposes a permission gate on establishing a legitimate exit entitlement. The Circle can transfer assets in kind; external token or issuer controls may still affect an individual transfer.</p><button className="btn ghost" type="button" onClick={onExit}>See how exit works <span aria-hidden>→</span></button></div>
        <div className="exit-flow-card"><span>YOUR CIRCLE CLAIM</span><i>↓</i><strong>Entitlement fixed</strong><i>↓</i><div><span>Token claims</span><span>Circle USDC</span></div><small>Illustrative flow · no asset prices implied</small></div>
      </section>

      <section className="fork-feature" id="fork">
        <div className="fork-feature-copy"><span className="eyebrow">FORK · make the rules yours</span><h2>Same philosophy.<br /><em>Different constitution.</em></h2><p>A Fork copies a Mandate’s rules and lineage into an independent Mandate and Circle. Parent money, holdings, members and trades do not move.</p><strong>Rules are portable. Capital is independent.</strong><button className="text-action" type="button" onClick={onFork}>Fork a Mandate <span aria-hidden>→</span></button></div>
        <div className="fork-diagram" aria-label="One Mandate can branch into two independent Circles">
          <div className="fork-rule fork-original"><span>ORIGINAL CONSTITUTION</span><strong>Current Mandate rules</strong><small>{view ? `Pre-IPO maximum · ${formatBps(BigInt(view.mandate.maxPreIpoWeightBps))}` : "Verified limit unavailable"}</small></div>
          <div className="fork-branch-lines" aria-hidden="true"><i /><i /></div>
          <div className="fork-circles"><div><span>CIRCLE A</span><strong>Parent capital stays</strong></div><div><span>CIRCLE B</span><strong>Independent capital</strong></div></div>
          <p>Choose different rules when you create the Fork.</p>
        </div>
      </section>

      <section className="landing-final-cta">
        <span className="eyebrow">PEOPLE · CAPITAL · RULES</span><h2>Build a Circle around what you believe.</h2><p>Start with shared rules. Let members decide whether to contribute.</p><div><button className="btn primary" type="button" onClick={onExplore}>Explore Circles <span aria-hidden>→</span></button><button className="btn ghost" type="button" onClick={onCircle}>Open Devnet workspace</button></div></section>

      <footer className="landing-footer"><span className="brand-mark">T</span><span>Tenet</span><p>Don’t copy someone’s trades. Fork their investment constitution.</p><button className="text-action" type="button" onClick={onCircle}>Open the Circle workspace <span aria-hidden>→</span></button></footer>
    </div>
  );
}

function MandateSurface({ view, onOpenCircle, onFork }: { view: CircleView; onOpenCircle: () => void; onFork: () => void }) {
  const { mandate } = view;
  const limits = [
    ["Single asset", formatBps(BigInt(mandate.maxWeightPerAssetBps)), "Maximum allocation to one permitted asset"],
    ["Private-market exposure", formatBps(BigInt(mandate.maxPreIpoWeightBps)), "Maximum across eligible pre-IPO economic exposure"],
    ["One token issuer", formatBps(BigInt(mandate.maxIssuerWeightBps)), "Maximum combined exposure to assets from one issuer"],
    ["One company", formatBps(BigInt(mandate.maxUnderlyingWeightBps)), "Maximum combined exposure across tokens for one company"],
    ["Token supply limit", formatBps(BigInt(mandate.maxSupplyConsumptionBps)), "Maximum share of a token’s total supply this Circle may hold"],
    ["Purchase price impact", formatBps(BigInt(mandate.maxPriceImpactBps)), "Maximum allowed price movement when buying"]
  ];
  return (
    <div className="mandate-page" id="mandate-detail">
      <section className="mandate-hero card">
        <div className="mandate-hero-top"><button className="text-action" type="button" onClick={onOpenCircle}>← Back to Circle</button><Badge tone="good">Mandate v{mandate.version}</Badge></div>
        <span className="eyebrow">Mandate · investment rules</span>
        <h1>Investment rules · {mandate.name}</h1>
        <p>The Mandate is this Circle’s shared rulebook. It decides which assets are allowed and sets the limits below.{CLUSTER === "devnet" ? " This devnet Circle is for testing, not real investing." : ""}</p>
        <div className="mandate-lineage"><span>Rules apply to this Circle’s pooled money</span><details><summary>Show on-chain Mandate details</summary><span>Name: {mandate.name}</span>{mandate.description ? <span>Description: {mandate.description}</span> : null}<span>Created by <AddressLink address={mandate.author} /></span><span>Based on {mandate.forkedFrom.__option === "Some" ? <AddressLink address={mandate.forkedFrom.value} /> : "an original Mandate"}</span></details></div>
      </section>

      <section className="card">
        <div className="card-head"><div><span className="eyebrow">Investment limits</span><h2>What this group agrees the Circle may do</h2><p className="card-intro">The Mandate is the Circle’s shared investment rulebook. These values are saved in the Circle’s Solana rules.</p></div><Badge tone="info">Current rules</Badge></div>
        <div className="mandate-limit-grid">{limits.map(([label, value, help]) => <article className="mandate-limit" key={label}><span>{label}</span><strong>{value}</strong><small>{help}</small></article>)}</div>
      </section>

      <section className="card">
        <div className="card-head"><div><span className="eyebrow">Allowed by the rules</span><h2>What the Circle may invest in</h2><p className="card-intro">An asset listed here is allowed, not necessarily owned. Check the Portfolio page for actual vault balances.</p></div><Badge tone="neutral">{view.assets.length} asset{view.assets.length === 1 ? "" : "s"}</Badge></div>
        <div className="mandate-assets">{view.holdings.length ? view.holdings.map(({ asset, registry, targetWeightBps }) => <div className="mandate-asset" key={asset.mint}>
          <div className="mandate-asset-icon">{registry.symbol.slice(0, 4)}</div><div className="mandate-asset-name"><strong>{registry.displayName}</strong><span>{registry.symbol} · {CLUSTER === "devnet" ? "Devnet test asset" : registry.assetClass === 2 ? "PreStocks economic exposure" : "Public-company tokenized exposure"}</span>{CLUSTER === "devnet" ? <Badge tone="warn">Test token · no real value</Badge> : null}</div>
          <div className="mandate-asset-weight"><span>Target weight</span><strong>{formatBps(BigInt(targetWeightBps))}</strong></div>
          <div className="mandate-asset-status"><span className="status-dot" />Enabled</div>
        </div>) : <div className="directory-note"><strong>No permitted asset data is available.</strong><span>The Circle’s list of allowed assets could not be read from Solana.</span></div>}</div>
      </section>

      <section className="mandate-controls card">
        <div><span className="eyebrow">Pool controls</span><h2>How the Circle operates</h2></div>
        <div className="mandate-control-grid">
          <div><span>Minimum contribution</span><strong>{displayAmount(mandate.minContributionUsdc, USDC_DECIMALS)} {CASH_TICKER}</strong></div>
          <div><span>Maximum Circle size</span><strong>{displayAmount(mandate.maxPoolSizeUsdc, USDC_DECIMALS)} {CASH_TICKER}</strong></div>
          <div><span>Contribution window duration</span><strong>{formatDuration(mandate.epochDuration)}</strong></div>
          <div><span>Membership</span><strong>{mandate.membershipPolicy === 0 ? "Open" : "Invite only"}</strong></div>
          <div><span>Share of members needed to change rules</span><strong>{formatBps(BigInt(mandate.amendmentThresholdBps))}</strong></div>
          <div><span>Wait before a rule change takes effect</span><strong>{formatDuration(mandate.amendmentDelaySeconds)}</strong></div>
        </div>
        <div className="mandate-actions"><span>Rules are portable. Money stays independent.</span><button className="btn primary" type="button" onClick={onFork}>Create a Circle with these rules</button></div>
      </section>
    </div>
  );
}

type ThemeChoice = "system" | "light" | "dark";
