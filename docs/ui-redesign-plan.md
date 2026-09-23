# Tenet UI implementation plan

This plan records the product-facing UI work requested for Tenet. It preserves the existing POOL → EXECUTE → VALUE → EXIT → FORK product model and treats accuracy of live financial state as a hard requirement.

## Keep

- Tenet, Mandate, Circle, Member, Epoch, and Fork terminology.
- The current protocol flows and their explicit devnet/test-network warnings.
- The Circle dashboard, Explore, Portfolio, Prices & Value, Mandate, Contribute, Exit, Fork, and public-site surfaces.
- Honest empty, stale, unsupported, and unavailable states. Never replace them with illustrative values presented as live.
- Both themes and the current connected-wallet/network indicators.

## Simplify

- Make the Circle's actual position and next useful action the first things visible on the dashboard.
- Separate rules (what the Mandate permits) from holdings (what the Circle actually has).
- Explain fork progress as distinct on-chain steps and distinguish a Mandate from the independent Circle it configures.
- Reduce repeated labels and technical addresses; keep addresses available in disclosure/details controls.
- On narrow screens, prioritize Circle overview, contribute, holdings, and exit; move secondary detail below the primary actions.

## Remove

- Any success wording before the corresponding transaction is confirmed and the resulting account is fetched.
- Generic "Unexpected error" when a specific operation or safe recovery instruction can be shown.
- Fake live tickers, prices, performance, member counts, or market claims.
- Any claim that a forked Mandate alone is already a created Circle.

## Animate

- Use restrained transitions for navigation, loading-to-result changes, expandable details, and transaction progress.
- Respect reduced-motion preferences; animations must not hide transaction state or delay actions.
- Do not animate fabricated market movement or imply that a pending transaction is confirmed.

## Rebuild / refine

- Repair the resumable Fork flow so it copies rules, activates the child Mandate, creates a separate Circle and its vault accounts, then confirms completion from chain state.
- Give each multi-transaction setup step an explicit label, progress state, and actionable error. Previously confirmed steps must be safely resumable.
- Keep a clear distinction between the child Mandate address and child Circle address.
- Verify the dashboard, Explore, Circle details, contribution, exit, and Fork screens at desktop and mobile widths using real app state and honest unavailable states.

## Delivery order

1. Design tokens: warm ivory/graphite, Peach, Sage, Market Blue, serif headline and sans UI. **Implemented locally.**
2. Public landing: separate `/` route with the repository community image, full product story, asset-category rail, verified Mandate preview, market-data availability, contribution, exit and Fork explanations. **Implemented locally.** The character art is intentionally a still image; no fake CSS human animation or unsupported live asset/price data is used.
3. Consumer workspace: `/app` now has focused Overview, Explore, Portfolio, Prices, Mandate, Contribute, Exit, and Fork screens. The first viewport shows only Circle value, member position, Mandate status, and clear actions. **Implemented locally.**
4. Mobile: five primary actions in the bottom bar at phone and tablet widths; Mandate/Fork are reachable from Overview. **Narrow browser viewport verified for Overview, Portfolio and Exit; tablet remains to be visually checked.**
5. Verify read-only routes, light/dark parity, browser history, wallet states, and on-chain results. **Read-only routes, themes and browser history checked; signed wallet transactions and program-level E2E remain open.**

The existing devnet Circle has zero holdings and only one permitted test token. The UI must keep showing that state until real assets and verified pricing are connected; a visual redesign cannot substitute for the remaining EXECUTE and VALUE integrations.

## FINAL UI/UX BUILD PROMPT — 2026-09-23

- Added `docs/ui-rebuild-plan.md` before this UI pass, mapping each requested surface and its truthful-data constraints.
- Expanded `/` into the requested landing hierarchy: hero, category rail, mechanics, scroll story, Mandate, asset universe, market intelligence, contribution rules/automation state, exit, Fork, and final CTA.
- Reused `apps/web/public/tenet-community-hero.png`; verified that it contains the existing four-member editorial illustration. Repository search found no other image/reference assets.
- Added the asset universe from the current Circle's on-chain Mandate registry, clearly distinguishing permitted assets from actual holdings and labeling devnet registry entries as test assets. No stock ticker, market quote, return, or Circle example was fabricated.
- Added a shared persisted Light / Dark / System selector to public landing and the app shell. Reduced-motion preferences suppress marquee and entrance motion.
- Reduced desktop sidebar choices to Overview, Explore, Holdings, Prices & value, and Mandate; contribution, Exit, and Fork remain prominent Circle actions.
- Local mobile browser inspection: hero and public navigation render at the available 375px-class viewport; asset-universe content is legible and uses verified/test labels. Anchor offset fix is included. Desktop and tablet visual QA remain to be performed.
- Local `tsc --noEmit`, Vite production build, `money-lint`, and `git diff --check` pass. `pnpm --filter @tenet/web typecheck` was blocked because pnpm attempted to purge/install the shared modules directory without a TTY; direct local executables were used instead.
- No financial program or execution logic was changed. No wallet transaction or deployment was performed. VPS remains unchanged.

