# Tenet — Update Impact Report

Audit date: 2026-09-21  
Scope: current repository, supplied canonical update, existing Engineering Specification, `PROGRESS.md`, Anchor state/instructions, SDK, UI, tests, verification harness and integration notes.

This is an impact report, not a redesign. The current implementation already has a real Anchor account model and a working Phase 2–3 devnet path. The update must be applied incrementally, preserving the product loop:

```text
POOL → EXECUTE → VALUE → EXIT → FORK
```

## A. Existing implementation already compliant

These areas currently match the update and should not be rewritten:

| Area | Current evidence | Status |
|---|---|---|
| Terminology and product loop | `README.md`, `docs/architecture.md`, Rust state names, SDK names, UI labels | compliant; Fork and amendment behavior are implemented in the program while consumer proposal history remains gated |
| Raw-unit accounting | `programs/tenet/src/state/mod.rs`, `src/math.rs`, `packages/domain/src/accounting.ts` | compliant; vault integer balances are authoritative |
| Exact client arithmetic | `packages/domain/src/accounting.ts`, `apps/web/src/money.ts`, generated SDK bigint fields | compliant; no money `number` path found |
| ScaledUiAmount boundary | `packages/domain/src/display.ts`, `AssetRegistryEntry.effective_multiplier_e18`, `test_scaled_ui_not_used_for_ownership` | compliant; multiplier never enters ownership, redemption or raw/raw supply math |
| Dynamic Token-2022 handling | `instructions/circle.rs`, `instructions/registry.rs`, `anchor_spl::token_interface`, verification fixtures | compliant for implemented registry/custody paths; live refresh instruction remains missing |
| Discovered asset universe | `scripts/verify-integrations.ts`, verification entries V-001/V-010 | compliant; live lists are evidence, not constants |
| Optional `prestocks-pulse` | `docs/verification.md` V-009, README third-party-data note | compliant; first-party/on-chain sources remain primary |
| Fixed account model | `MandateAsset`, `CircleAsset`, `Circle`, `Epoch`, `ContributionReceipt`, `RedemptionAsset` | compliant; no unbounded holdings vector or duplicate Circle raw balance |
| Epoch escrow separation | `pda::epoch_escrow`, `OpenEpoch`, `Contribute`, `FinalizeEpoch`, `test_pending_usdc_isolated` | compliant |
| No immediate share issuance | `Contribute` creates/updates a receipt; `FinalizeEpoch` reserves; `SettleContribution` credits Member | compliant |
| Epoch 0 | `epoch.rs`, `test_epoch_zero_accounting`, devnet E2E | compliant and verified |
| Cancellation | `cancel_contribution`, owner-only refund path, `test_pending_contribution_cancel` | compliant |
| Reserved-share accounting | `Circle.reserved_shares`, `Epoch.reserved_shares/settled_shares`, `test_reserved_shares_do_not_dilute`, `test_late_settlement_no_dilution` | compliant |
| Vault authority and substitution checks | PDA constraints in circle/epoch/redemption instructions, `test_account_substitution_rejected` coverage | compliant for implemented paths |
| Staged in-kind exit | `initiate_redemption`, per-asset reservations/claims, no oracle requirement, failed-asset isolation test | compliant at Tenet layer |
| Transfer-fee treatment | `pay_out` debits entitlement; no Circle reimbursement; `test_transfer_fee_borne_by_exiting_member` | compliant |
| Verification discipline | `scripts/verify-integrations.ts`, `pnpm verify`, `docs/verification.md` | retained; current output is 53/53 green |
| Consumer-first UI foundation | `apps/web/src/dashboard.tsx`, mobile overflow check, bigint display helpers | partially complete but direction is compliant; no live performance is fabricated |

## B. Required corrections and implementation impact

The table uses the requested fields. “Needs implementation” means the current code does not yet provide the behavior; it is not permission to replace the existing design.

| Update area | Current file / symbol | Current behavior | Required behavior | Migration impact | Tests affected |
|---|---|---|---|---|---|
| Name/product wording | `README.md` sections “The name”, “Problem”, PreStocks copy | Correct name sentence and approved SpaceX exposure sentence are present; README status text is stale and says no program exists | Keep wording; update stale status/phase claims and preserve qualified collective-investing thesis | none | lint/content scan |
| Raw-unit rule | `README.md`, `docs/architecture.md`, Rust comments | Already uses raw units as source of truth | Keep; ensure every future execution/NAV path uses raw balances and exact conversion at display boundary | none | `test_scaled_ui_not_used_for_ownership`, money-lint |
| Contribution lifecycle | `programs/tenet/src/instructions/epoch.rs`, `instructions/valuation.rs` | Epoch 0 works; rolling epochs now use bounded on-chain NAV snapshots with permissionless cancellation recovery | Keep isolated escrow, require verified NAV, and never trust client NAV | no deployed state migration known; preserve current PDA seeds | reserved-share, stale-NAV, cancellation, no-dilution tests |
| Circle aggregate reservation | `state::Circle.reserved_shares` | Implemented as an aggregate; current docs/progress contain stale historical “no code” claims | Keep aggregate plus per-Epoch proof; document it as derived, not an independent balance | pre-deploy layout already includes it; deployed-state migration must be checked before any upgrade | invariant/property tests |
| Instruction surface | `programs/tenet/src/lib.rs` | `cancel_contribution`, `refresh_asset_metadata`, Fork, staged redemption and amendment handlers exist; execution remains fail-closed; generated IDL/deployable artifact is current | Preserve stable names; keep begin/end execution until verified route/price checks are complete. Keep amendment threshold/delay governance and no exit dependency | add-only account/instruction migration; no rename of existing deployed instruction | refresh account-validation tests, Fork tests, amendment tests, execution replay tests |
| NAV/value | `packages/domain/src/valuation.ts`, `programs/tenet/src/instructions/valuation.rs` | Exact off-chain valuation boundary and consumer VALUE panel now align with bounded on-chain Pyth NAV snapshots; market-vs-mark and paired-feed surfaces remain analytical | Keep verified Pyth observations and refreshed multiplier metadata separate from raw ownership accounting | add registry/metadata fields only through explicit migration plan | `valuation.test.ts`, stale/confidence, market-vs-mark, paired-feed-unavailable, supply, on-chain snapshot tests |
| Jupiter execution | no execution instruction in current `lib.rs` | No swap path yet; `ExecutionAuth` is an unused state concept | Verify current router integration; bind Circle/vaults/mints/max input/min output/nonce; verify actual post-swap deltas and all Mandate caps | new execution accounts only; no custody-account replacement | output-vault, caps, replay, unauthorized-route tests |
| PreStocks safety | registry stores classification/live mint facts, but no execution attestation path | No permissionless price injection exists, but no PreStocks execution exists | Use verified executable source or bounded signed attestation with zero custody authority; discover live universe | no migration unless new attestation PDA is adopted | attestation-boundary and stale/expiry tests |
| Corporate actions | `AssetStatus` and verification/threat-model docs exist | No live refresh/indexing instruction or UI surface | Add sourced current state, status/ratio/deadline/replacement and safe-purchase restrictions without blocking Tenet exit | metadata/indexer migration only; preserve mint/vault identity | corporate-action stale/current tests |
| Fork | `Mandate.forked_from`, `fork_mandate` and `fork_mandate_asset` exist in source and current IDL/artifact | Child constitution path is artifact-tested; no parent custody or member accounts enter the path | Copy rules/config/lineage only; child asset PDAs are copied independently; parent read-only and capital untouched | add-only PDAs/instructions; deployed parent accounts remain unchanged | `test_fork_copies_rules`, `test_fork_does_not_move_parent_assets`, `test_child_mandate_cannot_modify_parent` |
| Amendments | `AmendmentProposal`/`AmendmentVote` PDAs and proposal/vote/execute handlers | Complete constitution snapshots, settled-share voting, current-delay execution and share-stability invalidation are implemented; UI does not yet expose proposal history | Keep threshold + delay governance; any share-total or reserved-exit change invalidates the proposal; exit/fork remain alternatives | add-only proposal/vote PDAs; no mutation of old Mandate layout | `test_amendment_requires_threshold_and_delay`, `test_amendment_vote_is_unique_and_uses_settled_shares`, `test_amendment_rejects_non_member` |
| Automatic contribution rail | no `ContributionRule` account/instruction/UI | Manual contribution only | Add optional real recurring path after core loop. Percentage/round-up require honest off-chain detection and bounded on-chain authorization; no direct buying | new PDAs only; manual path unchanged | all §49 automation tests |
| Contribution UI | `apps/web/src/dashboard.tsx` `EpochCard` | Contribute-now is present; no automation panel | Add optional “Automate contributions” surface with recurring/percentage/round-up states, pause/revoke and rule-vs-Mandate explanation | UI-only until verified authorization exists | UI integration and authorization-state tests |
| Mainnet/live-data wording | `README.md`, `PROGRESS.md`, `docs/verification.md` | README and some progress sections describe the repository as pre-program | Make status truthful; never turn observed values into constants | none | `pnpm verify`, money-lint, docs review |
| Required named tests | Rust/domain suites | Fork, amendment, accounting, exit and execution-delta names exist; automatic-contribution names remain absent because the rail is not shipped | Add exact canonical names or explicit aliases only when behavior is identical; preserve all existing tests | none | full Rust/TS suite |

## C. Automatic Contribution Rail — safest current architecture

The verified candidate is Solana Subscriptions & Allowances, recorded as V-025 in `docs/verification.md`:

```text
user wallet
  └─ explicit bounded USDC authorization
       └─ revocable recurring delegation
            └─ keeper / authorized transfer
                 └─ Tenet contribution path
                      └─ current EpochEscrow
                           └─ finalize → settle → Mandate execution
```

The proposed Tenet-side account is a new `ContributionRule` PDA keyed by `(circle, owner, rule id)`, containing rule kind, Circle, owner, authorized asset (USDC), maximum amount/period, schedule or observation window, expiry, paused/revoked state and execution nonce. Its destination must be derived from the current Circle/Epoch and never be caller-selected.

Implementation gate before code:

1. Verify on-chain whether the allowance program’s recurring transfer is CPI-capable.
2. Verify whether a PDA can be the delegatee/recipient for a permissionless keeper.
3. Verify exact account/rent/transfer-hook requirements on devnet.
4. Verify revocation directly from the member wallet and prove future transfers fail.

If items 1–2 do not pass, do not simulate automation. Keep manual contribution production-ready and either use a real keeper-submitted transfer followed by verified escrow balance deltas, or defer automation.

Priority remains recurring → percentage → round-up. Percentage and round-up are not purely on-chain schedules: an indexer/keeper may detect eligible inbound USDC or settled payments, but the authorization remains bounded and the UI must say detection is best-effort. No automation instruction may include swap accounts or investment selection.

## D. Account migration plan

Current inspection found:

| Concern | Current state | Plan |
|---|---|---|
| `Vec<Holding>` in Circle/Mandate | absent; uses `MandateAsset`/`CircleAsset` PDAs | preserve PDA model |
| duplicated holding `raw_amount` | absent; vault token-account amount is authoritative | never add a duplicate; read vault balances |
| `Circle.usdc_pending` | absent; `EpochEscrow` is a separate token account | preserve physical/logical separation |
| immediate shares in `contribute` | absent; receipts settle later | preserve lifecycle |
| existing deployed accounts | no mainnet Tenet deployment found; current program is devnet/test harness work | before deployment, freeze layouts; if an account has shipped, use versioned migration instructions and a written authority/rent/rollback plan. Do not reinterpret old bytes in place |
| future automation | no existing accounts | add new PDAs; manual contributions and old Epoch accounts remain valid |

The only current layout-sensitive area is the existing Circle/Member/Epoch/Redemption schema. No field removal or seed change is authorized by this update. Any needed change after deployment is a migration design task, not a refactor hidden inside feature work.

## E. Updated test plan

Already passing or present: `test_pending_usdc_isolated`, `test_pending_member_has_no_active_claim`, `test_reserved_shares_do_not_dilute`, `test_late_settlement_no_dilution`, `test_transfer_fee_borne_by_exiting_member`, `test_one_failed_asset_does_not_unnecessarily_lock_other_claims`, `test_redemption_entitlement_cannot_be_diluted`, `test_account_substitution_rejected`, `test_scaled_ui_not_used_for_ownership`, and the domain invariant/property suite.

Required additions or completion gates:

```text
test_execution_output_reaches_correct_vault
test_execution_respects_all_caps
test_no_authority_can_extract_assets
test_fork_does_not_move_parent_assets
test_child_mandate_cannot_modify_parent
test_amendment_requires_threshold_and_delay
test_redemption_entitlement_cannot_be_diluted       (program-level adversarial path)
test_scaled_ui_not_used_for_ownership               (program/fixture parity if needed)
test_redeem_always_available                         (Tenet gate only; issuer failures separate)
test_auto_contribution_requires_authorization
test_auto_contribution_respects_authorized_limit
test_auto_contribution_targets_correct_circle
test_auto_contribution_enters_epoch_escrow
test_auto_contribution_cannot_buy_assets_directly
test_auto_contribution_cannot_bypass_mandate
test_auto_contribution_revoke_stops_future_execution
test_auto_contribution_cannot_exceed_circle_cap
```

The fuzz/property harness must cover contribute, cancel, finalize, settle, execute, exit, claim and fork, including zero/max values, rounding boundaries, multiplier changes, transfer fees, stale pricing, zero liquidity and partial external-transfer failures. After every step assert:

```text
claimed Member shares + reserved Epoch shares = effective Circle shares
```

## F. Risk review

| Risk | Assessment / control |
|---|---|
| Migration | no current deployed Tenet state was found; treat any future deployed account as immutable until a versioned migration is approved |
| Share dilution | highest accounting risk; reserved shares must be counted at finalization and never again at late settlement; rolling issuance blocks without trustworthy NAV |
| Authority | vault PDA is the only Circle asset signer; automation must use user-bounded, revocable USDC authorization and never custody arbitrary wallet funds |
| Token compatibility | classic SPL and Token-2022 can coexist; every mint/program/extension/vault relationship must be checked dynamically |
| CPI/Jupiter | no execution path is currently shipped; verify current router composition and actual balance deltas before implementation |
| Oracle | stale/low-confidence Pyth or missing PreStocks executable value may block issuance/execution, never Tenet-level exit |
| Issuer | pause/freeze/permanent delegate/transfer hooks remain external controls; surface them and isolate failed claims |
| Automation liveness | keeper failure may skip a contribution but must never trap funds; manual contribution remains available |
| Scope | automation is Phase 9 and cannot delay POOL/EXECUTE/VALUE/EXIT/FORK |

## Contradictions to preserve explicitly

1. The update lists `execute_epoch` as one instruction, while its own Jupiter rule requires checking actual post-swap balances after Jupiter runs. Keep a begin/execute/end or equivalent two-phase transaction design until a verified single-instruction mechanism exists; do not trust a quote field.
2. The literal redemption formula using the entire vault balance over-allocates under parallel exits. Use available balance after existing reservations; this is required for fair concurrent claims and is already implemented.

## Incremental application order

1. Correct stale documentation/status claims and keep `PROGRESS.md` truthful.
2. Complete Phase 1–3 test-name parity and program-level adversarial coverage.
3. Regenerate the IDL/deployable artifact and verify `refresh_asset_metadata` and Fork against a fresh local deployment.
4. Complete EXIT review, then public-equity EXECUTE and Pyth-backed VALUE.
5. Add PreStocks execution/market-vs-mark/corporate-action surfaces.
6. Keep amendment governance UI and proposal history gated until wallet/indexer state is wired; the program path is artifact-tested.
7. Re-verify the Solana authorization primitive and implement only one real automation path if all gates pass.
8. Run full Rust/TypeScript/UI/verification suites after each major accounting or authority change; update `REVIEW.md` and `PROGRESS.md` continuously.
