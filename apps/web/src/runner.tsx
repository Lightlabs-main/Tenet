/**
 * Running wallet transactions from the UI: one shared runner so every action
 * reports the same way — a toast with the explorer link on success, the
 * program's own error message on failure — and refreshes chain state after.
 */
import { useEffect, useState, type ReactNode } from "react";
import type { Instruction, TransactionSendingSigner } from "@solana/kit";
import { send, sendGroups } from "./chain.ts";
import { formatRaw } from "./money.ts";
import { Spinner, useToast } from "./ui.tsx";
import { USDC_DECIMALS } from "./config.ts";

/** Trim trailing zeros for display ("5.000000" -> "5"). */
export const trim = (s: string) => (s.includes(".") ? s.replace(/\.?0+$/, "") : s);
export const usdc = (raw: bigint) => trim(formatRaw(raw, USDC_DECIMALS));

export type Run = (label: string, build: () => Promise<Instruction[]>) => Promise<boolean>;
export type RunGroups = (label: string, build: () => Promise<Instruction[][]>, after?: () => Promise<void>) => Promise<string[] | null>;

/** Human-readable program error from a failed transaction. */
export function explain(e: unknown): string {
  const msg = (e as Error)?.message ?? String(e);
  const anchor = /Error Message: ([^\n]+?)\.?(\n|$)/.exec(msg);
  if (anchor) return anchor[1]!;
  if (/User rejected|rejected the request/i.test(msg)) return "You rejected the request in your wallet.";
  if (/Unexpected error|simulation|revert/i.test(msg)) return "The wallet could not simulate this step. Cancel any prompt marked unsafe; do not submit a transaction that your wallet says will revert.";
  return msg.length > 400 ? msg.slice(0, 400) + "…" : msg;
}

export function useRunner(signer: TransactionSendingSigner, onChanged: () => Promise<void>) {
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
  /** Several transactions in order; stops at the first failure (earlier ones stay confirmed). */
  const runGroups: RunGroups = async (label, build, after) => {
    setBusy(label);
    try {
      const groups = await build();
      const sigs = await sendGroups(signer, groups, (i, n) => setBusy(n > 1 ? `${label} (${i}/${n})` : label));
      await after?.();
      toast({ kind: "ok", title: `${label} — ${sigs.length} transaction${sigs.length === 1 ? "" : "s"} confirmed`, sig: sigs[sigs.length - 1] });
      await onChanged();
      return sigs;
    } catch (e) {
      toast({ kind: "bad", title: `${label} failed`, body: explain(e) });
      await onChanged();
      return null;
    } finally {
      setBusy(null);
    }
  };
  return { busy, run, runGroups };
}

export function ActionButton({ label, busy, onClick, kind = "primary", block = true, disabled }: {
  label: ReactNode; busy: string | null; onClick: () => void; kind?: "primary" | "ghost"; block?: boolean; disabled?: boolean;
}) {
  return (
    <button className={`btn ${kind}${block ? " block" : ""}`} disabled={!!busy || disabled} onClick={onClick}>
      {busy ? <Spinner /> : null}{label}
    </button>
  );
}

export function useNow() {
  const [now, setNow] = useState(() => BigInt(Math.floor(Date.now() / 1000)));
  useEffect(() => {
    const t = setInterval(() => setNow(BigInt(Math.floor(Date.now() / 1000))), 1000);
    return () => clearInterval(t);
  }, []);
  return now;
}
