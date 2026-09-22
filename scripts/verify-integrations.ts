/**
 * Tenet - integration verification harness.
 *
 *   pnpm verify        (or: node scripts/verify-integrations.ts)
 *
 * READ-ONLY. Never sends a transaction. Mainnet writes live in smoke-mainnet.ts
 * and require ALLOW_MAINNET_WRITES=true plus an explicitly supplied signer.
 *
 * Rules this file obeys:
 *   RULE 1  no fabricated data. A failed source is reported as failed, never
 *           replaced with a plausible number.
 *   RULE 3  raw base units are canonical. The ScaledUiAmount multiplier is
 *           applied only at the display/valuation boundary.
 *   RULE 4  no float for money. All amounts are bigint.
 *
 * Exits non-zero if any BLOCKING check fails.
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Load the repository .env for direct Node invocations on the verification VPS.
 * Explicitly exported variables win, and values are never printed. This is a
 * deliberately small parser for the KEY=value form used by this project; it
 * does not attempt shell expansion or execute dotenv content.
 */
function loadProjectEnv(): void {
  const envPath = resolve(process.cwd(), ".env");
  if (!existsSync(envPath)) return;

  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator <= 0) continue;

    const key = trimmed.slice(0, separator).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || process.env[key] !== undefined) continue;

    let value = trimmed.slice(separator + 1).trim();
    if (value.length >= 2) {
      const first = value[0];
      const last = value[value.length - 1];
      if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
        value = value.slice(1, -1);
      }
    }
    process.env[key] = value;
  }
}

loadProjectEnv();

const RPC = process.env.SOLANA_RPC_URL ?? "https://api.mainnet-beta.solana.com";
const PRESTOCKS_API =
  process.env.PRESTOCKS_API_URL ?? "https://prestocks.com/api/prestocks";
const JUP = process.env.JUPITER_API_BASE ?? "https://lite-api.jup.ag";
const JUPITER_API_KEY = process.env.JUPITER_API_KEY;
const PYTH_HERMES = process.env.PYTH_HERMES_URL ?? "https://pyth.dourolabs.app/hermes";
const PYTH_API_KEY = process.env.PYTH_API_KEY;

const TOKEN_2022 = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
const TOKEN_CLASSIC = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const USDC_MINT =
  process.env.USDC_MINT ?? "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const ROUTER_TAKER =
  process.env.JUPITER_ROUTER_TAKER ?? "FJt9WntCGo6suyjH4cndwgKjQ8rDSau1JxLA91UFB49v";

// ---------------------------------------------------------------- types

type Extension = { extension: string; state: any };

type MintInfo = {
  address: string;
  tokenProgram: string;
  decimals: number;
  rawSupply: bigint;
  mintAuthority: string | null;
  freezeAuthority: string | null;
  extensions: Extension[];
};

type Finding = {
  id: string;
  ok: boolean;
  blocking: boolean;
  detail: string;
};

const findings: Finding[] = [];
const record = (f: Finding) => {
  findings.push(f);
  const tag = f.ok ? "PASS" : f.blocking ? "FAIL" : "WARN";
  console.log(`  [${tag}] ${f.id}: ${f.detail}`);
};

// ---------------------------------------------------------------- rpc

/**
 * Parse JSON preserving the EXACT lexical form of every number as a string.
 *
 * Why this exists (V-018): `getAccountInfo` jsonParsed returns some u64 fields as
 * JSON *numbers*, not strings - e.g. transferFeeConfig.maximumFee, which is
 * u64::MAX = 18446744073709551615. `res.json()` parses that as an IEEE-754 double
 * and silently yields 18446744073709551616. Every u64 above 2^53 read that way is
 * corrupted. RULE 4 forbids it.
 *
 * Uses the JSON.parse source-text reviver, so we get the digits as written.
 */
function parseJsonExact(text: string): any {
  return JSON.parse(text, function (_key, value, context: any) {
    if (typeof value === "number" && context && typeof context.source === "string") {
      return context.source; // exact lexical form, never a double
    }
    return value;
  });
}

async function fetchJsonExact(url: string, init?: RequestInit): Promise<any> {
  const res = await fetch(url, init);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return parseJsonExact(await res.text());
}

// ---- exact decimal arithmetic (RULE 4: no float anywhere near money) --------

type Dec = { mant: bigint; scale: number };

function dec(s: string | number | bigint): Dec {
  const t = String(s).trim();
  if (/[eE]/.test(t)) throw new Error(`refusing exponent-form number: ${t}`);
  const neg = t.startsWith("-");
  const body = neg ? t.slice(1) : t;
  const [int, frac = ""] = body.split(".");
  return { mant: BigInt((neg ? "-" : "") + (int || "0") + frac), scale: frac.length };
}

/** |a - b| <= tol, all exact. */
function decCloseTo(a: Dec, b: Dec, tol: Dec): boolean {
  const s = Math.max(a.scale, b.scale, tol.scale);
  const lift = (d: Dec) => d.mant * 10n ** BigInt(s - d.scale);
  const diff = lift(a) - lift(b);
  const abs = diff < 0n ? -diff : diff;
  return abs <= lift(tol);
}

let rpcId = 0;
async function rpc<T>(method: string, params: unknown[]): Promise<T> {
  const res = await fetch(RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method, params }),
  });
  if (!res.ok) throw new Error(`RPC ${method} HTTP ${res.status}`);
  const json: any = parseJsonExact(await res.text());
  if (json.error) throw new Error(`RPC ${method}: ${JSON.stringify(json.error)}`);
  return json.result as T;
}

async function getMint(address: string): Promise<MintInfo> {
  const r: any = await rpc("getAccountInfo", [
    address,
    { encoding: "jsonParsed" },
  ]);
  const v = r?.value;
  if (!v) throw new Error(`mint ${address} does not exist`);
  const parsed = v.data?.parsed;
  if (parsed?.type !== "mint") throw new Error(`${address} is not a mint`);
  const info = parsed.info;
  return {
    address,
    tokenProgram: v.owner,
    decimals: Number(info.decimals), // small, bounded 0..9 - safe
    // exact digits -> bigint. Never via a double. RULE 4.
    rawSupply: BigInt(info.supply),
    mintAuthority: info.mintAuthority ?? null,
    freezeAuthority: info.freezeAuthority ?? null,
    extensions: info.extensions ?? [],
  };
}

const ext = (m: MintInfo, name: string): any =>
  m.extensions.find((e) => e.extension === name)?.state;

// ------------------------------------------------- the two critical functions

/**
 * The effective ScaledUiAmount multiplier.
 *
 * V-003: reading `multiplier` alone is WRONG. SPACEX reads multiplier="1" while
 * newMultiplier="5" became effective on 2026-06-10. A naive read undervalues the
 * position by 5x. This function is the only permitted way to read it.
 *
 * Returned as a string to avoid binding the caller to float. Callers doing
 * valuation must feed it into an audited decimal type.
 */
export function effectiveMultiplier(m: MintInfo, nowUnixSeconds: bigint): string {
  const cfg = ext(m, "scaledUiAmountConfig");
  if (!cfg) return "1";
  const effAt = BigInt(cfg.newMultiplierEffectiveTimestamp ?? 0);
  return nowUnixSeconds >= effAt
    ? String(cfg.newMultiplier ?? cfg.multiplier ?? "1")
    : String(cfg.multiplier ?? "1");
}

/**
 * The transfer fee actually in force at `currentEpoch`.
 *
 * V-004: picking `newerTransferFee` unconditionally is WRONG whenever a change is
 * scheduled for a future epoch. Compare against both epochs.
 */
export function activeTransferFee(
  m: MintInfo,
  currentEpoch: bigint,
): { basisPoints: bigint; maximumFee: bigint } | null {
  const cfg = ext(m, "transferFeeConfig");
  if (!cfg) return null;
  const newer = cfg.newerTransferFee;
  const older = cfg.olderTransferFee;
  const pick =
    newer && currentEpoch >= BigInt(newer.epoch) ? newer : (older ?? newer);
  if (!pick) return null;
  return {
    basisPoints: BigInt(pick.transferFeeBasisPoints),
    maximumFee: BigInt(pick.maximumFee),
  };
}

/** Issuer controls Tenet cannot constrain. R-09. Surfaced, never hidden. */
function issuerControls(m: MintInfo): string[] {
  const out: string[] = [];
  if (ext(m, "permanentDelegate")) out.push("permanentDelegate");
  if (m.freezeAuthority) out.push("freezeAuthority");
  const p = ext(m, "pausableConfig");
  if (p) out.push(p.paused ? "pausable(PAUSED)" : "pausable");
  const h = ext(m, "transferHook");
  if (h) out.push(h.programId ? `transferHook(${h.programId})` : "transferHook(authority set, none installed)");
  if (ext(m, "defaultAccountState")?.accountState === "frozen")
    out.push("defaultAccountState=FROZEN");
  return out;
}

// ---------------------------------------------------------------- checks

async function checkUsdc(currentEpoch: bigint): Promise<MintInfo | null> {
  console.log("\n== V-014  USDC ==");
  try {
    const m = await getMint(USDC_MINT);
    record({
      id: "V-014.program",
      ok: m.tokenProgram === TOKEN_CLASSIC || m.tokenProgram === TOKEN_2022,
      blocking: true,
      detail: `token program ${m.tokenProgram}`,
    });
    record({
      id: "V-014.decimals",
      ok: m.decimals === 6,
      blocking: true,
      detail: `decimals=${m.decimals} (accounting assumes 6; if not, docs/accounting.md changes)`,
    });
    const fee = activeTransferFee(m, currentEpoch);
    record({
      id: "V-014.fee",
      ok: fee === null,
      blocking: false,
      detail: fee
        ? `UNEXPECTED transfer fee ${fee.basisPoints}bps - escrow accounting must change`
        : "no transfer fee",
    });
    const controls = issuerControls(m);
    record({
      id: "V-014.controls",
      ok: true,
      blocking: false,
      detail: controls.length ? controls.join(", ") : "none",
    });
    console.log(`  raw supply ${m.rawSupply}`);
    return m;
  } catch (e) {
    record({ id: "V-014", ok: false, blocking: true, detail: String(e) });
    return null;
  }
}

async function checkPreStocks(currentEpoch: bigint, nowSec: bigint) {
  console.log("\n== V-001/V-002/V-003  PreStocks universe ==");
  let assets: any[];
  try {
    assets = (await fetchJsonExact(PRESTOCKS_API)) as any[];
    if (!Array.isArray(assets)) throw new Error("expected a JSON array");
    record({
      id: "V-001",
      ok: assets.length > 0,
      blocking: true,
      detail: `${assets.length} assets discovered (universe is discovered, never hardcoded)`,
    });
  } catch (e) {
    record({ id: "V-001", ok: false, blocking: true, detail: String(e) });
    return;
  }

  for (const a of assets) {
    const sym = a.symbol ?? "?";
    const mintAddr = a.contract_address;
    console.log(`\n  --- ${sym} (${mintAddr}) ---`);
    try {
      const m = await getMint(mintAddr);
      const mult = effectiveMultiplier(m, nowSec);
      const fee = activeTransferFee(m, currentEpoch);
      const controls = issuerControls(m);

      record({
        id: `${sym}.token2022`,
        ok: m.tokenProgram === TOKEN_2022,
        blocking: false,
        detail: `token program ${m.tokenProgram === TOKEN_2022 ? "Token-2022" : m.tokenProgram}, decimals=${m.decimals}`,
      });

      // RULE 3: the multiplier must NOT be needed to compare raw supply to a raw
      // vault balance. We only apply it to reconcile against the issuer's own
      // (scaled) supply figure, to prove we understand which is which.
      const cfg = ext(m, "scaledUiAmountConfig");
      const naive = cfg ? String(cfg.multiplier ?? "1") : "1";
      record({
        id: `${sym}.multiplier`,
        ok: true,
        blocking: false,
        detail:
          mult === naive
            ? `effective ${mult}`
            : `effective ${mult} but the 'multiplier' field reads ${naive} - NAIVE READ WOULD BE WRONG`,
      });

      if (a.supply !== undefined && cfg) {
        // Reconcile the issuer's `supply` against raw supply x effective multiplier.
        //
        // V-017: multipliers are NOT integers (OPENAI is 1.4861347). All of this
        // is exact decimal arithmetic on bigint mantissas - no float, ever.
        //
        //   lhs = rawSupply * multiplier
        //   rhs = issuerSupply * 10^decimals
        const mp = dec(mult);
        const lhs: Dec = { mant: m.rawSupply * mp.mant, scale: mp.scale };
        const iss = dec(a.supply);
        const rhs: Dec = { mant: iss.mant * 10n ** BigInt(m.decimals), scale: iss.scale };
        // Issuer rounds its own display figure; allow one raw unit of slack.
        const tol: Dec = { mant: 1n, scale: 0 };
        const match = decCloseTo(lhs, rhs, tol);
        record({
          id: `${sym}.supplyReconcile`,
          ok: match,
          blocking: false,
          detail: match
            ? `issuer 'supply' is SCALED, not raw: raw ${m.rawSupply} x ${mult} == issuer ${a.supply}`
            : `issuer 'supply' does NOT reconcile: raw ${m.rawSupply} x ${mult} != issuer ${a.supply}`,
        });
      }

      record({
        id: `${sym}.fee`,
        ok: true,
        blocking: false,
        detail: fee
          ? `active ${fee.basisPoints}bps, max ${fee.maximumFee >= (1n << 64n) - 1n ? "UNCAPPED (u64::MAX)" : fee.maximumFee} (borne by exiting member)`
          : "no transfer fee",
      });

      record({
        id: `${sym}.issuerControls`,
        ok: true,
        blocking: false,
        detail: controls.length ? controls.join(", ") : "none",
      });
    } catch (e) {
      record({ id: `${sym}.mint`, ok: false, blocking: true, detail: String(e) });
    }
  }
}

async function checkJupiter(assets: { symbol: string; mint: string }[]) {
  console.log("\n== V-005/V-011  Jupiter routes ==");
  for (const a of assets) {
    // 100 USDC probe. Full min-viable-size ladder is V-011.
    const url =
      `${JUP}/swap/v1/quote?inputMint=${USDC_MINT}&outputMint=${a.mint}` +
      `&amount=100000000&slippageBps=50`;
    try {
      const res = await fetch(url);
      if (!res.ok) {
        record({
          id: `${a.symbol}.route`,
          ok: false,
          blocking: false,
          detail: `no route at $100 (HTTP ${res.status})`,
        });
        continue;
      }
      const q: any = parseJsonExact(await res.text());
      // priceImpactPct arrives as a high-precision decimal STRING. Keep it a
      // string; never Number() it. RULE 4.
      record({
        id: `${a.symbol}.legacyRoute`,
        ok: true,
        blocking: false,
        detail: `legacy v1 out=${q.outAmount} raw, impact=${q.priceImpactPct}, hops=${q.routePlan?.length ?? "?"} via ${q.routePlan?.map((h: any) => h.swapInfo?.label).join(" -> ")}`,
      });

      // Jupiter's current API is v2. It requires an API key even for a
      // quote-only order, so this is intentionally additive: environments
      // without a key retain the read-only legacy probe above but cannot claim
      // current execution compatibility.
      if (JUPITER_API_KEY) {
        const v2 = new URL("https://api.jup.ag/swap/v2/order");
        v2.search = new URLSearchParams({
          inputMint: USDC_MINT,
          outputMint: a.mint,
          amount: "100000000",
        }).toString();
        const current = await fetch(v2, { headers: { "x-api-key": JUPITER_API_KEY } });
        if (!current.ok) {
          record({
            id: `${a.symbol}.v2Order`,
            ok: false,
            blocking: true,
            detail: `current Swap V2 order failed (HTTP ${current.status})`,
          });
        } else {
          const order: any = parseJsonExact(await current.text());
          const output = typeof order.outAmount === "string" && /^\d+$/.test(order.outAmount);
          record({
            id: `${a.symbol}.v2Order`,
            ok: output,
            blocking: true,
            detail: output
              ? `Swap V2 quote-only order out=${order.outAmount} raw via ${order.router ?? "unknown"}`
              : `Swap V2 returned no exact raw outAmount: ${JSON.stringify(order).slice(0, 240)}`,
          });
        }
      } else {
        record({
          id: `${a.symbol}.v2Order`,
          ok: false,
          blocking: false,
          detail: "Swap V2 not probed: set JUPITER_API_KEY; legacy v1 result is not a release verification",
        });
      }
    } catch (e) {
      record({ id: `${a.symbol}.legacyRoute`, ok: false, blocking: false, detail: String(e) });
    }
    // Free-tier API keys are rate limited. Keep the legacy and current route
    // observations below one request per second per asset.
    await new Promise((resolve) => setTimeout(resolve, 1_200));
  }
}

async function checkJupiterRouter(assets: { symbol: string; mint: string }[]) {
  if (!JUPITER_API_KEY) {
    record({
      id: "V-008.router",
      ok: false,
      blocking: false,
      detail: "Swap V2 Router not probed: set JUPITER_API_KEY",
    });
    return;
  }

  console.log("\n== V-008  Jupiter Swap V2 Router /build (read-only) ==");
  for (const a of assets) {
    const url = new URL("/swap/v2/build", "https://api.jup.ag");
    url.search = new URLSearchParams({
      inputMint: USDC_MINT,
      outputMint: a.mint,
      amount: "100000000",
      slippageBps: "50",
      taker: ROUTER_TAKER,
    }).toString();
    try {
      const res = await fetch(url, { headers: { "x-api-key": JUPITER_API_KEY } });
      const body: any = parseJsonExact(await res.text());
      const instructionKeys = [
        "setupInstructions",
        "computeBudgetInstructions",
        "swapInstruction",
        "cleanupInstruction",
        "instructions",
      ].filter((key) => body && body[key] !== undefined);
      const hasExactOut = typeof body?.outAmount === "string" && /^\d+$/.test(body.outAmount);
      const hasRawInstructions = instructionKeys.length > 0;
      record({
        id: `${a.symbol}.v2RouterBuild`,
        ok: res.ok && hasExactOut && hasRawInstructions,
        blocking: true,
        detail: res.ok
          ? `out=${body.outAmount ?? "missing"} raw instruction fields=${instructionKeys.join(",") || "none"}`
          : `Swap V2 Router /build failed (HTTP ${res.status}): ${JSON.stringify(body).slice(0, 240)}`,
      });
    } catch (e) {
      record({ id: `${a.symbol}.v2RouterBuild`, ok: false, blocking: true, detail: String(e) });
    }
    // Free-tier keys are rate limited. Avoid turning a healthy route into a
    // false failure because eight sequential observations were too close.
    await new Promise((resolve) => setTimeout(resolve, 1_500));
  }
}

async function checkPythHermes() {
  console.log("\n== V-007  Pyth Hermes authentication/read path ==");
  const btcUsd =
    "0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43";
  if (!PYTH_API_KEY) {
    record({ id: "V-007.hermesAuth", ok: false, blocking: false, detail: "PYTH_API_KEY is not configured" });
    return;
  }
  const url = new URL(
    "v2/updates/price/latest",
    PYTH_HERMES.endsWith("/") ? PYTH_HERMES : `${PYTH_HERMES}/`,
  );
  url.search = new URLSearchParams({ "ids[]": btcUsd }).toString();
  try {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${PYTH_API_KEY}` } });
    const text = await res.text();
    let body: any = null;
    try { body = parseJsonExact(text); } catch { /* report status/body below */ }
    const parsed = Array.isArray(body?.parsed) ? body.parsed : [];
    const exact = parsed.length === 1
      && String(parsed[0]?.id ?? "").replace(/^0x/, "") === btcUsd.slice(2)
      && typeof parsed[0]?.price?.price === "string"
      && /^-?\d+$/.test(parsed[0].price.price)
      && /^-?\d+$/.test(String(parsed[0]?.price?.expo ?? ""))
      && /^\d+$/.test(String(parsed[0]?.price?.publish_time ?? ""));
    record({
      id: "V-007.hermesAuth",
      ok: res.ok && exact,
      blocking: false,
      detail: res.ok
        ? `status=${res.status} exact=${exact} parsed=${parsed.length} feed=${parsed[0]?.id ?? "missing"} idMatch=${String(parsed[0]?.id ?? "").replace(/^0x/, "") === btcUsd.slice(2)} priceType=${typeof parsed[0]?.price?.price} expoType=${typeof parsed[0]?.price?.expo} timeType=${typeof parsed[0]?.price?.publish_time}`
        : `Hermes request failed (HTTP ${res.status}): ${(text || JSON.stringify(body)).slice(0, 240)}`,
    });
  } catch (e) {
    record({ id: "V-007.hermesAuth", ok: false, blocking: false, detail: String(e) });
  }
}

// ---------------------------------------------------------------- main

async function main() {
  console.log("Tenet integration verification - READ ONLY");
  console.log(`rpc: ${RPC}`);
  console.log(`time: ${new Date().toISOString()}`);

  if (process.env.PYTH_ONLY === "true") {
    await checkPythHermes();
    return;
  }

  if (process.env.ALLOW_MAINNET_WRITES === "true") {
    console.log("\nNOTE: ALLOW_MAINNET_WRITES is set, but this harness never writes.");
  }

  const epochInfo: any = await rpc("getEpochInfo", []);
  const currentEpoch = BigInt(epochInfo.epoch);
  const nowSec = BigInt(Math.floor(Date.now() / 1000));
  console.log(`epoch: ${currentEpoch}  slot: ${epochInfo.absoluteSlot}`);

  await checkUsdc(currentEpoch);
  await checkPreStocks(currentEpoch, nowSec);
  await checkPythHermes();

  // Re-fetch the discovered universe for routing checks.
  try {
    const assets = (await fetchJsonExact(PRESTOCKS_API)) as any[];
    await checkJupiter(
      assets.map((a) => ({ symbol: a.symbol, mint: a.contract_address })),
    );
    await checkJupiterRouter(
      assets.map((a) => ({ symbol: a.symbol, mint: a.contract_address })),
    );
  } catch {
    record({ id: "V-005", ok: false, blocking: false, detail: "universe unavailable for routing checks" });
  }

  // ------------------------------------------------------------- summary
  const failed = findings.filter((f) => !f.ok && f.blocking);
  const warned = findings.filter((f) => !f.ok && !f.blocking);
  console.log("\n" + "=".repeat(60));
  console.log(
    `checks: ${findings.length}   blocking failures: ${failed.length}   warnings: ${warned.length}`,
  );
  if (failed.length) {
    console.log("\nBLOCKING FAILURES:");
    for (const f of failed) console.log(`  - ${f.id}: ${f.detail}`);
  }
  console.log(
    "\nStill UNVERIFIED and not covered here: V-007 (Pyth post-upgrade), " +
    "V-008 (Jupiter program id / CPI / current Swap V2), V-010 (public equities), " +
      "V-011 (min trade size ladder), V-012 (corporate actions), V-013 (eligibility).",
  );
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => {
  console.error("\nverification harness crashed:", e);
  process.exit(1);
});
