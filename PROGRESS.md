# Tenet — Progress

Last updated: 2026-09-23

## Secure-context HTTP error (2026-09-23)

- Added an early entry-page guard that upgrades insecure HTTP visits to the
  canonical HTTPS origin before loading Solana Kit/WebCrypto-dependent code.
- Web app TypeScript check and Vite production build pass.
- Live VPS Caddy redirect is still needed for an edge-level fix. SSH reached
  the host but the available key was rejected, so no remote configuration was
  changed; do not report the HTTP route fixed until that redirect is deployed
  and verified.

---

## TENET SPEC UPDATE

Full current assessment: [docs/update-impact-report.md](docs/update-impact-report.md).

Already compliant:
- Raw base units are canonical; ScaledUiAmount is display/valuation-only.
- Epoch escrow, ContributionReceipt, Epoch 0, cancellation and reserved-share settlement are implemented.
- CircleAsset/MandateAsset PDA account model and vault-authority constraints are implemented.
- Staged in-kind exit is implemented without a Tenet price/oracle/governance gate; external issuer controls remain disclosed.
- Transfer-fee, pending-member, late-settlement and failed-asset claim tests exist.
- Live verification harness and no-fabrication/money-lint rules remain active.

Needs correction:
- README and historical progress text still contain stale pre-program status claims.
- Complete named-test parity and program-level adversarial coverage for the update.
- Verify the source-level `refresh_asset_metadata` path against a fresh deployable artifact before relying on cached live mint observations.

Needs implementation:
- Verified public-equity EXECUTE and Pyth-backed VALUE.
- PreStocks market-vs-mark execution/value/corporate-action surfaces.
- Consumer-facing amendment UI and proposal history.
- Optional automatic contribution rail, starting with one real recurring path only after its Solana authorization behavior is verified.

Latest VALUE increment:
- Added `packages/domain/src/valuation.ts` as an exact display/valuation boundary.
- Pyth integer/exponent observations, freshness, confidence, paired-feed divergence,
  raw-vault valuation, and PreStocks market-vs-mark premium/discount are now
  modeled without floating-point arithmetic.
- This remains a verified valuation boundary rather than a fabricated live feed:
  missing/stale observations remain unavailable by design. The on-chain rolling
  path now consumes the same policy through `NavSnapshot`.
- Added a consumer-facing VALUE panel to `apps/web/src/dashboard.tsx` that
  shows active raw-backed USDC separately from unavailable NAV, paired-feed,
  and PreStocks mark surfaces; the live preview renders this distinction.
- Added the consumer-facing contribution automation preview with recurring,
  percentage, and round-up choices visibly disabled until a real revocable
  authorization path is verified; no wallet authority is simulated.
- Added visible registry freshness state beside each holding: classification is
  not presented as live metadata, and unrefreshed supply/fee/control facts show
  as `metadata pending`.
- Rechecked current Pyth documentation after the August 2026 Core upgrade:
  Hermes is authenticated, the documented receiver/feed program pair changed,
  and browser API-key embedding is not acceptable. Pyth remains gated on live
  account/feed verification and Anchor compatibility.

Latest implementation increment:
- Corrected the EXECUTE boundary's source-vault binding: `end_execution` now
  derives the Circle USDC vault instead of incorrectly comparing its address
  to the USDC mint. Begin/end also bind vault owners, stored token programs,
  completed Epoch state, and populate the replay authorization snapshot before
  the price-policy gate.
- Rebuilt the Anchor artifact and reran the complete LiteSVM suite: **54/54**
  passed. The execution path remains deliberately fail-closed until target
  Pyth feeds and a controlled Jupiter Token-2022 vault-delta route are
  verified.
- Added amendment governance with `AmendmentProposal` and `AmendmentVote`
  PDAs, complete constitution snapshots, settled-share voting, current-delay
  execution, checked `u128` threshold arithmetic, and explicit invalidation
  when the Circle share total or exit state changes.
- Regenerated the Anchor IDL/Codama SDK from the rebuilt artifact and added
  checked SDK builders. The remote LiteSVM suite now passes **54/54**,
  including the three amendment tests; Rust unit tests pass **25/25** and SDK
  client/PDA tests pass **12/12**.
- Added source-level `fork_mandate` and `fork_mandate_asset` instructions.
- Forks copy constitution fields and dedicated asset rules into a new child
  Mandate, bind the child to the forker, preserve parent immutability, and
  keep all Circle/custody accounts out of the path.
- Added the required Fork LiteSVM regression tests; the remote Qevor toolchain
  now passes the full integration suite and regenerated the deployable program
  artifact and IDL. The local WSL wrapper limitation remains documented.

Blocked:
- Automatic contribution implementation is blocked on direct verification of Subscriptions & Allowances CPI capability and PDA delegatee support (V-025 items 1–2).
- Execution/value remain gated by the open Pyth/Jupiter/mainnet integration verification items recorded in `docs/verification.md`.
- The VPS has no `JUPITER_API_KEY`, `.env`, or `PYTH_API_KEY`; current Swap V2/Hermes verification cannot be honestly completed until those credentials are provisioned privately.

**Impact-report pass validation (2026-09-21):**
- `node --test packages/domain/test/accounting.test.ts packages/domain/test/vectors.test.ts packages/sdk/test/pda.test.ts` — **32/32 passed**.
- `node scripts/lint-money-rules.mjs` — **clean**.
- `pnpm verify` — **blocked by sandboxed outbound RPC** (`EACCES` to `api.mainnet-beta.solana.com`); no fallback data used.
- `pnpm test` — **blocked before tests** by the local dependency wrapper requiring Node `>=22 <23` / pnpm 12 and attempting a non-interactive module purge.
- `cargo test -p tenet --lib --offline` — **blocked** because `anchor-lang` is not cached; online crates.io access is unavailable.

**Source refresh pass validation (2026-09-22):**
- `cargo test -p tenet --lib` — **21/21 passed** after the metadata refresh implementation.
- `node --test packages/domain/test/accounting.test.ts packages/domain/test/vectors.test.ts packages/sdk/test/pda.test.ts` — **33/33 passed**.
- `node scripts/lint-money-rules.mjs` — **clean**.
- direct web TypeScript check (`tsc --noEmit -p apps/web`) — **passed**.
- direct Vite production build — **passed**.
- `node packages/sdk/scripts/gen-client.mjs --check` — **passed**; no generated client drift from the committed IDL.
- `pnpm typecheck` — **blocked by the workspace wrapper's pnpm store database (`ERR_SQLITE_ERROR`)**, not by TypeScript diagnostics.
- WSL Anchor build/deploy — **blocked by `Wsl/.../E_ACCESSDENIED`**; no fresh `.so` or IDL can be honestly claimed.
- Jupiter verification — current official docs now identify Swap V2 (`/order` + `/execute` or `/build` + `/submit`) and require an API key; the harness now probes V2 when `JUPITER_API_KEY` is present and labels V1 probes legacy. CPI binding choice remains blocked until a real Token-2022 route and vault-delta check are completed.
- `node --test ... valuation.test.ts ...` — **38/38 passed** across accounting, valuation, vectors and PDA coverage.

**Continuation pass validation (2026-09-22):**
- Read-only integration harness ran on the Qevor VPS against Solana mainnet at slot `449382356` (epoch `1040`).
- `V-014` USDC, live PreStocks discovery, Token-2022 decimals, effective multipliers, raw-supply reconciliation, transfer fees and issuer controls all passed for the discovered 8-asset universe.
- Legacy Jupiter route probes returned routes for all 8 discovered assets; current Swap V2 remained explicitly **unverified** because `JUPITER_API_KEY` was not present. No execution instruction was enabled from the legacy result.
- After private credentials were provisioned, Swap V2 `/order` and the composable Router `/build` were verified read-only for all 8 discovered assets. Each Router result returned exact raw output plus setup, compute-budget, swap and cleanup instruction fields. Three legacy probes were rate-limited with HTTP 429 and are warnings only.
- Pyth Hermes authenticated successfully against the upgraded endpoint with a current BTC/USD feed; the response preserved integer price, exponent and publish-time fields. Target tokenized-equity feed IDs/layout and an actual controlled Token-2022 vault-delta execution remain open, so no production execution instruction is enabled yet.
- Added `packages/domain/src/execution.ts`, an exact raw-vault delta guard for the eventual `end_execution` path. It rejects source-balance increases, destination-balance decreases, over-spend and below-floor output without accepting quotes or UI quantities.
- Added six execution-delta tests; full domain/PDA suite now passes **48/48**. Direct web TypeScript check and production Vite build also pass.

---

## FULL AUDIT — 2026-09-21

Adversarial audit recorded in [REVIEW.md](REVIEW.md). No production sign-off.

Open high-severity gates:
- H-03: corrected in the domain model and on-chain `NavSnapshot`; rolling issuance still requires current verified feeds and refreshed metadata.
- H-04: EXECUTE remains fail-closed pending target pricing/route verification; amendment governance is implemented and artifact-tested, while automatic contributions remain absent until a real revocable authorization path is verified.
- H-05: source-level registry live-fact refresh now reads supply, multiplier, fee and issuer-control observations; fresh artifact testing passed, while extension-specific production integration remains a gate.
- H-06: upgrade-authority policy is unresolved for production.

Additional findings fixed in this pass: web now derives USDC from Config, the SDK package root hides raw amount-bearing builders, active-member counting tracks zero-share transitions, redemption paths assert vault authority/mint bindings, source-level live metadata refresh now observes current mint facts, and the exact execution-delta guard is tested off-chain. Remaining findings: full execution-path substitution testing, registry observation versioning, documentation drift, and the absent core mechanics.

Audit validation after fixes: domain/PDA tests 48/48 passed, SDK client/PDA tests 12/12 passed under the supported `tsx` runner, web TypeScript check and Vite build passed, `cargo test -p tenet --lib` passed 21/21, remote LiteSVM tests passed 50/50, and money-lint was clean. Live read-only integration verification passed on the VPS with no blocking failures; current Swap V2 remains unverified without its API key. See `REVIEW.md` for exact evidence.

---

## DONE

**Artifacts (all six, pre-implementation gate satisfied)**

- A — [docs/architecture.md](docs/architecture.md)
- B — [docs/instructions.md](docs/instructions.md)
- C — [docs/verification-plan.md](docs/verification-plan.md)
- D — [docs/threat-model.md](docs/threat-model.md)
- E — [docs/dependencies.md](docs/dependencies.md)
- F — [docs/implementation-plan.md](docs/implementation-plan.md)

**Verification** — V-001 … V-026 in [docs/verification.md](docs/verification.md). 53 automated checks passing, 0 blocking failures.

**Harness** — [scripts/verify-integrations.ts](scripts/verify-integrations.ts), read-only, dependency-free, exits non-zero on blocking regressions.

**WSL toolchain provisioned** (BLOCKER-01 cleared):

```
rustc   1.98.1          solana-cli  4.1.2 (Agave, pinned by Anchor)
cargo   1.98.1          anchor      1.2.0  (via avm, from the verified git source)
node    v22.23.2        pnpm        12.5.1
```

**D-04 resolved** (BLOCKER-02): `anchor-lang 1.2.0` + `pyth-solana-receiver-sdk 2.0.0`. The documented "0.31.1 max" compatibility was stale prose; the crate requires `anchor-lang ^1.0.2`. The 0.31.x fallback is withdrawn as it would now be the *incompatible* choice.

**Build gate cleared (V-016b).** `anchor build` exit 0, linked `.so` + IDL, with `token_interface` and `PriceUpdateV2` both exercised. No program code written yet — that was correct until now. **Phase 1 is open.**

---

## COMPLETE — Phase 1

**Phase 0 complete for everything Phases 1–3 depend on.**

**Done in Phase 1 so far:**

- [docs/accounting.md](docs/accounting.md) — the Phase 1 gate. Every formula, rounding direction, overflow bound, both dilution proofs, worked examples. Produced **A-17** (withdrew A-03).
- [packages/domain/src/accounting.ts](packages/domain/src/accounting.ts) — chain-free `bigint` accounting model. Epoch lifecycle, reserved shares, redemption reserve/claim, checked arithmetic, `checkInvariants`.
- [packages/domain/src/display.ts](packages/domain/src/display.ts) — the display boundary. `effectiveMultiplier`, `activeTransferFee`, exact decimals, `supplyConsumptionBps`. The only module allowed to touch the multiplier.
- [packages/domain/test/accounting.test.ts](packages/domain/test/accounting.test.ts) — **23 tests, all passing**, no build step (`node --test`).

```
pnpm test        23/23 pass
pnpm verify      53/53 pass
money-lint       clean
```

**The property fuzzer found a real bug (REVIEW.md H-01).** `execute()` spent `activeUsdc` without subtracting USDC reserved for an in-flight exit. The `hasPendingReservations` freeze protects the window *before* reservation; the exposure is *after* it, once the freeze correctly lifts. Fixed, regression-tested, and the architecture now states the rule for **every** debitable vault, not just asset vaults.

Tests reproduce verified mainnet data directly: `effectiveMultiplier` returns 5 for SPACEX, 1.4861347 for OPENAI and 1.0032690125398187 for AAPLx; `activeTransferFee` returns 100 bps at epoch 1039 and 50 bps at 1038.

**Anchor program scaffolded and building:**

```
Cargo.toml              workspace, overflow-checks = true
Anchor.toml             [toolchain] pinned 1.2.0 / 4.1.2 (V-024)
programs/tenet/
  Cargo.toml            idl-build propagates to anchor-spl (V-016b)
  src/constants.rs      PDA seeds, limits, MIN_NAV_FOR_ISSUANCE
  src/errors.rs         62 named errors, one per failure branch
  src/math.rs           checked arithmetic, mirrors packages/domain
  src/state/mod.rs      12 account structs + layout tests

program id  FJt9WntCGo6suyjH4cndwgKjQ8rDSau1JxLA91UFB49v
            keypair at .keys/ (gitignored) - target/ is deleted to reclaim disk
anchor build  exit 0, tenet.so 50,872 bytes, IDL 8,543 bytes
```

```
cargo test -p tenet --lib   12/12 pass
node --test (domain)        23/23 pass
money-lint                  clean
pnpm verify                 53/53 pass
```

**Correction — the IDL does not yet prove the account layouts.** `tenet.json` contains 62 errors but **0 accounts and 0 types**: Anchor emits only types reachable from an instruction, and the Phase 1 `noop` references none of them. The doc comment claiming otherwise has been fixed. What backs the layouts today is `state::tests` — discriminator presence and uniqueness, size bounds, the NAV bitmap covering `MAX_CIRCLE_ASSETS`, and a `Circle` layout assertion that fails if anything balance-shaped is added. Real IDL coverage arrives with the Phase 2 instructions.

**D-07 — CORRECTION.** Host builds now use `CARGO_TARGET_DIR=/root/tenet-target` in the WSL filesystem, which is faster than building across `/mnt/c`. An earlier version of this note said that took 1.4 GB "off C:". **That was wrong:** the WSL filesystem is a `.vhdx` file stored on C:, so it relocated the space rather than freeing it. A second source was also missed: `anchor build`'s IDL step compiles a host debug build into the workspace `target/debug` (781 MB) regardless of `CARGO_TARGET_DIR`.

**U-12 closed — the Rust math reproduces the domain model.** `scripts/gen-math-vectors.ts` generates 2,020 cases from `packages/domain` (hand-picked branch cases plus seeded random, 1,694 values and 326 expected errors across all five arithmetic functions). `programs/tenet/src/math_vectors.rs` replays every one; all agree, errors included. Two safeguards make that meaningful:

- **The test can fail.** Flipping the transfer-fee rounding from up to down produced 211 disagreements, the first being "1 raw unit at 1 bps must cost 1, not 0". Restored; 13/13 pass.
- **The vectors cannot go stale.** `vectors.test.ts` regenerates the file and fails if the committed copy differs.

Building the vectors surfaced two model gaps, both fixed on the TS side: `supplyConsumptionBps` threw an untyped error and had no u64 narrowing, where Rust returns `DivisionByZero` / `MathOverflow`; and Rust's `weight_bps` had **no domain counterpart at all**, so nothing modelled it. `weightBps` now exists.

```
cargo test -p tenet --lib   13/13 pass
pnpm test (domain)          25/25 pass
```

**PDA module — one definition, checked from both sides.** `programs/tenet/src/pda.rs` has all 16 derivations from `docs/architecture.md` §2 (only 3 existed before, in `constants.rs`). `packages/sdk/src/pda.ts` mirrors them as **seed builders, not addresses**, so it takes no Solana library while **D-05** (web3.js vs Kit) is open — whichever wins takes these seeds unchanged. `tests/vectors/pda.json` holds 96 addresses derived from the TS seeds; `pda_vectors.rs` re-derives each with the runtime's `find_program_address` and all 96 match, address and bump.

- **The test can fail:** encoding u64 seeds big-endian produced exactly the 16 predicted mismatches (4 integer-seeded derivations × the 4 test values that are not byte-palindromes).
- **It also verifies the test harness:** the TS derivation uses a hand-written ed25519 on-curve check. 46 of 96 vectors needed a bump below 255, so a wrong curve check would have shown as bump mismatches.
- A Rust test pins the vectors to the current program id, so regenerating the keypair cannot leave them describing another program.
- `ExecutionAuth` seeds were ambiguous (`seq` in architecture.md, `nonce` in instructions.md and the struct). Resolved to `nonce`, with `epoch` meaning the Epoch **account**; the table is corrected.

**`overflow-checks` is now actually enforced.** `money-lint` already claimed R-03, but its regex matched from `[profile.release]` to *any* later `overflow-checks = true`. Tested against the old regex: it **passed** a commented-out setting, one placed only in `[profile.release.build-override]`, and one only in `[profile.dev]`; it also accepted a member-crate `[profile.release]` that cargo ignores. The rewrite parses the workspace-root section itself and flags `[profile.*]` in member manifests. All five broken configurations now fail; the real one passes.

**Build script hardened.** Host tests now use `CARGO_TARGET_DIR` (they were still writing 1.4 GB to C:), and the script refuses to build without the program keypair — `anchor build` would otherwise silently generate a new one and change the program id.

```
cargo test -p tenet --lib   15/15 pass
pnpm test                   31/31 pass  (domain 25 + sdk 6)
money-lint                  clean
pnpm verify                 53/53 pass
```

---

## IN PROGRESS — Phase 2 (pool)

**On-chain test harness: LiteSVM, in-process.** `tests/program` is a separate crate (not dev-deps of the program: `anchor build`'s IDL step compiles dev-deps, so LiteSVM would rebuild on every program build). It runs the real `target/deploy/tenet.so` — no validator, suited to this 7.7 GB machine. Spike: `noop` executed, 550 CU, 0.21 s; Anchor 1.2 and LiteSVM 0.16 types interoperate without conversion.

**Done — 14 instructions across config, registry, mandate, circle and Epoch 0:**

| instruction | notes |
|---|---|
| `initialize_config` | **A-18.** The spec used `config.registry_authority` / `config.usdc_mint` but never defined `Config`. Gated on the program's upgrade authority so nobody can race the deployer to appoint the registry authority. Asserts USDC is classic SPL with 6 decimals. |
| `upsert_registry_entry` | create-or-update; class must agree with the chain (USDC = classic SPL AND the configured mint; equities = Token-2022) |
| `create_mandate` | every spec §26 check, plus the underlying-company cap the spec list predates |
| `add_mandate_asset` | duplicates impossible (mint in the PDA seed) |
| `finalize_mandate` | reads all assets + registry entries as remaining accounts; **completeness** enforced (count + index bitmap) and each registry entry bound to its asset |
| `create_circle` | Circle + classic-SPL USDC vault owned by the `VaultAuthority` PDA |
| `add_circle_asset` | Token-2022 vault, **sized from the real mint's extensions** |
| `open_epoch` | epochs strictly in order; **refuses when shares are outstanding** (A-19) |
| `contribute` | into the derived per-epoch **escrow**, never active capital; min, pool cap, window, membership policy |
| `cancel_contribution` | full refund, no admin in the path |
| `close_contributions` | permissionless after the window |
| `finalize_epoch` | Epoch 0: shares = micro-USDC, exact, no oracle; sweeps escrow → active vault |
| `settle_contribution` | permissionless; never writes `total_shares` (A-20); receipt closed → double settle impossible |
| `close_epoch` | requires every receipt settled; releases residue |

```
host unit tests (program)    21/21
on-chain (LiteSVM)           36/36   config 9 · mandate 10 · circle 4 · epoch 13
TS (domain + sdk)            31/31
```

**Real mainnet mints in the tests.** `scripts/fetch-mint-fixtures.ts` snapshots USDC, SPACEX, OPENAI and AAPLx (`tests/fixtures/mints/`, slot-stamped). Circle tests load them byte for byte and create vaults through the real token programs; the vault's extension set is asserted equal to what Token-2022 says the mint requires.

**Mutation-tested, twice.** Config/mandate: 3 mutants, 4 targeted tests failed, nothing else. Epoch (money-moving): 4 mutants — escrow seeds removed, settle inflating `total_shares`, rolling-epoch guard removed, cancel not reducing `pending` — failed exactly the 5 predicted tests. The escrow mutant's failure: a contribution routed straight into the active vault *succeeded*.

**Spec corrections from Epoch 0:** A-19 (Epoch 0 needs no oracle; rolling epochs refused at `open_epoch` too, or contributions could be stranded), A-20 (`settle` must write `circle.reserved_shares`; guarantee restated as "never writes `total_shares`"), A-21 (an empty epoch deadlocked the Circle in the spec's version).

**Correction — who rejects a wrong token program.** I expected our `TokenProgramMismatch` constraint to reject a mismatched token program in `create_circle` / `add_circle_asset`. It does not run first: Anchor performs `init` (a CPI into `token_program`) while loading accounts, before plain constraints, regardless of field order — reordering was tried and changed nothing. The protection still holds (only the two genuine SPL programs are admitted, and each refuses a mint it does not own; the transaction reverts), and the tests now assert that — rejected, nothing created — instead of an error that never fires.

**Toolchain hazard found.** The Solana platform-tools compiler (rustc 1.95.0-dev) **crashes with an internal compiler error while rendering some warnings** — observed on a liveness warning. `wsl-build-tenet.sh` now runs a host `cargo check` first and refuses to build on any warning.

**Open from this work:** no `set_registry_authority` rotation (losing the key freezes classification, never custody) — needed before mainnet.

---

## IN PROGRESS — Phase 3 (exit)

**Built: 5 instructions** — `initiate_redemption`, `reserve_redemption_asset`, `reserve_redemption_usdc`, `claim_redemption_asset`, `claim_redemption_usdc`. No price account, oracle or approval anywhere in the exit path (RULE 6).

**Found and fixed before writing the on-chain code — REVIEW.md H-02 (HIGH).** In the reference model, two exits could initiate before either reserved; whichever reserved *first* took value from the other. Demonstrated: bob and carol at 30% each — carol reserving first took **428,571,428** and left bob **171,428,571**. Reservation is permissionless, so carol could always go first. The existing test was named "fair in every order" but only checked the *remaining* member, who is unharmed — the value moved between the two exiters. Fix **A-22**: exits are serialized, and `finalize_epoch` refuses while an exit is unreserved (otherwise an exiter could take a slice of newcomers' USDC). Test-first; new fuzzed invariant **INV-021** fails on its own with the guard removed.

**Found while building:** a count-based asset snapshot would have **deadlocked a Circle** whose vaults are not a contiguous `0..n` of Mandate indexes (`1 < 1` rejects asset 1; the exit never completes; every later exit and epoch blocks) and let a third party complete someone's exit by reserving a freshly created empty vault. Replaced with a snapshot **bitmap** of existing vaults.

```
on-chain (LiteSVM)   43/43   config 9 · mandate 10 · circle 4 · epoch 13 · redemption 7
TS (domain + sdk)    32/32   incl. INV-021 after every fuzzer step
```

Real mint behaviour exercised: SPACEX's **transfer fee** is borne by the exiting member (vault debited the full entitlement, fee withheld on the member's account, no Circle USDC moved); an issuer **pause** of SPACEX blocks only the SPACEX claim, every other claim pays, and the paused claim stays open and pays in full once unpaused.

**Mutation-tested on-chain.** Four mutants — reservations not subtracted, inflow guard removed, snapshot check removed, obligation not discharged on claim — failed exactly the five predicted tests. The reservation mutant reproduced the H-02 split on-chain: bob 300.0B vs carol 428.6B.

**Phase 3 exit criteria**

| criterion | status |
|---|---|
| `test_exit_without_oracle` with every price source disabled | ✅ no price account exists in the VM |
| `test_parallel_redemptions` in every permutation | ✅ both orders, equal to ±1 raw unit |
| a paused/failing asset leaves all other claims working | ✅ real SPACEX pause, and a frozen member account |
| `test_remaining_members_not_charged_exit_fee` | ✅ within the transfer-fee test |
| **Codex review sign-off in `REVIEW.md`** (spec §36) | ⏸ deferred by the user until everything is built |
| per-asset claim UI, fee disclosure before signing | ❌ `apps/web` (D-05 now resolved: Kit) |

---

## SDK — `packages/sdk` on Kit (D-05)

**Decision D-05: Kit + Codama** (user choice, on evidence). Anchor 1.2's own TS client (`@anchor-lang/core`) is built on `@solana/web3.js` 1.x and decodes `u64` as `BN`; the Kit client generated by Codama decodes `u64` as native `bigint`, which is what `packages/domain` uses throughout (RULE 4, V-018).

```
packages/sdk/idl/tenet.json          committed IDL copy — refreshed by every successful anchor build
packages/sdk/scripts/gen-client.mjs  Codama → src/generated (57 files); --check fails on drift
packages/sdk/src/index.ts            re-exports the client; money builders narrowed to bigint
pinned exactly                       @solana/kit 8.3.0 · program-client-core 8.3.0 · codama 1.11.0
                                     nodes-from-anchor 1.5.6 · renderers-js 2.5.0 · tsx 4.23.15
```

**Checked against the Rust side, not trusted.** The 12 generated PDA helpers reproduce all 67 Rust-verified derivations in `tests/vectors/pda.json` (address and bump); generated error codes equal those the on-chain tests observed (6062, 6074, 6075); `getCircleSize()` equals `8 + INIT_SPACE`. Corrupting one seed byte in the generated `circle` helper failed the cross-check **and** the drift check independently.

**`bigint` only for money.** Generated inputs accept `number | bigint` for u64/i64; a `number` above 2^53 silently loses precision. The SDK's `contribute`, `initiateRedemption`, `openEpoch` and `createMandate` narrow those fields to `bigint` in their types and refuse anything else at runtime.

**Supply chain.** First third-party packages in the repo, installed via `npx pnpm@12.5.1` (no global install). pnpm's install-script block stays on; esbuild's script is explicitly declined (`allowBuilds: esbuild: false`) after verifying `tsx` works without it. Lockfile passes pnpm's supply-chain policy check.

```
npm test   →  domain + PDA 32/32 · client drift check · SDK 5/5
```

**Not yet:** the web app (`apps/web`) — Phase 2 contribute UI and Phase 3 per-asset claim UI with fee disclosure before signing.

---

## DEVNET — live since 2026-09-21

```
program     FJt9WntCGo6suyjH4cndwgKjQ8rDSau1JxLA91UFB49v   (669,088 bytes, upgradeable)
authority   3oMfA5C9Lgmgj8wZ3yR9NUsBJG7jvj2o4SUXrchsiRyK   devnet-only wallet (WSL: ~/.config/solana/tenet-devnet.json)
test USDC   GXcCAwkuxFYeyHji4EiD4H4iy1dbKbuPNgXjoAYHhbMy   devnet test mint, 6 dp — NOT Circle USDC
test equity Fh8WnGFLtVbQSoJtxmdPqk66KiYnvo7QS9ofoZnUMp8i   plain Token-2022, 9 dp
circle      UQ4zJqWHaw5eFwULR3oLDyCehNYCj8GcK27cCD7ECeZ    from the e2e run
```

**Phase 2 exit criterion met.** `packages/sdk/scripts/devnet-e2e.ts` — through the Kit SDK, from a real wallet — ran config → registry → mandate → circle → **contribute → finalize → settle** → close, then an exit: initiate → reserve → claim. 19 transactions, first attempt, and 13 on-chain checks all passed, among them: wallet debited exactly 5 test-USDC; the 5 landed in the **epoch escrow** with the active vault untouched (INV-002); finalize swept it to active capital; the member held exactly 5,000,000 shares; **INV-001 held on devnet**; the exit was entitled to exactly 2.5 and received exactly 2.5, the Circle kept 2.5 with no obligations or pending exits left.

The "real wallet" is a CLI keypair. A browser-wallet run comes with `apps/web`.

**Deploy note.** The first deploy failed part-way on public-RPC write drops and its CLI-generated buffer could not be resumed (the one-time recovery phrase had been cut from the output). The buffer was closed and its SOL recovered; `scripts/wsl-devnet.sh deploy` now supplies its own buffer keypair so a failure resumes, and retries with a priority fee. The CLI's global default on this machine is **mainnet**; nothing in the devnet tooling relies on it.

---

## WEB APP — `apps/web` (Vite + React on the Kit SDK)

**Redesigned 2026-09-21** after user feedback that the first version was not a dashboard (it was a stacked form). Now: sticky nav (brand, Devnet pill, Circle switcher, wallet menu); a Circle header with status badge and a stat grid (active capital, total shares, members, **your position** with ownership %); a **holdings table** (symbol, Public/Pre-IPO badge, target weight vs the Mandate cap, exact vault quantity, your pro-rata share); **Mandate rules as meters** (largest asset, pre-IPO total, largest issuer, largest company — a rule at its cap turns amber); a sticky side column with an **epoch lifecycle stepper**, countdown, contribute box (quick amounts, balance, "you'll receive N shares") and an **exit card with a % slider and a per-asset preview of what you'd receive, net of issuer fees, before starting**; transaction toasts with Solana Explorer links; readable errors extracted from Anchor logs. Previews use the domain's `entitlementForRedemption` / `sharesForContribution` — the functions cross-checked against the Rust program. No market prices are shown; the page says why (Phase 4).

Static single-page app: every value comes straight from the chain through `@tenet/sdk`; no server, no secrets. Wallets via Wallet Standard (`@solana/react` 8.3 + `@wallet-standard/react`), filtered to those that can sign and send on **devnet**. A permanent banner states the "USDC" is a devnet test mint.

- **Readable without a wallet.** Anyone can load a Circle and see its Mandate rules (per-asset, pre-IPO, issuer and company caps), state, shares, members, vaults and current epoch before trusting it with money. Actions need a connected wallet.
- **Contributions** follow the program's state machine: open epoch 0 → contribute / cancel & refund → close window → finalize → settle → close epoch. Rolling epochs show *why* they are unavailable (Phase 4 pricing) instead of a dead button.
- **Exit**: start an exit, reserve remaining assets (labelled "anyone can"), then **claim each asset separately** — a failing asset shows its own error and leaves the rest claimable. Serialized exits are explained in the UI (H-02).
- **Transfer-fee disclosure before signing**: each asset claim shows "you receive" net of the issuer's Token-2022 fee, computed by the domain's tested `activeTransferFee` (V-004) from the mint read via `jsonParsed` (Kit returns integers as `bigint`).
- **Money never touches a JS `number`**: amounts parse from strings with the domain's exact decimal parser, format from `bigint`; bps formatted in integer arithmetic.

Verified in the browser pane against live devnet: the e2e Circle renders exactly (Active, 2.500000 shares, 1 member, 1 vault — found by an on-chain discriminator scan — epoch 1 not opened). No console errors. **375 px** phone width had a horizontal overflow (a 44-character address input) — fixed, re-measured, none. Production build: 325 KB JS, `process.env` fully substituted (the generated SDK references it; browsers have none).

Supply chain: `@tanstack/react-query` 5.103.2 was **10 hours old** and pnpm's release-age policy flagged it — pnpm then wrote itself an exception into `pnpm-workspace.yaml`. Removed the exception and pinned 5.103.1 (5 days old) instead.

**Not yet verified: signing.** The in-app browser cannot run wallet extensions. A fresh Circle with no shares (`GcAB7dpPG4H9QeVDci9A5V92WNCADCQm7SeS5bKnSECS`) is prepared as the app's default for a browser-wallet run; `scripts/wsl-devnet.sh fund <address>` mints test USDC to a tester.

---

## NEXT

1. **Browser-wallet devnet run** of `apps/web` (needs the user's wallet — Phantom/Solflare/Backpack on devnet).
2. Regenerate the IDL/deployable artifact and run `refresh_asset_metadata` integration coverage (permissionless, A-16) — the on-chain half of V-003/V-004.
3. Close V-007 (Pyth) and V-011 — Phase 4 only.

**Codex review — deferred by the user to after everything is built** (2026-09-21). Phase 3 is functionally complete but not signed off until then; the H-02 fix and the dilution proof are the priority items for that review.

R-23 is settled in practice: both an **issuer** cap (counterparty risk) and an **underlying-company** cap (concentration) exist and are enforced at finalization.

---

## BLOCKED

### ~~BLOCKER-01 — Anchor cannot build on Windows~~ — **CLEARED**

Resolved by provisioning WSL Debian. Rust/Anchor work runs there; TypeScript runs on either. `D-07` (repo on `/mnt/c` vs the WSL filesystem) is still open — the spike builds in `/root` to avoid the cross-boundary penalty.

### ~~BLOCKER-02 — Anchor / Pyth version conflict~~ — **CLEARED by V-016**

Resolved from crate metadata, pending build confirmation. If the spike fails, this reopens — and a hand-rolled Pyth deserialisation remains forbidden as a workaround (RULE 8).

### ~~BLOCKER-03 — SBF build~~ — **CLEARED 2026-09-21 (V-016b)**

```
anchor build            EXIT = 0
target/deploy/spike.so  112,400 bytes
target/idl/spike.json     5,703 bytes
```

Two causes, neither a dependency problem:

1. **Host memory pressure** wedged the WSL VM. `.wslconfig memory=5GB` on a 7.7 GB host
   starved Windows; both sides thrashed. Corrected to `memory=3GB, swap=10GB, processors=4`,
   cleared by a reboot.
2. **`idl-build` did not propagate to `anchor-spl`**, plus the `anchor init` template's
   leftover test referencing scaffold instructions. Both one-line fixes — see V-016b for the
   exact `Cargo.toml` / `Anchor.toml` settings the real program needs.

Diagnostic lesson: the first three attempts piped `anchor build` through `tail`, which buffers
and discarded every diagnostic when the process died. That turned a feature-flag fix into a
long misdiagnosis, including a wrong OOM hypothesis. **Build output goes to a log file.**

### ENV-01 — This machine is disk- and memory-constrained (ongoing)

```
C: drive      ~237 GB capacity, reached 0 bytes free mid-build
RAM           7.7 GB total
WSL vhdx      grew to 11.59 GB
```

**What this project consumed:** platform-tools 3.2 GB · rustup 2.6 GB · the throwaway D-04 spike 1.7 GB · agave 662 MB · cargo registry 566 MB · nvm 237 MB, plus ~1.1 GB of `target/` directly on C:.

**Reclaimed so far:** 2.9 GB inside the guest (the spike, the unused Rust 1.85 toolchain that the *withdrawn* Anchor 0.31 fallback would have needed, the superseded Agave 4.2.2, and the cargo source cache) and 1.1 GB of `target/` on C:. C: went from **0 → 4.14 GB free**.

**Still recoverable, needs elevation.** The guest now uses 8.4 GB of an 11.59 GB vhdx. `wsl --manage Debian --set-sparse true` succeeded and applies going forward, but already-allocated blocks need an explicit compact from an elevated shell, with WSL shut down first (`diskpart` → `select vdisk file="…\LocalState\ext4.vhdx"` → `compact vdisk`).

**Consequences for the build plan.**

1. A full `anchor build` costs ~1.1 GB of `target/` on C:. With ~4 GB free that is workable but not comfortable. This strengthens the case for resolving **D-07** by building from the WSL filesystem rather than `/mnt/c`.
2. The program keypair is preserved at `.keys/tenet-keypair.json` (gitignored) precisely because `target/` is now something we delete to reclaim space. Losing it would change the program id.
3. Heavy builds should not run alongside other memory-hungry applications.

**Status after Phase 1 closed (2026-09-21): C: at 1.59 GB free — below what Phase 2 needs.** A full `anchor build` transiently writes ~0.9 GB (`target/debug` 781 MB + `target/release` 134 M), deleted after each build. The Phase 2 test harness (LiteSVM) compiles a large slice of the Solana runtime as a dev-dependency — several hundred MB more inside the vhdx. `fstrim` with sparse mode recovered only 0.18 GB. C: is the only drive. Everything regenerable that this project created has already been removed; what remains is the toolchain itself and the deliverables. **Blocked on the user**: freeing space on C: (their files, not ours to touch), or an elevated `diskpart` → `compact vdisk` of the WSL disk (~2–3 GB, described above).

### Open, non-blocking for Phases 1–3

- **V-007** — Pyth layout, feed IDs, API key. Blocks Phase 4 only.
- **V-010/V-011/V-012/V-013** — public-equity universe, trade sizing, corporate actions, eligibility.

---

## LIVE VERIFICATION

| id | subject | status |
|---|---|---|
| V-001 | PreStocks issuer API — 8 live assets | VERIFIED |
| V-002 | ANTHROPIC mint Token-2022; full issuer-control set | VERIFIED |
| V-003 | **SPACEX effective multiplier is 5, field reads 1**; API supply is scaled | VERIFIED |
| V-004 | Transfer fee 100 bps uncapped; epoch 1039; recently doubled | VERIFIED |
| V-005 | Jupiter routes PreStocks; executable ≠ issuer indicative (~5%) | VERIFIED |
| V-006 | Toolchain reality; WSL required | VERIFIED |
| V-007 | Pyth post-upgrade layout / feeds / API key | **UNVERIFIED** |
| V-008 | Jupiter integration path | superseded by V-020 |
| V-009 | `prestocks-pulse` provenance (MIT, methodology matches) | REPORTED |
| V-014 | **USDC: classic SPL Token, 6 decimals, no fee** — A-02 holds | VERIFIED |
| V-015 | Anchor repo is `otter-sec/anchor`; **crates.io `avm` is an unrelated 2016 package** | VERIFIED |
| V-016 | **D-04 resolved** — Pyth SDK 2.0.0 requires `anchor-lang ^1.0.2` | VERIFIED |
| V-017 | **Multipliers are non-integer** (OPENAI = 1.4861347); 2 of 8 assets carry the trap | VERIFIED |
| V-018 | **`res.json()` silently corrupts u64 > 2^53** (maximumFee read as 2^64) | VERIFIED |
| V-019 | All 8 assets routable; issuer controls uniform across the universe | VERIFIED |
| V-020 | **Jupiter `JUP6Lkb…`; `maxAccounts` is not a cap; `onlyDirectRoutes` bounds to 24–30** | VERIFIED |
| V-021 | Pyth `rec5EKMGg…` and `pythWSnsw…` live on-chain | VERIFIED (existence) |
| V-016b | **Anchor 1.2.0 + anchor-spl + Pyth SDK 2.0.0 compile and link to SBF + IDL** | **VERIFIED — D-04 closed** |
| V-010 | **xStocks universe: 20 assets, Token-2022, 8 dp, NO transfer fee** | VERIFIED |
| V-026 | **Multiplier drift is routine, not rare; `multiplier` field stale everywhere** | VERIFIED |

---

## KNOWN RISKS

Full register in [docs/threat-model.md](docs/threat-model.md).

- **R-09 (irreducible)** — every PreStocks mint carries `permanentDelegate`, `freezeAuthority`, `pausable` and a transfer-hook authority under one issuer key. Uniform across all 8 assets, so the disclosure is universal.
- **R-08 (verified, worse than first assessed)** — the naive multiplier read is wrong on 2 of 8 assets, and multipliers are arbitrary decimals (1.4861347), so exact integer arithmetic through them is impossible. This is now the strongest argument for raw-units-only ownership accounting.
- **R-03 (new evidence)** — V-018 shows silent u64 corruption is reachable through ordinary JSON parsing, not just Rust arithmetic. `res.json()` is banned codebase-wide.
- **R-11** — account count, not byte size, is the execution constraint; `maxAccounts` cannot be trusted as a bound; routing is non-deterministic between quote and execution.
- **R-14** — upgrade authority must be burned or disclosed before any production claim.

---

## DECISIONS

| id | decision | status |
|---|---|---|
| A-01 | Mint in `MandateAsset` / `CircleAsset` PDA seeds | fixed |
| A-02 | Shares `u64`, 6 dp; 1 share = 1 micro-USDC at inception | **confirmed by V-014** |
| A-03 | ~~`RATE_SCALE = 1e18`~~ — **superseded by A-17** | withdrawn |
| A-04 | `close_epoch` releases the share rounding residue | fixed |
| A-05 | NAV accumulated across transactions via `NavSnapshot` | fixed |
| A-06 | `MAX_CIRCLE_ASSETS = 8` | fixed |
| A-07 | Redemption = burn → reserve → claim | **needs Codex review** |
| A-08 | Execution via sandwich + introspection; CPI fallback | contingent on the spike |
| A-09 | Supply consumption in raw units only | **reinforced by V-017** |
| A-10 | Attestation may only narrow, never widen | contingent on Phase 0 |
| A-11 | Upgrade authority burned or disclosed | open |
| **A-12** | **Execution uses `onlyDirectRoutes=true`; assert account count pre-submission** | **new, from V-020** |
| **A-13** | **All JSON parsed with exact source-text preservation; `res.json()` banned** | **new, from V-018** |
| D-04 | `anchor-lang 1.2.0` + `pyth-solana-receiver-sdk 2.0.0` | **resolved, build pending** |
| D-05 | **Kit + Codama** (client generated from the IDL; `u64` as native `bigint`) | **resolved 2026-09-21** |
| D-07 | **host `CARGO_TARGET_DIR` in the WSL filesystem; anchor deliverables stay in the workspace** | **resolved — 1.4 GB off C:** |

## DASHBOARD UI PASS — 2026-09-22

- Added a compact Circle workspace navigation bar linking Holdings, Value, Mandate, and Contribute/exit.
- Reworked the mobile header layout so wallet connection, network state, and Circle switching remain readable on narrow screens.
- Added a subtle constitutional visual treatment to the hero without changing on-chain data or introducing fabricated values.
- Verified the live devnet preview at `http://127.0.0.1:5173/`.
- TypeScript check and Vite production build pass.
- Added the Tenet principle strip to make the hackathon wedge explicit: collective capital, Mandate-constrained execution, and forkable rules.
- Re-ran read-only integration verification: 61 checks, 0 blocking failures, 8 warnings. Confirmed current PreStocks discovery, Token-2022 controls, and OpenAI/SpaceX effective multipliers.
- Added an exact-decimal PreStocks market-vs-issuer-mark surface with a same-origin dev proxy. Browser display remains unavailable when the host cannot reach the external source; no fallback values are shown.
- Added tested Pyth admission policy: registry-bound feed IDs, freshness, future timestamps, invalid values, and confidence-width limits are rejected before valuation.
- Expanded the root test command to include valuation and oracle-policy coverage.

## VPS BUILD VERIFICATION — 2026-09-22

- Provisioned the Qevor VPS with the native Anchor/Solana build dependencies.
- Verified the exact project toolchain remotely: Anchor CLI 1.2.0, Solana CLI 4.1.2, and platform-tools v1.57.
- Transferred the source tree to `/opt/tenet` without `.git`, dependencies, build outputs, or environment files.
- Remote `cargo test -p tenet --lib`: 21 passed, 0 failed.
- Remote `anchor build`: passed after restoring the canonical `.keys/tenet-keypair.json` into the disposable build directory. The source `declare_id!`, `Anchor.toml`, and canonical keypair all agree on `FJt9WntCGo6suyjH4cndwgKjQ8rDSau1JxLA91UFB49v`.
- Remote `cargo test -p tenet-program-tests`: 50 passed, 0 failed across Circle, registry refresh, Epoch, Mandate/Fork, and redemption suites.
- Refreshed the committed SDK IDL from the VPS build and regenerated 63 Codama client files. This exposed previously stale client coverage for `fork_mandate`, `fork_mandate_asset`, and `refresh_asset_metadata`.
- SDK/domain/invariant suite after regeneration: 46 passed, 0 failed.

## FORK UI PASS — 2026-09-22

- Added a consumer-facing Fork surface to the Circle dashboard.
- The flow creates a child Mandate, copies each dedicated MandateAsset rule, and finalizes the child only after all rules are present.
- Asset-copy steps use separate transactions so the maximum eight-asset constitution does not depend on one oversized transaction.
- A partially completed flow can resume from the same child address; no parent Circle, vault, member, or capital account is supplied to the Fork path.
- Added the Fork builders to the checked SDK package surface without exposing any new raw-number financial inputs.
- Web TypeScript check and Vite production build pass after the UI change.

## EXECUTE UI PASS — 2026-09-22

- Added an explicit Execute section to the consumer dashboard and workspace navigation.
- The surface documents the verified integration boundary: Jupiter Swap V2 Router, Circle USDC vault input, Mandate-approved destination vaults, and raw pre/post vault-delta protection.
- The action remains disabled until supported target Pyth feeds and a controlled Token-2022 vault-delta execution are verified. No swap, signer, or Circle vault was used.
- Web TypeScript check, Vite production build, and money-lint all pass after the change.

## BUILD VERIFICATION — 2026-09-22

- Web TypeScript check and Vite production build pass.
- Domain/accounting/PDA suite: 48 passed, 0 failed.
- SDK client suite: 6 passed, 0 failed; generated client remains current at 63 files.
- Money-lint: clean.

## EXECUTE BOUNDARY VERIFICATION — 2026-09-22

- Added `begin_execution` / `end_execution` to the Anchor program as a fail-closed execution boundary.
- `begin_execution` binds the Circle, MandateAsset, CircleAsset, source USDC vault, destination vault, token programs, expiry, balance allowance, and Jupiter instruction window; it rejects before any route can move funds while verified price policy is unavailable.
- `end_execution` verifies raw source/destination vault deltas, maximum input, minimum output, vault ownership, mint bindings, and revokes the temporary source-vault delegate before closing the execution authorization.
- Preserved the existing on-chain error-code order; regenerated the SDK from the rebuilt IDL and retained the stable `findActiveUsdcVaultPda` export alias.
- VPS `anchor build`: passed. VPS program suite: **51 passed, 0 failed**.
- Added `test_execution_window_is_fail_closed`; no Jupiter route, signer, mainnet transaction, or funded real-capital swap was used.
- Full production execution remains gated on verified target Pyth feeds, on-chain price-impact/cap enforcement, and a controlled vault-delta route.

## EXECUTION CAP PASS — 2026-09-22

- Added live raw supply-consumption enforcement to `end_execution`: the destination vault's post-execution raw balance is checked against the live mint raw supply and `Mandate.max_supply_consumption_bps` using checked `u128` arithmetic.
- Added zero-supply and exact-boundary unit coverage; the cap never uses ScaledUiAmount, UI quantities, quotes, or floating point.
- Bound `end_execution` to the active Circle Mandate, the exact MandateAsset, and its registry entry; the registry token program must match the live output mint owner.
- Rebuilt the Anchor artifact and IDL on the VPS; the full remote program suite remains **51 passed, 0 failed**.
- Price-impact, issuer, pre-IPO, and NAV-dependent caps remain release-gated until verified price observations are available; no execution path was enabled.
- Updated the consumer Execute surface to distinguish the armed raw supply cap from the still-gated price-dependent checks; web typecheck and Vite build pass.

## PYTH EXECUTION ADMISSION PASS — 2026-09-22

- Added the pinned `pyth-solana-receiver-sdk 2.0.0` dependency and resolved it against Anchor 1.2.0 on the VPS.
- Added a `PriceUpdateV2` account to `end_execution`; the handler requires full Pyth verification, a registry-bound feed ID, a 60-second freshness window, positive price, and confidence no wider than 100 bps.
- Added integer-only Pyth fair-output arithmetic with the Mandate price-impact floor; no floating-point or UI amount enters the check.
- Anchor build with `PriceUpdateV2`: passed. VPS Rust suite: **24 passed, 0 failed**; full program suite remains green after IDL regeneration.
- This does not close the external-data gate: target tokenized-equity feed IDs and a controlled Jupiter route still require live verification before `begin_execution` can stop failing closed.

## ON-CHAIN NAV SNAPSHOT PASS — 2026-09-22

- Added `open_nav_snapshot`, `record_asset_nav`, and `cancel_epoch` to the Anchor program and regenerated the SDK/IDL.
- Rolling epochs now use a bounded `NavSnapshot` PDA: active USDC and unreserved vault balances are read directly from token accounts; each CircleAsset is recorded once through a bitmap.
- NAV valuation is feed-bound to the registry's Pyth tokenized-equity feed, requires fresh/high-confidence `PriceUpdateV2`, and applies the refreshed ScaledUiAmount multiplier only at the economic valuation boundary.
- `finalize_epoch` uses the frozen snapshot for rolling share issuance, while Epoch 0 remains exact and oracle-free. Stale or never-opened rolling snapshots have permissionless cancellation recovery so isolated escrow cannot strand contributors.
- Added integration coverage for rolling-epoch admission and cancellation recovery; remote Rust unit suite is **25 passed, 0 failed** and full program suite is **51 passed, 0 failed** after the change.
- Production execution remains gated: target live feeds, issuer/PreStocks execution trust, and a controlled Jupiter vault-delta route still require verification.

## ROLLING EPOCH UI PASS — 2026-09-22

- Added live snapshot discovery to the web chain loader and regenerated SDK exports for `open_nav_snapshot`, `record_asset_nav`, and `cancel_epoch`.
- The Contribute surface now distinguishes Epoch 0 from rolling pricing, offers “Open NAV snapshot” for active Circles, shows remaining asset observations, and never offers rolling finalization without the snapshot account.
- Updated stale “Phase 4” copy so the consumer dashboard describes fresh verified observations and isolated escrow recovery accurately.
- Web TypeScript check and Vite production build pass; SDK generation check and SDK/PDA suite remain **12 passed, 0 failed**.
## DASHBOARD BOOT/PORT REPAIR — 2026-09-22

- Replaced the stale local preview process on port 5173 with the current Vite server; the dashboard now mounts and loads the devnet Circle workspace at `http://127.0.0.1:5173/`.
- Added an index boot screen and startup-error surface so a failed module load cannot present as an empty black page.
- Browser verification: Circle workspace, holdings, value safeguards, Mandate rules, and read-only wallet state rendered successfully.
- Verification: web TypeScript passed, Vite production build passed, and `money-lint` remained clean.

## DASHBOARD VISUAL PASS — 2026-09-22

- Reworked the design tokens, workspace navigation, hero hierarchy, stat cards, spacing, contrast, and action-panel treatment for a more deliberate consumer investment UI.
- Preserved all existing read-only/data-integrity language and did not add fabricated performance, prices, or execution affordances.
- Verification: browser rendered the live devnet Circle with no console errors; web TypeScript, Vite production build, and `money-lint` passed.

## EXECUTION PREFLIGHT REGRESSION — 2026-09-22

- Added `test_end_execution_builder_binds_circle_usdc_vault` so the execution test surface explicitly guards the Circle-scoped USDC source-vault binding introduced in the corrected `EndExecution` account model.
- Kept `test_execution_window_is_fail_closed` fail-closed: LiteSVM does not load the real Jupiter program, so the fixture does not pretend a Jupiter route is executable.
- VPS `cargo test --manifest-path tests/program/Cargo.toml -- --test-threads=1`: **55 passed, 0 failed**.
- No mainnet transaction, signer, funded swap, or production execution enablement was performed.

## INTEGRATION VERIFIER ENVIRONMENT FIX — 2026-09-22

- Confirmed the authorized VPS already contains `JUPITER_API_KEY` and `PYTH_API_KEY` in `/opt/tenet/.env`; the prior warning came from the verifier not loading `.env`.
- Updated `scripts/verify-integrations.ts` with a minimal non-executing `.env` loader. Explicitly exported variables still take precedence, and secret values are never logged.
- Credentialed read-only replay: **67 checks, 0 blocking failures, 3 warnings**. Pyth Hermes authentication passed; Jupiter v2 Router `/build` passed for all 8 dynamically discovered PreStocks assets.
- Remaining release gates are target-asset Pyth feed binding, current Jupiter on-chain program/CPI/account verification, and controlled vault-delta evidence. No swap or signer was used.
- The three warnings are HTTP 429 route observations for OpenAI, Polymarket, and SpaceX. They do not authorize execution.
- V-007 and V-008 remain open for target feed binding/layout, the current Jupiter on-chain program/CPI/account contract, and a controlled Token-2022 vault-delta transaction.

## UI REFERENCE / WORKSPACE PASS — 2026-09-22

- Classified 18 supplied reference PNGs as 11 unique references across light/dark landing, dashboard, Explore, Circle detail, Mandate/Fork, mobile, and the design system. Exact duplicates remain preserved in the repository.
- Added [docs/ui-reference-map.md](docs/ui-reference-map.md) with the source-to-screen map and the rule that illustrative screenshot values must never enter production data paths.
- Replaced the old jade/black visual foundation with shared Inkberry, Deep Plum, Peach, Warm Mist, positive, negative, market-data, warning, and neutral semantic tokens. Added persisted System / Light / Dark selection without changing financial logic.
- Added a responsive desktop Circle workspace rail and a live-data-only Explore surface. Explore renders the loaded on-chain Circle and clearly reports when directory indexing or performance data is unavailable; it does not fabricate discovery results.
- Browser validation passed on a clean Vite preview at `http://127.0.0.1:5175/`: light mode, Circle workspace, Explore navigation, devnet notice, and unavailable-price states rendered correctly. The old 5173 process had a stale Vite module graph and was not used as validation evidence.
- Web TypeScript check, Vite production build, money-lint, domain/PDA suite (**48 passed, 0 failed**), and SDK generation check pass. The local SDK client test command remains environment-blocked because the workspace root has no resolvable `tsx` package; no source failure was inferred from that missing dependency.
- Continued the reference implementation with a consumer landing page and a dedicated Mandate inspection surface. Landing CTAs lead to actual Circle/Explore views; Mandate limits, assets, lineage, membership and Epoch controls are read from the loaded on-chain accounts. Its Fork CTA enters the existing Circle Fork flow.
- Rechecked the landing and Mandate screens in the browser; live devnet rules rendered, including asset exposure class and fork lineage. Web TypeScript check and Vite production build pass after these additions.
- Added a fixed, safe-area-aware mobile tab bar for Home, Explore, Circle, and Mandate. Route navigation now resets to the selected surface, avoiding stale anchor positions after switching screens. Web TypeScript check and production build pass.

## LANDING REFERENCE FIDELITY — 2026-09-23

- Replaced the landing page's invented orbit illustration with a reference-led hero: community contribution, Circle, Mandate, and governed asset categories.
- Added a transparent community portrait asset at `apps/web/public/tenet-community-hero.png`, derived from the supplied dark landing reference's visual direction. Mock financial figures from UI references remain excluded from the production interface.
- Reworked the public hero typography, dark Inkberry/Deep Plum treatment, Peach emphasis, CTAs, and flow composition; preserved the `/` landing and `/app` workspace split.
- Verification: web TypeScript and Vite production build pass; domain/PDA tests **48 passed**, SDK client tests **6 passed**; final HTTPS landing was browser-verified after VPS deployment.
- `pnpm test` wrapper is environment-blocked because this host's pnpm attempted to purge the modules directory without a TTY (also reports Node 24 vs repository Node 22 engine). Equivalent test commands completed directly. ESLint is unavailable in the local root node_modules.

## TENET SPA ROUTE REPAIR — 2026-09-23

- Fixed `/app` deep links on both `http://38.49.209.149:8503` and HTTPS: Caddy now serves `/opt/tenet-preview/dist` with `try_files {path} /index.html`.
- Replaced only the PM2-managed `tenet-preview` Python static server that returned 404 for `/app`; saved the remaining PM2 process list so the old server is not resurrected after restart.
- Preserved port 8501 and its Streamlit listener. Backed up the previous Caddyfile at `/etc/caddy/Caddyfile.before-tenet-spa-20260923` before activation.
- Verification: Caddy config validates; `/app#explore` rendered the Explore surface in browser at both port 8503 and HTTPS; port 8501 listener remained unchanged.

## CIRCLE DASHBOARD CLARITY PASS — 2026-09-23

- Reordered the Circle view so actual holdings/status lead, clarified that the current Circle is an empty devnet demo with no real stock position, and identified TEQx as a test token rather than equity exposure.
- Replaced visible `tUSDC`/Epoch/NAV/execution jargon with consumer-facing wording; retained the underlying contribution, valuation, exit, and governance behavior.
- Hid the long Circle address behind an “Open another Circle” disclosure and moved router/security implementation detail behind an explanation disclosure.
- Verification: web TypeScript check, Vite production build, `git diff --check`, domain/PDA tests (**48 passed**), and SDK generation/client tests (**6 passed**).
- Rendered the devnet Circle locally in the browser and confirmed it reads “This Circle has not invested yet,” reports 0 test USDC, shows TEQx only as an allowed test token, and explains why there are no stock positions.
- This pass is local-only; the VPS has not been updated or re-verified.

## APP-WIDE PRODUCT CLARITY PASS — 2026-09-23

- Applied consistent plain-language copy across the public landing page, Circle dashboard, Explore, Mandate details, contributions, execution status, exits, Fork, and account/network error paths.
- Distinguished Mandate target allocations from actual Circle holdings; changed the personal position headline to ownership percentage and explained that displayed asset portions are token amounts, not dollar values.
- Made the landing flow explicitly illustrative and stated that the current devnet demo has no stock holdings. The on-chain Circle currently has 0 active test USDC, 0 members, no held tokens, and TEQx only as an allowed test asset; no stock prices or real investment claims were added.
- Clarified contribution-window duration in human units, pending-funds and exit-preparation messages, and the fact that automatic contributions are not available or authorized.
- Fixed invalid Circle-address feedback so a malformed address is reported beside the address field instead of being presented as an RPC/Circle-load error.
- Verification: web TypeScript check and Vite production build pass; domain/PDA tests **48 passed**, SDK client tests **6 passed**, generated client check and `git diff --check` pass. Landing, Explore, Mandate, and Circle dashboard were checked in the local browser preview.
- This pass is local-only. It does not deploy or update the VPS; the local preview is at `http://127.0.0.1:5176/`.

## FORK END-TO-END REPAIR — 2026-09-23

- Inspected the current Fork UI, generated SDK account/instruction APIs, Anchor `CreateCircle` / `AddCircleAsset` constraints, existing Fork instructions, and current tests.
- Found the Fork flow only created/copied/finalized a child Mandate. It never created the independent Circle or its token vaults, while the UI reported “New Circle created” as soon as a derived Mandate address existed.
- Added `docs/ui-redesign-plan.md` before the component changes, following the supplied UI prompt. Kept this pass scoped to truthful Fork progress and recovery.
- Fork now creates the Circle and each asset vault using the source Circle’s recorded token program, persists the non-secret seed in session storage for retries, validates copied rules/lineage/vault PDAs, and reports completion only after fetching all required child accounts. It offers an explicit “Open new Circle” action.
- Wallet simulation failures now say the step was not confirmed and tell users to cancel unsafe prompts; retries detect already-confirmed steps instead of duplicating setup. No wallet transaction was signed by Codex.
- Added `test_forked_mandate_creates_independent_circle_and_vaults`, covering child Circle/vault creation, zero initial child custody, and unchanged parent accounts/vaults. Adversarial sign-off remains open in `REVIEW.md`.
- Local verification: web typecheck passed; Vite production build passed; `money-lint` passed; domain/PDA suite **48 passed**; SDK generated-client check passed; SDK client suite **6 passed**; `git diff --check` passed; Rust test source parsed.
- Local LiteSVM execution is blocked: offline Cargo dependency resolution cannot find `pyth-solana-receiver-sdk`, and the required `target/deploy/tenet.so` is absent. No network install or VPS deployment was attempted.
- Browser smoke test on `http://127.0.0.1:5176/app`: live devnet Circle loaded, Explore and Mandate navigation rendered the expected surfaces. Browser wallet was not connected, so signing/transaction execution was intentionally not attempted.

## CONSUMER APP NAVIGATION / VISUAL PASS — 2026-09-23

- The user reported that the landing and workspace still felt combined and the dashboard was scattered. Confirmed the old `5176` process served stale HTML from another running local preview; opened this workspace's current Vite app on `http://127.0.0.1:5177/` for verification.
- Replaced the single long Circle page with focused Overview, Portfolio, Prices, Mandate, Contribute, Exit, and Fork screens. Overview now leads with three honest signals (cash-only Circle value or unavailable priced NAV, member position, Mandate state), holdings, and direct actions. Advanced accounting/rule explanations remain available in disclosures.
- Simplified desktop navigation, added a five-action mobile/tablet bottom bar, preserved independent `/` public and `/app` workspace destinations, and made browser Back restore the previous screen.
- Replaced the purple visual palette with Graphite, Warm Ivory, Peach, Sage and Market Blue; added a serif headline paired with the existing sans UI. Both Light and Dark render in the same structure.
- Browser checks on the actual `5177` process: landing, Circle overview, Portfolio, Mandate, Contribute wallet-required state, Fork entry, Light/Dark styling, and Back navigation rendered correctly against the existing devnet Circle. No wallet transaction was signed. The devnet Circle still has 0 active test USDC, 0 held assets, and only the permitted TEQx test mint.
- Web TypeScript and production bundle build pass; money-lint passes; domain/PDA tests **48 passed**; SDK generated-client check passes and client tests **6 passed**. The new Rust Fork lifecycle test remains unexecuted locally due missing offline Cargo dependency and deployable artifact.
- This UI pass is local. Port `5176` and the VPS preview were not replaced. A read-only SSH access check to the previously authorized VPS failed with `Permission denied (publickey,password,keyboard-interactive)`; no remote files or services were changed. Production stock execution, live NAV, and a signed end-to-end contribution/exit/fork remain open gates.
- Continued the consumer pass in the user-visible narrow browser tab: redirected that tab from the stale `5176` preview to this workspace's `5177` server. Verified the mobile Overview, Portfolio and Exit layouts and the bottom navigation. Simplified Explore to one verified Circle and a small directory-status note.
- Portfolio now lists only nonzero vault-held assets; permitted but unpurchased TEQx appears as an explicit explanation, not as a holding. The accounting methodology is available on demand. Cash-only Circle value is shown from active test USDC; priced NAV remains unavailable when unpriced assets are held.
- Wallet-required action screens now include a direct Connect wallet control. In the in-app browser, no devnet-capable wallet was detected, so signed contribution/exit/fork testing remains open. The post-change web typecheck, production build, money-lint and diff check pass.

## FINAL UI/UX BUILD PROMPT — 2026-09-23

- Read the complete supplied UI/UX prompt, inspected the current public landing and `/app` Circle workspace, searched the repository image inventory, and added `docs/ui-rebuild-plan.md` before the implementation pass.
- Expanded the public landing into the requested story: hero, investment-category rail, product mechanics, scroll journey, current on-chain Mandate summary, permitted asset universe, market-intelligence availability, manual/automatic contribution states, exit, Fork, and final CTA.
- Reused the existing four-person `apps/web/public/tenet-community-hero.png`. No additional reference images or stock logos exist in the repo. No issuer examples, token prices, returns, performance, or fake automation were added.
- Circle-specific rule/asset details come from the loaded devnet Mandate registry. The permitted `TEQx` test token is explicitly labeled as a devnet test asset, distinct from the Circle's actual zero stock holdings.
- Moved shared System / Light / Dark state to the router so the public page and app use the same persisted theme. Added restrained, reduced-motion-aware editorial rails. Simplified desktop primary navigation to Overview, Explore, Holdings, Prices & value, and Mandate; money actions remain directly available from Overview.
- Verified the local landing at the available phone-sized viewport, including the hero, mid-page story, asset section, and sticky-header anchor offset. Opened “Open the demo” and confirmed the separate `/app#top` Circle workspace loads from the public site. Desktop/tablet responsive QA is still open.
- Verification: direct web TypeScript check passed; Vite production build passed; domain/PDA suite **48 passed**; SDK generated client check passed; SDK client tests **6 passed**; money-lint and `git diff --check` passed.
- `pnpm --filter @tenet/web typecheck` could not start because pnpm attempted to remove/install the shared modules directory in a non-interactive shell. Direct local binaries were used; SDK tests passed when run from `packages/sdk` so the local `tsx` package resolves.
- UI-only changes; no Anchor, custody, valuation, execution or wallet transaction logic changed. No transaction was signed and no VPS deployment was performed. The current preview is local at `http://127.0.0.1:5177/`.

## MAINNET READ-ONLY READINESS CHECK — 2026-09-23

- `pnpm verify` could not launch because the local pnpm wrapper attempted a non-interactive dependency purge under unsupported Node 24 / pnpm 11. Ran the existing read-only harness directly with Node instead; no files, wallet, signer, or transaction were used.
- Mainnet read-only harness: **63 checks, 0 blocking failures, 10 warnings** at slot `449806663` (epoch `1041`). USDC and the dynamically discovered 8-asset PreStocks universe passed mint/token metadata, raw supply, multiplier, fee, and issuer-control checks. Legacy Jupiter routes were observed but are not Swap V2 or execution verification.
- The local environment has no `PYTH_API_KEY` or `JUPITER_API_KEY`; Pyth Hermes authentication and current Jupiter Swap V2 `/order` + Router `/build` therefore remain unverified in this run. V-007/V-008 remain open.
- Finalized mainnet `getAccountInfo` at slot `449807618` returned no account for the configured program ID `FJt9WntCGo6suyjH4cndwgKjQ8rDSau1JxLA91UFB49v`. Tenet is not deployed at the configured address on mainnet. `apps/web/src/config.ts` is intentionally still devnet-only and must not be switched by changing only the RPC URL.
- No code/config was flipped to mainnet. No program deployment, config initialization, swap, contribution, or other real-capital transaction was attempted. Mainnet release remains blocked on deployment/authority decisions, unresolved verification and adversarial review gates, and a separately reviewed controlled transaction plan. Full observations are in [docs/verification.md](docs/verification.md).

## MAINNET CLIENT SWITCH — 2026-09-23

- Switched the local web client to Solana Mainnet (`solana:mainnet`), configured canonical mainnet USDC, removed the devnet default Circle, and set the default RPC path to a same-origin route. The client never substitutes devnet accounts on mainnet.
- The workspace checks the configured Tenet program account at finalized commitment. The actual mainnet response is `value: null` for the configured program ID, so the app now clearly reports that Tenet is not deployed instead of rendering a broken test Circle.
- All wallet transactions remain disabled in config and `chain.send()` has a central fail-closed guard. The Vite preview proxy forwards only `getAccountInfo`, `getEpochInfo`, `getProgramAccounts`, and `getTokenAccountBalance`; `sendTransaction` was tested and rejected with HTTP 403.
- A same-origin server-side proxy was required because browser-origin requests to the public Solana RPC returned HTTP 403. The local preview on `http://127.0.0.1:5178/app` successfully read mainnet at slot `449818523` and reported the missing Tenet program. The earlier sandboxed `5177` process cannot reach upstream RPC and is not the verified mainnet preview.
- Verification: web TypeScript check and Vite production build passed; domain/PDA suite **48/48** passed; SDK generated-client check passed; SDK client suite **6/6** passed; money lint and `git diff --check` passed.
- This changes the local app, not the VPS deployment. Production hosting still needs an equivalent read-only mainnet RPC proxy. No mainnet program deployment, wallet signing, contribution, trade, or exit was performed. V-007/V-008 and deployment/authority/security gates remain open.
