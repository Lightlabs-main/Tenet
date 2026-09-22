# Tenet — Threat Model & Risk Register

**Artifact D of the six pre-implementation artifacts.**

Tenet holds real user funds. Each risk below names a concrete failure, the invariant that must hold, the mitigation, the **residual** risk that remains after mitigation, and the test that proves it.

**Implementation status (2026-09-22):** this register covers the target
architecture. The current devnet program now includes Fork and amendment
instructions with artifact-level tests. Execution remains fail-closed pending
target pricing/route verification, and automatic-contribution authorization
is still a design requirement rather than a shipped capability.

Severity is `impact × reachability`. "Residual" is what is still true after we have done everything we can — several residuals are irreducible and must be *disclosed* rather than claimed away.

---

## Summary

| id | risk | severity | residual after mitigation |
|---|---|---|---|
| R-01 | Share dilution | **critical** | none if INV-001 holds |
| R-02 | Rounding exploitation | **critical** | dust accrues to Circle (intended) |
| R-03 | Arithmetic overflow | **critical** | none |
| R-04 | Oracle manipulation | **critical** | bounded by caps + confidence policy |
| R-05 | Stale / low-confidence prices | high | issuance pauses; exit unaffected |
| R-06 | Liquidity & execution impact | high | bounded by `max_price_impact_bps` |
| R-07 | Corporate action / expiry | high | **partially irreducible** — disclosed |
| R-08 | ScaledUiAmount multiplier change | **critical** | none for ownership; valuation needs live reads |
| R-09 | Issuer controls (delegate/freeze/pause/hook) | **critical** | **irreducible** — must be disclosed |
| R-10 | Transfer fees | medium | borne by the actor; disclosed pre-signature |
| R-11 | Jupiter execution integration | **critical** | post-balance verification bounds it |
| R-12 | Pyth availability / API key | high | degrade to Unavailable; exit unaffected |
| R-13 | Registry classification trust | high | **disclosed** trust assumption |
| R-14 | Program upgrade authority | **critical** | **must be burned or disclosed** |
| R-15 | Account substitution | **critical** | none — structural |
| R-16 | Attestation trust | high | bounded to "bad trade", never theft |
| R-17 | Frontend / indexer data integrity | high | on-chain wins; provenance shown |
| R-18 | Pricing-service trust | high | narrow, non-custodial, disclosed |
| R-19 | Replay | **critical** | none — structural |
| R-20 | Griefing / liveness | medium | permissionless recovery paths |
| R-21 | Automatic contribution authorization | high | bounded by an audited program; revocation bypasses Tenet |
| R-22 | Off-chain detection for percentage / round-up | medium | best-effort trigger, bounded authorization; must be disclosed |
| R-23 | **Underlying-company concentration via two wrappers** | high | needs a second cap dimension — see below |

---

## R-01 — Share dilution

**Scenario.** A contributor settles a receipt three epochs late and `settle_contribution` increments `circle.total_shares` again, minting shares that were already counted at finalization. Every existing member is silently diluted.

**Invariant.** INV-001: `sum(member.shares) + Σ(reserved − settled) == circle.total_shares`.

**Mitigation.** Reserved-share accounting (architecture §4). `total_shares` increases **only** in `finalize_epoch`. `settle_contribution` takes `circle` as a **read-only** account, so the runtime makes the error impossible rather than relying on our discipline. `close_epoch` releases the rounding residue so dust cannot sit in the denominator forever.

**Residual.** None, provided INV-001 is asserted after every operation in the property tests.

**Tests.** `test_reserved_shares_do_not_dilute`, `test_late_settlement_no_dilution`, `test_rolling_epoch_no_dilution`, plus the INV-001 assertion in the fuzz harness.

---

## R-02 — Rounding exploitation

**Scenario.** An attacker contributes and exits repeatedly in a pattern where each round's rounding favours them by one unit, farming value from other members.

**Invariant.** INV-005: rounding never advantages the actor who triggers it.

**Mitigation.** Every division floors toward the Circle. Issuance floors down; redemption floors down; dust stays in the vault. There is no path where a rounding remainder is paid out.

**Residual.** Dust accrues to the Circle and is shared pro-rata by remaining members. This is intended and documented.

**Tests.** `test_rounding_always_favours_the_circle` (fuzz over adversarial amounts), `test_zero_boundaries`, and a property test asserting Circle NAV per share is non-decreasing across any contribute/exit sequence at fixed prices.

---

## R-03 — Arithmetic overflow

**Scenario.** `pending_usdc_raw * share_rate_fixed` overflows `u64` and wraps, producing an absurd share count.

**Invariant.** No silent wraparound anywhere.

**Mitigation.** `u128` intermediates with `checked_*` throughout; explicit checked downcast to `u64` at every boundary; `overflow-checks = true` in the release profile (this is a Cargo setting that is *off* by default in release — it must be set explicitly and asserted in CI). TypeScript uses `bigint` and audited decimal arithmetic; `Number` is banned for money by lint rule (RULE 4).

**Residual.** None.

**Tests.** `test_overflow_protection`, `test_max_boundaries`; a CI grep asserting `overflow-checks` is enabled.

---

## R-04 — Oracle manipulation

**Scenario.** An attacker moves a thin market or submits a manipulated price update immediately before `finalize_epoch`, depressing `active_nav_before` so their pending contribution buys a disproportionate share of the Circle.

**Invariant.** INV-013: unsafe pricing blocks price-dependent actions.

**Mitigation.** Feed id checked against the registry entry, never caller-supplied. `get_price_no_older_than` with an explicit per-class max age. Confidence-ratio policy rejects wide intervals. `NavSnapshot` bounds the whole valuation to a slot window. Execution is frozen while a snapshot is open, so vault balances cannot move underneath it. Mandate caps are enforced against post-execution reality regardless of what any price claimed.

**Residual.** Bounded. An attacker who can move the real market within the confidence policy can still shift NAV somewhat; the caps limit the damage, and Epoch 0 (the largest issuance event) uses no oracle at all.

**Tests.** `test_execution_rejects_bad_price`, `test_pyth_confidence_policy`, `test_rolling_epoch_no_dilution` under adversarial price sequences.

---

## R-05 — Stale prices

**Scenario.** Pyth stops updating. The Circle keeps issuing shares at last week's prices.

**Invariant.** INV-013 blocks issuance; INV-014 protects exit.

**Mitigation.** Staleness is a hard failure in `record_asset_nav`. The epoch cannot finalize; it moves to `Cancelled` and every contributor recovers escrowed USDC without approval. **`initiate_redemption` has no price account in its instruction at all** — the separation is structural, not procedural.

**Residual.** New issuance pauses during an outage. That is the correct behaviour.

**Tests.** `test_pyth_staleness`, `test_exit_without_oracle`, `test_execution_rejects_stale_price`.

---

## R-06 — Liquidity & execution impact

**Scenario.** A Circle large relative to a thin PreStocks market executes and moves the price badly against itself; or attempts to exit a position into a market that cannot absorb it.

**Invariant.** INV-009 … INV-012 caps hold; impact is measured from real balance deltas.

**Mitigation.** `max_price_impact_bps` checked against the actual `spent`/`gained` in `end_execution`, never a quoted number. `max_supply_consumption_bps` computed in raw units (`vault.amount / mint.supply`). Minimum viable trade size measured per asset (V-011). Execution plans prefer deploying new cash over sell-side rebalancing.

**Residual.** Real. A Circle can still hold an asset it cannot exit at a good price. Mitigated by the design decision that **exit is in kind** — the member receives the tokens and chooses when to sell, so the Circle is never forced to liquidate into a thin market for a departing member.

**Tests.** `test_execution_rejects_supply_cap`, `test_execution_output_reaches_correct_vault`, `test_zero_liquidity` (adversarial).

---

## R-07 — Corporate actions, conversion and expiry

**Scenario.** A PreStocks asset converts or expires. A Circle holds a token that is about to become worthless or must be exchanged by a deadline, and the UI shows a stale price as though nothing is wrong.

**Invariant.** Corporate-action state is financial state, not decorative metadata.

**Mitigation.** Corporate-action status is tracked per asset with `status`, `conversion_ratio`, `effective_date`, `deadline`, `replacement_asset`, `source`, `last_verified`. Verified against official sources, never hardcoded from this prompt's examples (spec §49). New purchases of an asset under a material conversion/expiry event are blocked. The status is surfaced prominently on the Circle and asset pages. **In-kind exit is never blocked** merely because pricing is unavailable.

**Residual.** **Partially irreducible.** Tenet can only act on corporate actions it learns about. A surprise action between polls is a real exposure and must be stated in the README's limitations.

**Tests.** `test_expired_asset` (adversarial), `test_exit_without_oracle` covering an asset with no price.

---

## R-08 — ScaledUiAmount multiplier change

**Scenario — verified, not hypothetical.** V-003 shows SPACEX's `scaledUiAmountConfig.multiplier` reads `1` while `newMultiplier` is `5` with an effective timestamp already in the past. An implementation reading `multiplier` values the position at **one fifth** of its true size. A member exiting at that moment would be told their exposure is worth 20% of reality.

**Invariant.** INV-019: scaled-UI changes never alter canonical raw ownership.

**Mitigation.** Ownership accounting uses raw base units exclusively — a multiplier change provably cannot alter a member's pro-rata claim, because the multiplier never appears in the redemption arithmetic. Supply consumption uses raw over raw, so the multiplier cancels. Display and valuation use a single tested `effectiveMultiplier(mint, now)` function implementing the timestamp rule, read live and never cached across a corporate action.

**Residual.** None for ownership. Valuation depends on reading the mint live, which is a liveness dependency, not a correctness one.

**Tests.** `test_scaled_ui_not_used_for_ownership`, `test_exit_after_scaled_multiplier_change`, `test_scaled_ui_effective_multiplier_selection` (boundary instant, both directions), `test_raw_balance_is_canonical`.

---

## R-09 — Issuer controls: PermanentDelegate, freeze, pause, transfer hook

**Scenario — verified.** V-002 shows one key, `WV9PJN7XTmTLVwbutCLFxp8TyePee6Xq5mRq6Fti5Wc`, simultaneously holding `permanentDelegate`, `freezeAuthority`, `pausableConfig` authority, `transferHook` authority and `transferFeeConfig` authority on PreStocks mints. That key can move tokens out of any account, freeze any account, pause all transfers, install a transfer hook, or raise the fee.

**Invariant.** None available — **Tenet cannot constrain the issuer.**

**Mitigation.** Disclosure, not prevention:

- The issuer's powers are shown on the PreStocks asset page and in the README's trust assumptions.
- Exit-guarantee wording is bounded exactly as spec §37 requires: Tenet may say *"Tenet does not impose a permission gate on exit"* and must **never** say *"every external token is always transferable."*
- A transfer hook appearing without warning must not break other assets' claims — per-asset claim isolation covers this.
- The registry surfaces issuer-control status so a Mandate author can see it before including an asset.

**Residual.** **Irreducible and severe.** This is the single largest trust assumption in the product. It is a property of the asset, not of Tenet, and it must be stated plainly wherever PreStocks exposure is offered.

**Tests.** `test_permanent_delegate_scenario` (simulate seizure; assert Tenet's accounting stays consistent and other assets remain claimable), `test_paused_mint_isolates_claim`.

---

## R-10 — Transfer fees

**Scenario — verified.** V-004: the active fee is 100 bps, **uncapped**, and was raised from 50 bps at epoch 1032. A naive implementation reimburses the exiting member's fee from Circle USDC, making remaining members pay for someone else's exit.

**Invariant.** INV-015: the exiting member bears their own transfer mechanics.

**Mitigation.** No reimbursement path exists in the program. The expected fee is computed with the epoch-correct `activeTransferFee(mint, currentEpoch)` and shown before signing. An entitlement too small to transfer economically stays outstanding as a claim — never seized, never socialised (spec §22).

**Residual.** Exit costs real money on PreStocks assets. Disclosed pre-signature.

**Tests.** `test_transfer_fee_borne_by_exiting_member`, `test_remaining_members_not_charged_exit_fee`, `test_maximum_transfer_fee` (adversarial), a unit test for the epoch-boundary fee selection.

---

## R-11 — Jupiter execution integration

**Scenario.** A malicious or compromised frontend supplies a route that sends output to an attacker-controlled account, or claims a price impact of 0.3% while executing at 30%.

**Invariant.** INV-007 (output cannot be redirected), INV-008 (no asset outside the Mandate).

**Mitigation.** `dest_vault` is **derived** from `["vault", circle, out_mint]`, never accepted from the caller. `mandate_asset_out` must exist, proving the asset is in the universe. All Mandate caps are enforced in `end_execution` against **actual post-transaction balances**. A quoted `priceImpactPct` is never trusted as an input to a safety check — only as a UI hint. In the sandwich design, the delegate is approved for exactly `max_in` and revoked in the same transaction, and instruction introspection asserts only Jupiter runs in the window.

**Residual.** The introspection logic is the crux. If it has a gap, the delegate window is exploitable. **This is the first thing Codex must attack.** The archived official CPI crate (V-008) also means we carry our own integration risk.

**Tests.** `test_execution_output_reaches_correct_vault`, `test_execution_rejects_universe_violation`, `test_jupiter_output_redirect_rejected`, `test_non_jupiter_instruction_in_window_rejected`, `test_delegate_revoked_on_failure`.

---

## R-12 — Pyth availability and the API key

**Scenario.** V-007: Hermes now requires an API key. The key is rate-limited or revoked, and the valuation path stops working.

**Mitigation.** Every price-dependent action fails closed. The UI shows `Unavailable` with a reason. Share issuance pauses; exit is unaffected. No cached or estimated price is ever substituted (RULE 1).

**Residual.** A credentialed third party sits in the valuation path. This is a genuine availability dependency and belongs in the README's limitations.

**Tests.** `test_pyth_staleness`, `test_exit_without_oracle`, plus an integration test with the key deliberately invalid.

---

## R-13 — Registry classification trust

**Scenario.** An asset is misclassified as a public equity rather than pre-IPO, letting a Circle exceed `max_pre_ipo_weight_bps` while appearing compliant. Or a forged issuer label defeats `max_issuer_weight_bps`.

**Mitigation.** Classification cannot come from arbitrary user input (spec §25). The registry authority is a named key with **no custody power whatsoever** — it can mislabel, but it can never move a token. Registry entries are seeded from verified on-chain and issuer data, and the classification plus its source is shown on the Mandate page.

**Residual.** **Disclosed trust assumption.** A malicious registry authority could cause a Circle to hold a risk profile its Mandate did not intend. It could never steal.

**Tests.** `test_forged_registry_classification` (adversarial), `test_registry_authority_cannot_extract` (part of the INV-006 sweep).

---

## R-14 — Program upgrade authority

**Scenario.** Whoever holds the upgrade key can replace the program with one that drains every vault. This defeats every other control in this document.

**Mitigation.** Before any claim of production readiness the key is either burned, or retained and **explicitly disclosed** on the Circle page and in the README (spec §65). No middle position, and no silent retention.

**Residual.** While the key lives, Tenet is a trusted system wearing a trustless interface. Say so.

**Tests.** A deployment check asserting the documented upgrade-authority state matches the on-chain state.

---

## R-15 — Account substitution

**Scenario.** A caller passes their own token account as `vault`, or Circle B's vault while operating on Circle A, or a fake token program.

**Invariant.** INV-018.

**Mitigation.** Structural. `CircleAsset` and the vault are PDAs seeded on `(circle, mint)`, so an account belonging to another Circle **cannot be derived at the expected address**. `token_program` is validated against `mint.owner`. Every instruction re-derives every PDA. The universal constraint table in `docs/instructions.md §0` is applied without exception.

**Residual.** None, provided no instruction accepts an unchecked `AccountInfo` in a custody path. A CI lint flags raw `AccountInfo` in custody instructions.

**Tests.** `test_wrong_vault_rejected`, `test_wrong_circle_rejected`, `test_wrong_mint_rejected`, `test_wrong_token_program_rejected`.

---

## R-16 / R-18 — Attestation and pricing-service trust

**Scenario.** PreStocks has no verified on-chain oracle. Tenet's pricing service signs attestations. A compromised signer attests a wildly wrong reference value.

**Mitigation.** The attestation is bounded so that its worst case is a *bad trade*, never *theft*:

- It may only **narrow** what the Mandate already permits — it cannot raise a cap, admit an asset outside the universe, or move funds.
- It binds network, program id, circle, epoch, both mints, `max_in`, `min_out`, `issued_at`, `expires_at`, `nonce`.
- Replay is structurally impossible: the `ExecutionAuth` PDA is seeded on `nonce` (INV-020).
- `end_execution` still enforces every cap against real post-state, so a lying attestation cannot widen the outcome.
- The attestor key is per-Circle, on-chain and shown in the UI. Members who dislike it may exit or fork.

**Residual.** A disclosed, bounded trust assumption. Worst case is a trade inside `max_price_impact_bps`.

**Tests.** `test_execution_authorization_expiry`, `test_execution_replay_rejected`, `test_wrong_circle_authorization_rejected`, `test_attestation_cannot_widen_caps`.

---

## R-17 — Frontend and indexer data integrity

**Scenario.** The indexer serves a stale or wrong NAV and a member exits believing a false number; or a compromised frontend submits a bad execution.

**Mitigation.** On-chain state is authoritative; the indexer is a cache (spec §44). The program never accepts a client-supplied NAV. Every financial number in the UI carries provenance (source + observation time). When a source fails, the UI renders `Unavailable` and blocks the dependent action — there is no fabricated fallback (RULE 1).

**Residual.** A compromised frontend can mislead a user into signing something legal-but-unwise. Pre-signature simulation showing real expected effects is the mitigation.

**Tests.** `test_program_rejects_client_supplied_nav`; UI tests asserting `Unavailable` rather than a placeholder number.

---

## R-19 — Replay

**Scenario.** An execution authorization is submitted twice, executing the same trade twice.

**Mitigation.** `ExecutionAuth` is a PDA seeded on `["exec_auth", circle, epoch, nonce]` and is **closed** in `end_execution`. A second attempt fails at account init. Structural, not a flag check.

**Residual.** None.

**Tests.** `test_execution_replay_rejected`, `test_execution_authorization_expiry`.

---

## R-20 — Griefing and liveness

**Scenario.** Someone initiates a redemption and never reserves, freezing execution forever. Or nobody settles a receipt and the epoch never closes.

**Mitigation.** Every recovery path is **permissionless**: `reserve_redemption_asset`, `settle_contribution`, `record_asset_nav`, `close_epoch` and `open_epoch` may all be called by anyone. A redemption carries a deadline after which anyone may force-complete its reservations. No Circle can be held hostage by one absent participant.

**Residual.** Someone must eventually pay the transaction fee. In practice any member has the incentive.

**Tests.** `test_permissionless_recovery`, `test_redemption_deadline_force_complete`.

---

## R-21 — Automatic contribution authorization

**Scenario.** A member authorises recurring contributions. A compromised keeper, or Tenet itself, drains their wallet; or revocation silently fails to stop future pulls.

**Mitigation — structural, not policy.** Tenet never holds a raw wallet delegation. Authorization runs through the audited Solana **Subscriptions & Allowances** program (V-025), bounded by `amountPerPeriod`, `periodLengthS` and a hard `expiryTs`. Tenet's `execute_auto_contribution` has exactly **one** possible destination — the derived `["epoch_escrow", circle, epoch_index]` PDA — so it cannot buy assets, cannot bypass the Mandate and cannot exceed `max_pool_size_usdc`.

**The decisive property:** revocation is a direct call to the Solana program. **No Tenet code path participates**, so Tenet cannot block, delay or gate it even if fully compromised — the same shape as the exit guarantee.

**Residual.** The keeper learns contribution timing. Keeper liveness is a UX dependency, not a custody one: if the keeper stops, contributions simply do not happen and the member can contribute manually. Tenet also inherits dependency risk on a program shipped 2026-06-02 — young, though audited by Cantina and Foundation-maintained. **Manual contribution therefore remains the production path** regardless of automation status.

**Tests.** The eight §49 tests, plus `test_auto_contribution_revoke_stops_future_execution` exercised against the real delegation program rather than a stub.

---

## R-22 — Off-chain detection for percentage and round-up rules

**Scenario.** A member believes "5% of incoming USDC" or "round up every payment" captures everything. The indexer misses transfers, and the member silently under-contributes — or the UI implies a guarantee that does not exist.

**Mitigation.** The distinction is stated plainly wherever these rules appear: **the authorization is bounded on-chain; the trigger is best-effort off-chain.** The delegation caps how much can ever be pulled per period; only detection is approximate.

**Residual.** Real and irreducible without an on-chain hook into arbitrary user payments. Implying guaranteed capture would be a RULE 1 violation — a financially plausible number the product cannot actually back. Recurring contributions have no such gap, which is why they ship first.

**Tests.** UI tests asserting the disclosure is present; `test_auto_contribution_respects_authorized_limit`.

---

## R-23 — Underlying-company concentration through two different wrappers

**Scenario — concrete, from V-010.** A Circle sets `max_issuer_weight_bps = 1500` intending "at most 15% SpaceX". It then buys **`SPCXx`** (the Backed xStock) *and* **`SPACEX`** (the PreStocks token). Both are SpaceX economic exposure. If the cap keys on the *token issuer*, these are two different issuers — Backed and PreStocks — and each is independently under the cap while the Circle's real SpaceX exposure is double what the Mandate intended.

**Root cause: `max_issuer_weight_bps` is ambiguous.** Two genuinely different risks are being conflated:

| dimension | what it limits | SPCXx vs SPACEX |
|---|---|---|
| **token issuer** (counterparty) | exposure to Backed's or PreStocks' solvency, pause/freeze authority, SPV structure | **different** — Backed vs PreStocks |
| **underlying company** (investment) | exposure to SpaceX's business outcome | **the same** |

Both are real caps a Mandate author would want, and they are not substitutes. A Mandate limiting counterparty risk is saying something different from one limiting investment concentration.

**Proposed correction — additive, no removal.** The registry entry carries both `issuer` (token issuer) and a new `underlying_id` (the company). The Mandate gains `max_underlying_weight_bps` alongside the existing `max_issuer_weight_bps`, and `end_execution` enforces both.

**Status: provisionally applied, pending your decision.** `Mandate.max_underlying_weight_bps` and `AssetRegistryEntry.underlying_id` now exist in `programs/tenet/src/state/mod.rs`.

I said earlier this was "proposed, not applied" and then included it, so stating that plainly: the fields are additive, they remove nothing, and no instruction enforces the new cap yet — that lands in Phase 4 with `end_execution`. If you decide the single `max_issuer_weight_bps` should carry both meanings, deleting two fields before first deployment costs nothing. Blocking Phase 1's account model on this decision would have cost more than carrying a field that might go unused.

What is **not** reversible for free is shipping a cap that says "15% SpaceX" and does not enforce it.

**Residual if not adopted.** `max_issuer_weight_bps` must then be documented as a *counterparty* cap only, and the UI must not describe it as limiting exposure to a company — otherwise the product states a guarantee it does not enforce.

**Tests (once the dimension is settled).** `test_underlying_cap_across_wrappers` — build a Circle holding both SPCXx and SPACEX and assert the intended cap binds.

---

## Adversarial review queue (spec §54)

Codex must specifically attempt, in this order — highest value first:

1. Instruction introspection gaps in `begin_execution` (R-11) — **the crux of the execution design**
2. Dilution via late settlement and reserved-share accounting (R-01)
3. Account substitution across Circles and mints (R-15)
4. Redemption reservation vs concurrent execution ordering (R-01/R-06)
5. Rounding farming over long contribute/exit sequences (R-02)
6. Exit immediately after finalization; exit mid-epoch; exit with pending contribution
7. Parallel redemptions in every permutation
8. Changed ScaledUiAmount multiplier mid-redemption (R-08)
9. Maximum transfer fee; PermanentDelegate seizure (R-09, R-10)
10. Stale Pyth; extreme confidence interval (R-04, R-05)
11. Duplicate execution and replay (R-19)
12. Forged registry classification (R-13)
13. Last-second contribution before an amendment vote (spec §39)
14. Zero liquidity; expired asset; Circle with only USDC; single-asset Circle; Circle at exactly `MAX_CIRCLE_ASSETS`

Findings are recorded in `REVIEW.md` with file, symbol, exploit scenario, expected invariant and required correction — with a failing test wherever one can be written.
