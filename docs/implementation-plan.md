# Tenet — Implementation Plan

**Artifact F of the six pre-implementation artifacts.**

Repository tasks mapped to the build order in the spec (§60). A phase is complete only when its exit criteria are met — compiling is not completion (spec §2).

**Definition of complete, applied to every task:** the invariant is understood · tests exist · tests pass · external assumptions are verified · the real UI uses the real implementation · failure states exist · no fake fallback path exists.

---

## Phase 0 — Verification *(current)*

No money-moving program code.

| task | output | status |
|---|---|---|
| Six pre-implementation artifacts | `docs/architecture.md`, `docs/instructions.md`, `docs/verification-plan.md`, `docs/threat-model.md`, `docs/dependencies.md`, `docs/implementation-plan.md` | **done** |
| PreStocks universe + issuer API | V-001 | **done** |
| Token-2022 inspection of PreStocks mints | V-002, V-003 | **done (2 of 8)** |
| Transfer-fee epoch semantics | V-004 | **done** |
| Jupiter routability + indicative-vs-executable gap | V-005 | **done** |
| Toolchain reality | V-006 | **done** |
| `prestocks-pulse` provenance | V-009 | **done** |
| All 8 PreStocks mints inspected | V-002/V-003/V-017/V-019 | **done** |
| USDC mint inspection | V-014 | **done** — classic SPL, 6 dp, no fee |
| Anchor repo + `avm` supply-chain check | V-015 | **done** |
| **D-04**: Anchor 1.2.0 + Pyth SDK 2.0.0 | V-016 | **done** (resolution proven) |
| JSON u64 precision hazard | V-018 | **done** — `res.json()` banned |
| Jupiter program id + account-count limits | V-020 | **done** → decision A-12 |
| Pyth program addresses on-chain | V-021 | **done** |
| Pyth SDK ids + verification level | V-023 | **done** — `Full` mandatory |
| Toolchain skew / Anchor.toml pin | V-024 | **done** |
| Subscriptions & Allowances primitive | V-025 | **done** (interface; CPI-ability open) |
| Provision WSL: rust, agave, anchor, pnpm | working build env | **done** |
| `scripts/verify-integrations.ts` + `pnpm verify` | repeatable harness | **done** — 53 checks green |
| `scripts/lint-money-rules.mjs` | mechanical rule enforcement | **done** |
| **SBF build proof (V-016b)** | linked `.so` | **BLOCKED — BLOCKER-03** |
| Pyth: `PriceUpdateV2` layout on a real account, feed IDs, API key | V-007 | **UNVERIFIED — blocks Phase 4** |
| Public tokenized-equity universe | V-010 | not started |
| Minimum viable trade sizes | V-011 | not started |
| Corporate-action state, official source | V-012 | not started |
| PreStocks eligibility rules | V-013 | not started |
| Repo scaffold: tsconfig, ESLint, CI | buildable monorepo | partial (workspace + lint done) |

**Exit criteria.** `pnpm verify` runs green · D-04 resolved by a real build · WSL toolchain proven by `anchor build` on a hello-world program · `docs/verification.md` has no blocking UNVERIFIED rows for Phases 1–3.

---

## Phase 1 — Core accounting

Accounting invariants are written **before** the instructions that rely on them.

| task | where |
|---|---|
| `docs/accounting.md` — share precision, every formula, every rounding direction | `docs/` |
| Account structs: `Mandate`, `MandateAsset`, `AssetRegistryEntry`, `Circle`, `CircleAsset`, `Member`, `Epoch`, `ContributionReceipt`, `NavSnapshot`, `Redemption`, `RedemptionAsset`, `ExecutionAuth` | `programs/tenet/src/state/` |
| PDA derivation module — single source of truth, shared Rust/TS | `programs/tenet/src/pda.rs`, `packages/sdk` |
| Checked arithmetic module: `u128` intermediates, floor-toward-Circle helpers | `programs/tenet/src/math.rs` |
| Token-2022 inspection: `effectiveMultiplier`, `activeTransferFee` | `packages/integrations`, mirrored in-program |
| `packages/domain` — pure accounting in `bigint`, no chain dependency | `packages/domain` |
| Invariant harness INV-001 … INV-005 over the pure domain model | `tests/invariants` |

**Exit criteria.** Domain model passes property tests over randomised contribute/finalize/settle/redeem sequences · INV-001 holds after every generated step · `overflow-checks = true` asserted in CI · `effectiveMultiplier` reproduces V-003 exactly (SPACEX → 5, ANTHROPIC → 1) and `activeTransferFee` reproduces V-004 (epoch 1039 → 100 bps).

---

## Phase 2 — Pool

| task | instructions |
|---|---|
| Registry | `upsert_registry_entry` |
| Mandate | `create_mandate`, `add_mandate_asset`, `finalize_mandate` |
| Circle | `create_circle`, `add_circle_asset` |
| Epoch 0 | `open_epoch`, `contribute`, `cancel_contribution`, `close_contributions`, `finalize_epoch`, `settle_contribution`, `close_epoch` |
| SDK + minimal UI for the above | `packages/sdk`, `apps/web` |

Epoch 0 uses no oracle (`shares_i = amount_usdc_raw_i`, exact, no division), so this phase ships end-to-end while Pyth and Jupiter are still unverified. Rolling epochs are **architecturally present but disabled** until safe NAV exists (spec §9) — the `record_asset_nav` path lands in Phase 4.

**Exit criteria.** `test_epoch_zero_accounting` passes on a local validator · escrow separation proven by `test_pending_usdc_isolated` · `test_pending_contribution_cancel` proves recovery without any admin · a real wallet completes contribute → finalize → settle on devnet.

---

## Phase 3 — Exit *(before execution, deliberately)*

If members cannot retrieve their proportional assets, no further capital deployment gets built.

| task | instructions |
|---|---|
| Redemption state machine | `initiate_redemption`, `reserve_redemption_asset`, `claim_redemption_asset`, `claim_redemption_usdc` |
| Execution gating on `pending_reservations` | `Circle` |
| Per-asset claim isolation + failure UI | `apps/web` |
| Transfer-fee disclosure pre-signature | `apps/web` |

**Codex review is required before this phase is considered complete** (spec §36). The dilution proof in `docs/architecture.md §8` is what gets reviewed.

**Exit criteria.** `test_exit_without_oracle` passes with every price source disabled · `test_parallel_redemptions` passes in every permutation · a deliberately paused/failing asset leaves all other claims working · `test_remaining_members_not_charged_exit_fee` passes · Codex sign-off in `REVIEW.md`.

---

## Phase 4 — Public equities

Unblocked only when V-007, V-008 and V-010 are verified.

| task | where |
|---|---|
| Pyth integration: feed-id binding, staleness, confidence policy | `programs/tenet`, `packages/integrations` |
| `open_nav_snapshot`, `record_asset_nav`, rolling `finalize_epoch` | `programs/tenet` |
| Jupiter execution: `begin_execution` / `end_execution` (design A-08) | `programs/tenet` |
| Execution planner: underweight → route, new cash first | `services/indexer`, `packages/sdk` |
| Mandate enforcement against real post-balances | `programs/tenet` |

**Exit criteria.** One **real** supported public-stock route executes on mainnet-beta under the guarded write policy · vault balance delta verified on-chain · `test_execution_rejects_universe_violation` and `test_execution_output_reaches_correct_vault` pass · Codex review of the introspection logic complete.

---

## Phase 5 — PreStocks

| task | where |
|---|---|
| Live universe discovery (no hardcoded list) | `services/indexer` |
| Token-2022 handling end-to-end through custody and exit | `programs/tenet` |
| Market vs issuer-mark valuation split | `packages/integrations` |
| Premium/discount + supply-consumption surfaces | `apps/web` |
| Execution safety for PreStocks (attestation, if Phase 0 proves it necessary) | `programs/tenet` |
| Corporate-action status + purchase blocking | `services/indexer`, `apps/web` |
| Issuer-control disclosure (R-09) on every PreStocks surface | `apps/web` |

Do not integrate Tessera or any competing pre-IPO provider. Do not add Meteora, Clawpump or a project token — Meteora appears only as a route venue *inside* Jupiter (V-005), never as a direct integration.

**Exit criteria.** A real PreStocks route executes · supply consumption computed in raw units and matching an independent calculation · premium/discount live for all 8 assets · the SPACEX 5× multiplier renders correctly everywhere.

---

## Phase 6 — Value

Live NAV · holdings · member position · Pyth divergence (tokenized vs underlying) · PreStocks premium/discount · supply risk · price provenance on every number · corporate-action state.

**Exit criteria.** Every visible financial number has real provenance · no fallback values anywhere · `Unavailable` renders correctly when a source fails · mobile layout verified on a real phone viewport.

---

## Phase 7 — Fork

`fork_mandate` · parent lineage · rule modification with a visual diff · new independent Circle.

**Exit criteria.** `test_child_mandate_cannot_modify_parent` compares full parent account bytes before and after · `test_fork_does_not_move_parent_assets` proves zero assets and zero members transfer · the lineage graph renders · the fork flow is visually excellent — this is one of Tenet's defining moments (spec §60).

---

## Phase 8 — Amendments

Only after POOL, EXECUTE, VALUE, EXIT and FORK work safely. The attack table in `docs/instructions.md §7` is defended **before** any voting code is written. If time runs short, amendments are deferred — **not faked, and not removed from the architecture** (spec §39).

---

## Phase 9 — Automatic Contribution Rail

Recurring and rule-based contributions affect **POOL only**; they never choose investments. Architecture is in `docs/architecture.md` §13; the verified primitive is V-025.

Build order within the phase, per the update's §16 priority:

1. **Recurring** — direct fit to `createRecurringDelegation`.
2. **Percentage of eligible incoming USDC** — on-chain bound + off-chain detection.
3. **Round-up** — same shape, most indexer work.

**One real automation path beats three fake ones.** Manual contribution remains the production path regardless (spec §15).

Gated on V-025 open items 1–2 (can `transferRecurring` be CPI'd; may the delegatee be a PDA). If neither resolves safely, this phase is **not shipped** — it is not simulated.

Required tests before exposure (spec §49): `test_auto_contribution_requires_authorization` · `_respects_authorized_limit` · `_targets_correct_circle` · `_enters_epoch_escrow` · `_cannot_buy_assets_directly` · `_cannot_bypass_mandate` · `_revoke_stops_future_execution` · `_cannot_exceed_circle_cap`.

**Exit criteria.** All eight tests pass · revocation verified to work **without any Tenet instruction** · the UI states plainly that percentage/round-up *detection* is best-effort while the *authorization* is bounded.

---

## Scope-cut order (spec §61)

Cut in this order: advanced amendment UX → automatic contributions → advanced corporate-action automation → discovery filters → fork visual-diff polish → social/reputation features.

**Never cut:** verification · raw-unit accounting · vault security · share accounting · Mandate enforcement · PreStocks correctness · Pyth correctness · Jupiter verification · in-kind exit · Fork · real transactions · tests.

---

## Critical path

```
WSL provisioning ─┐
                  ├─> D-04 spike ─> Phase 1 ─> Phase 2 ─> Phase 3 ─> Codex review
V-014 USDC ───────┘                                                        │
                                                                           ▼
V-007 Pyth ──┐                                                        Phase 4 ─> 5 ─> 6 ─> 7
V-008 Jupiter┤                                                             ▲
V-010 xStocks┘─────────────────────────────────────────────────────────────┘
```

The two starting blockers — **WSL provisioning** and the **D-04 Anchor/Pyth spike** — gate everything. They are the immediate next actions.

Phases 1–3 are deliberately independent of Pyth and Jupiter, so oracle and execution verification can proceed in parallel with building the accounting core. This is why exit comes before execution: it is the part that must be right, and it is the part that needs nothing external to be right.
