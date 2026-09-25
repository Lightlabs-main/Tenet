# Verification Log

Evidence for every external assumption Tenet's code is allowed to depend on.

Rule 2 applies: **no instruction may be written whose safety depends on an unverified external assumption.** Each entry records what was observed, when, from where, and which code may rely on it.

Entries are append-only. When an observation is superseded, add a new entry — do not rewrite history. Anything not recorded here is **unverified** and must be treated as unknown.

Legend: `VERIFIED` = observed directly by this project. `REPORTED` = stated by a source, not independently observed. `UNVERIFIED` = assumption with no evidence yet.

---

## V-001 — PreStocks issuer API is live and returns the asset universe

```
timestamp   2026-09-20T22:20Z
network     n/a (issuer HTTPS API)
source      https://prestocks.com/api/prestocks
request     GET (no auth)
status      VERIFIED
```

**Observed result.** HTTP 200, JSON, a top-level **array** of 8 objects. Field names exactly as returned:

```
name  symbol  description  image  external_url  contract_address
markPrice  markValuation  tokenPrice  impliedValuation  supply
```

Full universe observed (8 assets, no more):

| symbol | contract_address | tokenPrice | markPrice | supply (as returned) |
|---|---|---|---|---|
| ANDURIL | `PresTj4Yc2bAR197Er7wz4UUKSfqt6FryBEdAriBoQB` | 154.6582 | 154.7999 | 11805.856351985 |
| ANTHROPIC | `Pren1FvFX6J3E4kXhJuCiAD5aDmGEb7qJRncwA8Lkhw` | 1031.9533 | 1036.8867 | 7381.880280847 |
| FIGUREAI | `PreZad18qfPtbxNpMtMuAuX2zVpvkEU8DnJx56faCWd` | 180.9870 | 181.0407 | 3012.910074075 |
| KALSHI | `PreLWGkkeqG1s4HEfFZSy9moCrJ7btsHuUtfcCeoRua` | 881.8944 | 895.6632 | 904.895600780 |
| NEURALINK | `PrekqLJvJ3qVdXmBGDiexvwUTF4rLFDa6HWS4HJbw9S` | 430.5325 | 336.4912 | 2595.332175866 |
| OPENAI | `PreweJYECqtQwBtpxHL171nL2K6umo692gTm7Q3rpgF` | 1103.3115 | 995.9332 | 2826.443863737 |
| POLYMARKET | `Pre8AREmFPtoJFT8mQSXQLh56cwJmM7CFDRuoGBZiUP` | 143.9069 | 143.8492 | 4817.084336996 |
| SPACEX | `PreANxuXjsy2pvisWWMNB6YaJNzr7681wJJr2rHsfTh` | 116.1620 | 153.8874 | 43712.533765345 |

**Conclusions.**

1. The live universe is **8 assets**. Tenet must still discover it at runtime — this table is evidence, not a hardcoded universe.
2. The API returns **no `decimals` and no token program**. Both must be read on-chain.
3. `tokenPrice` and `markPrice` are the issuer's own figures. `tokenPrice` is *indicative*, not an executable quote — see V-005.
4. Live premium/discount is real and large right now (NEURALINK `+27.9%`, SPACEX `-24.5%`), which makes the premium/discount surface a genuine product feature rather than decoration.

**Code permitted to rely on this.** The `packages/integrations` PreStocks client (response *shape* only). The issuer mark may be used as the analytical reference mark (spec §18). It may **not** be used as NAV where an executable market valuation is obtainable.

---

## V-002 — PreStocks mints are Token-2022 with custody-relevant extensions (ANTHROPIC)

```
timestamp   2026-09-20T22:22Z
network     solana mainnet-beta
source      getAccountInfo (jsonParsed), https://api.mainnet-beta.solana.com
account     Pren1FvFX6J3E4kXhJuCiAD5aDmGEb7qJRncwA8Lkhw   (ANTHROPIC)
slot        448865315   (RPC apiVersion 4.3.0-rc.0)
status      VERIFIED
```

**Observed result.**

```
owner (token program)  TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb   (SPL Token-2022)
account space          911 bytes
decimals               9
raw supply             7381880280847
mintAuthority          WV9PJN7XTmTLVwbutCLFxp8TyePee6Xq5mRq6Fti5Wc
freezeAuthority        WV9PJN7XTmTLVwbutCLFxp8TyePee6Xq5mRq6Fti5Wc
```

Extensions present:

| extension | observed state |
|---|---|
| `permanentDelegate` | delegate = `WV9PJN7…5Wc` |
| `transferFeeConfig` | newer: 100 bps @ epoch 1039; older: 50 bps @ epoch 1032; **maximumFee = 18446744073709551615 (u64::MAX — uncapped)** |
| `pausableConfig` | `paused: false`, authority = `WV9PJN7…5Wc` |
| `transferHook` | `programId: null`, authority = `WV9PJN7…5Wc` |
| `scaledUiAmountConfig` | multiplier `1`, newMultiplier `1`, effective ts `0` |
| `defaultAccountState` | `initialized` (not frozen by default) |
| `confidentialTransferMint`, `confidentialTransferFeeConfig` | present |
| `metadataPointer`, `tokenMetadata` | self-pointing; name "Anthropic PreStocks" |

**Conclusions.**

1. Tenet **must** use `anchor_spl::token_interface` and branch on the owning token program. Assuming classic SPL Token anywhere in the custody path is a correctness bug.
2. A single issuer key `WV9PJN7XTmTLVwbutCLFxp8TyePee6Xq5mRq6Fti5Wc` simultaneously holds permanent-delegate, freeze, pause, transfer-hook and transfer-fee authority. This is an **irreducible trust assumption Tenet cannot remove**, and it bounds what the exit guarantee may claim (spec §37). Tracked as risk `R-09`.
3. `transferHook.programId` is currently `null`, but the authority can set one at any time. Execution and redemption must tolerate a hook appearing without warning.
4. `defaultAccountState = initialized` means Circle vaults will not be created frozen.

**Code permitted to rely on this.** Nothing may hardcode these values. This entry justifies the *shape* of the Token-2022 inspection module and the wording of the exit guarantee.

---

## V-003 — ScaledUiAmount: the `multiplier` field is NOT the effective multiplier (SPACEX)

```
timestamp   2026-09-20T22:24Z
network     solana mainnet-beta
source      getAccountInfo (jsonParsed), https://api.mainnet-beta.solana.com
account     PreANxuXjsy2pvisWWMNB6YaJNzr7681wJJr2rHsfTh   (SPACEX)
slot        ~448865776
status      VERIFIED
```

**Observed result.**

```
owner (token program)  TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb
decimals               9
raw supply             8742506753069
scaledUiAmountConfig   multiplier: "1"
                       newMultiplier: "5"
                       newMultiplierEffectiveTimestamp: 1781065800
transferFeeConfig      newer 100 bps @ epoch 1039, older 50 bps @ epoch 1032,
                       maximumFee = u64::MAX
permanentDelegate      WV9PJN7…5Wc
pausableConfig         paused: false
transferHook           programId: null
```

**Derivation.**

```
newMultiplierEffectiveTimestamp 1781065800  ->  2026-06-10T04:30:00Z
observation time                                2026-09-20T22:25:49Z
effective already?                              TRUE
=> effective multiplier is 5, not 1

raw supply 8742506753069 / 10^9        =  8742.506753069
                            x 5        = 43712.533765345
PreStocks API `supply` (V-001)         = 43712.533765345      EXACT MATCH
```

**Conclusions — these are load-bearing.**

1. **Reading `scaledUiAmountConfig.multiplier` alone is wrong.** The effective multiplier is `newMultiplier` once `newMultiplierEffectiveTimestamp <= now`, otherwise `multiplier`. A naive implementation values every Circle's SPACEX position at **one fifth** of its true economic size. Tenet must implement timestamp-aware selection and test it.
2. **The PreStocks API `supply` field is the *scaled* supply, not raw.** Confirmed to the last digit. Using it as the denominator of the supply-consumption cap (spec §23) while the numerator is a raw vault balance would misreport Circle ownership by 5×. Supply consumption must therefore be computed as `vault.amount / mint.supply`, both raw — the multiplier cancels and never enters the calculation.
3. This is the concrete justification for RULE 3. Raw base units are canonical; the multiplier belongs only at the display/valuation boundary.

**Code permitted to rely on this.** The effective-multiplier function in the Token-2022 inspection module, and the decision that supply consumption is computed purely in raw units.

---

## V-004 — Active transfer fee is 100 bps and uncapped

```
timestamp   2026-09-20T22:25Z
network     solana mainnet-beta
source      getEpochInfo, https://api.mainnet-beta.solana.com
status      VERIFIED
```

**Observed result.** `epoch: 1039`, `absoluteSlot: 448865776`.

**Conclusion.** Current epoch `1039` equals `newerTransferFee.epoch` on both inspected mints, so the **active** fee is `100 bps` with `maximumFee = u64::MAX` (no cap). It was `50 bps` at epoch 1032 — the fee is **mutable and was recently doubled**.

Consequences:

- Fee selection must compare the **current cluster epoch** against both `olderTransferFee.epoch` and `newerTransferFee.epoch`. Reading `newerTransferFee` unconditionally is a bug whenever a change is scheduled for a future epoch.
- An in-kind exit of a PreStocks position costs the exiting member ~1% of the transferred amount, uncapped. This must be shown before signing (spec §22) and must **not** be reimbursed from Circle USDC (INV-015).
- Fee configuration must be read live for every valuation and every exit quote. Caching it across epochs is unsafe.

---

## V-005 — Jupiter routes PreStocks; indicative issuer price is not executable price

```
timestamp   2026-09-20T22:24Z
network     solana mainnet-beta
source      https://lite-api.jup.ag/swap/v1/quote
request     inputMint=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v (USDC)
            outputMint=PreANxuXjsy2pvisWWMNB6YaJNzr7681wJJr2rHsfTh (SPACEX)
            amount=100000000 (100 USDC)  slippageBps=50
status      VERIFIED
```

**Observed result.**

```
inAmount               100000000
outAmount              163767636          (raw base units, 9 decimals)
otherAmountThreshold   162948798
priceImpactPct         0.0485851421096795388872403771
routePlan              1 hop  ->  Meteora DLMM
```

**Derivation.**

```
received raw         163767636 / 10^9        = 0.163767636 base units
effective multiplier 5 (V-003)               = 0.818838180 display units
executable price     100 USDC / 0.81883818   = $122.12 per display unit
issuer tokenPrice    (V-001)                 = $116.16 per display unit
issuer markPrice     (V-001)                 = $153.89 per display unit
```

**Conclusions.**

1. PreStocks assets **are** routable through Jupiter, single hop, low impact at $100 size. Route venue observed: Meteora DLMM, reached *through* Jupiter — Tenet does not integrate Meteora directly.
2. The executable price ($122.12) differs from the issuer's indicative `tokenPrice` ($116.16) by ~5%. **They are not interchangeable.** The spec's §18 separation of "market/executable value" from "issuer reference mark" is empirically necessary.
3. Issuer prices are quoted per **display** unit (multiplier applied), consistent with V-003. Every conversion between an issuer price and a raw vault balance must pass through the effective multiplier.
4. `priceImpactPct` is returned as a high-precision decimal **string**. Parse with exact decimal arithmetic, never `Number` (RULE 4).
5. `100 USDC` is a viable probe size. Minimum viable trade size per asset remains **UNVERIFIED** and must be measured per asset in Phase 0.

---

## V-006 — Toolchain: Anchor requires WSL on Windows

```
timestamp   2026-09-20T22:23Z
source      https://www.anchor-lang.com/docs/installation  (documentation)
            local shell                                     (this machine)
status      REPORTED (docs) + VERIFIED (local)
```

**Observed result (documentation).** Current recommended set: `anchor-cli 1.2.0`, `solana-cli 4.1.2 (Agave)`, `rustc 1.85.0`, `node v23.9.0`. Anchor installs via AVM from `github.com/otter-sec/anchor`. Explicit statement: *"Windows Users: You must first install WSL"*.

**Observed result (this machine).**

```
node     v26.4.0     (docs recommend v23.9.0)
npm      11.17.0
rustc    1.96.0      (docs recommend 1.85.0)
cargo    1.96.0
git      2.53.0
pnpm     NOT INSTALLED
solana   NOT INSTALLED
anchor   NOT INSTALLED
docker   NOT INSTALLED
WSL      Debian, version 2, STOPPED
```

**Conclusion.** The working directory is Windows (`C:\stocklana`). Anchor builds and `solana-test-validator` **cannot run natively here**. All Rust/Anchor work must execute inside the existing WSL Debian instance. This is a **BLOCKER** for Phase 1, tracked in `PROGRESS.md`. The TypeScript side (SDK, web, indexer, `pnpm verify`) runs fine on Windows.

Node 26 and Rust 1.96 are both ahead of Anchor's tested versions. Do not assume they work — see `docs/dependencies.md` (D-01, D-02).

---

## V-007 — Pyth Core was upgraded on 2026-08-26; current receiver and Hermes paths require verification

```
timestamp   2026-09-22T00:00Z
source      https://docs.pyth.network/price-feeds/core/use-real-time-data/pull-integration/solana
            https://docs.pyth.network/price-feeds/core/contract-addresses/solana
            https://docs.pyth.network/price-feeds/core/fetch-price-updates
status      REPORTED — current documentation read; on-chain account and feed observations remain outstanding
```

**Observed result (documentation).**

- "Pyth Core on Solana was upgraded on **August 26, 2026**." Existing integrations were migrated automatically by the Pyth DAO.
- "The upgraded Pyth Core Contract **preserves the Pyth Core interface. No other code changes are needed**" beyond authentication.
- The recommended Hermes endpoint is `pyth.dourolabs.app/hermes`, and the current documentation says Hermes access requires an API key. That key must not be embedded in the browser; a secured server or an on-chain push-account path is required.
- The current Solana receiver address documented for mainnet and devnet is `rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ`; the current price-feed program is `pythWSnswVUd12oZpeFP8e9CVaEqJg25g1Vtc2biRsT`. These remain documentation observations until verified against live accounts.
- Rust integration remains `pyth-solana-receiver-sdk`; the documented account type is `Account<'info, PriceUpdateV2>` and freshness is enforced with `get_price_no_older_than(&Clock::get()?, max_age, &feed_id)`.
- The documentation's compatibility list still names Anchor `v0.28.0` through `v0.31.1`, while this repository uses Anchor `1.2.0`; repository dependency metadata and an actual target build must settle that compatibility before adding the crate.

**UNVERIFIED and blocking.** All of the following must be observed directly before any price-dependent instruction is written:

1. The actual on-chain receiver program address post-upgrade, including whether the documented upgraded pair is the pair Tenet should consume.
2. Whether `PriceUpdateV2` is still the account layout, confirmed by deserialising a real account.
3. Feed IDs for each tokenized equity and each underlying equity.
4. Whether `pyth-solana-receiver-sdk` compiles against the Anchor version we select (D-04).
5. How to obtain a Pyth API key, and what happens to Tenet when that key is rate-limited or revoked — a credentialed dependency in the valuation path is a real availability risk (`R-12`).

**No Tenet code may consume Pyth until V-007 is upgraded to VERIFIED.**

---

## V-008 — Jupiter CPI bindings are archived; current Swap V2 must be verified

```
timestamp   2026-09-22T00:00Z
source      https://github.com/jup-ag/jupiter-cpi
            https://developers.jup.ag/docs/swap
            https://developers.jup.ag/docs/swap/order-and-execute
status      REPORTED — current API surface updated; execution remains unverified
```

**Observed result.**

- The `jupiter-cpi` repository is **archived and read-only as of 2025-11-14**.
- Current Jupiter docs identify `https://api.jup.ag/swap/v2` as the active unified API. Its Meta-Aggregator uses `/order` + `/execute`; its Router uses `/build` + `/submit` for raw instruction/composability workflows.
- The current docs say the Router path is the path for custom transactions and CPI, but all current endpoints require an API key.
- The older V1/Metis docs remain reachable and still expose `/swap/v1/quote`, `/swap/v1/swap`, and `/swap/v1/swap-instructions`, but explicitly say Metis is no longer actively maintained and has been superseded by Swap V2.
- Current docs still state that Jupiter CPI can be used, but the only named `jupiter-cpi` crate is archived. Tenet therefore cannot treat the documentation statement as a verified dependency choice.
- A **Flash Fill** pattern is documented as the alternative to CPI, using versioned transactions and Address Lookup Tables to avoid transaction-size limits.
- V1 `/quote` accepts `maxAccounts` to constrain inner-route account usage, but current docs warn this is an estimate and does not include setup/cleanup accounts.

**Conclusion.** Tenet must **not** depend on the archived `jupiter-cpi` crate. The credentialed verification harness now probes current Swap V2 `/order` and Router `/build` paths; `/build` returned raw composable instruction fields for all 8 discovered PreStocks assets. V1 remains only a clearly labelled legacy signal. The Router path is the current implementation candidate, but V-008 remains open until a real Token-2022 route executes and its actual vault deltas are checked against a Tenet Circle vault on mainnet-beta.

**UNVERIFIED and blocking.** Current Jupiter aggregator program ID; exact instruction discriminators; whether a Token-2022 route carrying a transfer fee fits the 1232-byte limit under CPI; behaviour of `maxAccounts` with Token-2022.

---

## V-009 — `prestocks-pulse` third-party data layer (spec §50)

```
timestamp   2026-09-20T22:22Z
source      https://github.com/aralroca/prestocks-pulse
status      REPORTED — partial
```

**Observed result.** Repository exists. Owner `aralroca`. License **MIT**. 24 commits on main; example data snapshot timestamped `2026-09-17T19:17:51Z`. Provides hourly snapshots of token price, mark price, supply and mark valuation, a premium/discount ranking, a "PRE8" index, and an MCP server. Sources it documents: `https://prestocks.com/api/prestocks` for issuer data, Jupiter price v3 / quote endpoints for executable quotes, and direct Solana RPC reads of `scaledUiAmountConfig`. It independently documents the `SPACEX` 5× multiplier, consistent with V-003.

**Conclusion.** It exists, it is MIT-licensed, and its methodology matches what we verified independently. Its upstream sources are the *same* sources Tenet already reads directly, so it adds **no authority** Tenet lacks.

**Decision.** Tenet reads issuer data, Jupiter and RPC **directly**. `prestocks-pulse` may be used only for optional historical analytics, credited if used, and never as issuer truth (spec §51). Update cadence and maintenance guarantees are UNVERIFIED.

---

## V-015 — Anchor's canonical repository moved to `otter-sec/anchor`; the crates.io `avm` crate is NOT Anchor's

```
timestamp   2026-09-20T22:40Z
source      GitHub HTTP redirects; https://crates.io/api/v1/crates/avm
            https://api.github.com/repos/otter-sec/anchor
status      VERIFIED
```

**Observed result.**

```
github.com/solana-foundation/anchor  ->  301  ->  github.com/otter-sec/anchor
github.com/coral-xyz/anchor          ->  301  ->  github.com/otter-sec/anchor
github.com/otter-sec/anchor          ->  200

otter-sec/anchor:  "⚓ Solana Program Framework"
                   stars 5135 · license Apache-2.0 · archived false
                   pushed_at 2026-09-20T11:55:49Z   (same day as this check)

releases:  v0.32.2  2026-09-14      v1.2.0  2026-09-04
           v0.31.2  2026-09-14      v1.1.2  2026-06-26
           v0.30.2  2026-09-14      v1.1.1  2026-06-25
```

**crates.io `avm`:**

```
name        avm
repository  https://github.com/schultyy/avm
description "Manages node.js installations"
max_version 1.0.1
updated_at  2016-06-12
```

**Conclusions — supply-chain relevant.**

1. **`cargo install avm` installs the wrong package.** The crates.io `avm` crate is an abandoned Node.js version manager last touched in 2016, unrelated to Anchor. Anchor's version manager must be installed from git: `cargo install --git https://github.com/otter-sec/anchor avm --force`. Recorded so nobody "fixes" the install command later by shortening it.
2. The `otter-sec/anchor` install source in the official docs is **legitimate**, not a doc misread or typosquat. Both historically canonical repositories (`coral-xyz`, `solana-foundation`) 301-redirect there, which is evidence of a genuine transfer of the repository rather than a fork.
3. **The 0.3x line is actively maintained**: `v0.31.2` and `v0.32.2` both shipped 2026-09-14, *after* `v1.2.0` (2026-09-04). A fallback to 0.31.x is therefore not a fallback onto an abandoned branch.

---

## V-016 — D-04 resolved: Anchor 1.x and the current Pyth SDK are aligned

```
timestamp   2026-09-20T22:42Z
source      https://crates.io/api/v1/crates/pyth-solana-receiver-sdk
            https://crates.io/api/v1/crates/pyth-solana-receiver-sdk/2.0.0/dependencies
status      VERIFIED (crate metadata) — build confirmation still pending
```

**Observed result.**

```
pyth-solana-receiver-sdk
  max_stable_version   2.0.0
  published            2026-06-15
  repository           https://github.com/pyth-network/pyth-crosschain
  version history      2.0.0 (2026-06-15) · 1.2.0 (2026-05-19) · 1.1.0 (2025-11-07)
                       1.0.1 · 1.0.0 (2025-09) · 0.6.1 (2025-04)
  none yanked

dependencies of 2.0.0 (normal):
  anchor-lang    ^1.0.2        <-- decisive
  borsh          ^1.5.3
  cfg-if         ^1.0
  hex            ^0.4.3
  pythnet-sdk    ^3.0.0
```

**Conclusion — this dissolves the contradiction in `docs/dependencies.md` §3.**

`pyth-solana-receiver-sdk 2.0.0` requires `anchor-lang ^1.0.2`, i.e. `>= 1.0.2, < 2.0.0`. **Anchor 1.2.0 satisfies it.** The documentation prose claiming compatibility with "v0.28.0, v0.29.0, v0.30.1, v0.31.1" (V-007) describes the **older 0.6.x/1.x-era SDK lineage and is stale**. The crate's own dependency metadata is the authoritative statement, and it points the opposite way: the current SDK *requires* Anchor 1.x and would **not** build against 0.31.1.

**Decision D-04 — resolved:**

```
anchor-lang               1.2.0
pyth-solana-receiver-sdk  2.0.0
```

The 0.31.x fallback is **withdrawn**: it would now be the *incompatible* choice, not the safe one. This inverts the fallback ordering recorded earlier.

**Still required before Pyth code is written.** Crate metadata proves version *intent*, not that it compiles or that it matches the post-upgrade chain state. V-007 remains open on: the on-chain receiver program address after 2026-08-26, confirmation that `PriceUpdateV2` is still the layout (by deserialising a real account), feed IDs, and the Hermes API key flow. Note that SDK 2.0.0 predates the 2026-08-26 upgrade; whether a newer release is required post-upgrade is **UNVERIFIED**.

---

## V-014 — USDC mint confirmed

```
timestamp   2026-09-20T22:50Z
network     solana mainnet-beta
source      scripts/verify-integrations.ts (getAccountInfo)
account     EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v
status      VERIFIED
```

**Observed result.**

```
token program   TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA   (classic SPL Token)
decimals        6
raw supply      8023285681580250
transfer fee    none
issuer controls freezeAuthority (set)
```

**Conclusions.**

1. `decimals == 6` confirms decision **A-02**: 1 share = 1 micro-USDC at inception holds, and `docs/accounting.md` does not need to change.
2. USDC is **classic SPL Token, not Token-2022**. The Circle therefore holds *both* token programs simultaneously — classic for the USDC vaults, Token-2022 for PreStocks. This is exactly why `token_interface` and an explicitly passed, mint-validated `token_program` are mandatory rather than stylistic.
3. No transfer fee on USDC, so escrow accounting is exact: the amount that leaves a contributor equals the amount that arrives in `EpochEscrow`. If this ever changes, contribution accounting must change with it — the harness checks it on every run.
4. USDC has a freeze authority. Disclosed, not mitigable.

---

## V-017 — ScaledUiAmount multipliers are NOT integers (OPENAI = 1.4861347)

```
timestamp   2026-09-20T22:50Z
network     solana mainnet-beta
source      scripts/verify-integrations.ts
account     PreweJYECqtQwBtpxHL171nL2K6umo692gTm7Q3rpgF   (OPENAI)
status      VERIFIED
```

**Observed result.**

```
scaledUiAmountConfig.multiplier        "1"
scaledUiAmountConfig.newMultiplier     "1.4861347"       <-- non-integer
effective multiplier                    1.4861347         (effective timestamp passed)

raw supply   1901875963018
reconcile    1901875963018 x 1.4861347  ==  issuer supply 2826.4438637369667  (exact)
```

**Conclusions — this extends V-003 and is stronger than it.**

1. **Two of eight assets carry the naive-read trap**, not one: SPACEX (effective 5, field reads 1) and OPENAI (effective 1.4861347, field reads 1). This is not an edge case in the universe — it is 25% of it.
2. **Multipliers are arbitrary decimals, not integers.** Any code doing `raw × multiplier` with integer or floating-point arithmetic is wrong. It requires exact decimal arithmetic. The first version of our own harness assumed integers and crashed on OPENAI — which is precisely the bug this entry exists to prevent in the program.
3. This is now the **strongest available argument for decision A-09 and RULE 3**: you cannot do exact integer ownership arithmetic through a multiplier of `1.4861347`. Ownership, custody and redemption must stay in raw base units, where the multiplier never appears. Supply consumption stays raw-over-raw for the same reason.
4. The reconciliation `rawSupply × effectiveMultiplier == issuerSupply × 10^decimals` holds exactly for all 8 assets, which independently confirms the issuer's `supply` field is scaled (V-003) across the whole universe rather than just SPACEX.

---

## V-018 — `jsonParsed` returns some u64 fields as JSON numbers; `res.json()` corrupts them

```
timestamp   2026-09-20T22:50Z
network     solana mainnet-beta
source      scripts/verify-integrations.ts
status      VERIFIED
```

**Observed result.** Reading `transferFeeConfig.maximumFee` through the ordinary `await res.json()` path yielded:

```
observed via res.json()   18446744073709551616      (= 2^64)
actual on-chain value     18446744073709551615      (= 2^64 - 1 = u64::MAX)
```

The RPC returns `maximumFee` (and `withheldAmount`) as a JSON **number**, not a string, unlike `supply` which is returned as a string. `JSON.parse` turns it into an IEEE-754 double, which cannot represent `2^64 - 1`, and it silently rounds up.

**Conclusions.**

1. **Every u64 above 2^53 read through `res.json()` is silently corrupted.** The error is silent — no exception, no warning, just a wrong number. In a fee or balance path this is a direct financial bug.
2. The field-by-field inconsistency (`supply` as string, `maximumFee` as number) means "check whether it is a string" is not a reliable defence. The parse itself must preserve the digits.
3. **Required correction, now implemented in the harness:** parse with the `JSON.parse` source-text reviver so every number is retained as its exact lexical string, then convert deliberately to `bigint` or exact decimal at the point of use. This must be the *only* JSON parsing path for any RPC or quote response anywhere in the codebase.
4. The same hazard applies to Jupiter quote responses (`outAmount`, `otherAmountThreshold`, `inAmount`) and to the PreStocks API (`supply`, prices). All now go through the same exact parser.
5. This becomes a lint rule and a CI check: **`res.json()` is banned** in `packages/integrations`, `services/indexer` and `scripts/`.

---

## V-019 — All 8 PreStocks assets are Jupiter-routable; issuer controls are uniform

```
timestamp   2026-09-20T22:50Z
network     solana mainnet-beta
source      scripts/verify-integrations.ts ; lite-api.jup.ag
request     USDC -> asset, 100 USDC, slippageBps=50
status      VERIFIED
```

**Observed result.** All 8 assets routed successfully at the $100 probe size.

| symbol | out (raw) | price impact | hops | venue(s) |
|---|---|---|---|---|
| ANDURIL | 628876685 | 0.0229% | 1 | Manifest |
| ANTHROPIC | 95450800 | 0.0125% | 2 | HumidiFi → Manifest |
| FIGUREAI | 551418698 | 0.0436% | 2 | Quantum → Raydium CLMM |
| KALSHI | 108365416 | 0.0030% | 1 | Manifest |
| NEURALINK | 225174983 | 0.0465% | 1 | Manifest |
| OPENAI | 59985340 | 0.0246% | 1 | Manifest |
| POLYMARKET | 690501641 | 0.0150% | 1 | Manifest |
| SPACEX | 163767636 | 0.0198% | 1 | Meteora DLMM |

Issuer controls are **identical across all 8 mints**: `permanentDelegate`, `freezeAuthority`, `pausable`, `transferHook` (authority set, none installed), transfer fee `100 bps` uncapped, all under the same authority key.

**Conclusions.**

1. Execution at Circle-realistic entry sizes is viable for the whole universe. Impact at $100 is negligible; the ladder to find the size where impact breaches policy is still V-011.
2. Routes span at least five venues (Manifest, Meteora DLMM, Raydium CLMM, HumidiFi, Quantum) reached **through Jupiter**. Tenet integrates none of them directly — which is what makes Jupiter the right dependency and why route venues must never be hardcoded.
3. Two-hop routes exist (ANTHROPIC, FIGUREAI). Two hops means more accounts, which sharpens the transaction-size question in V-008. The size measurement must be done against a **two-hop Token-2022 route**, not a one-hop best case.
4. The uniformity of issuer controls means R-09 applies to the entire PreStocks universe, not to selected assets. The disclosure is universal.

---

## V-020 — Jupiter program id confirmed; `maxAccounts` is NOT a hard cap; `onlyDirectRoutes` is

```
timestamp   2026-09-20T22:55Z
network     solana mainnet-beta
source      lite-api.jup.ag /swap/v1/quote and /swap/v1/swap-instructions
            getAccountInfo for the program account
status      VERIFIED
```

**Program identity, confirmed on-chain.**

```
Jupiter aggregator  JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4
                    executable=true
                    owner=BPFLoaderUpgradeab1e11111111111111111111111
```

The `swapInstruction` carries ~39–45 bytes of instruction data and a large account list. Setup adds an ATA-creation instruction (`ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL`) plus compute-budget instructions, and 1–3 address lookup tables.

**Measured account count of the swap instruction, USDC → asset, 100 USDC:**

| asset | default | `maxAccounts=32` | `onlyDirectRoutes=true` |
|---|---|---|---|
| ANTHROPIC | 3 hops, **52** accts, impact 0.0128% | 2 hops, **44** accts, 0.0123% | 1 hop, **28** accts, 0.0164% |
| FIGUREAI | 2 hops, **41** accts, 0.0473% | 2 hops, **38** accts, 0.0473% | 1 hop, **28** accts, 0.0516% |
| OPENAI | 1 hop, **24** accts, 0.0134% | 1 hop, **24** accts, 0.0134% | 1 hop, **24** accts, 0.0242% |
| SPACEX | 1 hop, **30** accts, 0.0197% | 1 hop, **30** accts, 0.0197% | 1 hop, **30** accts, 0.0197% |

An earlier sample also produced a **56-account** 3-hop route for FIGUREAI and a **54-account** route for ANTHROPIC *at* `maxAccounts=40`.

**Conclusions — these decide the execution design.**

1. **`maxAccounts` is a routing hint, not a guarantee.** At `maxAccounts=40`, ANTHROPIC returned a 54-account instruction; at `maxAccounts=48`, FIGUREAI returned 56. The relationship is non-monotonic. **It must never be used as a safety bound.** Any design that assumes "we asked for 32, so it is at most 32" is wrong.

2. **Solana's per-transaction account-lock limit is 64.** A 56-account swap instruction plus Tenet's own ~10–12 accounts (circle, mandate_asset, source_vault, dest_vault, execution_auth, vault_authority, instructions sysvar, both token programs, both mints) **exceeds it**. Multi-hop routes are therefore not safely composable, and this is true for **both** candidate designs — CPI and sandwich both require every account in the same transaction, so this is not a tiebreaker between them, it is a constraint on both.

3. **`onlyDirectRoutes=true` produces a bounded, predictable 24–30 accounts**, leaving ~34–40 accounts of headroom. This is the only lever observed that actually bounds the account set.

4. **The measured cost of that bound is small.** Direct-route impact vs best-route impact at $100: ANTHROPIC 0.0164% vs 0.0128%, FIGUREAI 0.0516% vs 0.0473%, OPENAI 0.0242% vs 0.0134%. The worst observed penalty is ~1.1 bps, against a realistic `max_price_impact_bps` in the tens of bps. Bounding the route costs almost nothing at Circle entry sizes.

5. **Routing is non-deterministic between calls.** Venues changed on every request (`Deriverse+BisonFi+Manifest`, then `HumidiFi+Manifest`, then `Quantum+Manifest` for the same pair seconds apart). **The account set at quote time is not the account set at execution time.** This independently validates the core design decision that the program verifies *actual balance deltas* rather than the route description — a route-shape check would be unreliable by construction.

**Decision A-12.** Execution requests `onlyDirectRoutes=true` for v1, and the composed transaction's account count is asserted before submission. Multi-hop execution is deferred until there is a measured, bounded way to compose it.

---

## V-021 — Pyth program addresses confirmed on-chain (V-007 partially resolved)

```
timestamp   2026-09-20T22:55Z
network     solana mainnet-beta
source      https://docs.pyth.network/price-feeds/contract-addresses/solana (docs)
            getAccountInfo (on-chain confirmation)
status      VERIFIED (existence) / UNVERIFIED (layout + feeds)
```

**Observed result.**

```
Pyth Solana Receiver   rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ
                       executable=true  owner=BPFLoaderUpgradeab1e111...

Pyth Price Feed prog   pythWSnswVUd12oZpeFP8e9CVaEqJg25g1Vtc2biRsT
                       executable=true  owner=BPFLoaderUpgradeab1e111...
```

Both are live, executable, upgradeable-loader-owned programs. Docs state both are deployed on Solana mainnet and devnet (and several other SVM chains), and that existing integrations were auto-upgraded by the DAO on 2026-08-26.

**Still UNVERIFIED — V-007 remains open on:**

1. **Which program our SDK path actually uses.** Two addresses now exist; `pyth-solana-receiver-sdk 2.0.0` predates the 2026-08-26 upgrade (published 2026-06-15). Whether it targets `rec5…`, `pythWSns…`, or needs a newer release must be settled by reading the SDK's own `declare_id!`/constants, not by assumption.
2. **`PriceUpdateV2` layout**, confirmed by deserialising a real price account rather than trusting the docs' "interface preserved" claim.
3. **Feed IDs** for each tokenized and each underlying equity.
4. **Target-feed coverage** for the supported tokenized-equity/underlying pairs. Hermes API-key acquisition and the `Authorization: Bearer` flow against `pyth.dourolabs.app/hermes` are now verified by the credentialed replay above.

**No Tenet code may consume Pyth until items 1–3 are observed directly.**

---

## V-022 — Build environment: memory ceiling, Anchor's Solana pin, and a truncated toolchain download

```
timestamp   2026-09-20T23:58Z — 2026-09-21T00:05Z
host        Windows 11, 7.7 GB RAM total (0.4 GB free at time of failure), 8 logical CPUs
guest       WSL2 Debian 13 (trixie)
status      VERIFIED
```

**Observed failures and their causes.**

1. **WSL2 VM died mid-build** with `Wsl/Service/CreateInstance/E_FAIL` (error code 6, failure step 2). WSL defaulted to ~3.8 GiB with **no swap** on a 7.7 GB host. Concurrent `cargo install` work exhausted it.

2. **Anchor's platform-tools download was truncated and left unusable.** Anchor reported:

   ```
   Error: platform-tools v1.56 installation did not create a Rust sysroot
          at /root/.cache/solana/v1.56/platform-tools
   ```

   Inspection showed only a temp file, never extracted:

   ```
   observed   tmp-platform-tools-linux-x86_64.tar.bz2    151,945,216 bytes
   actual     platform-tools-linux-x86_64.tar.bz2        520,271,243 bytes  (release v1.56, 2026-08-18)
   completeness                                          29%
   ```

   The downloader left a 29% file in place and failed at extraction rather than at download, so the symptom ("no Rust sysroot") pointed away from the real cause (a short download).

3. **Anchor 1.2.0 pins its own Solana version.** We installed `solana-cli 4.2.2` via the Anza stable channel; after `avm install 1.2.0` the active release became **`4.1.2`** — matching the version in Anchor's own documentation. Both are present under `~/.local/share/solana/install/releases/`.

**Corrections applied.**

- `%USERPROFILE%\.wslconfig` created with `memory=5GB`, `swap=8GB`, `processors=6`, `autoMemoryReclaim=gradual`. Swap is the part that actually prevents the hard kill during linking. Verified after restart: 4.8 GiB RAM, 6 CPUs. Reversible by deleting the file and running `wsl --shutdown`.
- `scripts/wsl-install-platform-tools.sh` downloads with resume, **verifies the byte count against the GitHub release asset size, and refuses to extract a short file**. The failure mode above was silent; this makes it loud.

**Conclusions.**

1. This environment is **memory-constrained for Solana builds**. Program builds should not run concurrently with other heavy work, and CI must not assume a large builder.
2. **Anchor's toolchain pin overrides ours.** `Anchor.toml` must pin `solana_version` explicitly so the active release is deterministic rather than a side effect of install ordering — otherwise two machines can silently build against different Agave versions.
3. A downloaded toolchain artifact must be **size-verified before use**. An unverified 29% tarball produced an error message that named the wrong problem, which is exactly the kind of wasted debugging a checked download prevents.

---

## V-023 — Pyth SDK program IDs, the `pro-compatible` fork, and mandatory verification level

```
timestamp   2026-09-21T00:12Z
source      https://raw.githubusercontent.com/pyth-network/pyth-crosschain/main/
              target_chains/solana/pyth_solana_receiver_sdk/src/{lib.rs,price_update.rs}
status      VERIFIED (source read) — resolves V-007 item 1
```

**Observed result — `lib.rs` selects program IDs by cargo feature:**

```rust
cfg_if::cfg_if! {
    if #[cfg(feature = "pro-compatible")] {
        declare_id!("rec2HHDDnjLfj4kE7VyEtFA1HPGQLK33259532cRyHp");
        pub const PYTH_PUSH_ORACLE_ID: Pubkey = pubkey!("pyt2F414BA6dPttK6RddPZUdHfapoBN24GL5wbrPCou");
    } else {
        declare_id!("rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ");
        pub const PYTH_PUSH_ORACLE_ID: Pubkey = pubkey!("pythWSnswVUd12oZpeFP8e9CVaEqJg25g1Vtc2biRsT");
    }
}
```

**Conclusions.**

1. The two addresses confirmed on-chain in V-021 are **complementary, not alternatives**: `rec5EKMGg…` is the receiver program and `pythWSnsw…` is the push-oracle program, and the **default** (no-feature) build uses both. Our earlier uncertainty about "which one" was the wrong question.
2. There is a **second pair** behind the `pro-compatible` feature (`rec2HHDDn…`, `pyt2F414B…`). Which pair Tenet should target after the 2026-08-26 Core upgrade is **UNVERIFIED** and must be settled before Pyth code ships — building against the wrong pair means reading price accounts that do not exist. Tracked as V-007 item 1b.

**Observed result — verification level is enforced, and the default is safe:**

```rust
pub fn get_price_no_older_than(&self, clock, maximum_age, feed_id) -> ... {
    self.get_price_no_older_than_with_custom_verification_level(
        clock, maximum_age, feed_id,
        VerificationLevel::Full,          // <-- default
    )
}
```

with `check!(self.verification_level.gte(verification_level), InsufficientVerificationLevel)`.

The SDK's own documentation warns: *"Using partially verified price updates is dangerous, as it lowers the threshold of guardians that need to collude to produce a malicious price update."*

**Conclusions — this is a hard rule for Tenet.**

3. **Tenet uses `get_price_no_older_than` only.** `get_price_no_older_than_with_custom_verification_level` and `get_price_unchecked` are **banned** in the codebase; a `Partial` verification level lowers the guardian-collusion threshold and is a direct path to the oracle manipulation in R-04. This becomes a lint rule alongside the `res.json()` ban.
4. `PriceUpdateV2` is still present with `feed_id`, `price`, `conf`, `exponent`, `publish_time` and an explicit `verification_level` field — consistent with the docs' "interface preserved" claim, though layout confirmation by deserialising a **real account** (V-007 item 2) is still outstanding.

**Opportunity for R-04.** The SDK also exposes `TwapUpdate` / `TwapPrice` with `get_twap_no_older_than(clock, max_age, window_seconds, feed_id)`, which validates the TWAP window length. A TWAP-based NAV for **share issuance** would materially reduce the last-second manipulation risk in R-04, since it cannot be moved by a single-block price push. Worth evaluating in Phase 4 — recorded as an option, not yet a decision.

---

## V-024 — Anchor infers the Agave version from `Cargo.lock` and gets it wrong

```
timestamp   2026-09-21T00:10Z
guest       WSL2 Debian 13, anchor-cli 1.2.0, solana-cli 4.1.2
source      anchor build output; https://api.github.com/repos/anza-xyz/agave/releases
status      VERIFIED
```

**Observed result — dependency resolution SUCCEEDED:**

```
spike v0.1.0
├── anchor-lang               v1.2.0
├── anchor-spl                v1.2.0   (features: token_2022)
└── pyth-solana-receiver-sdk  v2.0.0
```

This is the substantive half of V-016b: the three crates coexist in one dependency graph, confirming D-04 at the resolution level.

**Observed result — `anchor build` then failed for an unrelated reason:**

```
Failed to list installed Solana versions with `agave-install`:
  Unable to load /root/.config/solana/install/config.yml:
  Custom { kind: Other, error: "Error(\"missing field `json_rpc_url`\", line: 2, column: 1)" }

Error: "Unknown release: 5.0.0"
Error: setting up Solana 5.0.0 resolved from resolved solana-program in Cargo.lock
```

**Cross-check of available Agave releases:**

```
v4.4.0-alpha.5  2026-09-18 (prerelease)     v4.2.2  2026-08-28
v4.3.0          2026-09-18 (prerelease)     v4.2.1  2026-08-13
v4.3.0-rc.1     2026-09-11
```

**There is no Agave 5.0.0.**

**Conclusions.**

1. **Anchor derives the Agave CLI version from the `solana-program` crate version in `Cargo.lock`.** The lockfile resolves `solana-program 5.0.0`, so Anchor tried to activate "Solana 5.0.0" — a release that does not exist. **Crate versioning and CLI versioning have diverged**, so this inference is unsound on any project whose dependency graph pulls a 5.x `solana-*` crate.
2. In this project that skew arrives through Anchor's **own** generated dev-dependencies: the 1.2.0 template ships `litesvm 0.10.0` plus `solana-message`/`solana-transaction`/`solana-signer`/`solana-keypair`, and `cargo add` reported pulling `solana-sysvar v5.0.0`. So the default `anchor init` output is self-inconsistent on this toolchain.
3. A second, independent defect: `agave-install`'s `config.yml` was written without `json_rpc_url`, so `agave-install list` failed outright and Anchor could not even see the installed versions. Repaired with `solana config set --url`.

**Required correction — this confirms V-022 conclusion 2 and is now binding.**

`Anchor.toml` **must** pin the toolchain explicitly:

```toml
[toolchain]
anchor_version = "1.2.0"
solana_version = "4.1.2"
```

Without this pin the build depends on transitive crate resolution and is not reproducible between machines — two developers can silently target different Agave versions, or fail to build at all. The pin goes into the real repository's `Anchor.toml`, not just the spike.

4. Anchor 1.2.0's template uses **`litesvm`** for program tests rather than the older ts-mocha harness. Tenet's program test suite should follow the template's harness rather than fight it.

---

## V-025 — Solana Subscriptions & Allowances: a verified primitive for the automatic contribution rail

```
timestamp   2026-09-21T00:30Z
network     solana mainnet-beta
source      https://solana.com/docs/payments/subscriptions/overview
            https://solana.com/docs/payments/subscriptions/recurring-delegation
            getAccountInfo (on-chain confirmation)
status      VERIFIED (existence + documented interface)
```

**Observed result.**

```
program     De1egAFMkMWZSN5rYXRj9CAdheBamobVNubTsi9avR44
            executable = true
            owner      = BPFLoaderUpgradeab1e11111111111111111111111
shipped     2026-06-02 by the Solana Foundation, mainnet + devnet
audit       Cantina
```

Documented interface:

- Three models: **fixed delegation**, **recurring delegation**, **subscription plans**.
- A program-controlled **Subscription Authority** PDA per `(user, mint)` pair. The user approves it **once**; individual authorizations are separate records checked per transfer.
- Recurring delegation fields: `amountPerPeriod`, `periodLengthS`, `startTs`, `expiryTs`.
  Instructions: `initSubscriptionAuthority`, `createRecurringDelegation`, `transferRecurring`, `revokeDelegation`.
- *"The Subscription Authority cannot move funds by itself. A transfer only succeeds when it matches one of the user's active authorizations."*
- `expiryTs` is a hard stop. Perpetual delegation is disallowed for deferred-start arrangements.
- Revocation is **unilateral by the user**, closes the delegation PDA and refunds rent; `RevokeSubscriptionAuthority` clears the token-account approval.
- Supports **both SPL Token and Token-2022**, forwarding transfer-hook accounts for hook-enabled mints.

**Conclusions.**

1. This satisfies every authorization requirement the specification update places on automatic contributions — bounded amount, bounded period, hard expiry, unilateral revocation — using an **audited Foundation program** rather than a mechanism Tenet invents.
2. It resolves the classic hazard of this feature. A naive `approve` would put Tenet in the token account's **single delegate slot**, evicting any other protocol's delegation and granting a flat allowance with no time bound. The Subscription Authority indirection avoids both problems.
3. **Revocation does not pass through Tenet.** The user calls `revokeDelegation` on the Solana program directly. Tenet cannot block, delay or gate it even in principle — which is the same property the exit guarantee relies on.
4. Token-2022 support matters here: USDC is classic SPL Token (V-014), but the same rail must not break if a Circle ever accepts a Token-2022 contribution asset.

**UNVERIFIED — must be settled before implementation (Phase 9):**

1. Whether `transferRecurring` can be **CPI'd** from another program, or requires the delegatee to sign the transaction directly. If CPI is unsupported, Tenet verifies the escrow balance delta after the keeper's transfer — the same verify-effects pattern used for execution.
2. Whether the delegatee may be a **PDA** (required for permissionless keepers).
3. Rent and account-count cost per rule.
4. Keeper liveness model and who pays transaction fees.

**No Tenet automation code may be written until items 1–2 are observed directly.**

---

## V-010 — Public tokenized-equity universe (xStocks): discovered, Token-2022, no transfer fee

```
timestamp   2026-09-21T00:10Z
network     solana mainnet-beta
source      https://lite-api.jup.ag/tokens/v2/search?query=xStock   (discovery)
            getAccountInfo (jsonParsed)                             (on-chain confirmation)
status      VERIFIED
```

**Discovery method.** Jupiter's token search returns the universe with mint, decimals, token program, supply and live liquidity. Backed's own metadata host (`xstocks-metadata.backed.fi`) returns **403** for index endpoints, so it cannot be used for enumeration. The universe is therefore discovered from Jupiter at runtime — **never hardcoded** (spec §48).

**Observed (20 returned; the list is evidence, not a fixed universe):**

| symbol | mint | liquidity (USD) |
|---|---|---|
| SPYx | `XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W` | 7,992,269 |
| CRCLx | `XsueG8BtpquVJX9LVLLEGuViXUungE6WmK5YZ3p3bd1` | 2,404,223 |
| NVDAx | `Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh` | 2,132,918 |
| QQQx | `Xs8S1uUs1zvS2p7iwtsG3b6fkhpvmwz4GYU3gWAmWHZ` | 1,929,410 |
| SPCXx | `Xs3oZwbHvqis4NYcf4YKWmEia2eC84wSiVrcYcTqpH8` | 1,717,781 |
| COINx | `Xs7ZdzSHLU9ftNJsii5fCeJhoRWSC32SQGzGQtePxNu` | 1,362,011 |
| TSLAx | `XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB` | 1,293,448 |
| HOODx | `XsvNBAYkrDRNhA7wPHQfX3ZUXZyZLdnCQDfHZ56bzpg` | 1,205,084 |
| MSTRx | `XsP7xzNPvEHS1m6qfanPUGjNmdnmsLKEoNAnHjdxxyZ` | 1,134,771 |
| MCDx | `XsqE9cRRpzxcGKDXj1BJ7Xmg4GRhZoyY1KpmGSxAWT2` | 920,015 |
| GLDx | `Xsv9hRk1z5ystj9MhnA7Lq4vjSsLwzL2nxrwmwtD3re` | 787,330 |
| MSFTx | `XspzcW1PRtgf6Wj92HCiZdjzKCyFekVD8P5Ueh3dRMX` | 650,855 |
| AAPLx | `XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp` | 633,986 |
| STRCx | `Xs78JED6PFZxWc2wCEPspZW9kL3Se5J7L5TChKgsidH` | 528,700 |
| GOOGLx | `XsCPL9dNWBMvFtTmwcCA5v3xWPSMEBCszbQdiLLq6aN` | 513,794 |
| METAx | `Xsa62P5mvPszXL1krVUnU5ar38bBSVcWAB6fmPCo5Zu` | 407,152 |
| PLTRx | `XsoBhf2ufR8fTyNSjqfU71DYGaE6Z3SUGAidpzriAA4` | 372,881 |
| GMEx | `Xsf9mBktVB9BSU5kf4nHxPq5hCBJ2j2ui3ecFGxPRGc` | 262,902 |
| AMZNx | `Xs3eBt7uRfJX8QUs4suhyU8p2M6DoUDrJyWBa8LLZsg` | 251,295 |
| KOx | `XsaBXg8dU5cPM6ehmVctMkVqoiRG2ZjMo1cyBJ3AykQ` | 211,443 |

**On-chain confirmation (SPYx, NVDAx, SPCXx, AAPLx):**

```
token program   TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb   (Token-2022)
decimals        8                                             (PreStocks use 9)
extensions      metadataPointer · permanentDelegate · defaultAccountState
                scaledUiAmountConfig · pausableConfig
                confidentialTransferMint · transferHook · tokenMetadata
transferFee     NONE
```

Authorities are **split** across several keys (freeze `JDq14BW…`, permanent delegate `5aMNNLQ…`, scaled-UI authority `S7vYFFWH…`), unlike PreStocks where one key holds everything (V-002).

**Conclusions.**

1. **xStocks are Token-2022 with 8 decimals, not 9.** Any code that assumed a uniform decimal count across asset classes would be wrong. Decimals are read per mint (already required by RULE 3).
2. **No transfer fee on xStocks.** Exit costs differ sharply by asset class: an in-kind exit of a public-equity position costs nothing, while a PreStocks position costs ~1% uncapped (V-004). The UI must show this per asset rather than as one Circle-level number.
3. **`permanentDelegate` and `pausableConfig` are present here too.** R-09 is therefore **not** PreStocks-specific — it applies to the public-equity universe as well, and the README's trust-assumption wording must cover both.
4. **`SPCXx` is a SpaceX xStock.** A Circle could hold SpaceX exposure through *both* `SPCXx` and the PreStocks `SPACEX` mint. `max_issuer_weight_bps` must therefore key on **issuer**, not on mint or asset class, or the issuer cap is trivially bypassed by splitting across two wrappers of the same underlying. This is a concrete Mandate-enforcement requirement that the registry's `issuer` field must support.
5. Liquidity spans 30× (SPYx $8.0M down to KOx $211k), so `MIN_VIABLE_TRADE_SIZE` must be per asset (V-011), not global.

**Still UNVERIFIED for Phase 4:** Pyth feed IDs for each tokenized instrument and each underlying equity, and whether paired feeds exist at all for these. Hermes feed discovery now requires an API key (V-007).

---

## V-026 — ScaledUiAmount drift is routine for xStocks, not a rare corporate action

```
timestamp   2026-09-21T00:12Z
network     solana mainnet-beta
status      VERIFIED
```

**Observed.**

| asset | `multiplier` (field) | `newMultiplier` | effective ts | effective now |
|---|---|---|---|---|
| NVDAx | 1.0009180758490996 | 1.001701196801074 | 2026-09-10 (**past**) | **1.001701196801074** |
| AAPLx | 1.0026642075893797 | 1.0032690125398187 | 2026-08-08 (**past**) | **1.0032690125398187** |
| SPYx | 1.003909240011759 | 1.005714560286254 | — | newMultiplier |
| SPCXx | 1 | 1 | 0 | 1 |
| SPACEX (PreStocks) | 1 | 5 | 2026-06-10 (**past**) | **5** |
| OPENAI (PreStocks) | 1 | 1.4861347 | past | **1.4861347** |

Drift per update: AAPLx `+0.0603%`, NVDAx `+0.0782%`. Update cadence roughly monthly (2026-08-08, 2026-09-10).

**Conclusions — these strengthen RULE 3 considerably.**

1. **In every single mint examined with a non-trivial multiplier — across both asset classes — the `multiplier` field is stale and `newMultiplier` is the effective value.** This is not an edge case to guard against; it is the **normal steady state**. Code reading `multiplier` is simply wrong, everywhere, today.
2. **For xStocks the multiplier is a recurring accrual, not a corporate action.** It ratchets upward ~0.06–0.08% about monthly. The earlier framing — "refresh the multiplier around corporate actions" — is insufficient. `refresh_asset_metadata` must run on a **schedule**, and any cached multiplier is measurably wrong within weeks.
3. Error magnitudes if read naively: SPACEX **−80%**, OPENAI **−32.6%**, xStocks **−0.06 to −0.6%**. The small ones are arguably worse in practice: they are too small to notice in review and large enough to corrupt NAV and share pricing over time.
4. Multipliers are **never integers** in the general case. There is no exact integer arithmetic through `1.0032690125398187`. This is the decisive argument for keeping ownership, redemption and supply-consumption accounting in raw base units where the multiplier never appears (decision A-09, INV-019).

---

## V-016b — D-04 PROVEN: the dependency combination compiles and links to SBF

```
timestamp   2026-09-21T00:15Z
guest       WSL2 Debian 13
toolchain   anchor-cli 1.2.0 · solana-cli 4.1.2 (Agave) · rustc 1.98.1
            platform-tools v1.56 · sbpf target 1.89.0-sbpf-solana-v1.56
status      VERIFIED
```

**Result.**

```
anchor build            EXIT = 0
target/deploy/spike.so  112,400 bytes   (linked SBF shared object)
target/idl/spike.json     5,703 bytes   (IDL generated)
```

The probe program exercises exactly what Tenet depends on, and all of it compiled:

- `anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface}` as `InterfaceAccount` / `Interface` — Token-2022 **and** classic through one program.
- `pyth_solana_receiver_sdk::price_update::PriceUpdateV2` as an Anchor `Account`.
- `get_price_no_older_than(&Clock::get()?, max_age, &feed_id)` — the `VerificationLevel::Full` path (V-023).

Resolved versions: `anchor-lang 1.2.0` · `anchor-spl 1.2.0` (feature `token_2022`) · `pyth-solana-receiver-sdk 2.0.0`.

**Decision D-04 is closed.** The stale Pyth documentation (V-007) claiming a `0.31.1` ceiling was wrong in both directions: the current SDK **requires** Anchor 1.x, and the combination builds.

**Two configuration gotchas found, both required for the real repository:**

1. **`idl-build` must propagate to `anchor-spl`.** `anchor init` generates `idl-build = ["anchor-lang/idl-build"]`. Any `anchor-spl` type used inside `#[derive(Accounts)]` then fails IDL generation with:

   ```
   error[E0599]: no associated item named `DISCRIMINATOR` found for
                 anchor_spl::token_interface::TokenAccount
   error[E0599]: no function named `create_type` / `insert_types`
   ```

   Required: `idl-build = ["anchor-lang/idl-build", "anchor-spl/idl-build"]`.
   Confirmed: `pyth-solana-receiver-sdk` has **no** `idl-build` feature, so it needs no entry.

2. **The template's generated test must be removed or rewritten.** `anchor init` emits `programs/<name>/tests/test_initialize.rs` referencing scaffold instructions (`Initialize`, `Increment`). Replacing the program's instructions without touching that file breaks the build with errors that look like dependency failures but are stale scaffolding.

Also noted: `anchor build` warns on a program-ID mismatch between the keypair and `declare_id!`. Harmless for a spike; the real repository runs `anchor keys sync`.

**Diagnostic lesson worth keeping.** The first three attempts piped `anchor build` through `tail`, which buffers and discarded every diagnostic when the process died — turning a one-line feature-flag fix into hours of misdiagnosis, including a wrong OOM hypothesis and a wedged WSL subsystem. **Build output goes to a log file, never through a pipe that buffers.**

### Required `Cargo.toml` / `Anchor.toml` settings for `programs/tenet`

```toml
# Cargo.toml
[features]
idl-build = ["anchor-lang/idl-build", "anchor-spl/idl-build"]

[profile.release]
overflow-checks = true      # OFF by default in release — R-03 depends on this
```

```toml
# Anchor.toml
[toolchain]
anchor_version = "1.2.0"
solana_version = "4.1.2"    # pin explicitly — Anchor otherwise infers it
                            # from solana-program in Cargo.lock and gets it
                            # wrong (V-024: infers a nonexistent Agave 5.0.0)
```

---

## Open items

| id | assumption | status | blocks |
|---|---|---|---|
| V-007 | Pyth post-upgrade program address, account layout, feed IDs, API key | **UNVERIFIED** | all price-dependent instructions |
| V-008 | Jupiter program ID, CPI vs sandwich viability, **tx size on a 2-hop Token-2022 route** | **UNVERIFIED** | all execution instructions |
| V-010 | xStocks tokenized-equity universe, mints, token programs, Pyth feed pairs | UNVERIFIED | public-equity execution + divergence surface |
| V-011 | Minimum viable trade size per PreStocks asset (impact ladder) | UNVERIFIED | execution sizing |
| V-012 | Corporate-action state per PreStocks asset, from an official source | UNVERIFIED | corporate-action surface |
| V-013 | PreStocks eligibility / jurisdictional gating rules (official) | UNVERIFIED | acquisition gating (spec §6) |
| V-014 | USDC mint, decimals and token program | **RESOLVED** | — |
| V-016b | Anchor 1.2.0 + pyth-solana-receiver-sdk 2.0.0 actually **compile together** | **RESOLVED** | — |

## Current read-only replay — 2026-09-22T12:43:49Z

| field | observation |
|---|---|
| Timestamp | `2026-09-22T12:43:49Z` |
| Network | Solana mainnet-beta |
| Source | `scripts/verify-integrations.ts` on the Qevor VPS; RPC `https://api.mainnet-beta.solana.com` |
| Request/account | USDC mint `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`; live PreStocks endpoint; legacy Jupiter quote endpoint; observed slot `449382356` |
| Observed result | USDC passed; 8-asset PreStocks universe discovered; all discovered mints passed Token-2022, multiplier, supply and control checks; legacy Jupiter returned a route for each asset |
| Conclusion | Read-only source facts remain usable for metadata and route discovery. Credentialed Swap V2 `/order` and Router `/build` probes now pass for all 8 discovered PreStocks assets; Pyth Hermes authentication/read access passes for a current feed. This still does **not** close V-007/V-008: target tokenized-equity feed IDs/layout and a real Token-2022 route executed against Tenet vault deltas remain unverified. |
| Code depending on it | `scripts/verify-integrations.ts`, registry refresh/metadata UI, PreStocks discovery and display surfaces. No production EXECUTE instruction depends on the legacy route result. |

## Credentialed replay — 2026-09-22T13:25:09Z

| field | observation |
|---|---|
| Timestamp | `2026-09-22T13:25:09Z` |
| Network | Solana mainnet-beta; observed during the same VPS replay at slot `449390978` |
| Source | `scripts/verify-integrations.ts` on the Qevor VPS; Jupiter `https://api.jup.ag/swap/v2`; Pyth `https://pyth.dourolabs.app/hermes` |
| Observed result | Jupiter Router `/build` returned exact raw output plus raw instruction fields for all 8 discovered PreStocks assets. Pyth Hermes returned authenticated BTC/USD data with integer `price`, `expo` and `publish_time` fields. |
| Conclusion | API authentication and raw composition are verified. No signer, swap, or Circle vault was used. Three legacy route observations were rate-limited (HTTP 429); they do not invalidate the Router results. |
| Code depending on it | Jupiter Router verification in `scripts/verify-integrations.ts`; the exact raw-delta guard in `packages/domain/src/execution.ts`. On-chain execution remains gated until target equity feeds and a controlled vault-delta transaction are verified. |

## Pyth SDK compatibility build — 2026-09-22T15:35:29+01:00

| field | observation |
|---|---|
| Timestamp | `2026-09-22T15:35:29+01:00` |
| Network | N/A for this compile verification; no transaction or price account was read |
| Source | Official Pyth `pyth-solana-receiver-sdk` source/API and the pinned dependency resolved by `cargo` on the Qevor VPS |
| Request/account | `pyth-solana-receiver-sdk 2.0.0`, Anchor `1.2.0`, `PriceUpdateV2`, `get_price_no_older_than`, full verification path |
| Observed result | VPS `cargo test -p tenet --lib`: 24 passed; VPS `anchor build`: passed; the generated IDL includes the `PriceUpdateV2` execution account; integer price-floor tests passed |
| Conclusion | V-016b is resolved. This verifies SDK/toolchain compatibility only; it does not verify target tokenized-equity feed IDs, live feed accounts, or a Jupiter vault-delta transaction, so V-007/V-008 remain open. |
| Code depending on it | `programs/tenet/src/instructions/execution.rs` Pyth admission and price-impact floor; `programs/tenet/Cargo.toml` dependency declaration. |

### Resolved since the first pass

| id | outcome |
|---|---|
| V-014 | USDC is classic SPL Token, 6 decimals, no transfer fee — A-02 holds |
| V-015 | Anchor's canonical repo is `otter-sec/anchor`; crates.io `avm` is an unrelated 2016 package |
| V-016 | **D-04 resolved**: Anchor 1.2.0 + Pyth SDK 2.0.0 (`anchor-lang ^1.0.2`); 0.31.x fallback withdrawn |
| V-017 | Multipliers are non-integer decimals; 2 of 8 assets carry the naive-read trap |
| V-018 | `res.json()` silently corrupts u64 values above 2^53 — banned codebase-wide |
| V-019 | All 8 PreStocks assets routable; issuer controls uniform across the universe |

## Credentialed replay after verifier environment fix — 2026-09-22T17:12:02Z

| field | observation |
|---|---|
| Timestamp | `2026-09-22T17:12:02Z` |
| Network | Solana mainnet-beta; observed slot `449442471` |
| Source | `scripts/verify-integrations.ts` on the authorized Qevor VPS, loading `/opt/tenet/.env` without printing secret values |
| Request/account | Live PreStocks endpoint; authenticated Pyth Hermes; Jupiter Swap V2 `/order` and `/build` |
| Observed result | **67 checks, 0 blocking failures, 3 warnings**. Eight assets were dynamically discovered; Token-2022 controls, raw supply reconciliation, and effective multipliers passed. Authenticated Pyth Hermes replay passed. Jupiter v2 Router `/build` passed for all eight assets. Three route observations were rate-limited with HTTP 429. |
| Conclusion | The verifier's prior “missing credentials” result was an environment-loading defect and is corrected. API-level evidence is now current; V-007 remains open for target tokenized-equity feed IDs/layout, and V-008 remains open for the current Jupiter on-chain program/CPI/account contract and a controlled vault-delta transaction. |
| Code depending on it | `.env` loader in `scripts/verify-integrations.ts`; no production execution instruction was enabled. |
## On-chain NAV snapshot build — 2026-09-22T16:00:00+01:00

- **Timestamp:** 2026-09-22T16:00:00+01:00
- **Network:** authorized Qevor VPS build environment; no deployment or transaction
- **Source:** repository `programs/tenet/src/instructions/valuation.rs`, `epoch.rs`, and `execution.rs`; Pyth Receiver SDK 2.0.0
- **Request/account:** Anchor IDL/build plus Rust unit and LiteSVM integration suites
- **Observed result:** `open_nav_snapshot`, `record_asset_nav`, `cancel_epoch`, rolling `finalize_epoch`, and amendment governance compile; 25 Rust unit tests and 54 program tests pass. The generated IDL exposes optional snapshot accounts for Epoch 0, required rolling behavior in the handler, and the proposal/vote/execute amendment surface.
- **Slot where relevant:** live slot is read at snapshot open/record/finalize; no live slot was claimed in this build record
- **Conclusion:** on-chain NAV admission is implemented with registry-bound Pyth freshness/confidence checks, raw vault balances, reserved-claim exclusion, bitmap de-duplication, and refreshed multiplier metadata. Production execution remains gated pending live target-feed and controlled Jupiter-route verification.
- **Code depending on it:** rolling epoch finalization, `packages/sdk` generated instruction bindings, and the consumer dashboard's staged execution/value status.

## Mainnet read-only readiness probe — 2026-09-23

| field | observation |
|---|---|
| Timestamp | `2026-09-23T20:06:19Z` |
| Network | Solana mainnet-beta |
| Source | `node scripts/verify-integrations.ts` against `https://api.mainnet-beta.solana.com`; read-only harness |
| Request/account | Mainnet USDC mint; discovered PreStocks universe; public legacy Jupiter route endpoint; Pyth Hermes and Jupiter Swap V2 probes |
| Observed result | Slot `449806663`, epoch `1041`. **63 checks, 0 blocking failures, 10 warnings.** USDC and all 8 discovered PreStocks mints passed the harness's token-program, decimals, multiplier, raw-supply reconciliation, transfer-fee and issuer-control checks. Legacy Jupiter routes were returned for all 8, but are not release evidence. Pyth Hermes was not probed because `PYTH_API_KEY` is absent; Swap V2 `/order` and Router `/build` were not probed because `JUPITER_API_KEY` is absent. |
| Additional account check | At `2026-09-23T20:10:31Z`, finalized `getAccountInfo` at slot `449807618` returned `null` for the configured program ID `FJt9WntCGo6suyjH4cndwgKjQ8rDSau1JxLA91UFB49v`. No Tenet program exists at that address on mainnet at that observation. |
| Conclusion | This verifies only live token metadata and legacy route discovery. It does not constitute an end-to-end Tenet mainnet test. The current web build remains explicitly devnet-only; the configured program is not deployed on mainnet, and V-007/V-008 plus the other open production gates remain unresolved. No transaction, deployment, signer, or vault was used. |
| Code depending on it | Read-only source/metadata verification in `scripts/verify-integrations.ts`; no production execution path is enabled by these observations. |

## Mainnet app connection — 2026-09-23

| field | observation |
|---|---|
| Timestamp | `2026-09-23T20:58:43Z` |
| Network | Solana mainnet-beta |
| Source | Local Tenet app at `http://127.0.0.1:5178/app`; Vite same-origin proxy in `apps/web/vite.config.ts` forwarding to `https://api.mainnet-beta.solana.com` without a browser `Origin` header |
| Request/account | JSON-RPC batch: `getEpochInfo` and finalized `getAccountInfo` for configured program `FJt9WntCGo6suyjH4cndwgKjQ8rDSau1JxLA91UFB49v` |
| Observed result | HTTP 200 at slot `449818523`, epoch `1041`; `getAccountInfo.value` was `null`. The in-browser app displayed “Tenet is not deployed on mainnet yet.” An origin-tagged direct request to the public RPC returned HTTP 403, while the server-side local proxy succeeded. The proxy rejected a `sendTransaction` JSON-RPC method with HTTP 403. |
| Conclusion | The local app is now configured for Solana Mainnet and has a working read-only chain connection. No devnet Circle is reused. All wallet transaction paths remain disabled. This is not a deployed or end-to-end production Tenet test. Production hosting needs an equivalent same-origin, read-only RPC proxy (or a verified browser-authorized endpoint); the VPS was not changed. |
| Code depending on it | `apps/web/src/config.ts`, `apps/web/src/chain.ts`, `apps/web/src/App.tsx`, and the local proxy in `apps/web/vite.config.ts`. No custody, execution, or exit path is enabled by this observation. |

## VPS same-origin mainnet read-only app — 2026-09-24

| field | observation |
|---|---|
| Timestamp | `2026-09-24T01:03:27Z` |
| Network | Solana mainnet-beta |
| Source | VPS Caddy same-origin route on `https://38.49.209.149/api/solana` and `http://38.49.209.149:8503/api/solana`; loopback-only `tenet-rpc-proxy.service` forwards to `https://api.mainnet-beta.solana.com` without forwarding browser Origin |
| Request/account | Finalized `getAccountInfo` for configured program `FJt9WntCGo6suyjH4cndwgKjQ8rDSau1JxLA91UFB49v`; finalized `getEpochInfo` |
| Observed result | Both origins served the landing page, `/app#top`, JS/CSS/hero assets, and live RPC. Finalized response at slot `449873788`, epoch `1041`, program account `value: null`. `getBalance`, `getLatestBlockhash`, and `getEpochInfo` returned HTTP 200. `sendTransaction` returned HTTP 403 on both origins. |
| Conclusion | VPS mainnet reads and the read-only app shell work. Browser inspection confirms “Tenet is not deployed on mainnet yet”; no devnet Circle data is substituted. Wallet transactions remain disabled. This is not an end-to-end investment flow or production release. |
| Code depending on it | `services/solana-rpc-proxy/{server.mjs,policy.mjs}`, `apps/web/vite.config.ts`, `apps/web/src/config.ts`, `apps/web/src/chain.ts`, Caddy route, and `tenet-rpc-proxy.service`. No custody, signing, execution, or exit capability is exposed by the proxy. |

## PreStocks live source and mainnet release replay — 2026-09-24

| field | observation |
|---|---|
| Timestamp | 2026-09-24T10:37:11Z for the integration replay; app source data was fetched at approximately 2026-09-24T10:36:33Z (browser retrieval time, not provider publication time) |
| Network | Solana mainnet-beta for mint/program checks; PreStocks first-party HTTPS API for its product universe |
| Source | pnpm verify in /opt/tenet-build-45188cc; fixed VPS proxy https://38.49.209.149/api/prestocks -> https://prestocks.com/api/prestocks; finalized mainnet RPC through tenet-rpc-proxy.service |
| Request/account | Dynamic PreStocks product-universe GET; supported-mint metadata/supply/Token-2022 checks; finalized getAccountInfo for configured Tenet program FJt9WntCGo6suyjH4cndwgKjQ8rDSau1JxLA91UFB49v |
| Observed result | Source and proxy returned HTTP 200 JSON with 8 products. App rendered all 8 with exact-decimal premium/discount calculations and labels distinguishing the source universe from actual Circle holdings. Integration verifier: 63 checks, 0 blocking failures, 10 warnings. Finalized configured-program lookup at slot 450004913 returned value: null; epoch observed by verifier was 1041. The current replay did not complete authenticated Pyth or Jupiter Swap V2 probes because those credentials were unavailable to that invocation. |
| Conclusion | Live PreStocks market/reference data is displayed as informational source data only, not an executable quote, guaranteed liquidity, verified transferability/corporate-action state, shareholder rights, or Circle NAV. The program is still absent at its configured mainnet address; transactions remain disabled and there was no on-chain write. A credentialed replay recorded on 2026-09-22 is historical evidence and does not close current Pyth/Jupiter/feed/CPI release gates. |
| Slot where relevant | 450004913 finalized program-account lookup; verifier read slot 450003646 |
| Code depending on it | services/solana-rpc-proxy/server.mjs and its tests; apps/web/src/dashboard.tsx, apps/web/src/App.tsx, apps/web/src/styles.css; exact-decimal valuation in packages/domain/src/valuation.ts and packages/domain/test/valuation.test.ts; dynamic checks in scripts/verify-integrations.ts. No financial instruction may treat the provider quote or reference mark as oracle-grade execution/NAV input. |

## Fresh SBF build and LiteSVM workspace test - 2026-09-24

| field | observation |
|---|---|
| Timestamp | 2026-09-24T11:08:11Z |
| Network | VPS local release build and in-process LiteSVM; no mainnet write |
| Source | Anchor CLI 1.2.0; Solana platform-tools v1.56; SBF architecture v3; repository checkout /opt/tenet-build-45188cc |
| Request/account | Build tenet program with build-only --ignore-keys after the standard Anchor check exposed mismatched local keypair; verify generated IDL address and rerun full Rust workspace tests against target/deploy/tenet.so |
| Observed result | Fresh artifact built successfully, size 918448 bytes, SHA-256 072522082797173cc1d6aeebbe5c71feab290ffa6a4ead2539f16980fd054936. IDL address is FJt9WntCGo6suyjH4cndwgKjQ8rDSau1JxLA91UFB49v. cargo test --workspace --offline passed all 81 unit and LiteSVM integration tests. Anchor reported deploy keypair public key 7pLYmJXsTJW7vWuT9BwYqNCWUDXp8SR1JKmKYNofAECf, not matching FJt9. |
| Slot where relevant | No live chain read in the build/test command; separate finalized FJt9 account observation at slot 450004913 was null |
| Conclusion | The source compiles to an SBF artifact and local on-chain behavior tests pass. The artifact is not authorized/deployable at FJt9 using the available mismatched keypair. No key synchronization, deployment, signature, or transaction was performed. The program ID must not be changed implicitly. |
| Code depending on it | programs/tenet/src/lib.rs, Anchor.toml, generated target/idl/tenet.json, deployment keypair address selection, app config, SDK program ID and PDA derivations. |

## Latest configured-program presence check - 2026-09-24

| field | observation |
|---|---|
| Timestamp | 2026-09-24T11:10:41Z (verification record time; query completed immediately before) |
| Network | Solana mainnet-beta |
| Source | VPS read-only proxy at 127.0.0.1:8504/api/solana; HTTPS Tenet app and PreStocks route |
| Request/account | Finalized getAccountInfo for FJt9WntCGo6suyjH4cndwgKjQ8rDSau1JxLA91UFB49v; GET https://38.49.209.149/app and GET https://38.49.209.149/api/prestocks |
| Observed result | RPC returned value: null at slot 450011109. App and PreStocks route returned HTTP 200. Frontend config remains TRANSACTIONS_ENABLED=false. |
| Slot where relevant | 450011109 |
| Conclusion | The public app and current PreStocks source path are live, but no Tenet mainnet program exists at the configured address. There is no end-to-end mainnet investment path. |
| Code depending on it | services/solana-rpc-proxy/server.mjs, apps/web/src/config.ts, apps/web/src/App.tsx, and the deployed static bundle. |

## V-008  Current Jupiter Swap V2 Router build replay (route construction only)

| field | observation |
|---|---|
| Timestamp | `2026-09-24T11:34:57.966Z` |
| Network | Solana mainnet-beta asset/mint discovery; Jupiter Swap V2 Router API for unsigned instruction construction |
| Source | Clean-environment execution of `scripts/verify-integrations.ts` from `/proc`; [Jupiter Swap V2 Build API reference](https://developers.jup.ag/docs/api-reference/swap/build); [Jupiter keyless rate documentation](https://developers.jup.ag/docs/llms.txt) |
| Request/account | GET `https://api.jup.ag/swap/v2/build` for the 8 dynamically discovered PreStocks mints, mainnet USDC mint, `amount=100000000` raw, `slippageBps=50`, and `taker=FJt9...` (configured program address used only as a non-signing probe) |
| Observed result | **8/8** current V2 builds passed response checks: exact input/output mints and raw input, integer `outAmount`/`otherAmountThreshold`, raw swap instruction and setup/compute-budget arrays. All returned swap instructions targeted `JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4`. Full verifier result: 70 checks, 0 blocking failures, 9 warnings at RPC slot `450016743`. Pyth Hermes and `/order` probes were not authenticated. |
| Slot where relevant | `450016743` (mainnet RPC reads during the verifier); the API build itself is off-chain and has no chain slot |
| Conclusion | Current Router route construction is available without an API key at a slower public rate. This is **not** proof of a Circle-vault swap: the probe taker was not a signing wallet; no source Circle vault, destination Circle vault, CPI, Token-2022-specific execution, price policy, transaction size, post-swap vault deltas, signature, or mainnet write was tested. Jupiter's current documented parameters include `destinationTokenAccount` but not a source-token-account override. V-008 remains open; keep execution fail-closed and `TRANSACTIONS_ENABLED=false`. |
| Code depending on it | `scripts/verify-integrations.ts`, `programs/tenet/src/instructions/execution.rs`, Jupiter raw-instruction composition, and release gating. |

## V-007/V-008 release-gate rerun - 2026-09-24

| field | observation |
|---|---|
| Timestamp | 2026-09-24T11:46:52Z |
| Network | Solana mainnet-beta (read-only); VPS package tests |
| Source | pnpm test, pnpm typecheck, pnpm check:money, pnpm verify; finalized mainnet RPC; [Pyth Solana integration guide](https://docs.pyth.network/price-feeds/core/use-real-time-data/pull-integration/solana); [Pyth Core upgrade guide](https://docs.pyth.network/price-feeds/core/upgrade/preparing) |
| Request/account | Dynamic current PreStocks universe; Jupiter Swap V2 Router /build; Pyth Hermes configured probe; finalized getAccountInfo(FJt9...) |
| Observed result | 62 tests passed; typecheck and money-lint passed. Verifier: 70 checks, 0 blocking failures, 9 warnings at slot 450019439. Eight PreStocks assets were discovered and eight exact-input Jupiter V2 raw-instruction builds passed. Pyth Hermes was skipped because PYTH_API_KEY is absent. Finalized configured-program lookup returned value: null at slot 450019646. |
| Slot where relevant | 450019439 verifier read; 450019646 program lookup |
| Conclusion | Route construction and local tests pass, but no transaction was signed or sent. The Jupiter tests did not prove Circle vault account binding, CPI success, Token-2022 execution, or actual balance deltas. Pyth was not verified for supported equity feeds. Tenet is not end-to-end or mainnet working; keep the transaction gate disabled. |

## VPS Pyth environment and authenticated Hermes read — 2026-09-24

| field | observation |
|---|---|
| Timestamp | 2026-09-24T12:47:00.509Z |
| Network | Solana mainnet-beta for verifier RPC reads; Pyth Hermes HTTPS for feed read |
| Source | `/opt/tenet/.env` (configuration names/presence only); `scripts/verify-integrations.ts`; [Pyth Core upgrade guide](https://docs.pyth.network/price-feeds/core/upgrade/preparing); [Pyth fetch updates guide](https://docs.pyth.network/price-feeds/core/fetch-price-updates) |
| Request/account | Authenticated `GET /hermes/v2/updates/price/latest` for BTC/USD feed `e62df6c8…a415b43`; full read-only PreStocks/Jupiter verifier |
| Observed result | The targeted Pyth check returned HTTP 200 and one exact parsed feed. Full verifier: 67 checks, 0 blocking failures, 3 warnings at slot 450033084. Eight discovered PreStocks mints built Jupiter V2 Router instructions; three legacy route checks returned HTTP 429. No secret value was logged. |
| Slot where relevant | 450033084 for mainnet RPC observation |
| Conclusion | Pyth Bearer authentication and the BTC/USD Hermes read work using the existing VPS env file. This does not establish that required underlying-equity/tokenized-stock feed pairs exist or are fresh. Jupiter route construction is not Circle-vault execution evidence. No transaction or deployment was sent; keep the transaction gate disabled. |
| Code depending on it | `scripts/verification-env.ts`, `scripts/verify-integrations.ts`, Pyth feed registry/valuation policy, Jupiter execution account binding. |

To run the verifier with credentials stored outside the checkout, set `TENET_ENV_FILE=/opt/tenet/.env`. The loader accepts simple `KEY=value` entries only; it does not execute the file or print values.

## VPS program-key discovery correction - 2026-09-24

| field | observation |
|---|---|
| Timestamp | 2026-09-24T13:03:54Z |
| Network | VPS filesystem inspection; no chain write |
| Source | `/opt/tenet/.keys/tenet-keypair.json`, `/opt/tenet/target/deploy/tenet-keypair.json`, and the separate build checkout's target keypair |
| Request/account | Derive public addresses from candidate 64-byte Solana JSON keypairs; private contents were never printed |
| Observed result | The two /opt/tenet keypairs derive FJt9WntCGo6suyjH4cndwgKjQ8rDSau1JxLA91UFB49v. /opt/tenet-build-45188cc/target/deploy/tenet-keypair.json derives 7pLYmJXsTJW7vWuT9BwYqNCWUDXp8SR1JKmKYNofAECf. The two FJt9 files were mode 0666/0644 and the separate 7pLY file 0644; all three are now mode 0600 and root-owned.
| Slot where relevant | None |
| Conclusion | The expected program-ID keypair was already on the VPS; the prior report that it was absent was wrong. Keep the separate build checkout's mismatching target key out of deployment. A funded deploy payer/upgrade authority and authoritative source/build path still need confirmation. No transaction was signed or sent. |
| Code depending on it | Anchor program identity, release build/deploy procedure, frontend/IDL address consistency. |

## Fresh Devnet candidate build — 2026-09-24

| field | observation |
|---|---|
| Timestamp | 2026-09-24 17:53:39 UTC |
| Network | Solana Devnet; no chain write |
| Source | `/opt/tenet-build-45188cc`; public RPC `https://api.devnet.solana.com`; Anchor-generated IDL and optimized SBF artifact |
| Request/account | Read current slot, inspect executable account `7YWVfv6sDGZkyENbhvHLCiVZMDcJnGgFDZ4cso8BLsbh`, and query rent for 819472 bytes |
| Observed result | Current slot `503582908`; new program address returned AccountNotFound; VPS payer balance `0 SOL`; optimized artifact SHA-256 `4affe732ce6bbbeff99bd93e92879a8d31032cc936d61f09e65a57223f1e983f`; rent minimum `4.163568 SOL`. Offline LiteSVM tests passed 81/81. |
| Slot where relevant | `503582908` |
| Conclusion | Devnet source/client/build identity agrees, but the program is not deployed. Wallet transactions remain disabled and the current mainnet-read-only bundle remains live. No Devnet or Mainnet signature/transaction was submitted. User test funding is required before deployment and a full Devnet E2E. |
| Code depending on it | `Anchor.toml`, `programs/tenet/src/lib.rs`, `packages/sdk/idl/tenet.json`, generated SDK, `apps/web/src/config.ts`, SBF deployment/E2E path. |

## Deployed Devnet POOL/EXIT preview — 2026-09-24

| field | observation |
|---|---|
| Timestamp | 2026-09-24T21:49:09Z for deployed UI verification; on-chain E2E completed earlier on 2026-09-24 |
| Network | Solana Devnet; HTTPS preview served by the VPS |
| Source | `solana program show` against `https://api.devnet.solana.com`; `packages/sdk/scripts/devnet-e2e.ts`; `pnpm test`, `pnpm typecheck`, `pnpm check:money`, production Vite build; browser at `https://38.49.209.149/app#top` |
| Request/account | Tenet program `7YWVfv6sDGZkyENbhvHLCiVZMDcJnGgFDZ4cso8BLsbh`; programdata `5KD9kTgCoEv8diYSGddnDcupGBepR3FVEM1BVxLMwJ4V`; clean Circle `6UB4NCMKLZbMAJ2uS9ynmQ8m8TsaCjFDnURQfmpE5rK2`; test USDC mint `8XcK83nbTAtdvfHCFWLCAEHigHDBAGuEachzQss9oCkt` |
| Observed result | Program executable and finalized; data length 819472; binary SHA-256 `4affe732ce6bbbeff99bd93e92879a8d31032cc936d61f09e65a57223f1e983f`; upgrade authority `F5WouUdTmk6n4SaSTZLrE9PCUrArnWdGYwykqPH2jBiK`. E2E contribution was escrowed separately from active Circle funds, finalized and settled; partial redemption claims returned test USDC and processed the zero-balance test asset. Rust/LiteSVM 81/81; packages/proxy/SDK 64/64; web typecheck, money-lint and build passed. Browser confirmed the default Circle and valueless test-assets notice load from chain. |
| Slot where relevant | Deployment slot `503613496`; later read-only executable/authority check returned the same deployed program. |
| Conclusion | Devnet POOL and staged EXIT flows are usable with test assets. The app exposes wallet-signed contribution/exit/Fork controls only on Devnet; Jupiter stock purchases remain unavailable. The Codex browser detected no injected wallet, so no user wallet signature was requested. No Mainnet write occurred. This is not Mainnet readiness or overall security approval. |
| Code depending on it | `apps/web/src/config.ts`, `apps/web/src/App.tsx`, `apps/web/src/wallet.tsx`, `apps/web/src/dashboard.tsx`, `apps/web/src/chain.ts`, `packages/sdk/scripts/devnet-e2e.ts`, program/SDK generated IDL, and `/opt/tenet-preview/dist`. |


## Devnet fixed test-market build and funding gate — 2026-09-25

| field | observation |
|---|---|
| Timestamp | 2026-09-25T02:50:11Z for live mint metadata; program binary comparison and wallet balance/rent read completed before static bundle promotion |
| Network | Solana Devnet; chain observations below were read-only. Program behavior was exercised only in LiteSVM. |
| Source | Public Devnet RPC and Solana CLI; repository candidate /opt/tenet-build-45188cc/target/deploy/tenet.so; live SPA root /opt/tenet-preview/dist |
| Request/account | Program 7YWVfv6sDGZkyENbhvHLCiVZMDcJnGgFDZ4cso8BLsbh; ProgramData 5KD9kTgCoEv8diYSGddnDcupGBepR3FVEM1BVxLMwJ4V; test-USDC mint 8XcK83nbTAtdvfHCFWLCAEHigHDBAGuEachzQss9oCkt; upgrade authority F5WouUdTmk6n4SaSTZLrE9PCUrArnWdGYwykqPH2jBiK |
| Observed result | Test-USDC: classic SPL Token, 6 decimals, raw supply 110000000 (110 tokens), mint authority 9pCJ96uVkHb6wiSvbSpTNL99A3jsieQ9R8w6A9s2o6aE, no freeze authority. Candidate SBF: 1,149,176 bytes, SHA-256 bac5398fc6e020b5c39692555ddb2d68a789cf6fc5367de8ef7f9d5fbc5d2ce2. Deployed SBF dump: 819,472 bytes, SHA-256 4affe732ce6bbbeff99bd93e92879a8d31032cc936d61f09e65a57223f1e983f, last deployed slot 503613496. Devnet rent minimum for 1,149,176 bytes: 5.83846432 SOL; upgrade-authority wallet balance at read: 4.985368466 SOL. |
| Slot where relevant | Deployed program slot 503613496; live mint metadata was read at the latest finalized slot of the CLI request. No transaction slot exists for the local LiteSVM tests. |
| Conclusion | The Devnet test-market program and UI are built, but the exact candidate is not deployed. Browser actions are hash-gated and remain disabled. Test Circle creation still needs the user-authorized program upgrade; Epoch-0 funding needs actual tokens from the test-USDC authority. No matching mint-authority key was found in inspected VPS keypair directories; no faucet, token mint, upgrade, airdrop, or user-wallet transaction was sent. Devnet SOL has no mainnet monetary value. |
| Code depending on it | programs/tenet/src/instructions/test_market.rs, generated IDL/SDK, apps/web/src/dashboard.tsx, apps/web/src/chain.ts (exact SBF-hash preflight), apps/web/src/config.ts, and /opt/tenet-preview/dist. |

LiteSVM validation for this increment: 59 program tests passed, including the new market initialization, account-substitution, vault-delta, and pending-Epoch isolation tests. Package tests passed 51/51, RPC proxy 7/7, SDK client 6/6; TypeScript, production web build, and money-lint passed. These are not live Devnet wallet transactions or external token-faucet verification.

## Candidate status clarification  2026-09-25

| Field | Observation |
|---|---|
| Timestamp | 2026-09-25 (UTC; source observation from VPS session) |
| Network | Solana Devnet |
| Source | VPS build artifact, offline tests, and prior finalized account/RPC reads |
| Request/account | Candidate Tenet program 7pLYmJXsTJW7vWuT9BwYqNCWUDXp8SR1JKmKYNofAECf; deployed program 7YWVfv6sDGZkyENbhvHLCiVZMDcJnGgFDZ4cso8BLsbh |
| Observed result | Candidate absent from Devnet. Candidate artifact 1,216,976 bytes, SHA-256 08fc524d656bfe50b1b9291e40e87314ce437339cee8fdbefb267af84a04a355; estimated buffer rent 6.18288832 SOL. No transaction slot. |
| Conclusion | Candidate is not deployed. Its single fixed-inventory TST-EQ and fixed 1:1 transfer are not a six-instrument on-chain-priced market. No candidate transaction, mint, upgrade, or wallet signature was submitted. |
| Code depending on it | programs/tenet/src/instructions/test_market.rs, generated IDL/SDK, and Devnet-only UI |

The locally passing test suites validate fixture/LiteSVM behavior only. They do not validate public-Devnet execution or authorize publishing this candidate as a complete app.
