# Tenet

Collectively owned portfolios of tokenized stocks, governed by an on-chain investment constitution.

**Don't copy someone's trades. Fork their investment constitution.**

---

> **Status: complete Devnet build — POOL → EXECUTE → VALUE → EXIT → FORK.**
> The whole loop runs against real on-chain state with valueless test assets: TUSDC from an
> on-chain faucet, six DEVNET TEST INSTRUMENTS, a devnet price feed and a devnet market standing in
> for Pyth and Jupiter. **Live on Devnet** (addresses in docs/devnet.md). Nothing is deployed on mainnet; there are no production users or assets.
> Start here: **[docs/devnet.md](docs/devnet.md)** (setup, architecture, demo script).

---

## Problem

Historically, direct access to high-demand private-company investments has been constrained by accreditation requirements, large minimums and limited distribution. Tokenization is beginning to improve individual access to both public and private-market economic exposure.

**But individual access does not solve collective investing.**

Millions of people already save and invest collectively — through investment clubs, stokvels, savings groups and informal communities. Those structures still commonly depend on bank accounts, spreadsheets, group chats and trusted individuals. Someone holds the account. Someone decides what to buy. Everyone else finds out afterwards.

Tenet moves that behaviour on-chain. Instead of giving pooled money to one person and trusting them to follow an informal agreement, members place capital under an explicit **Mandate** that can be inspected and enforced.

The new primitive is **collective capital governed by programmable investment rules.**

The existing on-chain answers do not cover this. Copy trading reproduces the discretion. DAO treasuries and vaults replace it with governance that still cannot be exited cleanly. What is defensible here is the combination: retail-sized collective capital, public tokenized equities and eligible pre-IPO economic exposure, enforceable on-chain Mandates, unconditional protocol-level exit, and forkable investment constitutions.

Ten people contributing $5 each can collectively build $50 of SpaceX economic exposure — under rules none of them can quietly override.

## Product

Tenet lets a group pool USDC under an explicit **Mandate** — an investment constitution that nobody can secretly override. The Mandate defines what capital can do: permitted assets, target allocations, exposure caps, how much of a token's supply the group may consume, how much execution impact is tolerable, and how the rules may be amended.

Members do not vote on individual trades. The Mandate governs execution. If members disagree with the strategy they can stay, propose an amendment, **exit**, or **fork**.

The strongest governance feature is exit.

## Why Solana

Tokenized public equities and tokenized pre-IPO exposure both exist on Solana today with real, routable liquidity. Token-2022 gives issuers the extension machinery these instruments need — and gives Tenet the obligation to handle it correctly. Execution costs are low enough that per-asset in-kind redemption is practical rather than theoretical.

## The name

A tenet is a principle held in common. Tenet names both halves of the product cleanly — the principle, and the people bound by it.

## Mandates

A Mandate is rules, not money. It specifies permitted assets and target weights, maximum single-asset exposure, maximum pre-IPO allocation, maximum issuer exposure, maximum supply consumption, maximum execution impact, minimum contribution, maximum pool size, membership policy, epoch duration and amendment rules.

## Circles

A Circle is one pooled portfolio governed by one Mandate. Circle assets live in program-controlled vaults. No creator, operator, backend, multisig or executor can withdraw them.

## Five mechanics

```
POOL  →  EXECUTE  →  VALUE  →  EXIT  →  FORK
```

Everything else exists to strengthen this loop.

## Architecture

See [docs/architecture.md](docs/architecture.md) for the account graph, PDA seeds, authority model, share accounting, epoch lifecycle, redemption design and its dilution proof. The instruction surface — signers, account mutability, constraints, failure branches — is in [docs/instructions.md](docs/instructions.md).

## Public equities

Valued from verified Pyth feeds for the tokenized instrument. Where an underlying-equity feed also exists, both are read and the divergence between them is surfaced as a product feature. Where a paired feed does not exist, divergence is not displayed — it is never approximated.

## PreStocks

PreStocks provides **economic exposure** to private companies. Tenet never says "own OpenAI" or "own SpaceX", and never implies shareholder rights.

Two valuations are shown side by side and never conflated: the **executable market price** and the **issuer reference mark**. As of 2026-09-20 these differ materially across the live universe — see [docs/verification.md](docs/verification.md) V-001 and V-005.

## Pyth

Price, exponent, confidence and publish time are all read and validated. An explicit freshness and confidence policy gates every price-dependent action. Stale or low-confidence pricing blocks new share issuance and execution. **It never blocks in-kind exit.**

## Jupiter

Jupiter is Tenet's execution infrastructure. Routes are validated against the Mandate, and every Mandate cap is enforced against **actual post-transaction vault balances** rather than any quoted figure. A client claiming a favourable price impact changes nothing.

## Token-2022

Both classic SPL Token and Token-2022 are supported, with the token program read from the mint rather than assumed. Transfer fees, ScaledUiAmount, permanent delegate, freeze, pause and transfer hooks are all read live per mint.

**Raw token units are canonical.** Ownership, custody and redemption accounting use integer base units only. The ScaledUiAmount multiplier is applied at the display and valuation boundary and never enters ownership arithmetic — which is what makes a multiplier change unable to alter anyone's pro-rata claim.

## Accounting

Shares are `u64` with 6 decimal places; at inception one share equals one micro-USDC contributed. All intermediates are checked `u128`. No floating-point arithmetic appears in share issuance, redemption, raw balances, supply ratios or contribution accounting. Every division floors toward the Circle, so rounding never advantages whoever triggered it. Full derivations live in [docs/accounting.md](docs/accounting.md).

## Exit

Exit is **in kind**. A member's entitlement is their share fraction of each raw vault balance, computed with integer arithmetic. No price, oracle, approval or vote is required to establish it.

Redemption is staged — the entitlement is fixed, reserved per asset, then claimed per asset — so a problem with one external token cannot trap the others. The exiting member bears their own transfer costs; remaining members never subsidise someone else's exit.

**What Tenet can and cannot promise.** Tenet does not impose a permission gate on exit. Tenet **cannot** promise that every external token is always transferable: a Token-2022 issuer may hold pause, freeze, permanent-delegate and transfer-hook authority entirely outside Tenet's control. See Trust assumptions.

## Forking

`fork_mandate` creates a new Mandate with the **forker's own rules** — validated exactly like
`create_mandate` — and records `forked_from`. `fork_mandate_asset` copies each asset in the
parent's order with a target the forker chooses (it must fit the child's caps), then the child is
finalized independently. Example: lower the pre-IPO cap from 30% to 15%; the child's own Circle is
then held to 15% on every buy. A fork never copies Circle assets, members, money or trade history,
and the parent Mandate is read-only throughout.

Rules are portable. Capital is independent.

## Security

Twenty named invariants (INV-001 … INV-020) define share reconciliation, escrow separation, proportional entitlement, rounding direction, authority limits, execution routing, Mandate caps, oracle safety, transfer mechanics, fork independence, account substitution, scaled-UI neutrality and replay. Implemented paths have tests; design-only invariants remain release gates until their instructions exist. See [docs/threat-model.md](docs/threat-model.md) and [REVIEW.md](REVIEW.md).

Adversarial review is a required gate, not a formality: no security-sensitive financial path is complete before it.

## Trust assumptions

Stated plainly, because pretending they do not exist would be the dishonest part:

1. **Token-2022 issuer control.** Verified on mainnet: a single issuer key holds permanent-delegate, freeze, pause, transfer-hook and transfer-fee authority over the PreStocks mints. That key can seize, freeze or pause tokens Tenet holds. Tenet cannot prevent this and does not claim to.
2. **Program upgrade authority.** Until it is burned or explicitly disclosed, whoever holds it can replace the program. Tenet is not production-ready while this is unresolved.
3. **Asset classification.** Pre-IPO and issuer caps depend on registry metadata from a named authority. That authority has **no custody power** — it can mislabel, never steal.
4. **Price attestation**, if Phase 0 proves it necessary for PreStocks. It can only narrow what a Mandate already permits; it can never widen a cap, admit an outside asset, or move funds.
5. **Third-party availability.** Pyth's Hermes endpoint now requires an API key. Tenet degrades to `Unavailable` and pauses issuance — it never substitutes a guessed price.

## Corporate actions

Tracked as financial state: status, conversion ratio, effective date, deadline, replacement asset, source and last-verified time. Verified against official sources, never hardcoded. Material conversion and expiry events block unsafe new purchases and are surfaced prominently. They never block legitimate in-kind exit.

## Verification

Every external assumption Tenet's code depends on is recorded in [docs/verification.md](docs/verification.md) with timestamp, network, source, observed result and the code permitted to rely on it. The plan is [docs/verification-plan.md](docs/verification-plan.md).

```bash
pnpm verify
```

Read-only by default. Mainnet writes require `ALLOW_MAINNET_WRITES=true` and an explicitly supplied funded signer.

## Setup

Toolchain: Anchor 1.2.0, Solana CLI 4.1.x, Rust 1.98, Node 22, pnpm (see [docs/dependencies.md](docs/dependencies.md)). On Windows build in WSL or on Linux.

```bash
pnpm install
anchor build                          # programs/tenet + programs/tenet-devnet
cargo test -p tenet-program-tests     # LiteSVM, against the built .so files
pnpm test                             # domain + SDK
pnpm --filter @tenet/web dev          # web app on http://localhost:5173/app
```

Devnet deployment, `pnpm devnet:setup`, price control and the end-to-end script: [docs/devnet.md](docs/devnet.md).

## Demo

1. Connect a wallet on **Devnet** → **Get 1,000 TUSDC** (faucet, signed by you).
2. **Create Mandate & Circle** (Frontier Technology: TNVDA, TAAPL, TSPY, TSPACEX, TOPENAI).
3. Contribute → close the window → shares issued.
4. **Execute epoch** — each asset bought to its Mandate target through the devnet market; the program checks real vault deltas, price impact, supply and target weight.
5. **Prices & value** — NAV, weight vs target, market vs mark, token vs underlying, compliance. Labelled DEVNET TEST DATA.
6. **Exit** 25 / 50 / 100% in kind to your wallet.
7. **Fork** with a lower pre-IPO cap → independent Circle, lineage shown.

A guided checklist on the Circle overview ticks each step from chain state. Full video script in [docs/devnet.md](docs/devnet.md#demo-video-script--5-minutes).

## Testing

Unit, integration, property/fuzz and invariant suites, plus adversarial tests contributed by review. CI runs `cargo fmt`, clippy, Anchor build, program tests, TypeScript lint and typecheck, all test suites, and the frontend build. `pnpm verify` runs before any deployment.

## Deployment

Devnet: see [docs/devnet.md](docs/devnet.md). Mainnet: not deployed; upgrade-authority policy must be resolved first (Trust assumptions #2).

## Known limitations

- Devnet prices are a **pricing simulation** set by the devnet operator, and the devnet market is a fixed-price inventory venue. They exercise every on-chain check but are not market data.
- Mainnet execution (Jupiter routes) and live Pyth / PreStocks price adapters are defined as interfaces (`apps/web/src/adapters.ts`) but not wired in this build.
- The execution target check uses the NAV fixed at the most recent epoch settlement; prices moving afterwards can leave an asset above target (shown as drift), and further buys of it are refused.
- Tenet cannot guarantee transferability of assets whose issuers retain pause, freeze or permanent-delegate authority.
- `contributed_basis_usdc` is a contribution record, not tax cost basis under any jurisdiction's methodology.
- Nothing here constitutes investment advice.

## Future work

Amendments · automatic contributions · richer corporate-action automation · fork visual diff · discovery filters. The safe Fork path and amendment governance are now present in the rebuilt program/IDL; automatic contributions remain gated until a real revocable authorization path is verified.

## Third-party data

[`prestocks-pulse`](https://github.com/aralroca/prestocks-pulse) (MIT, aralroca) was reviewed as a potential analytics source. Its methodology independently matches our own findings. Tenet reads issuer data, Jupiter and Solana RPC **directly**; if `prestocks-pulse` is later used for historical analytics it will be credited here and never treated as issuer truth.
