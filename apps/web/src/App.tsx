import { useCallback, useEffect, useState } from "react";
import { useSelectedWalletAccount } from "@solana/react";
import type { Address } from "@solana/kit";
import { DEFAULT_CIRCLE, TOKEN_PROGRAM } from "./config.ts";
import { ataAddress, b58ToAddress, loadCircle, tokenBalance, type CircleView } from "./chain.ts";
import { Dashboard } from "./dashboard.tsx";
import { Spinner, ToastProvider } from "./ui.tsx";
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
        <form className="circle-switch" aria-label="Open a Circle" onSubmit={(e) => { e.preventDefault(); open(); }}>
          <input className="plain mono" value={input} onChange={(e) => setInput(e.target.value)} spellCheck={false} aria-label="Circle address" placeholder="Circle address" />
          <button className="btn small ghost" type="submit">Open circle</button>
        </form>
        <WalletButton />
      </nav>

      <main className="page">
        <div className="notice">
          <span className="notice-icon">!</span>
          <div className="notice-copy">
            <strong>Devnet preview</strong>
            <span>The USDC and assets shown here are test mints with no real-world value.</span>
          </div>
        </div>

        {error ? (
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
    </>
  );
}
