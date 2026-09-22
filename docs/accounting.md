# Tenet — Accounting

The exact arithmetic behind share issuance, settlement and redemption. Nothing here is left implicit (spec §11).

This document is a **Phase 1 gate**: the account structs and instructions that depend on these formulas are not written until this is settled and reviewed.

**Rule 4 governs every line below.** No floating point appears in any formula. Rust uses `checked_*` on `u128` intermediates; TypeScript uses `bigint`. The `ScaledUiAmount` multiplier appears **nowhere** in this document except §8, which is display only.

---

## 1. Units

| quantity | type | unit | source of truth |
|---|---|---|---|
| USDC amounts | `u64` | micro-USDC (`1e-6`), **raw base units** | token account `amount` |
| asset amounts | `u64` | **raw base units** of that mint | vault `amount` |
| shares | `u64` | `1e-6` share | `Member.shares`, `Circle.total_shares` |
| NAV | `u128` | micro-USDC | computed, never stored authoritatively |
| weights, caps | `u16` | basis points (`1e-4`) | `Mandate` |

**USDC has 6 decimals — confirmed on-chain (V-014).** The share representation below depends on that fact; if it were ever untrue, this document changes.

```
SHARE_DECIMALS        = 6
MAX_CIRCLE_ASSETS     = 8
BPS_DENOMINATOR       = 10_000
```

**At inception, 1 share = 1 micro-USDC contributed.** This is the whole reason Epoch 0 needs no division and no oracle.

---

## 2. What is *not* canonical

Stated plainly because getting this wrong is the most expensive mistake available:

- **Not canonical:** display quantities, `ScaledUiAmount`-scaled amounts, issuer-reported supply, USD prices, anything from an API.
- **Canonical:** the integer `amount` field of a token account, and the integer `supply` field of a mint.

V-017 is the proof this matters: OPENAI's effective multiplier is `1.4861347`. There is no exact integer arithmetic through that number. Ownership accounting that touched the multiplier could not be exact, so ownership accounting does not touch it.

---

## 3. Epoch 0 — initial funding

`Circle.total_shares == 0`. The rolling formula divides by NAV, which is zero here, so Epoch 0 has its own rule:

```
shares_i = amount_usdc_raw_i
```

Exact. No division, no rounding, no oracle, no price. A contributor of `50_000_000` micro-USDC ($50) receives `50_000_000` shares.

```
epoch.total_shares_before = 0
epoch.nav_before          = 0
epoch.reserved_shares     = Σ amount_usdc_raw_i  =  epoch.pending_usdc_raw
```

This is why Epoch 0 ships first: it is the largest single issuance event in a Circle's life and it depends on nothing external.

---

## 4. Rolling issuance

For an active Circle:

```
active_nav_before = active_usdc_vault.amount
                  + Σ realizable_value(circle_asset.vault.amount)     // micro-USDC, u128
```

`EpochEscrow` is **excluded** — it is a different token account, not merely a different field (INV-002). Reserved redemption amounts are excluded too; those tokens are already spoken for.

### 4.1 The rate-based formulation, and why it is rejected

The obvious approach stores a fixed-point rate:

```
share_rate_fixed = floor(total_shares_before × RATE_SCALE ÷ active_nav_before)   // RATE_SCALE = 1e18
shares_i         = floor(amount_i × share_rate_fixed ÷ RATE_SCALE)
```

**This overflows `u128` in a reachable degenerate case.**

Worst-case magnitudes, bounded by observed reality (total USDC supply is `8.02e15` raw — V-014):

```
total_shares_before   ≤ ~1e16
amount_i              ≤ ~1e16
active_nav_before     ≥ 1          (a Circle whose NAV has collapsed to 1 micro-USDC)

share_rate_fixed  =  1e16 × 1e18 ÷ 1        =  1e34
amount_i × rate   =  1e16 × 1e34            =  1e50

u128::MAX                                   ≈  3.4e38
```

`1e50 ≫ 3.4e38`. The multiplication traps (or wraps, if `overflow-checks` were ever off). A Circle that has lost almost all its value is exactly the situation where an attacker *wants* to contribute, so this is not a theoretical corner.

### 4.2 The adopted formulation

Store the two inputs, not a precomputed rate:

```
epoch.total_shares_before : u64      frozen at finalization
epoch.nav_before          : u128     frozen at finalization

reserved_shares = floor(pending_usdc_raw × total_shares_before ÷ nav_before)
shares_i        = floor(amount_i        × total_shares_before ÷ nav_before)
```

Worst case:

```
amount_i × total_shares_before  ≤  1e16 × 1e16  =  1e32
u128::MAX                       ≈  3.4e38
headroom                        ≈  3.4e6 ×
```

Safe with six orders of magnitude to spare, **and exact** — no fixed-point rounding error is introduced before the division. It is also simpler: one division instead of two.

> **Correction to decision A-03.** The original design specified `RATE_SCALE = 1e18` with a stored `share_rate_fixed`. This analysis supersedes it. `RATE_SCALE` is removed from the design; `Epoch` stores `total_shares_before` and `nav_before` instead. Recorded as **A-17**.

### 4.3 Guards

Each is a required failure branch with a named test:

| condition | action | why |
|---|---|---|
| `nav_before == 0 && total_shares_before > 0` | **reject** → `Cancelled` | a Circle with no value cannot price entrants; division by zero |
| `nav_before < MIN_NAV_FOR_ISSUANCE` | **reject** → `Cancelled` | a near-zero NAV makes share price absurd and rounding pathological |
| any asset price stale / low-confidence / missing | **reject** finalization | INV-013 |
| `reserved_shares` would exceed `u64` | **reject** | checked downcast |
| `total_shares + reserved_shares` overflows `u64` | **reject** | checked add |

**None of these block exit** (INV-014). A `Cancelled` epoch refunds every contributor via `cancel_contribution`, with no admin approval.

---

## 5. Settlement, and why late claims cannot dilute

At finalization:

```
circle.total_shares    += reserved_shares
circle.reserved_shares += reserved_shares
epoch.reserved_shares   = reserved_shares
```

Settlement is per-receipt and permissionless:

```
shares_i = floor(amount_i × epoch.total_shares_before ÷ epoch.nav_before)

member.shares          += shares_i
epoch.settled_shares   += shares_i
circle.reserved_shares -= shares_i
epoch.settled_count    += 1
```

`settle_contribution` takes `circle` as a **read-only** account for `total_shares`. It cannot increment it. This is enforced by the runtime, not by our discipline.

### 5.1 Proof that settlements never exceed the reservation

Let `S = total_shares_before`, `N = nav_before`, and contributions `a₁ … aₙ` with `A = Σaᵢ = pending_usdc_raw`.

```
Σ shares_i  =  Σ floor(aᵢ·S / N)
            ≤  floor( Σ (aᵢ·S / N) )        since Σfloor(x) ≤ floor(Σx)
            =  floor(A·S / N)
            =  reserved_shares
```

So `settled_shares ≤ reserved_shares` always. A contributor settling three epochs late receives exactly what the frozen `(S, N)` entitled them to, and later epochs are unaffected because their shares were already counted in `total_shares` at finalization.

Both inputs are frozen on the `Epoch` account, so the result is **reproducible forever** and independent of settlement order.

### 5.2 Residue release

The inequality above is usually strict — the floors lose a little. Once `settled_count == receipt_count`:

```
residue = epoch.reserved_shares - epoch.settled_shares
circle.total_shares    -= residue
circle.reserved_shares -= residue
```

Without this, dust shares sit permanently in the denominator and dilute everyone by a tiny, ever-growing amount. `close_epoch` is permissionless.

---

## 6. Redemption

No price. No oracle. No approval. Integer arithmetic on vault balances only (RULE 6).

At `initiate_redemption`, with `s` shares redeemed and `S = circle.total_shares` **before** the burn:

```
redemption.shares_redeemed      = s
redemption.total_shares_at_snap = S
member.shares        -= s
circle.total_shares  -= s
```

Then per asset, permissionless:

```
available = circle_asset.vault.amount - circle_asset.reserved_for_redemption_raw
entitled  = floor(available × s ÷ S)                    // u128 intermediate
circle_asset.reserved_for_redemption_raw += entitled
```

**Why `available` subtracts existing reservations.** With two concurrent redeemers, using `vault.amount` directly would compute the second entitlement against a balance that still contains the first redeemer's reserved-but-unclaimed tokens — the Circle would promise more than it holds. This is the refinement noted in the spec update's B-6.

Overflow: `available × s ≤ u64::MAX × u64::MAX ≈ 3.4e38`, which is at the very edge of `u128`. In practice both are bounded far below `u64::MAX`, but the multiplication is `checked_mul` on `u128` regardless, and a `u64` supply times a `u64` share count cannot exceed `u128::MAX` — `(2⁶⁴−1)² < 2¹²⁸`. Safe by construction.

### 6.1 Proof: remaining members are never diluted

Vault `V`, total shares `S`, exiting `s`, entitlement `e = floor(V·s/S)`.

```
per-share backing after  =  (V − e) / (S − s)
                         ≥  (V − V·s/S) / (S − s)          since e ≤ V·s/S
                         =  (V/S)·(S − s) / (S − s)
                         =  V / S
                         =  per-share backing before
```

Non-decreasing, with equality only when `V·s/S` is an exact integer. Remaining members cannot lose (INV-004); the exiting member cannot gain, because of the floor (INV-005).

For a second concurrent redemption, apply the same argument with `V' = V − e₁`, `S' = S − s₁`. Since `V'/S' ≥ V/S`, the second redeemer is no worse off. **Parallel redemptions are therefore safe in any order** — `test_parallel_redemptions` asserts this over every permutation.

---

## 7. Rounding

**Every division floors toward the Circle.** There is no path where a rounding remainder is paid to the actor who triggered it.

| operation | direction | who absorbs the remainder |
|---|---|---|
| share issuance | floor | Circle |
| share settlement | floor | Circle (released as residue at `close_epoch`) |
| redemption entitlement | floor | Circle |
| supply consumption check | floor | conservative — understates, so the cap binds earlier |
| transfer-fee estimate shown to the user | **ceil** | the user sees the worst case, never a pleasant surprise |

The fee estimate is the single deliberate exception, and it rounds *against* the actor too: showing a larger expected cost is the conservative direction.

`test_rounding_always_favours_the_circle` fuzzes adversarial amounts and asserts NAV-per-share is non-decreasing across any contribute/exit sequence at fixed prices.

---

## 8. The Token-2022 conversion boundary — display only

Everything above is raw units. This section is the **only** place decimals and `ScaledUiAmount` appear, and nothing here feeds back into ownership.

```
raw base units ──┬──► ownership · redemption · supply          (§3–§7, exact integers)
                 │
                 └──► ÷ 10^decimals × effective_multiplier
                              ↓
                      economic quantity
                              ↓
                      × price → display value
```

### 8.1 Effective multiplier

```
effective = newMultiplier   when  newMultiplierEffectiveTimestamp <= now
          = multiplier      otherwise
```

Reading `multiplier` alone is **wrong**. Verified live (V-003, V-017):

| asset | `multiplier` field | `newMultiplier` | effective ts | **effective** |
|---|---|---|---|---|
| SPACEX | `1` | `5` | 2026-06-10 (past) | **5** |
| OPENAI | `1` | `1.4861347` | past | **1.4861347** |
| other 6 | `1` | `1` | — | `1` |

**2 of 8 assets carry the trap.** A naive read values a SPACEX position at one fifth of its true size.

Worked example, SPACEX (decimals 9, effective multiplier 5):

```
vault.amount            = 163_767_636          raw  ← canonical, used for ownership
÷ 10^9                  = 0.163767636
× 5                     = 0.818838180          display units
× issuer mark $153.8874 = $126.01               reference value   ← display only
```

The `0.818838180` and the `$126.01` never enter §3–§7.

### 8.2 Active transfer fee

```
fee = newerTransferFee  when  current_epoch >= newerTransferFee.epoch
    = olderTransferFee  otherwise
```

Picking `newerTransferFee` unconditionally is wrong whenever a change is scheduled for a **future** epoch. Verified live (V-004): current epoch `1039` equals `newerTransferFee.epoch`, so the active fee is `100 bps` with `maximumFee = u64::MAX` (**uncapped**), raised from `50 bps` at epoch 1032.

```
fee_amount = min( ceil(amount_raw × fee_bps ÷ 10_000), maximum_fee )
received   = amount_raw − fee_amount
```

The exiting member bears this (INV-015). It is **never** reimbursed from Circle USDC. Showing it before signing is required (spec §22).

---

## 9. Invariants

| id | statement |
|---|---|
| INV-001 | `Σ member.shares + circle.reserved_shares == circle.total_shares` |
| INV-002 | `EpochEscrow` balance is never reachable by `claim_redemption_*` |
| INV-003 | an unsettled `ContributionReceipt` confers no claim on any Circle vault |
| INV-004 | no member receives more than `floor(available × s ÷ S)` of any asset |
| INV-005 | no rounding remainder is ever paid to the actor who triggered the operation |
| INV-019 | a change to any mint's `ScaledUiAmount` multiplier leaves every `member.shares` and every entitlement **bit-identical** |

INV-001 is asserted after **every** step of the fuzz harness, and the property test independently recomputes `Σ over open epochs (reserved − settled)` to confirm `circle.reserved_shares` has not drifted.

---

## 10. Worked example

Circle with two members, Epoch 0, then a rolling epoch.

```
EPOCH 0
  Alice contributes  30_000_000 µUSDC ($30)   → 30_000_000 shares
  Bob   contributes  20_000_000 µUSDC ($20)   → 20_000_000 shares
  total_shares = 50_000_000     nav = 50_000_000 µUSDC     $1.00 / share (×1e-6)

EXECUTION
  Circle buys assets. Suppose they appreciate: nav = 60_000_000 µUSDC
  per-share backing = 60_000_000 / 50_000_000 = 1.2 µUSDC

EPOCH 1  (rolling)
  Carol contributes 12_000_000 µUSDC ($12)
  total_shares_before = 50_000_000
  nav_before          = 60_000_000
  reserved = floor(12_000_000 × 50_000_000 ÷ 60_000_000) = 10_000_000 shares
  total_shares = 60_000_000 ; reserved_shares = 10_000_000

  Carol settles:  floor(12_000_000 × 50_000_000 ÷ 60_000_000) = 10_000_000
  reserved_shares → 0 ; residue 0 (exact here)

  Check: Carol paid $12 for 10_000_000 shares at 1.2 µUSDC backing = $12.00. No dilution:
  Alice still holds 30_000_000 / 60_000_000 = 50% of a now-$72 Circle = $36 ≥ her $36 before.

EXIT
  Bob exits all 20_000_000 shares. S = 60_000_000, s = 20_000_000.
  For a vault holding 7_000_000_003 raw of some asset:
     entitled = floor(7_000_000_003 × 20_000_000 ÷ 60_000_000) = 2_333_333_334
     dust     = 7_000_000_003 − 3×2_333_333_334 = 1 raw unit, stays with the Circle
  Bob pays the 100 bps transfer fee on receipt (V-004); remaining members pay nothing.
```

---

## 11. Open items

| item | status |
|---|---|
| `MIN_NAV_FOR_ISSUANCE` value | **undecided** — must be set before rolling issuance is enabled |
| `realizable_value()` per asset class | depends on V-007 (Pyth) and the PreStocks market/mark split |
| Codex review of §5.1 and §6.1 proofs | **required before Phase 3 completes** (spec §32) |
| A-17 (removal of `RATE_SCALE`) | applied here; propagate to `docs/architecture.md` §4 |
