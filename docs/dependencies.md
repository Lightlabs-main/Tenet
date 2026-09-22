# Tenet — Dependency Matrix

**Artifact E of the six pre-implementation artifacts.**

Versions are chosen for **mutual compatibility**, not recency (spec §59). Nothing here is pinned until a spike proves the combination builds and its tests pass. Every row is either `VERIFIED` (built and tested by us), `CANDIDATE` (chosen, not yet proven) or `BLOCKED`.

---

## 1. Environment as observed (V-006)

| tool | installed here | Anchor docs recommend | status |
|---|---|---|---|
| OS | Windows 11 (`C:\stocklana`) | — | **WSL required for Anchor** |
| WSL | Debian, v2, **stopped** | — | must be started and provisioned |
| node | `v26.4.0` | `v23.9.0` | ahead — D-01 |
| npm | `11.17.0` | — | ok |
| pnpm | **not installed** | — | must install (workspace tool) |
| rustc / cargo | `1.96.0` | `1.85.0` | ahead — D-02 |
| solana / agave | **not installed** | `4.1.2` | must install in WSL |
| anchor | **not installed** | `1.2.0` | must install in WSL via AVM |
| docker | not installed | — | not required |
| git | `2.53.0` | — | ok |

---

## 2. The Windows blocker

Anchor's installation docs state plainly: *"Windows Users: You must first install WSL."* Anchor builds and `solana-test-validator` cannot run natively on Windows.

**Split the toolchain by layer:**

| layer | runs where |
|---|---|
| `programs/tenet` — build, test, deploy | **WSL Debian only** |
| `tests/program`, `tests/invariants` (validator-backed) | **WSL Debian only** |
| `packages/*`, `apps/web`, `services/indexer` | Windows or WSL |
| `scripts/*` and `pnpm verify` | Windows or WSL (network-only, no local validator) |

The repository lives on the Windows filesystem. Building Rust across the `/mnt/c` boundary from WSL is slow and occasionally produces file-watching problems; the setup step must decide between accepting that cost and cloning into the WSL filesystem. **Decision required before Phase 1** — tracked as `D-07`.

---

## 3. CONTRADICTION — Anchor version vs Pyth SDK — **RESOLVED (V-016)**

> **Resolution, 2026-09-20.** The conflict was based on Pyth's documentation prose. The crate's own
> dependency metadata says the opposite: `pyth-solana-receiver-sdk 2.0.0` (2026-06-15) requires
> `anchor-lang ^1.0.2`, which **Anchor 1.2.0 satisfies**. The documented "0.28 / 0.29 / 0.30.1 /
> 0.31.1" compatibility list is stale and describes the older SDK lineage.
>
> **Decision D-04: `anchor-lang 1.2.0` + `pyth-solana-receiver-sdk 2.0.0`.**
>
> The 0.31.x fallback is **withdrawn** — it is now the *incompatible* option, not the safe one.
> This inverts the fallback ordering below. Build confirmation is still outstanding; crate metadata
> proves intent, not that it compiles.
>
> The original contradiction is preserved below as written, because the reasoning about *why* a
> hand-rolled deserialisation would have been an unacceptable resolution still stands.

Spec §69 requires this be stated rather than silently resolved.

```
CONTRADICTION

Requirement A:
  Anchor's current documented toolchain is anchor-cli 1.2.0 with solana-cli 4.1.2.
  Choosing anything older means building on a deprecated toolchain from day one.

Requirement B:
  pyth-solana-receiver-sdk documents compatibility with Anchor v0.28.0, v0.29.0,
  v0.30.1 and v0.31.1 (V-007). It does NOT claim compatibility with Anchor 1.x.

Why they conflict:
  Anchor 1.x changed enough of the account/IDL machinery that an SDK exporting
  Anchor account types (Account<'info, PriceUpdateV2>) is not guaranteed to
  compile against it. Pyth is not optional: it is the entire public-equity
  valuation path and the divergence surface, and it is a sponsor target.

Financial/security implication:
  Resolving this by hand-rolling Pyth account deserialisation to dodge the
  version conflict would mean writing our own parser for an oracle account
  layout we have not verified post-upgrade (V-007 is still UNVERIFIED). That
  is precisely the class of mistake that produces a mispriced NAV and a
  dilution event. It is not an acceptable resolution.

Recommended resolution:
  Spike both combinations in WSL before committing to either, in this order:
    1. Anchor 1.2.0  + pyth-solana-receiver-sdk (latest)  -> does it build?
    2. Anchor 0.31.1 + pyth-solana-receiver-sdk (latest)  -> known-claimed pair
  Prefer (1) if it builds and its tests pass. Fall back to (2) otherwise, and
  record the downgrade and its reason in docs/verification.md.
  If NEITHER builds, that is a BLOCKER entry under RULE 8 — not a workaround.

What remains unchanged:
  Everything outside the oracle path. Account model, share accounting, escrow
  separation, redemption design and Fork do not depend on this choice. Phases 1
  through 3 (core accounting, pool, exit) can be built and fully tested while
  this is being resolved — which is exactly why the build order puts exit
  before execution.
```

---

## 4. Rust / Solana program dependencies

| crate | candidate | status | notes |
|---|---|---|---|
| `anchor-lang` | `1.2.0` or `0.31.1` | **BLOCKED** on D-04 | pending the spike above |
| `anchor-spl` | matching anchor | CANDIDATE | must expose `token_interface` |
| `spl-token-2022` | matching agave | CANDIDATE | needed for extension parsing |
| `pyth-solana-receiver-sdk` | latest | **BLOCKED** | V-007 + D-04 |
| Jupiter CPI bindings | **none** | **BLOCKED** | `jup-ag/jupiter-cpi` archived 2025-11-14 (V-008); do not depend on it |
| `solana-program` | transitive via anchor | CANDIDATE | do not pin independently — version skew here is a classic build break |

**Non-negotiable Cargo settings:**

```toml
[profile.release]
overflow-checks = true      # OFF by default in release; RULE 4 requires it
```

CI asserts this is present. A release build with wrapping arithmetic in share accounting is the highest-consequence build misconfiguration available to us.

`token_interface` (not `token`) must be used everywhere in the custody path — V-002 proves the assets we care about are Token-2022, and a classic-SPL assumption is a correctness bug.

---

## 5. TypeScript dependencies

| package | candidate | status | notes |
|---|---|---|---|
| `typescript` | 5.x | CANDIDATE | `strict: true` everywhere |
| `@coral-xyz/anchor` | matching the Rust anchor | **BLOCKED** on D-04 | must match the program exactly |
| `@solana/kit` 8.3 + `@solana/react` + Codama | **D-05 resolved: Kit** | chosen 2026-09-21 | program client generated from the Anchor IDL; see below |
| `@solana/spl-token` | latest with Token-2022 extension support | CANDIDATE | must expose `scaledUiAmountConfig` and `transferFeeConfig` |
| `@pythnetwork/hermes-client` | latest | **BLOCKED** | requires an API key post-upgrade (V-007) |
| `@pythnetwork/pyth-solana-receiver` | latest | **BLOCKED** | V-007 |
| decimal library | `decimal.js` or `big.js`, audited | CANDIDATE | for `priceImpactPct` and display math only |
| `next` | 15.x | CANDIDATE | mobile-first app |
| wallet adapter stack | latest stable | CANDIDATE | must support versioned tx + ALTs |
| `pnpm` | 9.x/10.x | **must install** | workspace tool |

**D-05 — web3.js vs Kit. RESOLVED 2026-09-21: Kit + Codama** (user decision on the evidence below). Pick exactly one and use it across SDK, indexer and web. Mixing them produces two incompatible `PublicKey`/address representations and subtle serialisation bugs.

Evidence (npm registry, 2026-09-21):

```
@coral-xyz/anchor            0.32.1   last published 2025-10 — superseded
@anchor-lang/core            1.2.0    Anchor 1.2's TS client — depends on @solana/web3.js ^1.69
@solana/wallet-adapter-react 0.15.40  peer @solana/web3.js ^1.99
@solana/kit                  8.3.0    @solana/react 8.3.0 (Wallet Standard) peers on it
codama 1.11.0 · @codama/nodes-from-anchor 1.5.6 · @codama/renderers-js 2.5.0
```

So there are two coherent stacks: **web3.js 1.x** (Anchor's own client + wallet-adapter) or **Kit** (Wallet Standard + a client *generated* from our IDL by Codama). A spike generated the Kit client from `target/idl/tenet.json` (IDL spec 0.1.0): all 19 instructions, 11 accounts, 77 errors and 12 PDA helpers, with `getCircleSize() == 96` matching the program's `8 + INIT_SPACE`, and doc comments carried through.

**Deciding factor: number types on the money path.** Kit decodes `u64` as native `bigint`, which is what `packages/domain` uses throughout (RULE 4, V-018). Anchor's TS client decodes `u64` as `BN`, adding a third numeric type and a conversion boundary exactly where precision bugs live.

**Caveat carried into the SDK.** Codama's generated *input* types accept `number | bigint` for `u64`. A `number` above 2^53 silently loses precision. The SDK's public API accepts `bigint` only for amounts and shares.

**Money-arithmetic rule (RULE 4), enforced by lint:**

- raw token amounts, share counts, USDC amounts → `bigint`, always
- ratios and display values → audited decimal type
- `number` → **banned** in any money path; ESLint rule plus a CI grep
- `JSON.parse` of a quote response must not coerce amount fields to `number` (V-005: `priceImpactPct` arrives as a 28-digit decimal string and `outAmount` as a numeric string)

---

## 6. Open dependency decisions

| id | decision | blocks | resolves when |
|---|---|---|---|
| D-01 | node 26 vs 23.9 | TS toolchain | spike; pin via `.nvmrc` / `packageManager` |
| D-02 | rust 1.96 vs 1.85 | program build | spike; pin via `rust-toolchain.toml` |
| D-03 | agave version to install | program build | follows D-04 |
| D-04 | **Anchor 1.2.0 vs 0.31.1** | program + SDK + Pyth | the §3 spike |
| D-05 | web3.js vs Kit | SDK, indexer, web | **resolved: Kit + Codama** |
| D-06 | Jupiter CPI bindings vs sandwich | execution | V-008 tx-size measurement |
| D-07 | repo on `/mnt/c` vs WSL filesystem | build ergonomics | before Phase 1 |

**Every one of these is resolved by building, not by reading.** A version table that has never compiled is a guess.

---

## 7. Pinning policy

Once a combination is proven:

- `rust-toolchain.toml` pins the Rust version
- `Anchor.toml` pins `anchor_version` and `solana_version`
- `Cargo.lock` and `pnpm-lock.yaml` are committed
- `packageManager` in `package.json` pins pnpm
- `.nvmrc` pins node
- the proven combination is recorded in `docs/verification.md` as a `V-xxx` entry with the date it was built and the test results

CI runs the pinned combination on every push. A dependency bump is a deliberate change with a re-run of `pnpm verify`, never an incidental one.
