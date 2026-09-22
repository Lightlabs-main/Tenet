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
