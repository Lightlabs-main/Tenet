# Tenet — Integration Verification Plan

**Artifact C of the six pre-implementation artifacts.**

What must be checked, how, and what each check unblocks. Results land in `docs/verification.md` as `V-xxx` entries. Nothing here is optional: an instruction whose safety depends on an unverified item does not get written (RULE 2).

Nine items are already verified — see V-001 … V-009. This plan covers the remainder and defines the repeatable harness.

---

## 1. The harness

```
scripts/verify-integrations.ts     orchestrator; writes docs/verification.md entries
scripts/inspect-mint.ts            one mint -> token program, decimals, raw supply, every extension
scripts/inspect-pyth.ts            one feed -> price, expo, confidence, publish_time, staleness
scripts/inspect-prestocks.ts       issuer API -> universe, marks, corporate actions
scripts/inspect-jupiter.ts         quotes at realistic Circle sizes; route + impact + maxAccounts
scripts/smoke-mainnet.ts           guarded write path (see §9)
```

Wired as:

```bash
pnpm verify
```

Rules for the harness:

- **Read-only by default.** No mainnet write without `ALLOW_MAINNET_WRITES=true` *and* an explicitly supplied funded signer.
- **No fallbacks.** A source that fails is recorded as failed. It never substitutes a plausible number (RULE 1).
- Every result carries `timestamp`, `network`, `source`, `request`, `slot`, `conclusion`.
- Secrets are redacted before anything is written to `docs/`.
- Exit non-zero if any **blocking** item regresses. `pnpm verify` runs in CI and before every deployment.

---

## 2. USDC — V-014 *(blocks all contribution accounting)*

| check | method | why it matters |
|---|---|---|
| mint address for the target cluster | config + on-chain read | wrong mint = worthless "USDC" |
| owning token program | `getAccountInfo.owner` | do not assume classic SPL Token |
| `decimals` | mint read | share precision assumes 6 (A-02) — **if it is not 6, `docs/accounting.md` changes** |
| extensions present | mint read | a transfer fee on USDC would alter escrow accounting |
| freeze authority | mint read | disclose if set |

Gate: `create_circle` and `contribute` may not be written until this is `VERIFIED`. The Jupiter quote in V-005 used `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v` and routed successfully, which is suggestive but **not** a substitute for reading the mint.

---

## 3. Token-2022 — partially verified (V-002, V-003, V-004)

Per mint in the candidate universe:

| check | status |
|---|---|
| owning token program | VERIFIED for 2 of 8 PreStocks mints — extend to all 8 |
| `decimals`, raw `supply` | VERIFIED for 2 of 8 |
| `TransferFeeConfig`, incl. **epoch-correct** fee selection | VERIFIED (V-004) — must become a tested library function |
| `ScaledUiAmount`, incl. **effective-multiplier** selection | VERIFIED (V-003) — the single highest-value finding so far |
| `PermanentDelegate` | VERIFIED present — must surface in UI |
| `TransferHook` (`programId` may become non-null) | VERIFIED null today; must be re-checked at execution time |
| `PausableConfig` | VERIFIED present, `paused: false` |
| `DefaultAccountState` | VERIFIED `initialized` |
| `ConfidentialTransfer*` | present; confirm it does not obstruct `transfer_checked` |
| behaviour of `transfer_checked` with fee + hook | **UNVERIFIED — must be exercised on a real transfer** |

Two library functions must exist, be unit-tested against the real observed data, and be the *only* way the codebase reads these:

```ts
effectiveMultiplier(mint, nowUnixSeconds): Decimal
  // newMultiplier when newMultiplierEffectiveTimestamp <= now, else multiplier

activeTransferFee(mint, currentEpoch): { basisPoints: bigint; maximumFee: bigint }
  // compares currentEpoch against older/newer epochs; never picks "newer" blindly
```

Both are exactly the places where V-003 and V-004 show a naive implementation is wrong. Property tests must cover the boundary instant in both directions.

---

## 4. PreStocks — V-001 verified; four items open

| item | id | method | gate |
|---|---|---|---|
| discover the live universe at runtime | done | `GET /api/prestocks` | registry seeding |
| per-mint on-chain inspection for all 8 | — | `inspect-mint.ts` | execution + valuation |
| **minimum viable trade size** per asset | V-011 | quote ladder $10/$50/$100/$500/$1k/$5k; find where impact exceeds policy | execution sizing |
| **corporate-action state** from an official source | V-012 | issuer docs/API; never this prompt's examples | corporate-action surface |
| **eligibility / jurisdictional rules** | V-013 | current official PreStocks rules | acquisition gating (spec §6) |
| API stability: auth, rate limits, cadence | — | repeated polling | indexer design |

Language gate: no surface may say "own OpenAI" or "own SpaceX". The permitted forms are "OpenAI economic exposure", "SpaceX economic exposure", "PreStocks exposure" (spec §6, §63). A lint rule enforces the banned-phrase list in `apps/web` and `packages/ui`.

Do **not** hardcode the eight assets found in V-001. The universe is discovered; V-001 is evidence that discovery works.

---

## 5. Public tokenized equities — V-010 *(blocks Phase 4)*

| check | method |
|---|---|
| enumerate the live, routable universe | issuer/venue listing + Jupiter routability probe — **never a hardcoded list** (spec §48) |
| mint, token program, decimals, extensions per asset | `inspect-mint.ts` |
| Jupiter route exists at Circle-realistic size | `inspect-jupiter.ts` |
| Pyth feed for the **tokenized** instrument | `inspect-pyth.ts` |
| Pyth feed for the **underlying** equity, where one exists | `inspect-pyth.ts` |
| market-session context (is the underlying market open?) | feed metadata |

The divergence surface (spec §16) requires **both** feeds. Where the underlying feed does not exist, divergence is not displayed — it is not approximated. Missing paired feeds are never invented.

---

## 6. Pyth — V-007 *(blocks every price-dependent instruction)*

The 2026-08-26 upgrade means tutorials predating it are untrustworthy. Required before any Pyth code:

1. **Receiver program address** post-upgrade, observed on-chain.
2. **Account layout** — fetch a real price account and deserialise it. Confirm `PriceUpdateV2` still applies rather than trusting the docs' claim that the interface is preserved.
3. **Feed IDs** for each tokenized and underlying asset, from the official feed listing.
4. **SDK compatibility** — does `pyth-solana-receiver-sdk` build against our chosen Anchor version? The SDK claims `0.28 / 0.29 / 0.30.1 / 0.31.1` and does **not** claim Anchor 1.2.0. This is dependency decision D-04.
5. **Hermes API key** — obtain one; confirm the `Authorization: Bearer` flow against `pyth.dourolabs.app/hermes`; measure rate limits.
6. **Freshness and confidence policy**, read from every update and enforced:

```
price, exponent, confidence, publish_time      all read, none assumed
max_age_seconds                                explicit, per asset class
confidence / |price| <= MAX_CONF_RATIO_BPS     explicit policy
```

Failure of any of these blocks `record_asset_nav` and `finalize_epoch` and **must not** block `initiate_redemption` (INV-013, INV-014). `test_exit_without_oracle` proves the separation.

**Availability risk.** A required API key puts a credentialed third party in the valuation path. Tenet must degrade to "Unavailable, new share issuance paused, exit unaffected" — never to a guessed price. Tracked as `R-12`.

---

## 7. Jupiter — V-008 *(blocks every execution instruction)*

1. **Current aggregator program id**, observed on-chain, not copied from a tutorial.
2. **Integration path decision.** Build both spikes and measure:
   - Option A: CPI with our own generated bindings (the official crate is archived).
   - Option B: sandwich + instruction introspection (architecture A-08, recommended).
3. **Transaction size under Token-2022** — the decisive measurement. Compose a realistic USDC → PreStocks route with transfer fee, ALTs, and our `begin`/`end` instructions, and measure serialized bytes against the 1232-byte limit. Repeat with a transfer hook simulated present.
4. **`maxAccounts`** — how far it can be constrained before routes disappear for these specific assets.
5. **Quote realism** — quotes at true Circle sizes, not $1 probes. Record route, input, expected output, executable rate, impact, availability (spec §47).
6. **Indicative vs executable** — already demonstrated in V-005 (~5% gap). Keep measuring; it justifies the whole market-vs-mark surface.
7. **`priceImpactPct` parsing** — returned as a high-precision decimal string. Assert the parser is exact-decimal and never `Number` (RULE 4). A unit test feeds it the exact V-005 string.

**Gate.** `begin_execution` / `end_execution` are not written until item 3 is measured. If Option B exceeds the size limit, we fall back to Option A and re-review; if both fail, that is a `BLOCKER` entry, not a workaround (RULE 8).

---

## 8. Wallet infrastructure

| check | why |
|---|---|
| versioned transaction + ALT support across target wallets | execution and multi-asset claims need both |
| mobile behaviour (deep links, in-app browsers) | the product is mobile-first (spec §42) |
| Token-2022 ATA creation and display | members receive Token-2022 assets on exit |
| clear pre-signature simulation, including transfer-fee effects | spec §22 — show the effect before signing |
| partial-signature / multi-instruction flows | the sandwich pattern (A-08) |

---

## 9. Mainnet write policy

```
default                     READ ONLY
writes require              ALLOW_MAINNET_WRITES=true
                            + an explicitly supplied funded signer
                            + minimum meaningful amounts
never                       commit or print a private key
```

`scripts/smoke-mainnet.ts` refuses to run without both conditions. CI never sets the flag. Every mainnet write is recorded in `docs/verification.md` with its signature.

---

## 10. Blocking matrix

| verification | blocks | phase |
|---|---|---|
| V-014 USDC | `create_circle`, `contribute`, all accounting | 1 |
| Token-2022 library fns | valuation, exit, supply caps | 1 |
| V-007 Pyth | `record_asset_nav`, `finalize_epoch` (rolling), divergence surface | 4 |
| V-008 Jupiter | `begin_execution`, `end_execution` | 4 |
| V-010 public equities | Phase 4 entirely | 4 |
| V-011 min trade size | execution sizing | 5 |
| V-012 corporate actions | corporate-action surface | 5 |
| V-013 eligibility | acquisition gating | 5 |

**Epoch 0, in-kind exit and Fork depend on none of these.** That is deliberate: the product's safety-critical core — pool, exit, fork — is buildable and testable while the oracle and execution integrations are still being verified. It is also why the build order puts exit before execution.
