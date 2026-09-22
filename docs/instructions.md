# Tenet — Account & Instruction Table

**Artifact B of the six pre-implementation artifacts.**

**Implementation status (2026-09-22):** the current source implements the
configuration, registry, Mandate/Circle setup, Epoch 0 pool flow, staged
redemption subset, the Fork path, live metadata refresh and amendment
governance. Execution remains deliberately fail-closed until target pricing
and route verification are complete. Automatic contributions remain gated on a
real revocable Solana authorization path. The IDL/SDK is regenerated from the
current Anchor artifact.

Every instruction in the planned program surface, with its signers, account mutability, PDA constraints, failure branches and state transitions. Each failure branch listed here becomes a named test (RULE 7).

Conventions:

- `S` signer · `W` writable · `R` read-only · `I` init · `C` close
- **Every** token account in a custody path is checked for: PDA derivation, `owner == expected token program`, `mint == expected mint`, `authority == VaultAuthority PDA`, and relation to the Circle *and* the Mandate. Rather than repeat that in all 22 tables, it is stated once here and is non-negotiable.
- `token_program` is always passed explicitly and validated against `mint.owner`. It is never assumed (V-002).

---

## 0. Universal constraints

Applied to every instruction that touches value:

| check | why |
|---|---|
| all PDAs re-derived from canonical seeds, `bump` from account | prevents address substitution (INV-018) |
| `circle.mandate == mandate.key()` | prevents cross-Mandate splicing |
| `circle_asset.circle == circle.key()` | prevents cross-Circle vault use (INV-018) |
| `circle_asset.mint == mint.key()` and `vault.mint == mint.key()` | prevents wrong-mint accounting |
| `mint.to_account_info().owner == token_program.key()` | prevents fake/ wrong token program |
| `vault.owner == vault_authority` | prevents vault substitution |
| every arithmetic op `checked_*`, `u128` intermediates | RULE 4 |
| no `Vec` iteration over unbounded collections | compute safety |

Failure of any → `ConstraintViolation`, transaction reverts.

Tests: `test_account_substitution_rejected` (umbrella), covering `test_wrong_vault_rejected`, `test_wrong_circle_rejected`, `test_wrong_mint_rejected`, `test_wrong_token_program_rejected`.

---

## 0b. Config *(decision A-18)*

### `initialize_config`

Creates the program-wide `Config`. The spec referenced `config.registry_authority` and `config.usdc_mint` without defining the account.

| account | mode | constraint |
|---|---|---|
| `upgrade_authority` | S,W | `== program_data.upgrade_authority_address` |
| `config` | W,I | PDA `["config"]` |
| `program` | R | this program; `programdata_address == program_data` |
| `program_data` | R | the program's ProgramData account |
| `usdc_mint` | R | classic SPL Token, `decimals == 6` (V-014) |
| `system_program` | R | |

Args: `registry_authority`.

**Why gated on the upgrade authority.** Whoever initializes `Config` chooses the registry authority, whose classifications drive the pre-IPO, issuer and underlying caps (R-13). Ungated, anyone watching the deploy could initialize first. **Consequence:** a program made immutable can never initialize `Config`, so initialization must precede revoking the upgrade authority (R-14).

**Failures:** not the upgrade authority (`NotUpgradeAuthority`, including when none exists) · ProgramData belongs to another program · USDC mint wrong decimals or wrong token program (`UnexpectedUsdcMint`) · already initialized.

Tests: `test_initialize_config_by_upgrade_authority`, `test_initialize_config_rejects_anyone_else`, `test_initialize_config_impossible_once_program_is_immutable`, `test_initialize_config_rejects_wrong_usdc`, `test_initialize_config_only_once`.

**Open:** no `set_registry_authority` rotation yet. Losing the registry authority key freezes classification (never custody). Needed before mainnet.

---

## 1. Registry

### `upsert_registry_entry`

Classifies a mint. Metadata only — this authority has **no custody power** (spec §25).

| account | mode | constraint |
|---|---|---|
| `registry_authority` | S | `== config.registry_authority` |
| `registry_entry` | W,I | PDA `["registry", mint]` |
| `mint` | R | must exist; `owner` recorded as `token_program` |
| `system_program` | R | |

Writes: `asset_class`, `issuer`, `public_or_pre_ipo`, `symbol`, `display_name`, `pyth_feed_tokenized`, `pyth_feed_underlying`, `prestocks_identifier`, `status`, `token_program`, `decimals`.

**Failures:** wrong authority · mint does not exist · `asset_class` inconsistent with observed mint owner · attempt to set a custody field (none exist).

**Trust note.** Mandate enforcement of pre-IPO and issuer caps depends on this classification, and it cannot come from arbitrary user input. This is a **disclosed trust assumption** (`R-13`), documented in the README and shown on the Mandate page.

### `refresh_asset_metadata`

Re-reads **live, observable** mint state and writes it to the registry entry. **Permissionless** — anyone may refresh any asset.

| account | mode | constraint |
|---|---|---|
| `payer` | S,W | permissionless |
| `registry_entry` | W | PDA `["registry", mint]` |
| `mint` | R | `owner == registry_entry.token_program` |
| `clock` | R | for the effective-multiplier comparison |

Writes: `raw_supply`, `effective_multiplier`, `active_transfer_fee_bps`, `active_transfer_fee_max`, `issuer_controls` bitflags (permanent delegate / freeze / paused / hook installed), `last_verified_slot`, `last_verified_ts`.

**Why this is a separate instruction from `upsert_registry_entry`, and why it is permissionless.** Classification (*is this pre-IPO? whose issuer?*) is a judgement that needs a trusted authority. Live mint state is **observable fact** — it can be read from the mint account by anyone, and nobody can lie about it because the instruction reads the mint directly rather than accepting caller-supplied values. Splitting them means the trusted authority is needed only for the judgement, never for freshness. It also means a stale multiplier or fee can be corrected by any member without waiting on an operator.

**Failures:** mint/token-program mismatch · registry entry does not exist.

**This instruction is the on-chain half of V-003/V-004.** It must select the effective multiplier by comparing `newMultiplierEffectiveTimestamp` against the clock, and the active fee by comparing the current epoch against both fee epochs. Reading `multiplier` or `newerTransferFee` unconditionally is the exact bug those entries document.

Tests: `test_refresh_reads_effective_multiplier`, `test_refresh_reads_epoch_correct_fee`, `test_refresh_is_permissionless`, `test_refresh_cannot_alter_classification`.

---

## 2. Mandate

### `create_mandate`

| account | mode | constraint |
|---|---|---|
| `author` | S,W | pays rent |
| `mandate_seed` | R | arbitrary pubkey, seeds the PDA |
| `mandate` | W,I | PDA `["mandate", mandate_seed]` |
| `system_program` | R | |

State: *(none)* → `Draft`.

**Failures (all validated here, spec §26):** empty name · name/description over length · `max_weight_per_asset_bps > 10_000` · `max_pre_ipo_weight_bps > 10_000` · `max_issuer_weight_bps > 10_000` · `max_supply_consumption_bps > 10_000` · `max_price_impact_bps > 10_000` · `min_contribution_usdc == 0` · `max_pool_size_usdc <= min_contribution_usdc` · `epoch_duration` outside `[MIN_EPOCH, MAX_EPOCH]` · `amendment_threshold_bps` outside `(5_000, 10_000]` · `amendment_delay_seconds < MIN_AMENDMENT_DELAY`.

Tests: `test_create_valid_mandate`, `test_reject_invalid_caps`, `test_zero_boundaries`, `test_max_boundaries`.

### `add_mandate_asset`

| account | mode | constraint |
|---|---|---|
| `author` | S,W | `== mandate.author` |
| `mandate` | W | `state == Draft` |
| `mandate_asset` | W,I | PDA `["mandate_asset", mandate, mint]` |
| `registry_entry` | R | PDA `["registry", mint]`; `status == Active` |
| `mint` | R | |
| `system_program` | R | |

Effects: `mandate.asset_count += 1`.

**Failures:** not author · mandate not `Draft` · duplicate mint (**account already initialized — structurally impossible to bypass**) · `asset_count == MAX_CIRCLE_ASSETS (8)` · `target_weight_bps > mandate.max_weight_per_asset_bps` · registry entry missing or inactive.

Test: `test_reject_duplicate_asset`.

### `finalize_mandate`

| account | mode | constraint |
|---|---|---|
| `author` | S | `== mandate.author` |
| `mandate` | W | `state == Draft` |

State: `Draft` → `Active`. After this the Mandate is immutable except via amendment.

| *remaining* | R | `[mandate_asset_i, registry_entry_i]` for **every** asset, any order |

**Why remaining accounts.** The caps need each asset's classification (pre-IPO? which issuer? which underlying company?), which lives in its registry entry, and no fixed account may hold an unbounded `Vec`. At most `MAX_CIRCLE_ASSETS` = 8 pairs, so 16 accounts.

**Completeness is the security property.** If the author could omit an asset, it would escape every cap. So: exactly `2 × asset_count` accounts; each `MandateAsset` owned by this program with `.mandate == mandate`; each index `0..asset_count` seen exactly once (bitmap); each registry entry must be the one that asset recorded — otherwise a pre-IPO asset could be passed with a public asset's entry to dodge the pre-IPO cap.

**Failures:** `asset_count == 0` (empty universe) · `Σ target_weight_bps > 10_000` · pre-IPO targets sum `> max_pre_ipo_weight_bps` · any issuer's targets sum `> max_issuer_weight_bps` · any **underlying company's** targets sum `> max_underlying_weight_bps` (R-23; same company via two issuers is one concentration) · missing or repeated asset (`IncompleteMandateAssets`) · asset from another Mandate or mismatched registry entry (`AccountSubstitution`).

Tests: `test_reject_invalid_weights`, `test_same_company_through_two_issuers_is_one_concentration`, `test_finalize_rejects_an_incomplete_asset_set`, `test_finalize_rejects_substituted_accounts`, `test_finalize_mandate_activates_and_freezes_it`.

### `fork_mandate`

| account | mode | constraint |
|---|---|---|
| `forker` | S,W | any wallet |
| `parent_mandate` | **R** | **never writable — enforces INV-017** |
| `new_mandate_seed` | R | |
| `new_mandate` | W,I | PDA `["mandate", new_mandate_seed]`; `forked_from = Some(parent)` |
| `system_program` | R | |

**No parent token account, no parent Circle, no parent Member appears in this instruction at all** — which is what makes INV-016 structural rather than a check.

The current implementation creates the child as `Draft` and copies the
dedicated `MandateAsset` PDAs through one `fork_mandate_asset` instruction per
asset. Each copy is bound to the parent asset's mint, registry entry and index;
the child must then pass the existing `finalize_mandate` completeness and cap
checks. A Circle is created separately with `create_circle`, so the fork path
never transfers parent capital or creates an implicit custody relationship.

**Failures:** parent not `Active` · any Mandate validation fails on the modified rules (re-validated in full, never inherited blindly).

Tests: `test_fork_copies_rules`, `test_fork_does_not_move_parent_assets`, `test_child_mandate_cannot_modify_parent`.

---

## 3. Circle

### `create_circle`

| account | mode | constraint |
|---|---|---|
| `creator` | S,W | any wallet |
| `mandate` | R | `state == Active` |
| `circle` | W,I | PDA `["circle", mandate]` |
| `vault_authority` | R | PDA `["vault_authority", circle]` |
| `active_usdc_vault` | W,I | PDA `["usdc_vault", circle]`, authority = `vault_authority` |
| `usdc_mint` | R | `== config.usdc_mint` |
| `token_program` | R | `== usdc_mint.owner` |
| `system_program`, `rent` | R | |

State: *(none)* → `Funding`, `total_shares = 0`, `current_epoch = 0`.

**Failures:** mandate not `Active` · Circle already exists · USDC mint mismatch.

Test: `test_create_circle`.

### `add_circle_asset`

Creates the vault for one Mandate asset.

| account | mode | constraint |
|---|---|---|
| `payer` | S,W | permissionless |
| `circle` | W | |
| `mandate_asset` | R | `.mandate == circle.mandate` |
| `circle_asset` | W,I | PDA `["circle_asset", circle, mint]` |
| `vault` | W,I | PDA `["vault", circle, mint]`, authority = `vault_authority` |
| `vault_authority` | R | |
| `mint` | R | `== mandate_asset.mint` |
| `token_program` | R | `== mint.owner` — **Token-2022 or classic, branch explicitly** |

**Failures:** mandate_asset belongs to another Mandate · mint mismatch · token program mismatch · vault already exists.

---

## 4. Epoch & contributions

### `open_epoch`

| account | mode | constraint |
|---|---|---|
| `payer` | S,W | permissionless |
| `circle` | W | previous epoch `Completed`, or `current_epoch == 0` |
| `epoch` | W,I | PDA `["epoch", circle, index_le]`; `index == circle.current_epoch` |
| `epoch_escrow` | W,I | PDA `["epoch_escrow", circle, index_le]`, authority = `vault_authority` |
| `usdc_mint`, `token_program`, `system_program` | R | |

State: *(none)* → `Open`. `closes_at = now + mandate.epoch_duration`.

**Failures:** previous epoch not `Completed` · index mismatch (prevents skipping/replaying an epoch).

### `contribute`

| account | mode | constraint |
|---|---|---|
| `contributor` | S,W | |
| `circle` | R | `state in { Funding, Active }` |
| `mandate` | R | |
| `epoch` | W | `state == Open`, `now < closes_at` |
| `receipt` | W,I (if needed) | PDA `["receipt", epoch, contributor]` |
| `contributor_usdc` | W | `owner == contributor`, `mint == usdc_mint` |
| `epoch_escrow` | W | **PDA `["epoch_escrow", …]` — never `active_usdc_vault`** |
| `usdc_mint`, `token_program` | R | |

Effects: transfer → escrow; `receipt.amount += amount`; `epoch.pending_usdc_raw += amount`; `receipt_count += 1` on first contribution.

**Failures:** epoch not `Open` · past `closes_at` · `amount < mandate.min_contribution_usdc` · `nav + pending + amount > mandate.max_pool_size_usdc` · membership policy rejects · insufficient balance.

Tests: `test_contribution_enters_epoch_escrow`, `test_pending_usdc_isolated`, `test_pending_member_has_no_active_claim`.

### `cancel_contribution`

| account | mode | constraint |
|---|---|---|
| `contributor` | S,W | `== receipt.owner` |
| `epoch` | W | `state in { Open, Cancelled }` |
| `receipt` | W,C | `!settled`; rent → contributor |
| `epoch_escrow` | W | |
| `contributor_usdc` | W | |
| `vault_authority` | R | signs the transfer |

**No admin approval exists in this path** (spec §10). **Failures:** not owner · already settled · epoch past `Open` and not `Cancelled`.

Test: `test_pending_contribution_cancel`.

### `close_contributions`

`Open` → `Closed`. Permissionless once `now >= epoch.closes_at`. Sole failure: called early.

### `open_nav_snapshot`

| account | mode | constraint |
|---|---|---|
| `payer` | S,W | permissionless |
| `circle` | W | `pending_reservations == 0` |
| `epoch` | W | `state == Closed` |
| `nav_snapshot` | W,I | PDA `["nav_snapshot", epoch]` |

Effects: `slot_opened = clock.slot`, `assets_remaining = circle.asset_count`, `nav_accum = active_usdc_vault.amount`, `recorded_bitmap = 0`. Sets `circle.execution_frozen = true`.

**Failures:** epoch not `Closed` · snapshot already open · an unreserved redemption exists.

### `record_asset_nav`

Prices exactly one asset. Permissionless.

| account | mode | constraint |
|---|---|---|
| `nav_snapshot` | W | not expired: `clock.slot - slot_opened <= NAV_SNAPSHOT_MAX_SLOTS` |
| `circle_asset` | R | `.circle == circle.key()` |
| `vault` | R | balance read here is canonical |
| `mint` | R | for `decimals`, `supply`, effective multiplier |
| `registry_entry` | R | supplies the expected feed id |
| `price_update` | R | `Account<PriceUpdateV2>`; feed id **must equal** `registry_entry.pyth_feed_tokenized` |
| `execution_auth` | R | *(PreStocks only)* attestation, §10 of architecture |

Effects: `nav_accum += realizable_value(vault.amount - circle_asset.reserved_for_redemption_raw)`; set bit `circle_asset.index`; `assets_remaining -= 1`.

The value conversion uses the live vault balance, the mint decimals, the most
recently refreshed effective ScaledUiAmount multiplier, and the verified Pyth
price. Pending epoch escrow and reserved exit claims are excluded from active
NAV.

**Failures:** bit already set (**double-count impossible**) · snapshot expired · `get_price_no_older_than` fails (stale, INV-013) · confidence ratio over policy · feed id mismatch · attestation expired/wrong-Circle · multiplier read fails.

Tests: `test_pyth_staleness`, `test_pyth_confidence_policy`, `test_execution_rejects_stale_price`, `test_scaled_ui_effective_multiplier_selection`.

### `finalize_epoch`

| account | mode | constraint |
|---|---|---|
| `payer` | S,W | permissionless |
| `circle` | W | |
| `epoch` | W | `state == Closed` |
| `nav_snapshot` | W,C | `assets_remaining == 0`, not expired |
| `epoch_escrow` | W | swept |
| `active_usdc_vault` | W | receives sweep |
| `vault_authority` | R | signs |

Effects:

```
active_nav_before = nav_snapshot.nav_accum
epoch.total_shares_before = circle.total_shares        // frozen
epoch.nav_before          = active_nav_before          // frozen

if circle.total_shares == 0:   reserved_shares = pending_usdc_raw                   (Epoch 0, exact)
else:                          reserved_shares = floor(pending_usdc_raw * circle.total_shares / active_nav_before)

circle.total_shares    += reserved_shares
circle.reserved_shares += reserved_shares
sweep epoch_escrow -> active_usdc_vault
```

State: `Closed` → `Finalized`. Clears `execution_frozen`.

**Phase 2 scope (A-19).** With `circle.total_shares == 0` (Epoch 0) there is no NAV snapshot: shares equal `pending_usdc_raw`, exactly. With shares outstanding, a bounded NAV snapshot is required. If its window is never opened or expires, permissionless `cancel_epoch` moves the closed epoch to `Cancelled`; each owner can then recover their isolated escrow through `cancel_contribution`. An epoch with zero contributions finalizes to zero shares (A-21) rather than failing and deadlocking the Circle.

**Failures:** snapshot incomplete or expired · `active_nav_before == 0 && total_shares > 0` (→ `Cancelled`) · `active_nav_before < MIN_NAV_FOR_ISSUANCE` (→ `Cancelled`) · `pending_usdc_raw == 0` and no prior shares · any checked-arithmetic overflow · `reserved_shares` exceeds `u64` · `total_shares + reserved_shares` overflows `u64`.

Tests: `test_epoch_zero_accounting`, `test_rolling_epoch_no_dilution`, `test_overflow_protection`.

### `cancel_epoch`

Permissionless recovery for a closed rolling epoch whose NAV snapshot was not
opened after the grace period or whose snapshot window expired. It clears the
valuation freeze, closes the optional snapshot, and leaves each contributor's
existing owner-only cancellation path available for refund.

### `settle_contribution`

Permissionless — anyone may settle anyone's receipt.

| account | mode | constraint |
|---|---|---|
| `payer` | S,W | any |
| `circle` | R | **read-only: cannot touch `total_shares`** |
| `epoch` | W | `state >= Finalized` |
| `receipt` | W,C | `!settled`; rent → `receipt.owner` |
| `member` | W,I (if needed) | PDA `["member", circle, receipt.owner]` |

Effects: `shares_i = floor(amount * epoch.total_shares_before / epoch.nav_before)`; `member.shares += shares_i`; `epoch.settled_shares += shares_i`; `circle.reserved_shares -= shares_i`; `settled_count += 1`.

Both divisor inputs are **frozen on the Epoch at finalization**, so the result is reproducible forever and independent of settlement order.

**Corrected (A-20).** An earlier version called `circle` read-only as "the structural guarantee" behind spec §12 — but the effects above write `circle.reserved_shares`, which INV-001 requires. `circle` is writable; the guarantee is that settlement **never writes `total_shares`**, asserted by `test_reserved_shares_do_not_dilute` across every settle.

Tests: `test_reserved_shares_do_not_dilute`, `test_late_settlement_no_dilution`.

### `close_epoch`

`Completed` transition; requires `settled_count == receipt_count`. Releases the residue: `circle.total_shares -= (reserved_shares - settled_shares)`. **Failures:** unsettled receipts remain · already closed.

---

## 5. Execution *(fail-closed boundary implemented; price-dependent activation remains gated)*

The program now exposes the `begin_execution` / `end_execution` boundary and
binds it to the Circle's USDC vault, the Mandate-approved destination vault,
the Jupiter instruction window, a nonce-seeded `ExecutionAuth`, and actual raw
vault deltas. `begin_execution` currently rejects after validating those
conditions because verified on-chain price observations are not yet wired into
the price-impact and concentration-cap checks. This is intentional: a route
must not become production-executable merely because the structural boundary
exists.

### `begin_execution`

| account | mode | constraint |
|---|---|---|
| `executor` | S,W | |
| `circle` | W | `!execution_frozen`, `pending_reservations == 0` |
| `mandate` | R | |
| `mandate_asset_out` | R | **proves the output asset is in the universe (INV-008)** |
| `source_vault` | W | `= usdc_vault` or an asset vault |
| `dest_vault` | W | PDA `["vault", circle, out_mint]` — **derived, never caller-supplied (INV-007)** |
| `execution_auth` | W,I | PDA `["exec_auth", circle, epoch, nonce]` — **replay impossible (INV-020)** |
| `instructions_sysvar` | R | introspection |
| `vault_authority` | R | signs the delegate approval |

Current effect: validate the structural authorization window and reject with `ExecutionPricePolicyUnavailable` before creating a spend authorization. The intended enabled-path effects are to record `pre_in` / `pre_out`, approve a delegate for **exactly** `max_in`, and assert via introspection that every instruction between this and `end_execution` targets Jupiter's program id and that `end_execution` is present in the same transaction. That enabled path remains gated until verified on-chain price observations and cap checks are wired.

**Failures:** `out_mint` not in the Mandate · `dest_vault` mis-derived · attestation expired / wrong circle / wrong program / wrong mints · nonce reused · a non-Jupiter instruction in the window · `end_execution` absent · execution frozen · a redemption is unreserved.

Current test: `test_execution_window_is_fail_closed`. The additional enabled-path tests remain release-gated until production execution is activated.

### `end_execution`

| account | mode | constraint |
|---|---|---|
| `executor` | S | `== execution_auth.executor` |
| `circle`, `source_vault`, `dest_vault` | W | same accounts as `begin_execution` |
| `mandate`, `mandate_asset_out`, `registry_entry` | R | exact Circle constitution and registry binding |
| `out_mint` | R | live `supply` and decimals for raw cap/price arithmetic |
| `price_update` | R | Pyth Receiver `PriceUpdateV2`; registry feed, full verification, freshness, and confidence are checked |
| `execution_auth` | W,C | consumed |

Effects — **all checks run against real post-transaction balances, never a quoted figure**:

```
spent  = pre_in  - source_vault.amount      require spent  <= max_in
gained = dest_vault.amount - pre_out        require gained >= min_out
require implied_impact_bps           <= mandate.max_price_impact_bps
require weight(out_mint)             <= mandate.max_weight_per_asset_bps
require issuer_weight(issuer)        <= mandate.max_issuer_weight_bps
require pre_ipo_weight               <= mandate.max_pre_ipo_weight_bps
require dest_vault.amount * 10_000 / out_mint.supply
                                     <= mandate.max_supply_consumption_bps   // raw units only
revoke delegate
```

**Failures:** any cap breached · `gained < min_out` · `spent > max_in` · delegate revoke fails · vault identity changed mid-transaction.

Current tests: `test_execution_window_is_fail_closed`, plus Rust unit coverage for raw supply-cap boundaries and integer-only Pyth output-floor arithmetic. The full enabled-path integration tests remain release-gated until a verified target feed and controlled route are available.

---

## 6. Redemption

### `initiate_redemption`

| account | mode | constraint |
|---|---|---|
| `member_owner` | S,W | `== member.owner` |
| `circle` | W | |
| `member` | W | `shares >= shares_to_redeem > 0` |
| `redemption` | W,I | PDA `["redemption", circle, owner, seq_le]` |

Effects: record `shares_redeemed = s`, `total_shares_at_snap = S`; `member.shares -= s`; `circle.total_shares -= s`; `asset_bitmap_at_snapshot = circle.asset_bitmap`; `assets_remaining = popcount(asset_bitmap) + 1`; `circle.pending_reservations += 1`; `member.next_redemption_seq += 1`.

**Why a bitmap of existing vaults, not a count (implementation finding).** `CircleAsset.index` is the asset's index in the *Mandate*, so the vaults that exist need not be `0..count`. With `index < asset_count`, a Circle holding only asset 1 would reject asset 1 (`1 < 1`); the exit could never complete and every later exit and epoch would block. The snapshot also stops a vault created *after* initiation — permissionless and empty — being reserved in place of a real asset to complete someone else's exit with a real asset never reserved.

**No price account. No oracle. No approval.** (RULE 6.)

**Failures:** insufficient shares · zero shares · a NAV snapshot is open · **another exit has unreserved assets** (`circle.pending_reservations > 0`, A-22 / REVIEW.md H-02 — without this, whichever of two concurrent exits reserves first takes value from the other).

Tests: `test_exit_without_oracle`, `test_exit_mid_epoch`, `test_exit_with_pending_epoch`.

### `reserve_redemption_asset` *(permissionless)*

| account | mode | constraint |
|---|---|---|
| `payer` | S,W | any |
| `redemption` | W | `assets_remaining > 0` |
| `circle_asset` | W | `.circle == redemption.circle` |
| `vault` | R | balance read |
| `redemption_asset` | W,I | PDA `["redemption_asset", redemption, mint]` — **double-reserve impossible** |

Effects: `entitled = floor((vault.amount - reserved) * s / S)` in `u128`; `reserved_for_redemption_raw += entitled`; `assets_remaining -= 1`; on the last one, `circle.pending_reservations -= 1`.

**Failures:** already reserved for this mint · asset belongs to another Circle · asset not in the exit's snapshot bitmap (`AssetNotInSnapshot`) · nothing left to reserve · arithmetic overflow.

### `reserve_redemption_usdc` *(permissionless)*

The USDC leg, split out because USDC has no `CircleAsset`: its obligation is `circle.usdc_reserved_raw`. `entitled = floor((active_usdc_vault.amount − circle.usdc_reserved_raw) × s / S)`. Reads the **active** vault only — never an epoch escrow (INV-002). Same completion accounting as above.

Tests: `test_parallel_redemptions`, `test_rounding_always_favours_the_circle`, `test_exit_after_scaled_multiplier_change`, `test_redemption_entitlement_cannot_be_diluted`.

### `claim_redemption_asset`

| account | mode | constraint |
|---|---|---|
| `member_owner` | S,W | `== redemption.owner` |
| `redemption_asset` | W,C | `!claimed` |
| `vault` | W | |
| `member_token_account` | W | `owner == member_owner`, `mint == mint` |
| `mint`, `token_program` | R | `token_program == mint.owner` |
| `vault_authority` | R | signs |

Uses `transfer_checked` through the correct token program. The member bears the transfer fee (V-004: 100 bps, uncapped) — **no reimbursement from Circle USDC** (INV-015).

**Failures (each isolated to this one asset):** mint paused · account frozen · transfer hook rejects · already claimed. A failure here leaves the claim open and **does not affect any other asset's claim** (spec §65).

A zero entitlement makes **no CPI at all**, so a paused mint cannot block closing out a claim for 0. `claimed` is also enforced structurally: the `RedemptionAsset` is closed on claim, so a second claim finds no account.

Tests: `test_transfer_fee_borne_by_exiting_member`, `test_remaining_members_not_charged_exit_fee`, `test_scaled_ui_not_used_for_ownership`, `test_one_failed_asset_does_not_unnecessarily_lock_other_claims`.

### `claim_redemption_usdc`

Same shape against `active_usdc_vault`. Excludes `epoch_escrow` entirely (INV-002).

---

## 7. Amendments *(Phase 8 — implemented, UI exposure remains gated)*

`propose_amendment` · `vote_amendment` · `execute_amendment`.

Each proposal is a bounded PDA keyed by `(Mandate, proposal_id)` and stores a
complete candidate constitution plus the Circle share total captured at
creation. Each voter has one `AmendmentVote` PDA keyed by `(proposal, voter)`.
The current Mandate's delay controls the proposal's execution window; the
proposed delay only applies after approval. Execution is permissionless after
the delay, but requires the captured share total, no reserved/pending exit
state, no execution freeze, and the current amendment threshold. The Mandate
version increments exactly once on execution. Exit has no dependency on any
amendment account.

Attack surface defended by the implementation:

| attack | implemented defence |
|---|---|
| double voting | `AmendmentVote` PDA `["amendment_vote", proposal, voter]` — second vote cannot init |
| vote then exit or contribute | proposal stores `total_shares_at_proposal`; any Circle share-total change invalidates the proposal rather than changing voting power |
| reserved or pending exit state | proposal and execution reject reserved shares, pending reservations and execution freeze |
| threshold error | `for_shares * 10_000 >= total_shares_at_proposal * amendment_threshold_bps`, `u128`, no float |
| replay | `executed` flag rejects a second execution |
| governance defeating exit | `initiate_redemption` has **no** dependency on proposal state — structurally cannot be blocked |

Program-level coverage: `test_amendment_requires_threshold_and_delay`,
`test_amendment_vote_is_unique_and_uses_settled_shares`, and
`test_amendment_rejects_non_member`.

---

## 8. Instruction inventory

| # | instruction | phase | signer | touches value |
|---|---|---|---|---|
| 1 | `upsert_registry_entry` | 1 | registry authority | no |
| 1b | `refresh_asset_metadata` | 1 | anyone | no |
| 2 | `create_mandate` | 2 | author | no |
| 3 | `add_mandate_asset` | 2 | author | no |
| 4 | `finalize_mandate` | 2 | author | no |
| 5 | `create_circle` | 2 | anyone | no |
| 6 | `add_circle_asset` | 2 | anyone | no |
| 7 | `open_epoch` | 2 | anyone | no |
| 8 | `contribute` | 2 | contributor | **yes** |
| 9 | `cancel_contribution` | 2 | contributor | **yes** |
| 10 | `close_contributions` | 2 | anyone | no |
| 11 | `open_nav_snapshot` | 2 | anyone | no |
| 12 | `record_asset_nav` | 4 | anyone | no |
| 13 | `cancel_epoch` | 2 | anyone | no |
| 14 | `finalize_epoch` | 2 | anyone | **yes** |
| 15 | `settle_contribution` | 2 | anyone | no |
| 16 | `close_epoch` | 2 | anyone | no |
| 17 | `initiate_redemption` | 3 | member | no |
| 18 | `reserve_redemption_asset` | 3 | anyone | no |
| 19 | `claim_redemption_asset` | 3 | member | **yes** |
| 20 | `claim_redemption_usdc` | 3 | member | **yes** |
| 21 | `begin_execution` | 4 | executor | **yes** |
| 22 | `end_execution` | 4 | executor | **yes** |
| 23 | `fork_mandate` | 7 | anyone | no |
| 24 | `propose_amendment` | 8 | member | no |
| 25 | `vote_amendment` | 8 | member | no |
| 26 | `execute_amendment` | 8 | anyone after delay | no |
| 26 | `create_contribution_rule` | 9 | member | no |
| 27 | `pause_contribution_rule` / `resume` | 9 | member | no |
| 28 | `close_contribution_rule` | 9 | member | no |
| 29 | `execute_auto_contribution` | 9 | anyone (keeper) | **yes** |

Nine instructions move value (eight, plus `execute_auto_contribution` once Phase 9 lands). Those eight carry the entire custody risk and get adversarial review before they are considered complete.
