/**
 * The Circle workspace. Every number is read from Solana Devnet: vault
 * balances, epochs, members, and prices from the devnet price feeds (DEVNET
 * TEST DATA). Every button sends a real transaction through the connected
 * wallet, built by the SDK's shared flow builders.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useWalletAccountTransactionSendingSigner } from "@solana/react";
import type { UiWalletAccount } from "@wallet-standard/react";
import { generateKeyPairSigner, type Address, type Instruction, type TransactionSendingSigner } from "@solana/kit";
import {
  AssetClass, EpochState, MandateState, MembershipPolicy, fetchMaybeEpoch, flows, getCancelEpochInstruction, pda,
  getClaimRedemptionAssetInstruction, getClaimRedemptionUsdcInstruction, getReserveRedemptionAssetInstruction,
  getReserveRedemptionUsdcInstruction, type MandateParamsInput,
} from "@tenet/sdk";
import { FRONTIER_TECHNOLOGY, faucetIxs } from "@tenet/sdk/devnet";
import { entitlementForRedemption, sharesForContribution } from "../../../packages/domain/src/accounting.ts";
import { valuePortfolio, type HoldingInput } from "../../../packages/domain/src/portfolio.ts";
import { CASH_TICKER, CHAIN, INSTRUMENTS, TOKEN_2022_PROGRAM, TOKEN_PROGRAM, TRANSACTIONS_ENABLED, USDC_DECIMALS, USDC_MINT } from "./config.ts";
import {
  ataAddress, createAtaIdempotent, loadActivity, loadDirectory, lineage, rpc, tokenBalance, withheldFee,
  type ActivityItem, type CircleView, type DirectoryEntry, type ExitView, type Holding,
} from "./chain.ts";
import { executionProvider, priceProvider } from "./adapters.ts";
import { formatRaw, formatShares, parseAmount } from "./money.ts";
import { ActionButton, trim, usdc, useNow, useRunner, type Run, type RunGroups } from "./runner.tsx";
import { AddressLink, Badge, Meter, Stepper, explorerTx, formatBps, formatSignedBps, ratioBps } from "./ui.tsx";

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

const isPre = (h: Holding) => h.registry.assetClass === AssetClass.PreIpo;
const hex = (b: ArrayLike<number>) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");

/** Everything the VALUE layer needs, from the loaded view. */
function portfolioOf(view: CircleView) {
  const m = view.mandate;
  const inputs: HoldingInput[] = view.holdings.map((h) => ({
    symbol: h.registry.symbol, assetClass: isPre(h) ? "preIpo" : "public", issuer: h.registry.issuer,
    underlying: hex(h.registry.underlyingId), decimals: h.registry.decimals,
    multiplierE18: h.registry.effectiveMultiplierE18 > 0n ? h.registry.effectiveMultiplierE18 : 1_000_000_000_000_000_000n,
    vaultRaw: h.vaultRaw, reservedRaw: h.asset.reservedForRedemptionRaw, mintSupplyRaw: h.mintSupplyRaw,
    targetBps: h.targetWeightBps, price: h.price?.price ?? null, mark: h.price?.mark ?? null, underlyingPrice: h.price?.underlyingPrice ?? null,
  }));
  return valuePortfolio(view.activeUsdcRaw - view.circle.usdcReservedRaw, inputs, {
    perAssetBps: m.maxWeightPerAssetBps, preIpoBps: m.maxPreIpoWeightBps, issuerBps: m.maxIssuerWeightBps,
    underlyingBps: m.maxUnderlyingWeightBps, supplyBps: m.maxSupplyConsumptionBps,
  });
}

// ================================================================ page

export type CirclePanel = "overview" | "portfolio" | "prices" | "contribute" | "exit" | "fork";

export function Dashboard({ panel, navigate, view, circle, account, me, usdcBalance, onChanged, onOpenCircle }: {
  panel: CirclePanel; navigate: (panel: CirclePanel | "mandate") => void;
  view: CircleView; circle: Address; account: UiWalletAccount | undefined; me: Address | null;
  usdcBalance: bigint | null; onChanged: () => Promise<void>; onOpenCircle: (circle: Address) => void;
}) {
  const connected = TRANSACTIONS_ENABLED && account && me;
  const heading = (eyebrow: string, title: string, body: string) =>
    <div className="screen-heading"><span className="eyebrow">{eyebrow}</span><h1>{title}</h1><p>{body}</p></div>;
  return (
    <div className="circle-screen">
      {panel === "overview" ? <>
        <DemoGuide view={view} me={me} usdcBalance={usdcBalance} navigate={navigate} />
        <Overview view={view} circle={circle} me={me} navigate={navigate} />
        <Lineage view={view} onOpenCircle={onOpenCircle} />
        <Activity circle={circle} view={view} />
      </> : null}
      {panel === "portfolio" ? <>
        {heading("EXECUTE", "Portfolio", "Real vault balances. Execute moves the Circle's TUSDC into its Mandate targets through the devnet market.")}
        <Holdings view={view} />
        {connected ? <ExecuteConnected view={view} circle={circle} account={account} onChanged={onChanged} /> : <ExecutePreview view={view} />}
      </> : null}
      {panel === "prices" ? <>
        {heading("VALUE", "Prices & value", "NAV, allocation against the Mandate, market vs mark and token vs underlying — from on-chain vaults × devnet test prices.")}
        <ValueSurface view={view} />
      </> : null}
      {panel === "contribute" || panel === "exit" || panel === "fork" ? <>
        {panel === "contribute" ? heading("POOL", "Add money together.", `Contributions wait in a separate ${CASH_TICKER} funding window. When it closes, everyone's shares are set together.`) : null}
        {panel === "exit" ? heading("EXIT", "Leave on your terms.", "Take your proportional slice of every asset, in kind. No vote, no price needed, nobody else is diluted.") : null}
        {panel === "fork" ? heading("FORK", "Make the rules your own.", "Copy this Mandate, change a rule, and start an independent Circle. Nothing here moves.") : null}
        {connected ? <Actions panel={panel} account={account} view={view} circle={circle} me={me} usdcBalance={usdcBalance} onChanged={onChanged} onOpenCircle={onOpenCircle} /> : <ConnectPrompt navigate={navigate} />}
      </> : null}
    </div>
  );
}

function ConnectPrompt({ navigate }: { navigate: (p: CirclePanel) => void }) {
  return <div className="card action-locked"><span className="eyebrow">Solana Devnet · test assets</span>
    <h2>{TRANSACTIONS_ENABLED ? "Connect your wallet to continue" : "Devnet is not set up for this build yet"}</h2>
    <p>{TRANSACTIONS_ENABLED ? "Use a Solana wallet switched to Devnet (Phantom, Solflare, Backpack). You'll need a little free Devnet SOL for fees; TUSDC comes from the faucet." : "The Tenet programs and test instruments have not been recorded for this build. Nothing can be sent."}</p>
    <div className="action-locked-buttons"><button className="btn ghost" type="button" onClick={() => navigate("overview")}>Back to overview</button></div></div>;
}

// ================================================================ demo guide

/** The whole product in seven steps, each ticked from real chain state. */
function DemoGuide({ view, me, usdcBalance, navigate }: {
  view: CircleView; me: Address | null; usdcBalance: bigint | null; navigate: (p: CirclePanel | "mandate") => void;
}) {
  const held = view.holdings.some((h) => h.vaultRaw > 0n);
  const priced = view.holdings.some((h) => h.price !== null);
  const steps: { n: string; title: string; body: string; done: boolean; go: CirclePanel }[] = [
    { n: "1", title: "Get test USDC", body: "Faucet: 1,000 TUSDC, signed by your wallet.", done: (usdcBalance ?? 0n) > 0n || (view.member?.shares ?? 0n) > 0n, go: "contribute" },
    { n: "2", title: "Contribute", body: "Your TUSDC waits in the epoch escrow.", done: view.receipt !== null || (view.member?.shares ?? 0n) > 0n, go: "contribute" },
    { n: "3", title: "Close & settle", body: "Window ends; everyone gets shares together.", done: (view.member?.shares ?? 0n) > 0n, go: "contribute" },
    { n: "4", title: "Execute", body: "Buy each asset up to its Mandate target.", done: held, go: "portfolio" },
    { n: "5", title: "Value", body: "NAV, weights, market vs mark.", done: held && priced, go: "prices" },
    { n: "6", title: "Exit", body: "Take 25%, 50% or 100% in kind.", done: view.exits.length > 0, go: "exit" },
    { n: "7", title: "Fork", body: "Change a rule, start a new Circle.", done: false, go: "fork" },
  ];
  const next = steps.find((s) => !s.done);
  return (
    <section className="card demo-guide">
      <div className="card-head">
        <div><span className="eyebrow">Guided demo · POOL → EXECUTE → VALUE → EXIT → FORK</span><h2>{next ? `Next: ${next.title}` : "You've run the whole flow"}</h2>
          <p className="card-intro">{me ? "Each step is a real Devnet transaction. Ticks come from chain state, not from this page." : "Connect a Devnet wallet to start."}</p></div>
        <Badge tone="warn">DEVNET · test assets</Badge>
      </div>
      <ol className="demo-steps">
        {steps.map((s) => (
          <li key={s.n} className={s.done ? "done" : s === next ? "now" : ""}>
            <button type="button" onClick={() => navigate(s.go)}>
              <span className="demo-n">{s.done ? "✓" : s.n}</span>
              <span><strong>{s.title}</strong><small>{s.body}</small></span>
            </button>
          </li>
        ))}
      </ol>
    </section>
  );
}

// ================================================================ overview

function Overview({ view, circle, me, navigate }: { view: CircleView; circle: Address; me: Address | null; navigate: (panel: CirclePanel | "mandate") => void }) {
  const member = view.member;
  const pv = useMemo(() => portfolioOf(view), [view]);
  const mine = member && pv.navRaw !== null && view.circle.totalShares > 0n ? (pv.navRaw * member.shares) / view.circle.totalShares : null;
  return <>
    <section className="overview-intro">
      <div><span className="eyebrow">Your shared portfolio · Devnet</span><h1>{view.mandate.name}</h1><p>{view.mandate.description || "A Circle governed by its on-chain Mandate."}</p></div>
      <div className="overview-actions"><button className="btn primary" type="button" onClick={() => navigate("contribute")}>Add money <span aria-hidden>→</span></button><button className="btn ghost" type="button" onClick={() => navigate("exit")}>Exit</button><button className="btn ghost" type="button" onClick={() => navigate("fork")}>Fork rules</button></div>
    </section>
    <div className="overview-metrics">
      <article className="overview-metric"><span>Circle value (NAV)</span><strong>{pv.navRaw === null ? "Price missing" : `${usdc(pv.navRaw)} ${CASH_TICKER}`}</strong><p>Vaults × devnet test prices. {usdc(pv.cashRaw)} {CASH_TICKER} is still cash.</p></article>
      <article className="overview-metric"><span>Your position</span><strong>{member && member.shares > 0n ? formatBps(ratioBps(member.shares, view.circle.totalShares)) : me ? "No shares yet" : "Connect wallet"}</strong><p>{mine !== null && member && member.shares > 0n ? `≈ ${usdc(mine)} ${CASH_TICKER} · ${trim(formatShares(member.shares))} shares` : "Shares arrive when your funding window settles."}</p></article>
      <article className="overview-metric"><span>Members</span><strong>{view.circle.memberCount.toString()}</strong><p>{view.holdings.length} permitted assets · epoch {view.circle.currentEpoch.toString()}</p><button type="button" onClick={() => navigate("mandate")}>View rules →</button></article>
    </div>
    <section className="overview-portfolio card"><div className="card-head"><div><span className="eyebrow">Portfolio</span><h2>What is actually in the Circle</h2></div><button className="text-action" type="button" onClick={() => navigate("portfolio")}>Open portfolio →</button></div>
      <div className="overview-holding"><span className="asset-icon usdc">T</span><div><strong>{CASH_TICKER}</strong><small>Circle cash vault · no monetary value</small></div><strong>{usdc(view.activeUsdcRaw)}</strong></div>
      {view.holdings.filter((h) => h.vaultRaw > 0n).map((h) => <div className="overview-holding" key={h.address}><span className="asset-icon">{h.registry.symbol.slice(0, 4)}</span><div><strong>{h.registry.displayName}</strong><small>{h.registry.symbol} · target {formatBps(BigInt(h.targetWeightBps))}</small></div><strong>{trim(formatRaw(h.vaultRaw, h.registry.decimals))}</strong></div>)}
      {!view.holdings.some((h) => h.vaultRaw > 0n) ? <div className="overview-empty">Nothing bought yet. After the first funding window settles, open Portfolio and press <strong>Execute epoch</strong>.</div> : null}
    </section>
    <details className="deep-disclosure"><summary>Mandate limits (planned targets vs caps)</summary><Rules view={view} /></details>
    <details className="deep-disclosure"><summary>On-chain addresses</summary><div className="preview"><div className="preview-row"><span className="k">Circle</span><AddressLink address={circle} /></div><div className="preview-row"><span className="k">Mandate</span><AddressLink address={view.mandateAddress} /></div></div></details>
  </>;
}

function Lineage({ view, onOpenCircle }: { view: CircleView; onOpenCircle: (c: Address) => void }) {
  const [dir, setDir] = useState<DirectoryEntry[] | null>(null);
  useEffect(() => {
    void (async () => {
      let d = await loadDirectory();
      // A just-forked Circle is newer than the cached directory: rescan once.
      if (!d.some((x) => x.mandateAddress === view.mandateAddress)) d = await loadDirectory(true);
      setDir(d);
    })().catch(() => setDir([]));
  }, [view.mandateAddress]);
  if (!dir) return null;
  const { ancestors, children } = lineage(dir, view.mandateAddress);
  if (!ancestors.length && !children.length) return null;
  const row = (d: DirectoryEntry, label: string) => <div className="preview-row" key={d.circle}><span className="k">{label}</span><span className="v"><button className="text-action" type="button" onClick={() => onOpenCircle(d.circle)}>{d.mandate.name} →</button> <small>pre-IPO cap {formatBps(BigInt(d.mandate.maxPreIpoWeightBps))}</small></span></div>;
  return <section className="card"><div className="card-head"><div><span className="eyebrow">Fork lineage</span><h2>Where these rules came from — and went</h2></div><Badge tone="pre">forked_from on-chain</Badge></div>
    <div className="preview">
      {ancestors.map((a) => row(a, "Parent"))}
      <div className="preview-row"><span className="k">This Circle</span><span className="v"><strong>{view.mandate.name}</strong> <small>pre-IPO cap {formatBps(BigInt(view.mandate.maxPreIpoWeightBps))}</small></span></div>
      {children.map((c) => row(c, "Fork"))}
    </div></section>;
}

function Activity({ circle, view }: { circle: Address; view: CircleView }) {
  const [items, setItems] = useState<ActivityItem[] | null>(null);
  useEffect(() => { void loadActivity(circle).then(setItems).catch(() => setItems([])); }, [circle, view]);
  return <section className="card"><div className="card-head"><div><span className="eyebrow">Activity</span><h2>Recent transactions on this Circle</h2><p className="card-intro">Straight from Solana; open any one in the explorer.</p></div></div>
    {items === null ? <p className="muted">Loading…</p> : items.length === 0 ? <p className="muted">No transactions yet.</p> : (
      <div className="preview">{items.slice(0, 12).map((i) => <div className="preview-row" key={i.signature}>
        <span className="k">{i.blockTime ? new Date(Number(i.blockTime) * 1000).toLocaleString() : `slot ${i.slot}`}</span>
        <span className="v"><a className="mono" href={explorerTx(i.signature)} target="_blank" rel="noreferrer">{i.signature.slice(0, 10)}… ↗</a> {i.ok ? null : <Badge tone="bad">failed</Badge>}</span>
      </div>)}</div>
    )}</section>;
}

// ================================================================ holdings

function Holdings({ view }: { view: CircleView }) {
  const { circle: c, member, mandate } = view;
  const mine = member?.shares ?? 0n;
  const usdcAvail = view.activeUsdcRaw - c.usdcReservedRaw;
  return (
    <section className="card" id="holdings">
      <div className="card-head">
        <div><span className="eyebrow">Vault balances</span><h2>Assets in the Circle</h2><p className="card-intro">Raw balances in the Circle's own on-chain vaults. Targets come from the Mandate.</p></div>
        <Badge tone="good">Live vault balances</Badge>
      </div>
      <table className="holdings">
        <thead><tr><th>Asset</th><th className="hide-sm">Target by rules</th><th className="r">In Circle</th><th className="r">Your portion</th></tr></thead>
        <tbody>
          <tr>
            <td><div className="asset"><div className="asset-icon usdc">T</div><div><div className="asset-name">{CASH_TICKER}</div><div className="asset-sub">cash · Tenet Devnet USDC, no monetary value</div></div></div></td>
            <td className="hide-sm muted">remainder</td>
            <td className="r">{usdc(view.activeUsdcRaw)}</td>
            <td className="r">{mine > 0n ? usdc(slice(usdcAvail, mine, c.totalShares)) : "—"}</td>
          </tr>
          {view.holdings.map((h) => <HoldingRow key={h.address} h={h} mine={mine} total={c.totalShares} capBps={BigInt(mandate.maxWeightPerAssetBps)} />)}
        </tbody>
      </table>
    </section>
  );
}

function HoldingRow({ h, mine, total, capBps }: { h: Holding; mine: bigint; total: bigint; capBps: bigint }) {
  const pre = isPre(h);
  const d = h.registry.decimals;
  const avail = h.vaultRaw - h.asset.reservedForRedemptionRaw;
  return (
    <tr>
      <td>
        <div className="asset">
          <div className="asset-icon">{h.registry.symbol.slice(0, 4)}</div>
          <div style={{ minWidth: 0 }}>
            <div className="asset-name">{h.registry.symbol} <Badge tone={pre ? "pre" : "info"}>{pre ? "Pre-IPO" : "Public"}</Badge> <Badge tone="warn">TEST</Badge></div>
            <div className="asset-sub">{h.registry.displayName}</div>
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

// ================================================================ execute

interface Plan { h: Holding; spend: bigint; target: bigint; held: bigint }

/** Spend 99% of each asset's headroom under its target share of the last settled NAV. */
function planExecution(view: CircleView, nav: bigint | null): Plan[] {
  if (nav === null) return [];
  const cash = view.activeUsdcRaw - view.circle.usdcReservedRaw;
  let left = cash;
  return view.holdings.map((h) => {
    const target = (nav * BigInt(h.targetWeightBps)) / 10_000n;
    const held = h.price ? ((h.vaultRaw - h.asset.reservedForRedemptionRaw) * h.price.price) / 10n ** BigInt(h.registry.decimals) : 0n;
    let spend = target > held ? ((target - held) * 99n) / 100n : 0n;
    if (spend > left) spend = left;
    // Skip dust: within 3% of target (the 1% safety margin plus the venue
    // spread leave ~1.3% unspent by design) counts as "at target".
    if (!h.price || spend < 10_000n || spend * 100n < target * 3n) spend = 0n;
    left -= spend;
    return { h, spend, target, held };
  });
}

function useSettledNav(view: CircleView, circle: Address) {
  const [nav, setNav] = useState<bigint | null>(null);
  useEffect(() => {
    if (view.circle.currentEpoch === 0n) { setNav(null); return; }
    let live = true;
    void pda.epoch(circle, view.circle.currentEpoch - 1n)
      .then(([e]) => fetchMaybeEpoch(rpc, e))
      .then((e) => { if (live) setNav(e.exists ? e.data.navBefore + e.data.pendingUsdcRaw : null); })
      .catch(() => { if (live) setNav(null); });
    return () => { live = false; };
  }, [view, circle]);
  return nav;
}

function ExecutePreview({ view }: { view: CircleView }) {
  return <section className="card"><div className="card-head"><div><span className="eyebrow">Execute epoch</span><h2>Invest the Circle's cash</h2><p className="card-intro">Connect a Devnet wallet to execute. Any wallet may execute: the program — not the executor — enforces targets, price impact and supply limits.</p></div></div>
    <p className="muted">{view.holdings.length} assets · cash {usdc(view.activeUsdcRaw - view.circle.usdcReservedRaw)} {CASH_TICKER}</p></section>;
}

function ExecuteConnected({ view, circle, account, onChanged }: { view: CircleView; circle: Address; account: UiWalletAccount; onChanged: () => Promise<void> }) {
  const signer = useWalletAccountTransactionSendingSigner(account, CHAIN);
  const { busy, runGroups } = useRunner(signer, onChanged);
  const nav = useSettledNav(view, circle);
  const plan = planExecution(view, nav);
  const todo = plan.filter((p) => p.spend > 0n);
  const blocked = view.circle.currentEpoch === 0n ? "Settle the first funding window before executing." :
    view.circle.executionFrozen ? "A valuation snapshot is in progress; execution resumes when it completes." :
    view.circle.pendingReservations > 0 ? "An exit is being prepared; finish it first (Exit page)." : null;
  const executeIxs = async (p: Plan): Promise<Instruction[]> => {
    const i = p.h;
    const q = await executionProvider.quote({ mint: i.asset.mint, decimals: i.registry.decimals, amountInRaw: p.spend, price: i.price!.price });
    const venue = await executionProvider.venue({ executor: signer, circle, mint: i.asset.mint, tokenProgram: i.asset.tokenProgram, amountInRaw: p.spend, minOutRaw: q.outRaw });
    // The vault receives the venue's output net of any Token-2022 transfer fee.
    const fee = await withheldFee(i.asset.mint, q.outRaw);
    const minOut = q.outRaw - (fee?.fee ?? 0n);
    return flows.execute({
      executor: signer, circle, mandate: view.mandateAddress, usdcMint: view.usdcMint, epochIndex: view.circle.currentEpoch - 1n,
      asset: { mint: i.asset.mint, tokenProgram: i.asset.tokenProgram }, priceAccount: i.price!.account,
      nonce: BigInt(Date.now()) * 100n + BigInt(i.asset.index), maxIn: p.spend, minOut,
      expiresAt: BigInt(Math.floor(Date.now() / 1000) + 300), venue,
    });
  };
  return (
    <section className="card" id="execute">
      <div className="card-head">
        <div><span className="eyebrow">Execute epoch · {executionProvider.name}</span><h2>Invest the Circle's cash to its Mandate targets</h2>
          <p className="card-intro">Each buy is one transaction: <code>begin_execution → market buy → end_execution</code>. The program checks the real vault deltas, the price-impact limit, supply consumption and the post-trade target weight — or reverts everything.</p></div>
        <Badge tone="warn">DEVNET TEST VENUE</Badge>
      </div>
      <div className="preview">
        <div className="preview-row"><span className="k">Settled NAV (last epoch)</span><span className="v">{nav === null ? "—" : `${usdc(nav)} ${CASH_TICKER}`}</span></div>
        {plan.map((p) => <div className="preview-row" key={p.h.address}>
          <span className="k">{p.h.registry.symbol} · target {formatBps(BigInt(p.h.targetWeightBps))}</span>
          <span className="v">{p.spend > 0n ? `buy ${usdc(p.spend)} ${CASH_TICKER}` : p.h.price ? "at target" : "no price"}{" "}
            {p.spend > 0n ? <button className="btn small ghost" type="button" disabled={!!busy || !!blocked} onClick={() => { void runGroups(`Buy ${p.h.registry.symbol}`, async () => [await executeIxs(p)]); }}>Buy</button> : null}
          </span>
        </div>)}
      </div>
      {blocked ? <p className="muted">{blocked}</p> : null}
      <ActionButton busy={busy} disabled={!!blocked || todo.length === 0} label={todo.length ? `Execute epoch · ${todo.length} buys` : "Everything is at target"}
        onClick={() => { void runGroups("Execute epoch", async () => Promise.all(todo.map(executeIxs))); }} />
    </section>
  );
}

// ================================================================ value

function ValueSurface({ view }: { view: CircleView }) {
  const pv = useMemo(() => portfolioOf(view), [view]);
  const now = BigInt(Math.floor(Date.now() / 1000));
  return (
    <section className="card value-card" id="value">
      <div className="card-head">
        <div><span className="eyebrow">Value · {priceProvider.name}</span><h2>Circle NAV {pv.navRaw === null ? "unavailable" : `${usdc(pv.navRaw)} ${CASH_TICKER}`}</h2>
          <p className="card-intro">{priceProvider.label}. Values use the same integer formula as the program's on-chain NAV snapshot.</p></div>
        <Badge tone="warn">DEVNET TEST DATA</Badge>
      </div>
      <table className="holdings">
        <thead><tr><th>Asset</th><th className="r">Price</th><th className="r">Value</th><th className="r">Weight / target</th><th className="r hide-sm">Supply held</th></tr></thead>
        <tbody>
          <tr><td>{CASH_TICKER}</td><td className="r">1.00</td><td className="r">{usdc(pv.cashRaw)}</td><td className="r">{pv.navRaw ? formatBps(ratioBps(pv.cashRaw, pv.navRaw)) : "—"}</td><td className="hide-sm" /></tr>
          {view.holdings.map((h, i) => {
            const v = pv.holdings[i]!;
            const age = h.price ? now - h.price.publishTime : null;
            return <tr key={h.address}>
              <td><strong>{h.registry.symbol}</strong>{isPre(h) ? <> <Badge tone="pre">Pre-IPO</Badge></> : null}
                {v.marketVsMarkBps !== null ? <div className={`asset-sub ${v.marketVsMarkBps < 0n ? "discount" : "premium"}`}>Market vs mark {formatSignedBps(v.marketVsMarkBps)} · mark {usdc(h.price!.mark!)}</div> : null}
                {v.tokenVsUnderlyingBps !== null ? <div className={`asset-sub ${v.tokenVsUnderlyingBps < 0n ? "discount" : "premium"}`}>Token vs underlying {formatSignedBps(v.tokenVsUnderlyingBps)} · underlying {usdc(h.price!.underlyingPrice!)}</div> : null}
                <div className="asset-sub">{age !== null ? `price published ${age < 120n ? `${age}s` : age < 7200n ? `${age / 60n} min` : `${age / 3600n} h`} ago` : "no price"}</div></td>
              <td className="r">{h.price ? usdc(h.price.price) : "—"}</td>
              <td className="r">{v.valueRaw === null ? "—" : usdc(v.valueRaw)}</td>
              <td className="r">{v.weightBps === null ? "—" : formatBps(v.weightBps)} / {formatBps(BigInt(h.targetWeightBps))}{v.driftBps !== null && v.driftBps !== 0n ? <div className={`asset-sub ${v.driftBps > 0n ? "premium" : "discount"}`}>{formatSignedBps(v.driftBps)} drift</div> : null}</td>
              <td className="r hide-sm">{v.supplyBps === null ? "—" : formatBps(v.supplyBps)}</td>
            </tr>;
          })}
        </tbody>
      </table>
      <h3 style={{ marginTop: 20 }}>Mandate compliance (actual weights)</h3>
      {pv.compliance === null ? <p className="muted">Compliance needs a price for every held asset.</p> : (
        <div className="rules">{pv.compliance.map((r) => <div key={r.rule}>
          <div className="rule-label"><span>{r.label}</span><strong className={r.ok ? undefined : "rule-at-cap"}>{formatBps(r.usedBps)} / {formatBps(r.capBps)} {r.ok ? "✓" : "over"}</strong></div>
          <Meter bps={r.usedBps} capBps={r.capBps} tone={r.ok ? undefined : "cap"} />
        </div>)}</div>
      )}
      <p className="honest value-note"><span>ⓘ</span><span>Price moves can push an asset above its target; the program then refuses further buys of it. Exits are in kind and never need a price.</span></p>
    </section>
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
  const rows = [
    { label: "One asset", used: hs.reduce((a, h) => (BigInt(h.targetWeightBps) > a ? BigInt(h.targetWeightBps) : a), 0n), cap: BigInt(m.maxWeightPerAssetBps) },
    { label: "Pre-IPO exposure", used: hs.filter(isPre).reduce((a, h) => a + BigInt(h.targetWeightBps), 0n), cap: BigInt(m.maxPreIpoWeightBps), pre: true },
    { label: "One issuer", used: sumBy((h) => h.registry.issuer), cap: BigInt(m.maxIssuerWeightBps) },
    { label: "One company", used: sumBy((h) => hex(h.registry.underlyingId)), cap: BigInt(m.maxUnderlyingWeightBps) },
  ];
  return (
    <section className="card" id="rules">
      <div className="rules">
        {rows.map((r) => (
          <div key={r.label}>
            <div className="rule-label"><span>{r.label}</span><strong>{formatBps(r.used)} / {formatBps(r.cap)}</strong></div>
            <Meter bps={r.used} capBps={r.cap} tone={r.pre ? "pre" : undefined} />
          </div>
        ))}
      </div>
      <div className="hero-meta" style={{ marginTop: 16 }}>
        <Badge>minimum {usdc(m.minContributionUsdc)} {CASH_TICKER}</Badge>
        <Badge>{formatDuration(m.epochDuration)} funding window</Badge>
        <Badge>max price impact {formatBps(BigInt(m.maxPriceImpactBps))}</Badge>
        <Badge>max supply held {formatBps(BigInt(m.maxSupplyConsumptionBps))}</Badge>
      </div>
    </section>
  );
}

// ================================================================ actions

function Actions({ panel, account, view, circle, me, usdcBalance, onChanged, onOpenCircle }: {
  panel: "contribute" | "exit" | "fork";
  account: UiWalletAccount; view: CircleView; circle: Address; me: Address;
  usdcBalance: bigint | null; onChanged: () => Promise<void>; onOpenCircle: (circle: Address) => void;
}) {
  const signer = useWalletAccountTransactionSendingSigner(account, CHAIN);
  const { busy, run, runGroups } = useRunner(signer, onChanged);
  return (
    <>
      {panel === "contribute" ? <><Faucet signer={signer} balance={usdcBalance} run={run} busy={busy} /><EpochCard view={view} circle={circle} me={me} signer={signer} usdcBalance={usdcBalance} runGroups={runGroups} busy={busy} /></> : null}
      {panel === "exit" ? <ExitCard view={view} circle={circle} me={me} signer={signer} runGroups={runGroups} busy={busy} /> : null}
      {panel === "fork" ? <ForkCard view={view} signer={signer} runGroups={runGroups} busy={busy} onOpenCircle={onOpenCircle} /> : null}
    </>
  );
}

export function Faucet({ signer, balance, run, busy }: { signer: TransactionSendingSigner; balance: bigint | null; run: Run; busy: string | null }) {
  const [sol, setSol] = useState<bigint | null>(null);
  useEffect(() => {
    let live = true;
    void rpc.getBalance(signer.address).send().then(({ value }) => { if (live) setSol(value); }).catch(() => {});
    return () => { live = false; };
  }, [signer.address, balance]);
  const lowSol = sol !== null && sol < 50_000_000n;
  return <aside className="devnet-test-faucet" aria-label="Devnet test USDC faucet">
    <div>
      <span className="eyebrow">Devnet only · no monetary value</span>
      <strong>Get test USDC</strong>
      <p>TUSDC is "Tenet Devnet USDC": minted by an on-chain faucet you sign for yourself. 1,000 per claim, one claim a minute. It is not a stablecoin and cannot be redeemed.</p>
      <small>Your balance: {balance === null ? "0" : usdc(balance)} TUSDC · {sol === null ? "…" : trim(formatRaw(sol, 9))} Devnet SOL</small>
      {lowSol ? <small className="error-text">You need a little free Devnet SOL for network fees (≈0.1 SOL is plenty). Get it at <a href="https://faucet.solana.com" target="_blank" rel="noreferrer">faucet.solana.com</a>, then come back.</small> : null}
    </div>
    <ActionButton block={false} busy={busy} label="Get 1,000 TUSDC" onClick={() => { void run("Get test USDC", () => faucetIxs(signer)); }} />
  </aside>;
}

// ================================================================ epoch

const STEP_OF: Record<number, number> = {
  [EpochState.Open]: 0, [EpochState.Closed]: 1, [EpochState.Finalized]: 2,
  [EpochState.Executing]: 2, [EpochState.Completed]: 3, [EpochState.Cancelled]: 1,
};

function EpochCard({ view, circle, signer, usdcBalance, runGroups, busy }: {
  view: CircleView; circle: Address; me: Address; signer: TransactionSendingSigner;
  usdcBalance: bigint | null; runGroups: RunGroups; busy: string | null;
}) {
  const now = useNow();
  const [amount, setAmount] = useState("100");
  const { circle: c, epoch, receipt, mandate, usdcMint } = view;
  const index = c.currentEpoch;
  const base = { payer: signer, circle };

  let parsed: bigint | null = null;
  let parseError: string | null = null;
  try { parsed = parseAmount(amount || "0", USDC_DECIMALS); } catch (e) { parseError = (e as Error).message; }
  const minOk = parsed !== null && parsed >= mandate.minContributionUsdc;
  const balOk = parsed !== null && usdcBalance !== null && parsed <= usdcBalance;

  const e = epoch?.data ?? null;
  const open = e?.state === EpochState.Open;
  const remaining = e ? e.closesAt - now : 0n;
  const canContribute = !e || (open && remaining > 0n);
  const span = e ? e.closesAt - e.openedAt : 0n;
  const unsettled = view.receipts.filter((r) => !r.data.settled).map((r) => r.data.owner);

  /**
   * Close → set shares (at on-chain NAV once the Circle holds assets) →
   * issue shares → complete, in as few transactions (wallet approvals) as
   * fit: a NAV snapshot must be finalized within ~150 slots (~60 s).
   */
  const finish = async () => {
    const groups: Instruction[][] = [];
    const close = open ? await flows.closeContributions({ ...base, index }) : [];
    if (e && (e.state === EpochState.Open || e.state === EpochState.Closed)) {
      if (view.navSnapshot) {
        groups.push(...await flows.finishRollingValuation({
          ...base, mandate: c.mandate, usdcMint, index, recordedBitmap: view.navSnapshot.data.recordedBitmap,
          assets: rollingAssets(view).map((a, i) => ({ ...a, index: view.holdings[i]!.asset.index })),
        }));
      } else {
        const valuation = c.totalShares === 0n
          ? [await flows.finalizeEpochZero({ ...base, usdcMint, index })]
          : await flows.finalizeRollingEpoch({ ...base, mandate: c.mandate, usdcMint, index, assets: rollingAssets(view) });
        groups.push([...close, ...valuation[0]!], ...valuation.slice(1));
      }
    } else if (close.length) groups.push(close);
    const owners = e?.state === EpochState.Finalized ? unsettled : view.receipts.map((r) => r.data.owner);
    const settle = owners.length ? await flows.settle({ ...base, index, owners }) : [];
    const complete = await flows.closeEpoch({ ...base, index });
    if (settle.length) settle[settle.length - 1]!.push(...complete); else settle.push(complete);
    groups.push(...settle);
    return groups;
  };
  const cancelStalled = async () => [[getCancelEpochInstruction({
    payer: signer, circle, epoch: epoch!.address, navSnapshot: view.navSnapshot?.address,
  })]];
  const empty = e !== null && e.receiptCount === 0 && e.state !== EpochState.Finalized;

  return (
    <section className="card">
      <div className="card-head">
        <div><span className="eyebrow">Funding window {index.toString()}</span><h2>Contribute to this Circle</h2>
          <p className="card-intro">{e ? "Money waits in escrow — refundable — until the window closes. Then shares are set for everyone at once." : `The window opens with the first contribution and stays open ${formatDuration(mandate.epochDuration)} so others can join.`}</p></div>
        <Badge tone="info">{e ? ["Open", "Closed", "Shares ready", "Executing", "Complete", "Cancelled"][e.state] : "Ready"}</Badge>
      </div>
      {e ? <Stepper steps={["Taking contributions", "Window closed", "Shares ready", "Complete"]} current={STEP_OF[e.state] ?? 0} /> : null}
      {open ? <div className="countdown"><div className="countdown-top"><span>{remaining > 0n ? "Window closes in" : "Window has ended"}</span><strong className="num">{remaining > 0n ? `${remaining}s` : "—"}</strong></div><Meter bps={span > 0n ? ratioBps(span - (remaining > 0n ? remaining : 0n), span) : 10_000n} /></div> : null}

      {e ? <div className="preview" style={{ marginTop: 0, marginBottom: 14 }}>
        <div className="preview-row"><span className="k">Waiting in escrow</span><span className="v">{usdc(e.pendingUsdcRaw)} {CASH_TICKER}</span></div>
        <div className="preview-row"><span className="k">Contributors</span><span className="v">{e.receiptCount}</span></div>
        {receipt ? <div className="preview-row"><span className="k">Your contribution</span><span className="v">{usdc(receipt.amountUsdcRaw)} {CASH_TICKER}{receipt.settled ? " · shares issued" : " · contribution pending"}</span></div> : null}
      </div> : null}

      {canContribute ? <>
        <div className="field">
          <div className="field-label"><span>Amount</span><span>Balance: {usdcBalance === null ? "0" : usdc(usdcBalance)} TUSDC</span></div>
          <div className="input-wrap"><input inputMode="decimal" value={amount} onChange={(ev) => setAmount(ev.target.value)} aria-label="amount in TUSDC" /><span className="suffix">TUSDC</span></div>
          <div className="chips">{["50", "100", "250", "500"].map((v) => <button key={v} className="chip" onClick={() => setAmount(v)}>{v}</button>)}</div>
        </div>
        {parseError ? <div className="error-text">{parseError}</div> : null}
        {parsed !== null && !minOk ? <div className="error-text">Minimum is {usdc(mandate.minContributionUsdc)} TUSDC.</div> : null}
        {parsed !== null && usdcBalance !== null && !balOk ? <div className="error-text">More than your balance — use Get test USDC above.</div> : null}
        <ActionButton busy={busy} disabled={!minOk || !balOk} label={`Contribute ${amount} TUSDC`} onClick={() => { void runGroups(`Contribute ${amount} TUSDC`, async () => [[
          ...(e ? [] : await flows.openEpoch({ ...base, mandate: c.mandate, usdcMint, index })),
          ...await flows.contribute({ contributor: signer, circle, mandate: c.mandate, usdcMint, index, amount: parseAmount(amount, USDC_DECIMALS) }),
        ]]); }} />
        {receipt && !receipt.settled && open ? <ActionButton kind="ghost" busy={busy} label="Cancel & refund my contribution" onClick={() => { void runGroups("Cancel contribution", async () => [await flows.cancelContribution({ contributor: signer, circle, usdcMint, index })]); }} /> : null}
      </> : null}

      {e && !canContribute && e.state !== EpochState.Cancelled ? (
        c.pendingReservations > 0 ? <p className="muted">An exit is being prepared. Finish it on the Exit page, then come back.</p> :
        view.navSnapshot && e.state === EpochState.Closed ? <>
          <p className="muted">A valuation of the Circle was started but not finished ({view.navSnapshot.data.assetsRemaining} asset{view.navSnapshot.data.assetsRemaining === 1 ? "" : "s"} left). Finish it now; if it has timed out (about a minute), cancel it so contributors can take their money back.</p>
          <ActionButton busy={busy} label="Finish valuation & issue shares" onClick={() => { void runGroups("Finish valuation & issue shares", finish); }} />
          <ActionButton kind="ghost" busy={busy} label="Cancel timed-out valuation" onClick={() => { void runGroups("Cancel timed-out valuation", cancelStalled); }} />
        </> :
        <>
          {e.state === EpochState.Finalized && receipt && !receipt.settled ? <p className="muted">You will receive {trim(formatShares(sharesForContribution(receipt.amountUsdcRaw, e.totalSharesBefore, e.navBefore)))} shares{e.totalSharesBefore > 0n ? ` at NAV ${usdc(e.navBefore)} ${CASH_TICKER}` : ""}.</p> : null}
          {empty ? <p className="muted">Nobody contributed in this window. Restart it to take contributions again.</p> : null}
          <ActionButton busy={busy} label={empty ? "Restart funding window" : c.totalShares === 0n ? "Close window & issue shares" : "Value the Circle on-chain & issue shares"} onClick={() => { void runGroups(empty ? "Restart funding window" : c.totalShares === 0n ? "Close window & issue shares" : "Value the Circle on-chain & issue shares", finish); }} />
          {empty ? null : <p className="muted">One click runs every step: close the window, set the share price{c.totalShares > 0n ? " from the on-chain NAV" : ""}, issue shares to all {e.receiptCount} contributor{e.receiptCount === 1 ? "" : "s"}, and complete the window.</p>}
        </>
      ) : null}

      {e?.state === EpochState.Cancelled ? <>
        <p className="muted">This funding window was cancelled because its valuation timed out. Every contributor can take their money back. Holdings, execution and exits are unaffected.</p>
        {receipt && !receipt.settled ? <ActionButton busy={busy} label={`Refund my ${usdc(receipt.amountUsdcRaw)} TUSDC`} onClick={() => { void runGroups("Refund contribution", async () => [await flows.cancelContribution({ contributor: signer, circle, usdcMint, index })]); }} /> : null}
      </> : null}
    </section>
  );
}

function rollingAssets(view: CircleView) {
  return view.holdings.map((h) => {
    if (!h.price) throw new Error(`${h.registry.symbol} has no price feed; the NAV cannot be computed.`);
    return { mint: h.asset.mint, tokenProgram: h.asset.tokenProgram, priceAccount: h.price.account };
  });
}

// ================================================================ create / fork forms

interface RuleDraft { name: string; preIpoPct: string; perAssetPct: string; minutes: string; targets: Record<string, string> }

function paramsFrom(d: RuleDraft, description: string): MandateParamsInput {
  const bps = (s: string) => toBps(s) ?? 0; // validated by checkDraft first
  return {
    name: d.name.trim(), description,
    maxWeightPerAssetBps: bps(d.perAssetPct), maxPreIpoWeightBps: bps(d.preIpoPct),
    maxIssuerWeightBps: bps(d.perAssetPct), maxUnderlyingWeightBps: bps(d.perAssetPct),
    maxSupplyConsumptionBps: FRONTIER_TECHNOLOGY.maxSupplyConsumptionBps, maxPriceImpactBps: FRONTIER_TECHNOLOGY.maxPriceImpactBps,
    minContributionUsdc: 10_000_000n, maxPoolSizeUsdc: 1_000_000_000_000n,
    epochDuration: BigInt(Math.max(60, Math.round(Number(d.minutes) * 60))),
    membershipPolicy: MembershipPolicy.Open, amendmentThresholdBps: 6_667, amendmentDelaySeconds: 86_400n,
  };
}

/** Live validation mirroring finalize_mandate, so the button only enables when the chain will accept. */
const utf8Len = (s: string) => new TextEncoder().encode(s).length;
/** Trim to at most `max` UTF-8 bytes without splitting a character. */
function trimBytes(s: string, max: number): string {
  let out = "";
  for (const ch of s) { if (utf8Len(out + ch) > max) break; out += ch; }
  return out;
}
/** "12.5" -> 1250 bps; null unless 0–100 with at most two decimals (whole bps). */
function toBps(s: string): number | null {
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(s.trim())) return null;
  const bps = Math.round(Number(s) * 100);
  return bps <= 10_000 ? bps : null;
}

/** Live validation mirroring create_mandate / finalize_mandate, so the button only enables when the chain will accept. */
function checkDraft(d: RuleDraft, isPreIpo: (sym: string) => boolean): string[] {
  const problems: string[] = [];
  const name = d.name.trim();
  if (!name) problems.push("Give the Mandate a name.");
  else if (utf8Len(name) > 48) problems.push("Name is too long (48 bytes max).");
  const pre = toBps(d.preIpoPct);
  const per = toBps(d.perAssetPct);
  if (pre === null) problems.push("Pre-IPO cap must be a percentage from 0 to 100.");
  if (per === null) problems.push("Per-asset cap must be a percentage from 0 to 100.");
  const minutes = Number(d.minutes);
  if (!/^\d+(\.\d+)?$/.test(d.minutes.trim()) || minutes < 1 || minutes > 129_600) problems.push("Funding window must be between 1 minute and 90 days.");
  const t: [string, number][] = [];
  for (const [s, v] of Object.entries(d.targets)) {
    const bps = toBps(v || "0");
    if (bps === null) problems.push(`${s} target must be a percentage from 0 to 100.`);
    else if (bps > 0) t.push([s, bps]);
  }
  if (!t.length) problems.push("Give at least one asset a target above 0%.");
  const sum = t.reduce((a, [, v]) => a + v, 0);
  if (sum > 10_000) problems.push(`Targets add up to ${formatBps(BigInt(sum))} (max 100%).`);
  if (per !== null) for (const [s, v] of t) if (v > per) problems.push(`${s} ${formatBps(BigInt(v))} is above the ${formatBps(BigInt(per))} per-asset cap.`);
  const preSum = t.filter(([s]) => isPreIpo(s)).reduce((a, [, v]) => a + v, 0);
  if (pre !== null && preSum > pre) problems.push(`Pre-IPO targets total ${formatBps(BigInt(preSum))}, above the ${formatBps(BigInt(pre))} pre-IPO cap.`);
  return problems;
}

function RuleEditor({ draft, setDraft, symbols, isPreIpo }: { draft: RuleDraft; setDraft: (d: RuleDraft) => void; symbols: string[]; isPreIpo: (s: string) => boolean }) {
  const set = (k: keyof RuleDraft, v: string) => setDraft({ ...draft, [k]: v });
  return <div className="rule-editor">
    <label className="field"><span>Mandate name</span><input value={draft.name} onChange={(e) => set("name", e.target.value)} maxLength={48} /></label>
    <div className="rule-editor-row">
      <label className="field"><span>Pre-IPO cap %</span><input inputMode="decimal" value={draft.preIpoPct} onChange={(e) => set("preIpoPct", e.target.value)} /></label>
      <label className="field"><span>Per-asset cap %</span><input inputMode="decimal" value={draft.perAssetPct} onChange={(e) => set("perAssetPct", e.target.value)} /></label>
      <label className="field"><span>Funding window (min)</span><input inputMode="decimal" value={draft.minutes} onChange={(e) => set("minutes", e.target.value)} /></label>
    </div>
    <div className="preview">{symbols.map((s) => <div className="preview-row" key={s}>
      <span className="k">{s} {isPreIpo(s) ? <Badge tone="pre">Pre-IPO</Badge> : null}</span>
      <span className="v"><input className="target-input" inputMode="decimal" value={draft.targets[s] ?? "0"} onChange={(e) => setDraft({ ...draft, targets: { ...draft.targets, [s]: e.target.value } })} aria-label={`${s} target %`} /> %</span>
    </div>)}</div>
  </div>;
}

const preIpoSymbols = new Set(["TSPACEX", "TOPENAI", "TANTHROPIC"]);

/** No Circle open yet: faucet + one-click "Frontier Technology" (editable). */
export function FirstCircleSetup({ account, onOpenCircle }: { account: UiWalletAccount | undefined; onOpenCircle: (c: Address) => void }) {
  if (!account || !TRANSACTIONS_ENABLED) {
    return <section className="card first-circle-setup"><span className="eyebrow">Solana Devnet · test assets</span><h1>Start a Circle</h1>
      <p>{TRANSACTIONS_ENABLED ? "Connect a Devnet wallet (top right) to get test USDC and create your first Circle." : "Devnet is not set up for this build yet."}</p>
      <p className="muted">Or pick an existing Circle on the Explore page.</p></section>;
  }
  return <FirstCircleConnected account={account} onOpenCircle={onOpenCircle} />;
}

function FirstCircleConnected({ account, onOpenCircle }: { account: UiWalletAccount; onOpenCircle: (c: Address) => void }) {
  const signer = useWalletAccountTransactionSendingSigner(account, CHAIN);
  const [balance, setBalance] = useState<bigint | null>(null);
  const refresh = useCallback(async () => {
    if (!USDC_MINT) return;
    setBalance(await tokenBalance(await ataAddress(signer.address, USDC_MINT, TOKEN_PROGRAM)));
  }, [signer.address]);
  useEffect(() => { void refresh(); }, [refresh]);
  const { busy, run, runGroups } = useRunner(signer, refresh);
  const [draft, setDraft] = useState<RuleDraft>({
    name: FRONTIER_TECHNOLOGY.name, preIpoPct: "30", perAssetPct: "30", minutes: "3",
    targets: Object.fromEntries(INSTRUMENTS.map((i) => [i.symbol, String((FRONTIER_TECHNOLOGY.targets.find(([s]) => s === i.symbol)?.[1] ?? 0) / 100)])),
  });
  const problems = checkDraft(draft, (s) => preIpoSymbols.has(s));
  const create = async () => {
    let circle: Address | null = null;
    const ok = await runGroups("Create Mandate & Circle", async () => {
      const chosen = INSTRUMENTS.filter((i) => (toBps(draft.targets[i.symbol] ?? "0") ?? 0) > 0);
      const out = await flows.createMandateAndCircle({
        author: signer, mandateSeed: (await generateKeyPairSigner()).address, usdcMint: USDC_MINT!, openFirstEpoch: false,
        params: paramsFrom(draft, FRONTIER_TECHNOLOGY.description),
        assets: chosen.map((i) => ({ mint: i.mint as Address, tokenProgram: i.tokenProgram as Address, targetWeightBps: toBps(draft.targets[i.symbol] ?? "0") ?? 0 })),
      });
      circle = out.circle;
      return out.groups;
    });
    if (ok && circle) onOpenCircle(circle);
  };
  return <section className="card first-circle-setup">
    <div className="card-head"><div><span className="eyebrow">Step 1 of the demo</span><h1>Create your Circle</h1><p className="card-intro">A Mandate (the rules) plus a Circle (the shared vaults), with its first funding window open. Takes a few wallet approvals.</p></div><Badge tone="warn">DEVNET TEST INSTRUMENTS</Badge></div>
    <Faucet signer={signer} balance={balance} run={run} busy={busy} />
    <RuleEditor draft={draft} setDraft={setDraft} symbols={INSTRUMENTS.map((i) => i.symbol)} isPreIpo={(s) => preIpoSymbols.has(s)} />
    {problems.map((p) => <div className="error-text" key={p}>{p}</div>)}
    <ActionButton busy={busy} disabled={problems.length > 0} label="Create Mandate & Circle" onClick={() => { void create(); }} />
    <p className="muted">Test instruments (TNVDA, TAAPL, TSPY, TSPACEX, TOPENAI, TANTHROPIC) are DEVNET TEST INSTRUMENTS — not real stocks or securities.</p>
  </section>;
}

function ForkCard({ view, signer, runGroups, busy, onOpenCircle }: {
  view: CircleView; signer: TransactionSendingSigner; runGroups: RunGroups; busy: string | null; onOpenCircle: (c: Address) => void;
}) {
  const m = view.mandate;
  const pct = (bps: number) => String(bps / 100);
  const [draft, setDraft] = useState<RuleDraft>(() => ({
    name: trimBytes(`${m.name} — Fork`, 48),
    preIpoPct: pct(Math.floor(m.maxPreIpoWeightBps / 2)), perAssetPct: pct(m.maxWeightPerAssetBps),
    minutes: String(Number(m.epochDuration) / 60),
    targets: Object.fromEntries(view.holdings.map((h) => [h.registry.symbol, pct(isPre(h) ? Math.floor(h.targetWeightBps / 2) : h.targetWeightBps)])),
  }));
  const bySymbol = new Map(view.holdings.map((h) => [h.registry.symbol, h]));
  const problems = checkDraft(draft, (s) => bySymbol.get(s) ? isPre(bySymbol.get(s)!) : false);
  const changed = [
    draft.preIpoPct !== pct(m.maxPreIpoWeightBps) ? `pre-IPO cap ${formatBps(BigInt(m.maxPreIpoWeightBps))} → ${draft.preIpoPct}%` : null,
    draft.perAssetPct !== pct(m.maxWeightPerAssetBps) ? `per-asset cap → ${draft.perAssetPct}%` : null,
  ].filter(Boolean);
  const fork = async () => {
    let circle: Address | null = null;
    const ok = await runGroups("Fork Mandate & create Circle", async () => {
      const out = await flows.forkMandateAndCircle({
        forker: signer, parentMandate: view.mandateAddress, newMandateSeed: (await generateKeyPairSigner()).address,
        params: paramsFrom(draft, `Fork of ${m.name}. DEVNET TEST.`), usdcMint: view.usdcMint, openFirstEpoch: false,
        // Fork copies assets in the parent's order, one by one.
        assets: view.holdings.map((h) => ({ mint: h.asset.mint, tokenProgram: h.asset.tokenProgram, targetWeightBps: toBps(draft.targets[h.registry.symbol] ?? "0") ?? 0 })),
      });
      circle = out.circle;
      return out.groups;
    });
    if (ok && circle) onOpenCircle(circle);
  };
  return (
    <section className="card" id="fork">
      <div className="card-head"><div><span className="eyebrow">Fork · change the rules</span><h2>Start a new Circle from these rules</h2><p className="card-intro">The fork records <code>forked_from</code> = this Mandate. It gets its own empty vaults and members; this Circle's money never moves.</p></div><Badge tone="pre">Money stays here</Badge></div>
      <RuleEditor draft={draft} setDraft={setDraft} symbols={view.holdings.map((h) => h.registry.symbol)} isPreIpo={(s) => bySymbol.get(s) ? isPre(bySymbol.get(s)!) : false} />
      {changed.length ? <p className="muted">Changing: {changed.join(", ")}.</p> : <p className="muted">Tip for the demo: lower the pre-IPO cap (e.g. 30% → 15%) and the pre-IPO targets to fit.</p>}
      {problems.map((p) => <div className="error-text" key={p}>{p}</div>)}
      <ActionButton busy={busy} disabled={problems.length > 0 || view.mandate.state !== MandateState.Active} label="Fork & create the new Circle" onClick={() => { void fork(); }} />
    </section>
  );
}

// ================================================================ exit

function ExitCard({ view, circle, me, signer, runGroups, busy }: {
  view: CircleView; circle: Address; me: Address; signer: TransactionSendingSigner; runGroups: RunGroups; busy: string | null;
}) {
  const { member, circle: c } = view;
  const [pct, setPct] = useState(50);
  const held = member?.shares ?? 0n;
  const shares = (held * BigInt(pct)) / 100n;
  const pending = view.exits.filter((x) => x.redemption.assetsRemaining > 0 || x.claims.length > 0);
  return (
    <section className="card">
      <div className="card-head"><div><span className="eyebrow">Your position</span><h2>Exit in kind</h2><p className="card-intro">You receive your exact slice of every asset and the cash — the same fraction everyone else keeps. One click runs start → reserve → send to your wallet.</p></div><Badge tone="good">No vote · no price</Badge></div>
      {held > 0n ? (
        c.pendingReservations > 0 && !pending.length ? <p className="muted" style={{ margin: 0 }}>Another member's exit is being prepared. Try again in a moment.</p> : <>
          <div className="field">
            <div className="field-label"><span>How much to take out</span><span className="num">{pct}% · {trim(formatShares(shares))} of {trim(formatShares(held))} shares</span></div>
            <input type="range" min={1} max={100} value={pct} onChange={(e) => setPct(Number(e.target.value))} aria-label="percent of your shares" />
            <div className="chips">{[25, 50, 100].map((p) => <button key={p} className="chip" onClick={() => setPct(p)}>{p}%</button>)}</div>
          </div>
          <ExitPreview view={view} shares={shares} />
          <ActionButton busy={busy} disabled={shares === 0n} label={`Exit ${pct}% to my wallet`} onClick={() => { void runGroups(`Exit ${pct}%`, () => flows.exitInKind({
            owner: signer, circle, seq: member!.nextRedemptionSeq, shares, usdcMint: view.usdcMint,
            assets: view.holdings.map((h) => ({ mint: h.asset.mint, tokenProgram: h.asset.tokenProgram })),
          })); }} />
        </>
      ) : <p className="muted" style={{ margin: 0 }}>This wallet holds no shares in this Circle.</p>}
      {pending.map((x) => <ExitItem key={x.seq.toString()} exit={x} view={view} circle={circle} me={me} signer={signer} runGroups={runGroups} busy={busy} />)}
    </section>
  );
}

function ExitPreview({ view, shares }: { view: CircleView; shares: bigint }) {
  const { circle: c } = view;
  const usdcOut = slice(view.activeUsdcRaw - c.usdcReservedRaw, shares, c.totalShares);
  return (
    <div className="preview">
      <div className="preview-row"><span className="k">{CASH_TICKER}</span><span className="v">{usdc(usdcOut)}</span></div>
      {view.holdings.map((h) => <PreviewAsset key={h.address} h={h} amount={slice(h.vaultRaw - h.asset.reservedForRedemptionRaw, shares, c.totalShares)} />)}
      <p className="exit-explainer">Token amounts from the Circle's current vaults. Any rounding remainder stays with the Circle, so nobody who stays is diluted.</p>
    </div>
  );
}

function PreviewAsset({ h, amount }: { h: Holding; amount: bigint }) {
  const fee = useFee(h.asset.mint, amount);
  const d = h.registry.decimals;
  return <>
    <div className="preview-row"><span className="k">{h.registry.symbol}</span><span className="v">{trim(formatRaw(fee ? amount - fee.fee : amount, d))}</span></div>
    {fee && fee.fee > 0n ? <div className="fee-note">after the token's {formatBps(fee.bps)} transfer fee ({trim(formatRaw(fee.fee, d))})</div> : null}
  </>;
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

/** Resume an exit that stopped part-way (e.g. a rejected wallet prompt). */
function ExitItem({ exit, view, circle, me, signer, runGroups, busy }: {
  exit: ExitView; view: CircleView; circle: Address; me: Address; signer: TransactionSendingSigner; runGroups: RunGroups; busy: string | null;
}) {
  const r = exit.redemption;
  const reserved = new Set(exit.claims.map((cl) => cl.mint));
  const resume = async (): Promise<Instruction[][]> => {
    const [vaultAuthority] = await pda.vaultAuthority(circle);
    const [activeUsdcVault] = await pda.usdcVault(circle);
    const reserve: Instruction[] = [];
    for (const { asset } of view.assets) {
      if (!((r.assetBitmapAtSnapshot >> asset.index) & 1) || reserved.has(asset.mint)) continue;
      reserve.push(getReserveRedemptionAssetInstruction({ payer: signer, circle, redemption: exit.address, circleAsset: (await pda.circleAsset(circle, asset.mint))[0], vault: asset.vault, redemptionAsset: (await pda.redemptionAsset(exit.address, asset.mint))[0] }));
    }
    if (r.assetsRemaining > 0 && !reserved.has(view.usdcMint)) {
      reserve.push(getReserveRedemptionUsdcInstruction({ payer: signer, circle, redemption: exit.address, activeUsdcVault, redemptionAsset: (await pda.redemptionAsset(exit.address, view.usdcMint))[0] }));
    }
    const claims: Instruction[][] = [];
    for (const cl of exit.claims) {
      const isUsdc = cl.mint === view.usdcMint;
      const tokenProgram = isUsdc ? TOKEN_PROGRAM : view.holdings.find((h) => h.asset.mint === cl.mint)?.asset.tokenProgram ?? TOKEN_2022_PROGRAM;
      const to = await ataAddress(me, cl.mint, tokenProgram);
      const create = await createAtaIdempotent(signer, me, cl.mint, tokenProgram);
      claims.push([create, isUsdc
        ? getClaimRedemptionUsdcInstruction({ memberOwner: signer, circle, redemption: exit.address, activeUsdcVault, redemptionAsset: cl.address, usdcMint: view.usdcMint, tokenProgram, memberUsdc: to, vaultAuthority })
        : getClaimRedemptionAssetInstruction({ memberOwner: signer, circle, redemption: exit.address, circleAsset: (await pda.circleAsset(circle, cl.mint))[0], redemptionAsset: cl.address, vault: (await pda.assetVault(circle, cl.mint))[0], mint: cl.mint, tokenProgram, memberTokenAccount: to, vaultAuthority })]);
    }
    return [...(reserve.length ? [reserve] : []), ...claims];
  };
  return <div className="exit">
    <div className="exit-head"><strong>Unfinished exit · {trim(formatShares(r.sharesRedeemed))} shares</strong><Badge tone="warn">{r.assetsRemaining > 0 ? "reserving" : "ready to send"}</Badge></div>
    <ActionButton block={false} kind="ghost" busy={busy} label="Finish this exit" onClick={() => { void runGroups("Finish exit", resume); }} />
  </div>;
}
