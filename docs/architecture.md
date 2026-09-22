# Tenet — Architecture Proposal

**Artifact A of the six original verification artifacts.** The design below is now partially implemented;
the implementation status and remaining gates are tracked in `PROGRESS.md`.

This document is grounded in `docs/verification.md`. Where a design depends on something not yet verified, it says so and names the blocking entry.

---

## 1. The object graph

```
Mandate ──────────────< MandateAsset >────────── AssetRegistryEntry
   │  (rules)                                          (classification)
   │
   │ 1:1
   ▼
Circle ───────────────< CircleAsset ──────────── vault (TokenAccount PDA)
   │  (capital)                                        ▲
   │                                                   │ signed by
   ├──────< Member                          VaultAuthority PDA
   │                                                   │
   ├──────< Epoch ──────< ContributionReceipt          │
   │            │                                      │
   │            └──────── EpochEscrow (USDC) ──────────┘
   │            └──────── NavSnapshot
   │
   ├──────< Redemption ──< RedemptionAsset
   │
   └──────── ActiveUsdcVault
```

Two hard separations carry most of the safety:

- **Mandate vs Circle.** A Mandate is rules. A Circle is money. A Fork copies the first and never touches the second (INV-016).
- **EpochEscrow vs ActiveUsdcVault.** Pending contributions are a different token account from active capital. This is what makes INV-002 and INV-003 structural rather than arithmetic.

---

## 2. PDA seeds

Every account is a PDA with a derivation that binds it to its parent. There is no account in the custody path whose address a caller may choose freely.

| account | seeds | notes |
|---|---|---|
| `Config` | `["config"]` | program-wide: registry authority + USDC mint (A-18) |
| `Mandate` | `["mandate", mandate_seed]` | `mandate_seed` is a client-generated `Pubkey`; avoids name-collision and variable-length seeds |
| `MandateAsset` | `["mandate_asset", mandate, mint]` | mint in the seed makes duplicates *impossible*, not merely rejected |
| `AssetRegistryEntry` | `["registry", mint]` | one entry per mint, globally |
| `Circle` | `["circle", mandate]` | 1:1 with Mandate in v1 |
| `CircleAsset` | `["circle_asset", circle, mint]` | duplicates structurally impossible |
| `VaultAuthority` | `["vault_authority", circle]` | the only signer over Circle assets |
| asset `vault` | `["vault", circle, mint]` | `TokenAccount`/`TokenAccount2022`, authority = `VaultAuthority` |
| `ActiveUsdcVault` | `["usdc_vault", circle]` | active capital only |
| `Epoch` | `["epoch", circle, index_le_u64]` | |
| `EpochEscrow` | `["epoch_escrow", circle, index_le_u64]` | **separate token account from `ActiveUsdcVault`** |
| `ContributionReceipt` | `["receipt", epoch, owner]` | one per member per epoch |
| `Member` | `["member", circle, owner]` | |
| `NavSnapshot` | `["nav_snapshot", epoch]` | |
| `Redemption` | `["redemption", circle, owner, seq_le_u64]` | `seq` allows repeat partial exits |
| `RedemptionAsset` | `["redemption_asset", redemption, mint]` | |
| `ExecutionAuth` | `["exec_auth", circle, epoch, nonce_le_u64]` | replay guard, see §10. `epoch` is the Epoch **account**, not its index; `nonce` is the field `ExecutionAuth.nonce` (formerly written `seq` here) |

**Why mint-in-seed matters.** `MandateAsset` and `CircleAsset` keyed by mint means "reject duplicate asset" is enforced by the runtime (account already initialized), not by a `Vec` scan we might get wrong. It also means account substitution across Circles fails automatically: a `CircleAsset` for Circle B simply cannot be derived at Circle A's address (INV-018).

---

## 3. Authority model

There is exactly one signer over Circle assets: the `VaultAuthority` PDA, seeds `["vault_authority", circle]`. It has no private key. It signs only inside instructions whose Anchor constraints already proved the transfer is protocol-legal.

Roles that exist, and what each may do:

| role | may do | may **never** do |
|---|---|---|
| Mandate author | create a Mandate; be credited as author | touch any Circle's assets; amend a Mandate unilaterally; affect forks |
| Circle creator | create a Circle from a Mandate | withdraw; choose trades; block exit |
| Member | contribute, cancel pending, settle, propose/vote amendments, exit, fork | withdraw more than pro-rata |
| Executor | submit an execution that the Mandate already authorises | choose an asset outside the Mandate; redirect output |
| Registry authority | classify assets (metadata only) | custody anything |
| Attestor | sign a short-lived price attestation that *narrows* what execution may do | authorise extraction; widen any Mandate limit |
| Upgrade authority | (see below) | — |

**Program upgrade authority is the one authority that can defeat all of the above.** Tenet is not production-ready while a live upgrade key exists. The deployment plan (`docs/deployment.md`, Phase 4) must either burn it or document it explicitly as a disclosed trust assumption on the Circle page. Risk `R-14`.

**Named test:** `test_no_authority_can_extract_assets` enumerates every role above, attempts a withdrawal with each as signer against every custody instruction, and asserts all fail (INV-006).

---

## 4. Share accounting

Full derivations live in `docs/accounting.md` (written at the start of Phase 1). The architectural decisions are fixed here.

### Representation

```
SHARE_DECIMALS      = 6          shares are u64, 1e-6 granularity
USDC_DECIMALS       = 6          confirmed on-chain (V-014)
NAV                 : u128       expressed in USDC raw units (micro-USDC)
```

> **A-17 supersedes A-03.** An earlier draft stored a fixed-point `share_rate_fixed` with
> `RATE_SCALE = 1e18`. The overflow analysis in `docs/accounting.md` §4.1 shows that
> formulation **overflows `u128` in a reachable degenerate case** — a Circle whose NAV has
> collapsed toward zero produces `amount × rate ≈ 1e50` against a `u128::MAX` of `3.4e38`,
> and that is precisely the state an attacker would want to contribute into.
> `RATE_SCALE` is removed. `Epoch` stores `total_shares_before: u64` and `nav_before: u128`,
> and every issuance divides once, directly. Peak intermediate falls to ~`1e32`, leaving
> six orders of magnitude of headroom, and the result is exact rather than fixed-point.

At inception, **1 share = 1 micro-USDC contributed**. Shares are `u64`; the theoretical ceiling is ~1.8e13 USDC of inception capital, far beyond any real Circle. Every intermediate is `u128` with checked arithmetic. No floating point appears anywhere in issuance, redemption or supply ratios (RULE 4).

### Epoch 0

`total_shares_before == 0`. The rolling formula is undefined here, so Epoch 0 has its own rule:

```
shares_i = amount_usdc_raw_i          (1:1, exact, no division)
```

Deterministic, no oracle, no rounding. This is why Epoch 0 is built first.

### Rolling epochs

```
active_nav_before = value(active holdings) + active_usdc_vault.amount     // excludes escrow
reserved_shares   = floor(pending_usdc_raw * total_shares_before / active_nav_before)
total_shares     += reserved_shares

epoch.total_shares_before = total_shares_before      // frozen, u64
epoch.nav_before          = active_nav_before        // frozen, u128
```

Guards, each a required failure branch:

- `active_nav_before == 0 && total_shares_before > 0` → **reject**. A Circle that has lost all value cannot price new entrants. Contributions are refundable via cancel; exit stays open.
- Any asset's price stale, low-confidence, or unavailable → **reject finalization** (INV-013). Exit is unaffected (INV-014).
- Every arithmetic step `checked_*` on `u128`, with an explicit downcast check to `u64`.

### Reserved-share settlement, and why late claims cannot dilute

Settlement is per-receipt and permissionless:

```
shares_i = floor(amount_usdc_raw_i * epoch.total_shares_before / epoch.nav_before)
```

Because `sum(floor(x_i)) <= floor(sum(x_i))`, the sum of individually settled shares can never exceed `reserved_shares`. Settlement moves shares from `reserved` to `claimed`; it **never** increments `total_shares` again. A contributor settling three epochs late receives exactly what the finalized rate entitled them to, and the arithmetic of later epochs is untouched because their shares were already counted in `total_shares` at finalization (spec §12).

`Epoch` carries `receipt_count` and `settled_count`. Once `settled_count == receipt_count`, a permissionless `close_epoch` releases the rounding residue `reserved_shares - settled_shares` by decrementing `total_shares`. Without this, dust shares would sit permanently in the denominator and slowly dilute everyone.

**INV-001 (exact):**

```
Σ member.shares  +  circle.reserved_shares  ==  circle.total_shares
```

`Circle.reserved_shares` is the running aggregate of `Σ over open epochs (epoch.reserved_shares − epoch.settled_shares)`, maintained incrementally: incremented in `finalize_epoch`, decremented in `settle_contribution` and in `close_epoch` when the rounding residue is released.

It is a **derived convenience, not a second source of truth.** Keeping it on `Circle` makes the invariant checkable in a single account read instead of iterating every open epoch — which matters because this is the invariant asserted after *every* step of the fuzz harness. The property test independently recomputes the per-epoch sum and asserts the two agree, so drift is caught rather than trusted away.

Checked as a property test after every generated operation sequence (`test_share_accounting_invariant`).

### Rounding direction

Every division floors **toward the Circle**. Issuance floors down (contributor gets no free share); redemption floors down (exiting member leaves dust behind). There is no path where rounding pays the actor who triggered it (INV-005). `test_rounding_always_favours_the_circle` fuzzes this.

---

## 5. NAV

One definition, used everywhere:

```
Circle NAV = active_usdc_vault.amount
           + Σ over enabled CircleAssets: realizable_value(vault.amount)
```

`EpochEscrow` is excluded, always. `reserved_for_redemption_raw` (§8) is excluded from the *issuable* NAV, because those tokens are already spoken for.

`realizable_value` is defined per asset class:

- **Tokenized public equity** — verified Pyth price for the *tokenized* instrument. The underlying-equity feed is used for the divergence surface only, never as NAV (spec §15).
- **PreStocks** — executable market value where a sufficiently reliable executable valuation exists. The issuer mark is displayed alongside as the reference mark and is **never** substituted into NAV (spec §18, justified by V-005: the two differ by ~5% right now).
- **USDC** — face value.

### Multi-transaction NAV, and why

Naively, finalizing an epoch must read N vaults plus N price accounts in a single transaction. That collides with the 1232-byte limit and the loaded-account cap, and it makes the maximum asset count a function of Solana's transaction size — a bad thing to bake into an accounting system.

Instead NAV is accumulated across transactions:

```
open_nav_snapshot(epoch)              -> NavSnapshot { slot_opened, assets_remaining, nav_accum }
  record_asset_nav(snapshot, asset)   -> validates one vault + one price source, adds to nav_accum
  ...once per enabled asset...
finalize_epoch(epoch, snapshot)       -> requires assets_remaining == 0
                                         and (current_slot - slot_opened) <= NAV_SNAPSHOT_MAX_SLOTS
```

Properties this buys:

- Each step validates exactly one `(CircleAsset, vault, mint, price)` tuple, so the account-substitution check is small and auditable.
- `record_asset_nav` is idempotent per asset (a bitmap in the snapshot), so it cannot be double-counted.
- The whole snapshot is bounded in time by `NAV_SNAPSHOT_MAX_SLOTS`; a stale snapshot expires rather than silently pricing an epoch at yesterday's prices.
- Execution is frozen while a snapshot is open, so the vault balances that were read cannot move underneath the calculation.

### `MAX_CIRCLE_ASSETS = 8`

Justification (spec §55):

- **Redemption** is per-asset and already unbounded-safe, so it does not constrain the count.
- **NAV** is now multi-transaction, so it does not constrain the count either.
- The real constraints are product and operational: a Mandate a person can actually read; an execution plan that converges in a reasonable number of routes; a Circle page that fits a phone; and a bounded worst case for the permissionless `record_asset_nav` loop.
- The live PreStocks universe is 8 (V-001), and a realistic Mandate mixes ~3 public equities with ~2–3 pre-IPO names. 8 comfortably covers the product without pretending to be an index fund.

`test_max_boundaries` builds a Circle at exactly 8 assets and drives the full lifecycle; a 9th asset must be rejected.

---

## 6. Epoch lifecycle

```
                  create_circle
                        │
                        ▼
                  ┌───────────┐  contribute / cancel_contribution
                  │   Open    │◀─────────────────────────────────────┐
                  └─────┬─────┘                                       │
                        │ closes_at reached                           │
                        ▼                                             │
                  ┌───────────┐  open_nav_snapshot                    │
                  │  Closed   │──▶ record_asset_nav (xN) ─────────────┤ snapshot expiry
                  └─────┬─────┘                                       │ returns to Closed
                        │ finalize_epoch                              │
                        ▼                                             │
                  ┌───────────┐                                       │
                  │ Finalized │  rate fixed, shares reserved,         │
                  └─────┬─────┘  escrow swept to ActiveUsdcVault      │
                        │                                             │
          settle_contribution (xN, permissionless)                    │
                        │                                             │
                        ▼                                             │
                  ┌───────────┐  execute_* against the Mandate        │
                  │ Executing │                                       │
                  └─────┬─────┘                                       │
                        │                                             │
                        ▼                                             │
                  ┌───────────┐  close_epoch releases share residue   │
                  │ Completed │──── open_epoch(index+1) ──────────────┘
                  └───────────┘

     Cancelled: reachable from Open/Closed when finalization is impossible
                (stale prices, zero NAV with shares outstanding). Every
                contributor can still cancel and recover escrowed USDC.
```

States are explicit fields, never inferred from timestamps alone (spec §30). `closes_at` is a *precondition* for the `Open → Closed` transition, not the transition itself.

**`Cancelled` is a safety valve, not a failure.** If prices cannot be trusted, the honest outcome is to refuse to price new shares and let people take their money back — not to guess a NAV.

---

## 7. Contribution lifecycle

```
contribute(epoch, amount)
    ├─ requires epoch.state == Open
    ├─ requires amount >= mandate.min_contribution_usdc
    ├─ requires epoch.pending + circle_nav + amount <= mandate.max_pool_size_usdc
    ├─ transfers USDC: member ATA ──▶ EpochEscrow   (never ActiveUsdcVault)
    ├─ init_if_needed ContributionReceipt { amount += , settled: false }
    └─ epoch.pending_usdc_raw += amount

cancel_contribution(receipt)
    ├─ requires epoch.state in { Open, Cancelled }
    ├─ requires !receipt.settled
    ├─ transfers USDC: EpochEscrow ──▶ member ATA   (VaultAuthority signs)
    ├─ epoch.pending_usdc_raw -= amount
    └─ closes receipt, rent to owner

        no admin approval anywhere in this path (spec §10)

settle_contribution(receipt)   [permissionless — anyone may settle anyone]
    ├─ requires epoch.state >= Finalized
    ├─ shares_i = floor(amount * epoch.total_shares_before / epoch.nav_before)
    ├─ member.shares += shares_i      (init_if_needed Member)
    ├─ epoch.settled_shares += shares_i ; epoch.settled_count += 1
    └─ DOES NOT touch circle.total_shares
```

Settlement being permissionless matters: a Circle can never be stuck because one contributor went away.

---

## 8. Redemption — design and dilution proof

This is the design the spec (§36) requires to be proven before implementation, and the one Codex must review first.

### Why not "compute and transfer in one instruction"

Because a single external asset can fail — paused mint (V-002 shows `pausableConfig` is live and issuer-controlled), frozen account, a transfer hook appearing, or a fee that makes a dust claim uneconomic. If all transfers share a transaction, one bad asset traps all the others. Spec §65 forbids that.

### The design: snapshot, reserve, then claim

**Step 1 — `initiate_redemption(circle, shares_to_redeem)`**

```
requires: no NavSnapshot open, no Redemption with unreserved assets
records:  redemption.shares_redeemed      = s
          redemption.total_shares_at_snap = S   (circle.total_shares before burn)
          redemption.assets_remaining     = circle.asset_count + 1   (+1 for USDC)
effects:  member.shares -= s
          circle.total_shares -= s
```

Shares are burned **immediately**. From this instant the exiting member has no claim on future gains and suffers no future losses — their entitlement is frozen as a fraction `s/S` of the vaults as they stood.

**Step 2 — `reserve_redemption_asset(redemption, circle_asset)`** *(permissionless)*

> **Why `available` subtracts reservations.** The obvious formula is
> `entitled = vault.amount × shares ÷ total_shares`. That is correct for a single
> redeemer and **wrong for two**: the second redeemer's entitlement would be computed
> against a balance that still contains the first redeemer's reserved-but-unclaimed
> tokens, so the Circle would promise more than it holds. Subtracting
> `reserved_for_redemption_raw` is what makes parallel exits fair, and is what the
> dilution proof below relies on.

```
available  = vault.amount - circle_asset.reserved_for_redemption_raw
entitled   = floor(available * s / S)          // u128 intermediate, floor
circle_asset.reserved_for_redemption_raw += entitled
redemption.assets_remaining -= 1
init RedemptionAsset { mint, amount_raw: entitled, claimed: false }
```

**Step 3 — `claim_redemption_asset(redemption_asset)`**

Transfers `amount_raw` from the vault to the member's token account, `VaultAuthority` signing, through the *correct* token program for that mint. Decrements `reserved_for_redemption_raw`. The member bears the transfer fee (INV-015). If the transfer fails for an issuer-side reason, **only this claim fails**; the account stays open and claimable later. Nothing is seized, nothing is socialised (spec §22).

### Execution is gated on reservations

`execute_*` requires `circle.pending_reservations == 0`, and all spending uses `vault.amount - reserved_for_redemption_raw`.

> **This applies to the USDC vault too, and the freeze alone is not sufficient.**
> Found by the property fuzzer and recorded as `REVIEW.md` H-01: once reservations
> complete the freeze correctly lifts, but the reserved USDC is still owed. An
> execution in that window could spend it and leave the claim unbackable.
> **Every vault the program can debit — asset or USDC — must spend only
> `balance − reserved`.** The freeze protects the window *before* reservation;
> this bound protects the window *after* it. So between Step 1 and Step 2 the Circle cannot trade, which is what makes "vault balance at reserve time" equal "vault balance at snapshot time".

The griefing question: could someone initiate a redemption and never reserve, freezing execution forever? No — Step 2 is **permissionless**. Any member (or a keeper) can complete another member's reservations. A redemption also carries a deadline after which anyone may force-complete the remaining reservations.

### Dilution proof

Let vault balance be `V`, total shares `S`, exiting shares `s`.

- Exiting member receives `e = floor(V·s/S)`.
- Circle retains `V − e`, and outstanding shares become `S − s`.
- Per-share backing after: `(V − e)/(S − s) ≥ (V − V·s/S)/(S − s) = (V/S)·(S − s)/(S − s) = V/S`.

Per-share backing for remaining members is **non-decreasing**, with equality only when `V·s/S` is an exact integer. Remaining members cannot be diluted (INV-004), and the exiting member cannot extract more than pro-rata because of the floor (INV-005).

For a second, concurrent redemption, the same argument applies with `V' = V − e₁` and `S' = S − s₁`; since `V'/S' ≥ V/S`, the second redeemer's per-share entitlement is no worse. Parallel redemptions are therefore safe in any order — which `test_parallel_redemptions` asserts by running every permutation.

Pending-epoch USDC is untouched by all of this: it lives in `EpochEscrow`, is not a vault, and is never reserved. An exiting member who also has an unsettled receipt cancels it separately. `test_exit_with_pending_epoch` covers this.

### Exit needs no oracle

Every quantity above is an integer read from a token account. No price, no Pyth, no Jupiter, no PreStocks API, no approval (RULE 6, INV-014). `test_exit_without_oracle` runs the whole path with every price source disabled.

---

## 9. Execution — two candidate designs

Nobody picks trades. `execute_*` may only move the Circle toward the Mandate's target weights, using new cash first (spec §31). The open question is *how* the Jupiter swap is performed, and V-008 makes this undecided.

### The binding constraint is account count, not instruction size (V-020)

Measured on mainnet: Jupiter's `swapInstruction` for a USDC → PreStocks route carries only ~39–45 bytes of data but **24–56 accounts**, depending on how many hops the router picks. Solana's per-transaction account-lock limit is **64**. Tenet's own accounts add roughly 10–12. A 56-account route therefore does not compose — and this is true for **both** options below, since either way every account must be present in the same transaction. Account count is a constraint on the whole approach, not a tiebreaker between designs.

Two further measured facts shape the design:

- **`maxAccounts` is a hint, not a cap.** At `maxAccounts=40` a route came back with 54 accounts. It cannot be used as a safety bound.
- **`onlyDirectRoutes=true` bounds the set to 24–30 accounts**, at a measured cost of ~1 bp or less of extra price impact at Circle entry sizes.

**Decision A-12: execution uses `onlyDirectRoutes=true` for v1**, and the composed transaction's account count is asserted before submission. Multi-hop execution waits until there is a measured way to bound it.

A third measurement matters independently of the option chosen: **routing is non-deterministic between calls.** The same pair returned different venues seconds apart. The account set at quote time is not the account set at execution time — so any check on the *shape* of the route is unreliable by construction, and verifying **actual balance deltas** is the only sound approach. That was already the design; V-020 turns it from a preference into a requirement.

### Option A — CPI into Jupiter

Tenet's program calls Jupiter directly; the vault never leaves program control.

- **Against:** `jup-ag/jupiter-cpi` is archived (V-008), so we would maintain our own generated bindings against an IDL that can change without notice. The 1232-byte limit is a live risk once Token-2022 accounts, a transfer-fee path and a possible hook are all present.

### Option B — sandwich with instruction introspection *(recommended)*

Three instructions in one atomic transaction:

```
1. begin_execution   records pre-balances of both vaults; validates the Mandate
                     permits this (in_mint, out_mint, max_in, min_out);
                     approves a delegate for EXACTLY max_in on the source vault;
                     reads the Instructions sysvar and asserts every instruction
                     between here and end_execution belongs to Jupiter's program
2. <Jupiter swap>    built off /swap-instructions, using ALTs
3. end_execution     re-reads BOTH vault balances; asserts
                       spent  = pre_in  - post_in  <= max_in
                       gained = post_out - pre_in  >= min_out
                     revokes the delegate; enforces every Mandate cap against
                     the ACTUAL post-state; writes the Execution record
```

- **For:** immune to transaction-size limits, because we never inline Jupiter's accounts into our own CPI frame. It validates *real financial effects* rather than trusting a route description — exactly what spec §32 demands. The Anchor changelog of August 2026 reports the Instructions sysvar being made usable again, which this design depends on.
- **Against:** it depends on instruction introspection being airtight. A gap there means an attacker could slip a non-Jupiter instruction into the window. The delegate approval is the entire attack surface and must be capped at `max_in` and revoked in the same transaction.

**Recommendation: Option B, with Option A retained as fallback.** The decision is **not final** — it is contingent on V-008, and Codex must review the introspection logic before a single lamport moves. Whichever is chosen, the post-balance verification in `end_execution` is mandatory: it is the check that makes a lying frontend harmless (INV-007).

### Mandate enforcement happens after the swap, not before

Price impact, single-asset weight, issuer weight, pre-IPO weight and supply consumption are all evaluated against post-execution vault balances. A client-supplied "price impact 0.3%" is never trusted (spec §32, §33). Supply consumption is computed in raw units only (`vault.amount / mint.supply`), which by V-003 is the only representation where the ScaledUiAmount multiplier cannot corrupt the ratio.

---

## 10. PreStocks price attestation

Public equities have Pyth. PreStocks does not have a verified on-chain oracle (V-007 covers Pyth only; no equivalent is known for PreStocks — this is UNVERIFIED and must be re-checked in Phase 0 before the attestation is built).

If an attestation proves necessary, it is bounded as follows:

```
attestation binds: network, program id, circle, epoch, in_mint, out_mint,
                   max_in, min_out, reference_market_value, issued_at,
                   expires_at, nonce
```

- The `ExecutionAuth` PDA seeded on `nonce` makes replay structurally impossible: the account already exists (INV-020).
- `expires_at` is checked against the on-chain clock.
- `circle` and `program id` binding means an attestation for one Circle is useless against another (`test_wrong_circle_authorization_rejected`).
- **An attestation may only narrow what is already permitted.** It cannot raise a Mandate cap, cannot authorise an asset outside the Mandate, and cannot move funds. A fully malicious attestor's worst case is a bad-but-bounded trade inside `max_price_impact_bps` — never extraction.
- The attestor key is per-Circle, stored on-chain, and shown on the Circle page. Members who dislike it can exit or fork. This is a **disclosed** trust assumption, not a hidden one.

---

## 11. Fork lifecycle

```
fork_mandate(parent, changes)
    ├─ reads  parent Mandate + parent MandateAssets
    ├─ writes new Mandate { forked_from: Some(parent), version: 1, author: signer }
    ├─ writes new MandateAssets  (rules only)
    ├─ applies the caller's explicit rule changes, re-validating ALL invariants
    ├─ creates a NEW Circle with zero assets, zero members, zero shares
    └─ parent Mandate account is READ-ONLY in this instruction
```

The parent is never passed as `mut`, so INV-017 is enforced by Anchor's account model rather than by a check we could forget. No token account of the parent Circle appears in the instruction at all, which is what makes INV-016 structural.

`test_child_mandate_cannot_modify_parent` snapshots the full parent account bytes before and after and asserts equality.

---

## 12. Data service boundary

`services/indexer` exists to make the product fast and legible. It is **never** authoritative for custody, shares, Mandate constraints or vault holdings — on-chain state wins (spec §44). Every financial number rendered in the UI carries provenance metadata naming its source and observation time, so "where did this number come from" is answerable for every dollar on screen.

When a data source is unavailable, the UI renders `Unavailable` and the dependent action is blocked with an explanation. There is no fallback number, ever (RULE 1).

---

## 13. Automatic Contribution Rail *(architecture only — implementation is Phase 9)*

Optional rules controlling **how USDC enters** a Circle. They do not choose investments.

```
Contribution Rules  control how capital ENTERS.
Mandate Rules       control what capital may DO.
```

This separation is the whole safety argument, and it is enforced structurally rather than by policy.

### The authorization primitive (verified — V-025)

Tenet does **not** invent a delegation mechanism. It uses the Solana Foundation's audited **Subscriptions & Allowances** program:

```
program   De1egAFMkMWZSN5rYXRj9CAdheBamobVNubTsi9avR44   (confirmed executable on mainnet)
shipped   2026-06-02 · audited by Cantina
model     recurring delegation: amountPerPeriod, periodLengthS, startTs, expiryTs
tokens    SPL Token and Token-2022, forwarding transfer-hook accounts
```

Why this and not a plain `approve`: a raw `approve` would put Tenet in the token account's **single delegate slot**, evicting any other protocol's delegation and granting a flat allowance with no time bound. The Subscription Authority indirection gives one approval per `(user, mint)` with many independently-bounded authorizations beneath it.

The property that matters most: **revocation does not pass through Tenet.** The member calls `revokeDelegation` on the Solana program directly. Tenet cannot block, delay or gate it — the same shape as the exit guarantee.

### Flow

```
member authorises ONCE (their signature, their wallet)
   initSubscriptionAuthority(user, USDC)
   createRecurringDelegation(amountPerPeriod, periodLengthS, expiryTs)
        │
        ▼
ContributionRule PDA  ["contrib_rule", circle, owner]
   kind: Recurring | Percentage | RoundUp
   circle · owner · max_per_period · period_s · expires_at
   paused · last_executed_at · total_contributed
        │
        ▼
execute_auto_contribution(rule)        [permissionless keeper]
   requires !paused
   requires now >= last_executed_at + period_s
   requires now <  expires_at
   requires amount <= rule.max_per_period
   requires epoch.state == Open
   requires nav + pending + amount <= mandate.max_pool_size_usdc
   destination = DERIVED  ["epoch_escrow", circle, epoch_index]
        │
        ▼
Epoch escrow → finalize → reserved shares → settle → Mandate execution
```

**The destination is derived, never passed in.** It is the same escrow PDA the manual `contribute` path uses, so an automatic contribution is structurally incapable of doing anything a manual contribution cannot.

Never `round-up → buy NVDA`. Always `round-up → contribute USDC → Epoch → Mandate decides`.

### Why each prohibition holds

| must not | why it cannot |
|---|---|
| buy assets directly | the only transfer destination is the derived escrow PDA; no swap accounts appear in the instruction |
| bypass Epoch escrow | there is no other destination |
| bypass Mandate rules | contributions enter the identical `Epoch → finalize → Mandate` path |
| exceed the Circle pool cap | `max_pool_size_usdc` checked before the transfer |
| change investment rules | the instruction cannot write to `Mandate` |
| withdraw arbitrary wallet funds | bounded by `amountPerPeriod` inside the audited delegation program; Tenet never holds a raw wallet delegation |
| survive revocation | revocation is a direct call to the Solana program; no Tenet code path participates |

### Rule types, honestly scoped

- **Recurring** — direct fit to `createRecurringDelegation`. Build first.
- **Percentage of eligible incoming USDC** — the delegation caps *how much per period*; "5% of incoming" needs off-chain detection. The indexer observes, the keeper submits, the on-chain rule still bounds the amount.
- **Round-up** — same shape, requires observing settled payments. Highest UX value, most indexer work, lowest priority.

**Honest limitation for the latter two:** *detection* is best-effort; the *authorization* is not. The UI must say so rather than implying guaranteed capture (RULE 1).

### Open questions — blocking implementation

1. Can `transferRecurring` be **CPI'd** by another program, or must the delegatee sign directly? If CPI is unsupported, the keeper submits the transfer and Tenet verifies the escrow balance delta afterwards — the same verify-effects-not-intent pattern as execution.
2. May the delegatee be a **PDA** (required for permissionless keepers)?
3. Rent and account-count cost per rule.
4. Keeper liveness, and who pays fees.

No automation code is written until 1–2 are observed directly.

---

## 14. Decisions recorded here

| # | decision | rationale | status |
|---|---|---|---|
| A-01 | Mint appears in `MandateAsset` / `CircleAsset` seeds | makes duplicates and cross-Circle substitution structurally impossible | fixed |
| A-02 | Shares `u64`, 6 dp, 1 share = 1 micro-USDC at inception | exact, no division at Epoch 0 | fixed |
| A-03 | ~~`RATE_SCALE = 1e18`~~ — **superseded by A-17** | overflowed `u128` at low NAV | withdrawn |
| A-04 | `close_epoch` releases the share rounding residue | prevents permanent dust dilution | fixed |
| A-05 | NAV accumulated across transactions via `NavSnapshot` | decouples asset count from tx size | fixed |
| A-06 | `MAX_CIRCLE_ASSETS = 8` | product/operational, not tx-size driven | fixed |
| A-07 | Redemption = burn-then-reserve-then-claim, execution gated on reservations | proof in §8; one asset failing cannot trap others | **needs Codex review** |
| A-08 | Execution via sandwich + introspection (Option B) | tx-size immune; verifies real effects | **contingent on V-008** |
| A-09 | Supply consumption computed in raw units only | V-003 — multiplier cancels, cannot corrupt the ratio | fixed |
| A-10 | PreStocks attestation may only narrow, never widen or authorise | bounds a malicious attestor to a bad trade, not theft | **contingent on Phase 0** |
| A-11 | Upgrade authority must be burned or disclosed before any production claim | R-14 | open |
| A-12 | Execution uses `onlyDirectRoutes=true`; assert account count pre-submission | V-020: `maxAccounts` is not a cap; 64-account tx limit | fixed |
| A-13 | All JSON parsed with exact source-text preservation; `res.json()` banned | V-018: silent u64 corruption above 2^53 | fixed |
| A-14 | `Circle.reserved_shares` as derived aggregate for single-read INV-001 | spec update B-4 | fixed |
| A-15 | Automation built on the audited Subscriptions & Allowances program, never a raw `approve` | V-025 | **architecture only, Phase 9** |
| A-16 | `refresh_asset_metadata` is permissionless; classification stays authority-gated | live mint state is observable fact | fixed |
| A-17 | `Epoch` stores `total_shares_before` + `nav_before`; no fixed-point rate | `accounting.md` §4.1 — rate form overflows `u128` at low NAV | fixed |
| A-18 | `Config` PDA `["config"]` holds `registry_authority` + `usdc_mint`; created only by the program's **upgrade authority** | the spec used `config.*` in two instructions but never defined it; ungated init lets anyone race the deployer and appoint themselves registry authority | fixed |
| A-19 | Epoch with no shares outstanding finalizes with **no NAV snapshot** (shares = micro-USDC, exact); with shares outstanding, `open_epoch` admits a bounded Pyth snapshot path and `cancel_epoch` recovers safely if pricing never opens or expires | the spec's `finalize_epoch` required a snapshot that needs Pyth, contradicting "Epoch 0 ships without an oracle". The explicit recovery path prevents a closed rolling epoch from stranding escrowed contributions | fixed |
| A-20 | `settle_contribution` takes `circle` **writable**; guarantee restated as "never writes `total_shares`", proven by test | the spec called `circle` read-only as "the structural guarantee" while its own effects write `circle.reserved_shares`, which INV-001 requires | fixed |
| A-21 | An epoch with no contributions finalizes to zero shares and completes | the spec failed finalization here, leaving the epoch `Closed` forever and the Circle unable to open another (`open_epoch` requires the previous epoch complete) | fixed |
| A-22 | **Exits are serialized**: `initiate_redemption` and `finalize_epoch` both require `circle.pending_reservations == 0` | REVIEW.md H-02 — with two exits unreserved at once, whoever reserves first takes value from the other (demonstrated: 428.6M vs 171.4M for equal 30% holders); an unreserved exit across a finalize takes a slice of newcomers' USDC. Reservation is permissionless and cannot be blocked, so serialization cannot trap anyone | fixed in model; on-chain in Phase 3 |
