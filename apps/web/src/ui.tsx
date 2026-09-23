import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { CLUSTER } from "./config.ts";

export const short = (a: string) => `${a.slice(0, 4)}…${a.slice(-4)}`;

/** 1250n bps -> "12.50%", in integer arithmetic. */
export const formatBps = (bps: bigint) => `${bps / 100n}.${(bps % 100n).toString().padStart(2, "0")}%`;

/** part/whole as bps, floored, integer only. */
export const ratioBps = (part: bigint, whole: bigint) => (whole === 0n ? 0n : (part * 10_000n) / whole);

export const explorerTx = (sig: string) => `https://explorer.solana.com/tx/${sig}?cluster=${CLUSTER === "devnet" ? "devnet" : "mainnet-beta"}`;
export const explorerAddr = (a: string) => `https://explorer.solana.com/address/${a}?cluster=${CLUSTER === "devnet" ? "devnet" : "mainnet-beta"}`;

type Tone = "good" | "warn" | "info" | "pre" | "bad" | "neutral";

export function Badge({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`badge ${tone}`}>{children}</span>;
}

export function Stat({ label, value, unit, sub, you }: {
  label: string; value: ReactNode; unit?: string; sub?: ReactNode; you?: boolean;
}) {
  return (
    <div className={`stat${you ? " you" : ""}`}>
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}{unit ? <span className="stat-unit">{unit}</span> : null}</div>
      {sub ? <div className="stat-sub">{sub}</div> : null}
    </div>
  );
}

/** A bar filled to `bps` of 100%, with an optional marker at `capBps`. */
export function Meter({ bps, capBps, tone }: { bps: bigint; capBps?: bigint; tone?: "pre" | "cap" }) {
  const pct = (b: bigint) => `${Number(b > 10_000n ? 10_000n : b) / 100}%`;
  return (
    <div className="meter" role="img" aria-label={`${formatBps(bps)}${capBps !== undefined ? ` of a ${formatBps(capBps)} cap` : ""}`}>
      <div className={`meter-fill${tone ? ` ${tone}` : ""}`} style={{ width: pct(bps) }} />
      {capBps !== undefined ? <div className="meter-cap" style={{ left: `calc(${pct(capBps)} - 1px)` }} /> : null}
    </div>
  );
}

export function Stepper({ steps, current }: { steps: string[]; current: number }) {
  return (
    <div className="stepper">
      {steps.map((s, i) => (
        <div key={s} className={`step${i < current ? " done" : i === current ? " now" : ""}`}>
          <div className="step-bar" />
          <span>{s}</span>
        </div>
      ))}
    </div>
  );
}

export function Spinner() {
  return <span className="spinner" aria-hidden />;
}

export function AddressLink({ address }: { address: string }) {
  return <a className="mono" href={explorerAddr(address)} target="_blank" rel="noreferrer">{short(address)}</a>;
}

// ---------------------------------------------------------------- toasts

interface Toast { id: number; kind: "ok" | "bad" | "info"; title: string; body?: string; sig?: string }

const ToastCtx = createContext<(t: Omit<Toast, "id">) => void>(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((t: Omit<Toast, "id">) => {
    const id = Date.now() + Math.random();
    setToasts((xs) => [...xs.slice(-3), { ...t, id }]);
    setTimeout(() => setToasts((xs) => xs.filter((x) => x.id !== id)), t.kind === "bad" ? 14_000 : 7_000);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`}>
            <div className="toast-title">
              {t.title}
              {t.sig ? <a href={explorerTx(t.sig)} target="_blank" rel="noreferrer">View ↗</a> : null}
            </div>
            {t.body ? <div className="toast-body">{t.body}</div> : null}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
