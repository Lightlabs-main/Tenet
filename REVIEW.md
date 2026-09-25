# Tenet — Adversarial Review

Owner: **Codex** (security engineer / financial-systems reviewer / account-substitution attacker / arithmetic reviewer / integration skeptic).

Codex assumes the implementation contains dilution attacks, rounding exploits, unsafe CPIs, stale pricing, malicious account substitution, authority leaks, Token-2022 mistakes, replay attacks, invalid Jupiter assumptions, oracle manipulation, wrong transfer-fee handling and broken redemption logic — until proven otherwise.

Every finding must identify: **file · function/symbol · issue · exploit or failure scenario · expected invariant · required correction.** A failing adversarial test accompanies the finding wherever one can be written. Claude patches; Codex retests.

**No security-sensitive financial path is complete before adversarial review.**

---

## Status

**Full audit — 2026-09-21, continued 2026-09-22.** The repository contains a real devnet-oriented POOL with Epoch 0 and rolling-epoch NAV snapshot admission, plus staged EXIT implementation and a tested chain-free accounting model. Source-level Fork, permissionless live metadata-refresh and amendment-governance paths are implemented: Fork creates an independent child Mandate and copies dedicated asset-rule PDAs without accepting parent custody accounts; refresh reads current mint facts into the registry; amendments use bounded proposal/vote PDAs and a share-stable execution snapshot. The source also contains a fail-closed EXECUTE boundary: nonce-seeded authorization, Jupiter-window introspection, exact vault binding and raw pre/post delta checks. Price-dependent execution activation and automatic contributions remain incomplete. VALUE has both an exact off-chain boundary and an on-chain Pyth snapshot path; target-feed/Jupiter verification still gates production execution. No production sign-off is granted.

### Fork implementation pass — 2026-09-21

The new `fork_mandate` path was checked with `cargo check -p tenet --lib`, the
program unit suite (21/21), and the remote LiteSVM suite (51/51), including
the fail-closed EXECUTE boundary regression. The VPS Anchor build regenerated
the IDL and deployable artifact used for that check.
The local Windows/WSL wrapper remains unreliable, so local release claims still
use the remote toolchain evidence rather than pretending the wrapper succeeded.

The audit reviewed the Anchor program, generated IDL/SDK, domain accounting and valuation boundary, web client, tests, integration verification, architecture/specification documents and current progress notes. Findings below distinguish exploitable code defects from release-blocking incompleteness and unresolved trust assumptions.

---

## CRITICAL

*(none demonstrated in the reviewed code path)*

---

## HIGH

### H-03 — Rolling NAV includes value already reserved for exits

```
file      packages/domain/src/accounting.ts:310-337
symbol    activeNav()
status    FIXED — domain and on-chain snapshot paths agree; production execution remains separately gated
```

**Issue.** `activeNav()` starts with `c.activeUsdc` and adds every asset value, but does not subtract `usdcReserved(c)` or the value represented by `reservedForRedemption`. Its comment promises the opposite. `finalizeEpoch()` calls it directly at line 336.

**Failure scenario.** A Circle with 2,000,000 active USDC has a 1,000,000-share exit fully reserved. The residual NAV is 1,000,000, but `activeNav()` returns 2,000,000. A 1,000,000-unit later contribution receives 500,000 shares instead of the correct 1,000,000. The targeted reproduction was run against the current module and produced exactly those values.

**Expected invariant.** Rolling issuance prices against active, realizable, unreserved Circle value. Pending Epoch escrow and all fixed redemption obligations are excluded.

**Correction applied.** `activeNav()` now starts from unreserved USDC and subtracts the proportional value of raw asset units already reserved for redemption. Regression test: `rolling NAV excludes reserved redemption obligations`. The on-chain `NavSnapshot` now applies the same exclusion before Pyth valuation; rolling issuance remains gated on current feed and metadata observations, not client NAV.

### H-04 — The required core product is not present in the program

```
file      programs/tenet/src/lib.rs:68-152
evidence  target/idl/tenet.json instruction list
status    RELEASE BLOCKER — not an exploit in the implemented Epoch 0 path
```

The program source now also exports `fork_mandate`, `fork_mandate_asset`, `refresh_asset_metadata`, `propose_amendment`, `vote_amendment` and `execute_amendment`; the generated IDL and deployable artifact were regenerated and checked on the VPS. The source includes a structural `begin_execution` / `end_execution` boundary with Jupiter-window and raw vault-delta checks, plus a verified Pyth admission and on-chain NAV snapshot path. The execution boundary now derives the Circle USDC vault correctly, binds vault owners and stored token programs, and snapshots replay authorization fields before the price-policy gate. `begin_execution` still intentionally fails closed before price-dependent execution. Automatic contribution authorization remains incomplete. The committed IDL correctly describes the current source and does not invent absent capabilities.

**Impact.** The repository cannot honestly be deployed or presented as the complete `POOL → EXECUTE → VALUE → EXIT → FORK` product. The missing paths are not safe to infer from the design docs or generated error names.

**Required correction.** Keep the current POOL/EXIT/Fork/amendment implementation scoped as devnet/staged functionality. The IDL/deployable artifact and adversarial tests are current; retain the release gate for the still-missing or unverified execution/value/automation paths, and do not expose UI controls or claims for absent instructions.

### H-05 — Live asset facts have no production refresh path

```
file      programs/tenet/src/instructions/registry.rs:103
symbol    upsert_handler()
status    OPEN — blocks any live execution/value/cap enforcement
```

`AssetRegistryEntry` stores `raw_supply`, multiplier, active transfer fee, issuer controls and verification slot/time. `upsert_handler()` remains classification-only, while the permissionless `refresh_asset_metadata` handler reads the current mint state into those live-fact fields. The path is present in the freshly generated IDL/deployable artifact and covered by extension-bearing fixture tests; production consumers still need an explicit freshness policy before execution or rolling issuance.

**Impact.** Those fields remain default/unverified. Any future consumer that treats them as current facts could calculate wrong supply consumption, transfer-fee behavior, ScaledUiAmount display, or issuer-control risk.

**Required correction.** Implement the refresh instruction from verified Token-2022 account state, or make every consumer reject missing/stale observations. Record slot/time and enforce explicit freshness policy before execution or rolling issuance.

### H-06 — Upgrade authority is an unresolved production custody/trust risk

```
file      programs/tenet/src/instructions/config.rs:19-57
docs      README.md:121-125
status    OPEN — explicit release blocker
```

The program deliberately gates initial configuration on the upgrade authority, and the README correctly states that a holder can replace the program. No mainnet deployment or immutable/multisig/timelocked upgrade policy is present in this repository.

**Impact.** Before authority resolution, users must trust the upgrade key not to replace vault logic or alter asset/accounting behavior. This is authority risk, not merely documentation risk.

**Required correction.** Initialize configuration first, then verify and document the actual on-chain authority policy (burned, or a reviewed multisig/timelock with operational controls) before any production claim.

### H-01 — Execution could spend USDC already reserved for an exiting member

```
file      packages/domain/src/accounting.ts
symbol    execute()
found by  property fuzzer, seed 157 step 57
status    FIXED + regression test
```

**Issue.** `execute()` spent from `circle.activeUsdc` without subtracting USDC already reserved by an in-flight redemption.

**Exploit / failure scenario.** A member initiates a redemption and reservations complete. The `hasPendingReservations` freeze therefore lifts — correctly, since nothing is unreserved. But the reserved USDC is still owed and not yet claimed. Any execution in that window can spend it, leaving the exiting member's claim unbackable. The fuzzer produced exactly this: `USDC reserved 8870584 > active 8688036`.

**Expected invariant.** INV-004 — a member's reserved entitlement is always backed by the vault that owes it.

**Root cause.** `docs/architecture.md` §9 already required spending to use `vault − reserved_for_redemption_raw`. That was implemented for **asset** vaults but not for the **USDC** vault. The freeze on unreserved redemptions looked like it covered the gap and did not: it protects the window *before* reservation, while the exposure is *after* it.

**Correction applied.** `execute()` now computes `availableUsdc(c) = activeUsdc − usdcReserved(c)` and refuses to spend beyond it. Regression test: `regression (fuzz seed 157): execution cannot spend USDC reserved for an exit`.

**Carry into the on-chain program.** `end_execution` must enforce the same bound on the USDC vault, not only on asset vaults. Worth treating as a checklist item for every vault the program can debit.

---

### H-02 — Reservation order let one exiting member take value from another

```
file      packages/domain/src/accounting.ts
symbol    initiateRedemption() / reserveRedemptionAsset()
found by  design trace before writing the on-chain redemption, 2026-09-21
status    FIXED in the model (A-22) + regression tests + fuzzed invariant INV-021
```

**Issue.** Two exits could be initiated before either reserved. Each snapshots `S = total_shares` at initiation, and `total_shares` has already dropped by the earlier exiter's shares — but the vault still holds that earlier exiter's unreserved portion. So the later exit's `floor((vault − reserved) × s / S)` counts the earlier exiter's money as backing its own shares.

**Exploit.** Vault 999,999,999, S = 100M; bob and carol hold 30M each and both initiate. Reserve order bob→carol: bob 299,999,999, carol 300,000,000 — fair. Order carol→bob: **carol 428,571,428, bob 171,428,571** — carol takes ~128.6M of bob's entitlement. `reserve_redemption_asset` is permissionless, so carol can always front-run bob's reservation. A second path: an exit initiated before an epoch finalizes would divide the newly swept USDC by its old `S`, taking a slice of newcomers' money.

**Why the existing test missed it.** `test_parallel_redemptions: fair in every order` asserted only that total claims fit in the vault and that the **remaining** member's backing did not fall. Both hold — the value moves *between the two exiters*, which no assertion compared. The fuzzer missed it for the same reason: its invariants were all aggregate.

**Fix — A-22, exits are serialized.** `initiate_redemption` is refused while any exit has unreserved assets; `finalize_epoch` is refused likewise (the inflow path). Serialization cannot be used to trap members: reservation is permissionless and moves no tokens, so no issuer pause, freeze or hook can block it, and anyone can push a pending exit through.

**Regression.** The test now asserts equal holders receive equal amounts (±1 raw unit) and that each person's amount is independent of exit order; a new test covers the finalize guard; and **INV-021** (at most one exit with unreserved assets) is checked after every fuzzer step. With the guard removed, the fuzzer fails on its own with INV-021 — verified.

**Carry into the on-chain program.** `initiate_redemption` and `finalize_epoch` both require `circle.pending_reservations == 0`.

---

## MEDIUM

### M-01 — Web client hardcodes one devnet USDC mint for arbitrary Circles

```
files     apps/web/src/config.ts:14; apps/web/src/chain.ts:183; apps/web/src/dashboard.tsx:346-646
symbol    TEST_USDC usage in loadCircle() and contribution/exit builders
status    FIXED — Config-derived mint now flows through balances, contributions and claims
```

`loadCircle()` and the dashboard use `TEST_USDC` rather than reading/validating the Circle's configured USDC mint. If a different valid devnet Circle is opened, balances and transaction accounts can be wrong or fail. The app is clearly marked devnet, so this is not a mainnet theft finding, but it is a consumer-facing account-integrity defect.

**Correction applied.** `loadCircle()` reads Config.usdcMint and returns it in `CircleView`; App and dashboard transaction/account builders use that value. The test mint remains only as a devnet default constant.

### M-02 — SDK bigint discipline is advisory, not enforced

```
file      packages/sdk/src/index.ts:25
symbol    export * from "./generated/index"
status    FIXED — package-root exports no longer expose raw amount-bearing builders
```

The handwritten SDK wrappers validate bigint inputs, but the public package also re-exports generated builders whose u64/i64 argument types accept `number | bigint`. A caller can therefore bypass the intended no-floating-point/no-unsafe-number boundary.

**Correction applied.** The package root exports account/data modules and non-amount builders explicitly; contribute, openEpoch, initiateRedemption and createMandate remain available only through bigint-checked wrappers. The SDK client test still proves numeric rejection.

### M-03 — Registry classification remains mutable without a versioned observation boundary

```
file      programs/tenet/src/instructions/registry.rs:55-103
symbol    upsert_handler()
status    OPEN TRUST ASSUMPTION
```

The registry authority can change asset class, issuer, feeds and status after Mandates reference the entry. That may change which caps and pricing surfaces apply without an amendment or historical observation boundary.

**Required correction.** Either make classification changes explicit governed amendments, version/snapshot the relevant facts for each Mandate/Circle, or document and operationally enforce the registry authority as a protocol trust dependency. Do not silently present mutable classifications as immutable investment rules.

### M-04 — Member count is only an ever-increasing settlement count

```
files     programs/tenet/src/instructions/epoch.rs:525-526; programs/tenet/src/instructions/redemption.rs
symbol    Circle.member_count
status    FIXED in program logic; on-chain regression assertion added
```

Settlement increments `member_count`, but full exits do not decrement it. Any UI or rule that interprets this as current membership will drift from actual active Member accounts.

**Correction applied.** `member_count` is now documented and maintained as the number of Members with non-zero shares: zero→positive settlement increments it and positive→zero redemption decrements it. The on-chain exit test asserts the full-redemption transition.

### M-05 — The full account-substitution matrix is not yet program-tested

```
files     programs/tenet/src/instructions/circle.rs; programs/tenet/src/instructions/redemption.rs
status    HARDENED in reviewed reserve/claim paths; full adversarial matrix still required
```

PDA seeds and Anchor token constraints provide substantial protection, and the reviewed staged paths bind CircleAsset/vault addresses. However, the repository does not yet contain the required program-level tests for wrong Circle, mint, token program, vault, destination, and output-vault combinations. Several reservation contexts rely on the previously-created PDA relationship rather than asserting every mint/authority relationship at the point of use.

**Correction applied.** Redemption reserve/claim handlers now assert vault mint consistency where applicable and require the vault token-account authority to equal the Circle VaultAuthority PDA. The required program-level substitution matrix remains to be executed once the Rust toolchain is available.

### M-06 — SDK client test does not run under the repository's direct Node path

```
file      packages/sdk/test/client.test.ts:1
symbol    import of packages/sdk/src/index
status    FIXED for the supported package runner
```

The direct command `node --test packages/sdk/test/client.test.ts` fails with `ERR_MODULE_NOT_FOUND` before running a test because the extensionless source import cannot be resolved by the current Node ESM setup. This is separate from the 32 passing domain/PDA tests, but it means the SDK client surface is not currently verified by a clean direct invocation.

**Correction applied.** The test uses an explicit `.ts` source import and passes under the supported package runner: `node --import tsx --test test/client.test.ts test/pda.test.ts` from `packages/sdk`.

---

## LOW

### L-01 — Documentation and progress status overstate completed coverage

```
files     README.md:112; docs/instructions.md; docs/threat-model.md; PROGRESS.md
status    OPEN DOCUMENTATION DRIFT
```

The README says twenty invariants “each has tests,” while several still refer to absent execution and automation paths. Fork and amendment tests now run against a freshly built `.so` on the VPS. The instruction and threat-model docs were updated to distinguish implemented governance from the remaining release gates. `PROGRESS.md` retains historical validation entries, but the latest continuation entry records current evidence separately.

**Required correction.** Label design-only controls explicitly, keep historical results dated, and publish current reproducible command results separately from prior milestone claims.

### L-02 — `CloseContributions` does not take the Circle account

```
file      programs/tenet/src/instructions/epoch.rs:341-360
symbol    CloseContributions
status    LOW — permissionless lifecycle path
```

The instruction closes any supplied open Epoch after its time, without loading the Circle relationship. Since the Epoch PDA is program-created and the operation is permissionless, this does not currently move funds or alter another Circle, but adding the Circle relation would make the invariant explicit and simplify future audits.

---

## VERIFIED CORRECT

These are verified for the reviewed implemented paths, subject to the test limitations below. Items whose instructions do not yet exist are intentionally listed separately as design-only.

| item | why it holds by construction | must still be tested |
|---|---|---|
| Duplicate Mandate/Circle assets | mint is in the PDA seed — a second init fails at the runtime level | `test_reject_duplicate_asset` |
| Cross-Circle account substitution | `CircleAsset`/vault PDAs seed on `(circle, mint)`; another Circle's account cannot be derived at the expected address | `test_wrong_circle_rejected` |
| Settlement cannot inflate total shares | `settle_contribution` takes `circle` **read-only** | `test_late_settlement_no_dilution` |
| Exit needs no oracle | `initiate_redemption` has no price account in its account list at all | `test_exit_without_oracle` |
| Remaining members not diluted by an exit | proof in `docs/architecture.md §8`: post-exit per-share backing `(V−e)/(S−s) ≥ V/S` | `test_parallel_redemptions` |
| Epoch escrow is separate from active USDC | `Contribute` transfers into the Epoch escrow; `FinalizeEpoch` is the only reviewed sweep path | `test_pending_usdc_isolated` |
| Settlement does not increase effective total shares | `SettleContribution` decreases reserved shares and does not write `Circle.total_shares` | `test_late_settlement_no_dilution` |
| Claim failure is isolated | redemption claim state is only marked claimed after the transfer CPI succeeds | `test_one_failed_asset_does_not_unnecessarily_lock_other_claims` |

### Design-only, not code-verified

The following claims remain open because they are fail-closed or unverified: production execution activation, target-feed/Jupiter route verification, issuer/pre-IPO concentration enforcement, corporate-action handling, and automatic-contribution authorization/revocation. Amendment threshold/delay governance is implemented and artifact-tested, with the conservative share-stability rule documented above. Raw supply-consumption enforcement, the Pyth admission boundary, and the on-chain NAV snapshot path are implemented, but the overall execution path remains fail-closed. The exact off-chain valuation boundary, bounded rolling snapshot, and structural execution window now exist and are tested; target tokenized-equity feeds and controlled production routes remain open. Fork parent immutability and metadata refresh are implemented in source and covered by the rebuilt artifact suite.

---

## VALIDATION EVIDENCE

Passed in this audit environment:

- `node --test packages/domain/test/accounting.test.ts packages/domain/test/execution.test.ts packages/domain/test/valuation.test.ts packages/domain/test/oracle-policy.test.ts packages/domain/test/vectors.test.ts packages/sdk/test/pda.test.ts` — 48/48 passed.
- `node --import tsx --test test/client.test.ts test/pda.test.ts` from `packages/sdk` — 12/12 passed.
- `node_modules/.bin/tsc --noEmit -p tsconfig.json` from `apps/web` — passed.
- `node scripts/lint-money-rules.mjs` — clean.
- Targeted NAV reproduction — confirmed H-03: 500,000 shares issued versus 1,000,000 when reserved value is excluded.
- `cargo check -p tenet --lib` — passed after dependencies became available.
- `cargo test -p tenet --lib` — 21/21 passed.
- Historical pre-fix `node --test packages/sdk/test/client.test.ts` failed before test execution with an extensionless-import error; the supported `tsx` runner now passes M-06.

Remote verification additionally passed:

- `cargo test -p tenet --lib` — 21/21.
- `cargo test -p tenet-program-tests` — 54/54, including the three amendment tests and `test_execution_window_is_fail_closed`.
- `anchor build` — passed with the canonical program keypair/ID; regenerated SDK is current at 68 files.
- Read-only mainnet harness — 61 checks, 0 blocking failures; 8 warnings are the intentionally unverified Swap V2 probes without `JUPITER_API_KEY`.

Latest continuation evidence (2026-09-22):

- VPS `anchor build` — passed after amendment governance; generated IDL and deployable artifact match the source.
- VPS `cargo test -p tenet --lib` — 25/25 passed.
- VPS `cargo test --manifest-path tests/program/Cargo.toml -- --test-threads=1` — 54/54 passed.
- Local SDK client/PDA suite — 12/12 passed under the supported package `tsx` runner.
- Web TypeScript check — passed after the execution-boundary source update.

Not reproducible here:

- `pnpm test` — stopped in the local dependency wrapper because the environment is Node v26 while the workspace requires Node 22.x; the wrapper then attempted a non-interactive module purge.
- `cargo test -p tenet --lib` and offline variant — blocked by unavailable crates.io access / uncached `anchor-lang`; WSL execution was also unavailable.
- local `pnpm verify` / direct integration verification — blocked by sandbox `EACCES` to Solana mainnet RPC; the same read-only harness was run successfully on the VPS.

The local LiteSVM linker failure remains an environment limitation only; the
same integration suite has since passed remotely. These results still do not
constitute mainnet deployment or production sign-off.

---

## UNVERIFIED ASSUMPTIONS

These are the design's soft spots. Each must be closed before the dependent code is considered complete.

| # | assumption | dependent on | consequence if false |
|---|---|---|---|
| U-01 | Instruction introspection can reliably prove only Jupiter ran between `begin_execution` and `end_execution` | A-08, V-008 | **the delegate window becomes exploitable — worst case in the design** |
| U-02 | A Token-2022 route with transfer fee + ALTs fits within 1232 bytes | V-008 | execution design must change; fall back to CPI or re-scope |
| U-03 | `PriceUpdateV2` is still the account layout after the 2026-08-26 Pyth upgrade | V-007 | NAV deserialises garbage; mispricing and dilution |
| U-04 | `pyth-solana-receiver-sdk` builds against the chosen Anchor version | D-04 | oracle path blocked; **no hand-rolled deserialisation as a workaround** |
| U-05 | Freezing execution while reservations are pending is sufficient to make "vault balance at reserve time" == "at snapshot time" | A-07 | exiting or remaining members mis-entitled |
| U-06 | `NAV_SNAPSHOT_MAX_SLOTS` is tight enough that prices cannot drift materially mid-snapshot | A-05 | issuance at stale prices; dilution |
| U-07 | Permissionless recovery paths genuinely prevent a Circle being held hostage | R-20 | liveness failure; funds stuck though not lost |
| U-08 | `MAX_CIRCLE_ASSETS = 8` is safe for compute and account limits in every instruction | A-06 | transactions fail at the boundary |
| U-09 | PreStocks has no verified on-chain oracle, making an attestation necessary | §10 | if false, the attestation and its trust assumption can be **deleted** — re-check before building it |
| U-10 | The registry authority genuinely holds no custody power in the final code | R-13 | authority leak |
| U-11 | `overflow-checks = true` is actually set in the release profile | R-03 | silent wraparound in share accounting |
| U-12 | The on-chain program reproduces `packages/domain` exactly | **closed 2026-09-21** — 2,020 shared vectors (`tests/vectors/math.json`) replayed by `math_vectors.rs`, all agree; a rounding mutant is caught (211 disagreements); a TS drift test keeps the file current | the property-tested model stops being evidence about the deployed code |
| U-13 | Every vault the program can debit enforces `balance − reserved`, not just USDC and assets found so far | H-01 | same class of bug in another debit path |

### Audit-specific open items

| # | item | consequence |
|---|---|---|
| A-01 | On-chain Rust tests, LiteSVM tests and full package tests could not be rerun in the current environment | program-level claims remain evidence-gapped even where prior progress records success |
| A-02 | Mainnet verification could not reach Solana RPC from the sandbox | no current feed, mint, supply, route or authority claim was refreshed |
| A-03 | Automatic contribution authorization primitives were not implemented or verified | automation must remain absent/manual; do not simulate it |

---

## REQUIRED PATCHES

1. Keep H-03's fix aligned with the on-chain NAV snapshot as live feeds and metadata are verified.
2. Keep H-04/H-05/H-06 as release gates; do not market the missing mechanics as live.
3. Run the program-level substitution matrix for M-05 and all required security-test names in the canonical update.
4. Regenerate and deploy the source-level metadata refresh/Fork paths, then implement the missing product mechanics behind H-04/H-05.
5. Mark design-only documentation and historical validation results (L-01).

---

## Review queue

## Latest execution-boundary review — 2026-09-22

- The `EndExecution.source_vault` account is Circle-scoped through the canonical USDC-vault PDA seeds; it is no longer address-bound to the execution authorization's input mint.
- `test_end_execution_builder_binds_circle_usdc_vault` guards this account relationship, while `test_execution_window_is_fail_closed` preserves the no-route fail-closed behavior in LiteSVM.
- VPS program suite passed **55/55** after the regression addition.
- Release remains blocked on verified target Pyth feeds and a controlled Jupiter route with actual vault-delta evidence. No production sign-off.

## Latest integration evidence — 2026-09-22

- The verifier now loads the existing VPS `.env` without exposing secrets; the previous missing-key warning was a harness defect, not evidence that the credentials were absent.
- Credentialed read-only replay passed **67/67 checks with 0 blocking failures and 3 warnings**. Pyth Hermes authentication passed, and Jupiter v2 Router `/build` passed for all eight discovered PreStocks assets.
- The three warnings are HTTP 429 route observations for OpenAI, Polymarket, and SpaceX. They do not authorize execution.
- V-007 and V-008 remain open for target feed binding/layout, the current Jupiter on-chain program/CPI/account contract, and a controlled Token-2022 vault-delta transaction.

## Latest UI review — 2026-09-22

- The supplied visual references are mapped in `docs/ui-reference-map.md`; 18 files were classified as 11 unique references. Screenshot-only values were not copied into runtime data.
- Light mode and the persisted theme selector were checked in a clean browser preview. Dark-mode tokens remain available through the same semantic token system.
- Desktop workspace rail and Explore surface were checked against the reference direction. Explore is explicitly live-data-only and reports the missing directory/indexer rather than presenting fabricated cards or performance.
- Circle workspace still renders real devnet account state, exact raw quantities, unavailable pricing notices, contribution automation as manual-only until authorization is verified, and the existing exit/fork safeguards.
- Local web typecheck, production build, money-lint, and domain/PDA tests passed. SDK generation is current; the local SDK client test invocation is blocked only by the missing root `tsx` dependency.
- Added a landing surface that states the collective-investing thesis and five mechanics without invented performance or private-share ownership language. Its only Circle card is populated from the live loaded account.
- Added a dedicated Mandate inspection surface that reads caps, permitted assets, fork lineage, Epoch controls, membership, and amendment parameters from chain state. Fork navigation continues through the existing on-chain flow.
- Added a persistent mobile primary tab bar with a safe-area inset and route-aware scrolling; the browser confirmed route navigation updates the selected surface and URL without retaining a stale section position. Desktop typecheck and build pass after the navigation change.
- Browser inspection confirmed the development Circle's real Mandate values render. The production readiness caveats above remain unchanged.

Worked in this order as code lands (mirrors `docs/threat-model.md`, highest value first):

1. Fix and re-test H-03: reserved-NAV rolling issuance.
2. Adversarially review the implemented instruction introspection and raw vault-delta boundary in `begin_execution` / `end_execution` (U-01).
3. Dilution via late settlement and reserved-share accounting.
4. Account substitution across Circles, mints, token programs and vault destinations.
5. Redemption reservation vs concurrent execution ordering (U-05/U-13).
6. Rounding farming over long contribute/exit sequences.
7. ScaledUiAmount multiplier changing mid-redemption.
8. Maximum transfer fee · PermanentDelegate seizure.
9. Stale Pyth · extreme confidence interval.
10. Duplicate execution and replay.
11. Forged registry classification and current corporate actions.
12. Automatic contribution authorization, revocation and limits.
13. Boundary Circles: zero liquidity · expired asset · USDC only · single asset · exactly 8 assets.

**Gate.** Phase 3 (exit) requires Codex sign-off before Phase 4 begins (spec §36). The artefact under review is the dilution proof in `docs/architecture.md §8`.

## Fork lifecycle correction — 2026-09-23

- Adversarial inspection found that the web Fork flow forked and finalized a Mandate, but did not create the independent Circle or its asset vaults; it then incorrectly displayed “New Circle created.”
- The UI now plans and sends named, resumable steps; validates child lineage and copied rules; creates the child Circle, USDC vault, and Mandate-bound asset vaults with each mint’s recorded token program; and reports success only after reading the accounts back.
- Confirmed steps are detected on retry via the stored non-secret PDA seed and account checks. Failed wallet simulation is presented as not confirmed, with an explicit instruction to cancel unsafe prompts.
- Added `test_forked_mandate_creates_independent_circle_and_vaults` to the LiteSVM suite. The source parses, but this local environment cannot execute it yet: the offline Cargo cache is missing `pyth-solana-receiver-sdk`, and `target/deploy/tenet.so` is absent.
- This is not adversarial sign-off. Re-run the new test and review account substitution, concurrent/retried partial setup, vault binding, and parent immutability before calling Fork complete.

## Mainnet readiness gate — 2026-09-23

- Ran the existing integration verifier directly against mainnet in read-only mode: 63 checks, 0 blocking failures, 10 warnings. The warnings include missing local Pyth/Jupiter API credentials, so current Pyth Hermes and Swap V2 checks were not performed. Legacy Jupiter routes are not execution evidence.
- A finalized mainnet account lookup at slot `449807618` found no account at the configured program ID. The frontend still explicitly refuses non-devnet configuration.
- **No mainnet release sign-off.** V-007/V-008, mainnet program deployment and its upgrade-authority policy, and all real-custody execution/exit reviews remain open. No signer, transaction, or deployment was used. See [docs/verification.md](docs/verification.md) for timestamped evidence.
- The local app is now configured for mainnet read-only access and reports the missing program account. Its development proxy enforces a JSON-RPC method allowlist; `sendTransaction` was rejected. This does not close production proxy, deployment, Pyth/Jupiter, upgrade-authority, or adversarial review gates, and does not constitute release sign-off.

## VPS mainnet read-only RPC proxy review — 2026-09-24

- Scope reviewed: the VPS public mainnet read path only; this is not a review or approval of the financial program, share accounting, execution, or exit.
- Confirmed fixed upstream, loopback-only service bind, Caddy-overwritten client address, read-method allowlist, Tenet-only `getProgramAccounts`, bounded request/response sizes, request timeout, and rate limiting. Six proxy tests pass, including malformed input, oversized requests, batch cap, foreign program scan, write denial, and rate limiting. Public HTTP/HTTPS checks returned live reads (200) and denied `sendTransaction` (403).
- No critical/high issue was found within this narrow read-only scope. Residual risk: the endpoint is public and unauthenticated, so it can be used for public chain reads and may consume the upstream allowance; rate limits are operational controls, not identity. Keep monitoring and retain the ability to stop `tenet-rpc-proxy.service`.
- The mainnet hosting proxy gap is resolved for the read-only preview. The configured program still returns `value: null`; V-007/V-008, program deployment/upgrade authority, and financial-path adversarial reviews remain open. **No mainnet release sign-off; transactions remain disabled.** This supersedes the earlier note that production hosting still lacked a same-origin proxy, but does not close the financial release gates.

## Mainnet live-source update — 2026-09-24

- Narrow scope: first-party PreStocks source proxy, exact-decimal market/reference comparison, display boundary, VPS static bundle promotion, and read-only integration checks. The proxy has a fixed destination, GET-only source route, no caller-controlled upstream, bounded response/time/rate, and a regression test for method/query substitution.
- The UI labels this as the discovered source universe, not Circle holdings. The provider does not establish an executable quote, guaranteed liquidity, transferability, current corporate-action status, or realizable Circle NAV; none is inferred from its reference mark.
- This is not adversarial sign-off for share accounting, Epoch settlement, vault authority, Jupiter CPI, Pyth target feeds, PreStocks execution attestations, Token-2022 transfer behavior, or redemption. No custody or write path was enabled. All financial release/deployment findings remain open.
- Validation: 62 JavaScript/domain/proxy/SDK tests passed; typecheck, money-lint, diff check, and web build passed. The current integration replay still has 10 warnings; Pyth/Jupiter current credentialed probes were not completed in this replay. The configured mainnet program account was null at finalized slot 450004913.

## Fresh SBF candidate and key mismatch - 2026-09-24

- Built the current program with Anchor 1.2.0, Solana platform tools v1.56, SBF v3; generated IDL still declares FJt9. The fresh 918448-byte artifact has SHA-256 072522082797173cc1d6aeebbe5c71feab290ffa6a4ead2539f16980fd054936.
- Full offline Rust workspace/LiteSVM suite passed 81/81 against the fresh artifact. This verifies local program behavior, not mainnet deployment, external CPI execution, or a real-custody transaction.
- Deployment remains blocked: Anchor reports the available target keypair as 7pLYmJXsTJW7vWuT9BwYqNCWUDXp8SR1JKmKYNofAECf while source/IDL and the absent mainnet account are FJt9WntCGo6suyjH4cndwgKjQ8rDSau1JxLA91UFB49v. Do not sync keys, change program ID, or deploy until the authority/migration decision is explicit. No financial release sign-off.
- Follow-up read-only checks: HTTPS app and PreStocks route both returned HTTP 200; TRANSACTIONS_ENABLED remains false. Finalized mainnet lookup at slot 450011109 still returned null for FJt9. No write method or signer was used.

## Jupiter V2 route replay  2026-09-24

- The updated read-only harness built current Swap V2 Router instructions for all 8 dynamically discovered PreStocks assets (70 checks, 0 blocking failures, 9 warnings). This confirms API route construction only; the request used the configured program address as a non-signing probe taker.
- The current documented build request exposes `destinationTokenAccount` but no source-account override. Tenet's Circle input is a dedicated PDA vault, so the API response alone does not establish that Jupiter spends from the Circle vault. No real Circle vault deltas, CPI execution, Token-2022 route, or transaction-size limit was verified.
- `begin_execution` remains intentionally fail-closed and must stay that way until target Pyth feeds, Jupiter account binding, and a controlled route are verified. No deployment, signature, or transaction was performed.

## Release-gate rerun - 2026-09-24
- Program is still absent at the configured mainnet ID (finalized slot 450019646); transactions stay disabled. This remains a deployment/authority blocker, not a UI or local-test failure.
- Current rerun passed 62 package tests and 70 read-only verifier checks (0 blocking, 9 warnings). The eight Jupiter V2 builds are unsigned route-construction evidence only; no Circle-vault binding/CPI or actual delta was tested.

## Pyth credential-path correction and current release status — 2026-09-24

- The VPS already has `PYTH_API_KEY` and `PYTH_HERMES_URL` in `/opt/tenet/.env`. Earlier verifier output saying the key was absent meant that process had not loaded this separate file; it did not mean the VPS lacked the key.
- The verifier now supports an explicit `TENET_ENV_FILE` path with regression tests. Hermes auth/read passed for BTC/USD using the current Pyth Bearer-auth flow. Supported equity and tokenized-equity feed pairs remain unverified; V-007 is not fully closed.
- Credentialed read-only integration replay: 67 checks, 0 blocking failures, 3 legacy-route HTTP 429 warnings at slot 450033084. Jupiter V2 Router `/build` succeeded for all 8 discovered PreStocks mints, but source-vault binding/CPI/real balance deltas remain open.
- Correction after expanded VPS scan: `/opt/tenet/.keys/tenet-keypair.json` and `/opt/tenet/target/deploy/tenet-keypair.json` derive the configured FJt9... identity. The separate `/opt/tenet-build-45188cc/target/deploy/tenet-keypair.json` derives 7pLY...; using it would be a different program identity. Earlier scan conclusions were incomplete.
- The two FJt9... key copies were mode 0666 and 0644; both are now 0600 and root-owned. The separate 7pLY... build key was also secured from 0644 to 0600. No secret was output. The distinct funded deployer/upgrade authority is still not identified. No signing, transaction, deployment, or program-ID migration occurred.
- This is a factual status update, not adversarial sign-off. Keep mainnet transactions disabled pending source/build-directory confirmation, deploy authority, target equity-feed verification, and Jupiter vault/CPI review.

## Devnet restart and optimized candidate — 2026-09-24

- Active Devnet source/client ID is `7YWVfv6sDGZkyENbhvHLCiVZMDcJnGgFDZ4cso8BLsbh`; legacy `FJt9...` Devnet program and its Circles remain untouched. New ID is not deployed yet.
- Size-optimized SBF candidate: 819,472 bytes, SHA-256 `4affe732ce6bbbeff99bd93e92879a8d31032cc936d61f09e65a57223f1e983f`; 4.163568 Devnet SOL rent-exempt minimum.
- Offline Rust/LiteSVM suite passed 81/81 against the optimized candidate; no deployment, transaction, or signer interaction occurred. This is not a security approval for mainnet or execution CPI.
- Devnet UI config currently points directly to public Devnet RPC; wallet transactions remain explicitly disabled. Current mainnet-read-only bundle is still live and has not been promoted/replaced.
- Deployment is blocked only on Devnet test funding: VPS payer balance is 0 and RPC airdrop was rate-limited. User was asked to transfer 5 test SOL from their Devnet wallet to the public VPS payer address; no Mainnet SOL is requested.

## DEVNET DEPLOYMENT AND LIVE TEST REVIEW — 2026-09-24

- Deployed Devnet program `7YWVfv6sDGZkyENbhvHLCiVZMDcJnGgFDZ4cso8BLsbh` finalized at slot `503613496`; on-chain deployed binary length and hash match the candidate. Upgrade authority is the user wallet; the VPS payer retains only the metadata registry authority and no Circle custody authority.
- Live E2E covered the Epoch-0 POOL path, escrow isolation, finalization, settlement and a partial in-kind EXIT claim using valueless Devnet test assets. It did not involve Mainnet or real securities.
- The empty default Circle is `6UB4NCMKLZbMAJ2uS9ynmQ8m8TsaCjFDnURQfmpE5rK2`. The dashboard loads it and labels the environment as Devnet test assets; the existing connect-wallet control is now exposed in the header.
- Retest evidence: Rust/LiteSVM 81/81; package, RPC proxy and SDK 64/64; web TypeScript, money-lint and production build passed.
- Review boundary: this evidence is not independent security sign-off. Fork has offline adversarial coverage but not a live Devnet browser-wallet run. Jupiter stock purchase, target Pyth feeds, auto-contribution and Mainnet remain disabled/gated.


## Devnet test-instrument review — 2026-09-25

- Added an isolated TST-EQ fixed-inventory test path; it is not public-equity execution and must never be described as shares or economic exposure in a real company.
- Emulator tests cover fixed-inventory initialization, Circle/Epoch-0 setup, exact input/output vault deltas, account-substitution rejection, and pending-USDC escrow isolation. tests/program passes 59 tests. Package tests pass 51, RPC proxy tests 7, SDK tests 6; web typecheck, production build and money-lint pass.
- Built candidate: 1,149,176 bytes, SHA-256 bac5398fc6e020b5c39692555ddb2d68a789cf6fc5367de8ef7f9d5fbc5d2ce2. Finalized Devnet deployment still has 819,472 bytes and SHA-256 4affe732ce6bbbeff99bd93e92879a8d31032cc936d61f09e65a57223f1e983f; therefore these new instructions are not deployed. Program ID remains 7YWVfv6sDGZkyENbhvHLCiVZMDcJnGgFDZ4cso8BLsbh and upgrade authority is user wallet F5WouUdTmk6n4SaSTZLrE9PCUrArnWdGYwykqPH2jBiK.
- The portfolio UI is published to /opt/tenet-preview/dist; its wallet actions verify the exact artifact hash and remain disabled until upgrade is confirmed. No unsafe simulation prompt should be generated against the older program.
- Test-USDC live metadata is verified at 6 decimals, supply 110, mint authority 9pCJ96uVkHb6wiSvbSpTNL99A3jsieQ9R8w6A9s2o6aE, and no freeze authority. The authority key was not found in the inspected keypair locations, so there is no verified faucet path. The feature must not invent funding.
- Rent estimate for a buffer equal to the new binary is 5.83846432 Devnet SOL; the upgrade-authority wallet showed 4.985368466 Devnet SOL at observation time. This is test SOL, not a USD cost, and still does not provide the authority signature or test-USDC.
- This section is implementation evidence, not adversarial security approval or live E2E. No Devnet transaction, program upgrade, token mint, Mainnet operation, or user-wallet signature was submitted.

## 2026-09-25 Devnet candidate review addendum

- Critical scope gap: current candidate implements one fixed-inventory TST-EQ at a fixed 1:1 test-USDC ratio. It does not meet the requested six-instrument synthetic universe, on-chain price observations, or multi-asset Circle allocations. Keep the portfolio market unavailable rather than presenting the single token as a stock market.
- Deployment/identity gap: candidate ID 7pLYmJXsTJW7vWuT9BwYqNCWUDXp8SR1JKmKYNofAECf is absent on Devnet and differs from deployed Tenet ID 7YWVfv6sDGZkyENbhvHLCiVZMDcJnGgFDZ4cso8BLsbh. Existing accounts must not be migrated or redirected implicitly.
- No live E2E evidence exists for this candidate. Local unit, type, build, and LiteSVM checks do not prove wallet transactions on public Devnet.
- Do not promote or mark complete until synthetic prices are derived from on-chain state, all six mint/vault bindings and cap checks are adversarially tested, deployment is authorized, and actual wallet-signed Devnet flow succeeds.
