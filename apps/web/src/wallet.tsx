import { useEffect, useRef, useState } from "react";
import { useSelectedWalletAccount } from "@solana/react";
import { useConnect, useDisconnect, type UiWallet } from "@wallet-standard/react";
import { short } from "./ui.tsx";

/** Nav wallet control: connect via a wallet supporting the active chain. */
export function WalletButton() {
  const [account, setAccount, wallets] = useSelectedWalletAccount();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  const wallet = account ? wallets.find((w) => w.accounts.some((a) => a.address === account.address)) : undefined;

  return (
    <div className="wallet" ref={ref}>
      <button className={`btn small ${account ? "ghost" : "primary"}`} onClick={() => setOpen((o) => !o)}>
        {account ? <><span className="avatar" /> {short(account.address)}</> : "Connect wallet"}
      </button>
      {open ? (
        <div className="wallet-menu">
          {account && wallet ? (
            <Disconnect wallet={wallet} onDone={() => { setAccount(undefined); setOpen(false); }} />
          ) : wallets.length === 0 ? (
            <div className="wallet-empty">
              No wallet with <strong>Solana Devnet</strong> support was detected. Install{" "}
              <a href="https://phantom.com" target="_blank" rel="noreferrer">Phantom</a>,{" "}
              <a href="https://solflare.com" target="_blank" rel="noreferrer">Solflare</a> or{" "}
              <a href="https://backpack.app" target="_blank" rel="noreferrer">Backpack</a>, then switch it to Solana Devnet.
            </div>
          ) : (
            wallets.map((w) => (
              <Connect key={w.name} wallet={w} onConnected={(a) => { setAccount(a); setOpen(false); }} />
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}

function Connect({ wallet, onConnected }: {
  wallet: UiWallet; onConnected: (a: UiWallet["accounts"][number]) => void;
}) {
  const [busy, connect] = useConnect(wallet);
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <button className="wallet-item" disabled={busy} onClick={async () => {
        setError(null);
        try {
          const accounts = await connect();
          if (accounts[0]) onConnected(accounts[0]);
        } catch (e) { setError((e as Error).message); }
      }}>
        {wallet.icon ? <img src={wallet.icon} alt="" /> : null}
        <span>{wallet.name}</span>
      </button>
      {error ? <div className="wallet-empty error-text">{error}</div> : null}
    </>
  );
}

function Disconnect({ wallet, onDone }: { wallet: UiWallet; onDone: () => void }) {
  const [busy, disconnect] = useDisconnect(wallet);
  return (
    <button className="wallet-item" disabled={busy} onClick={async () => { await disconnect(); onDone(); }}>
      Disconnect {wallet.name}
    </button>
  );
}
