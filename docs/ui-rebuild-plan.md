# Tenet UI rebuild plan

This plan applies the supplied final UI/UX brief to the existing Tenet app. It is an incremental consumer-interface pass, not a product or financial-logic redesign. The public landing page remains `/`; the connected Circle workspace remains `/app`.

## Current inspection

- The public site and Circle workspace are already separate routes.
- The current on-chain devnet Circle contains no held stock tokens or active USDC; its configured test asset is not evidence of a public-equity product.
- The workspace already has focused Overview, Explore, Portfolio, Prices & value, Mandate, Add money, Exit and Fork surfaces, with explicit unavailable/test-network states.
- The repository contains `apps/web/public/tenet-community-hero.png` as the only image asset. No bundled stock-logo or additional supplied design image files were found in the repository.
- Existing flows, account fetching and transaction code are retained. This work must not invent prices, AUM, returns, members, tickers or successful transaction states.

## Screen plan

| Area | Keep | Rebuild/refine |
|---|---|---|
| LANDING | Separate public route, Tenet thesis, community image, real Circle/demo link | Make the hero story-led, add the POOL → EXECUTE → VALUE → EXIT → FORK narrative, editorial Mandate panel, verified asset-category treatment, contribution / exit / fork explanations and a concise final CTA. Keep it to the requested hierarchy; omit unsupported live tickers and prices. |
| DASHBOARD | Existing live account state, test-network notice, actions and honest unavailable states | Keep first viewport to Circle Value, Your Position and Mandate Status, actual held assets, and the next action. Move diagnostics and long rule detail behind disclosure. |
| EXPLORE | Current on-chain/demo-aware directory state | One clear search/filter surface; show the actual Circle or a candid unavailable/empty state, never invented Circle performance or member counts. |
| CIRCLE DETAIL | Existing Circle route/context and wallet operations | Present Circle identity, membership/rule context, actual holdings and primary actions before secondary details. |
| MANDATE | On-chain constraints, lineage, membership and Epoch configuration | Present as a readable constitution with allocation/risk limits and lineage; distinguish permission from holdings. Keep fork/amendment capabilities truthful. |
| CONTRIBUTE | Existing contribution and Epoch transactions | Friendly USDC amount flow, clear test-network status and a plain-language explanation that funds enter an Epoch before Mandate-constrained investment. |
| AUTOMATION | Existing explicit “not available” state | Keep optional and clearly unavailable until a real, revocable authorization path exists; do not simulate recurring, percentage or round-up contributions. |
| EXIT | Existing in-kind redemption path and external-token caveats | Calm claim preview and status; never imply a price/oracle/governance permission gate at Tenet or promise external issuer transfer behavior. |
| FORK | Existing resumable child Mandate/Circle flow | Show original versus independent child constitution, distinguish Mandate from Circle, and only claim completion after accounts are fetched and verified. |
| MOBILE | Responsive app, safe-area navigation, large actions | Independently prioritize Circle, value/position, held assets and Add money/Exit; no shrunken desktop grid or horizontal overflow. |
| MOTION | Existing reduced-motion support and restrained transitions | Add CSS-only editorial reveals/marquees/flow transitions where they clarify the story; no fake human animation, market movement or transaction-state animation. Respect reduced-motion settings. |
| THEME SYSTEM | Persisted Light / Dark / System theme and identical information hierarchy | Align colors to Graphite, Warm Ivory, Peach, Sage and Market Blue; remove legacy purple dominance, keep semantic warning/loss colors, avoid theme flash. |

## Incremental implementation order

1. Design tokens and theme parity; remove conflicting legacy overrides where safe.
2. Refine the separate public landing page using the existing community visual and product-true copy.
3. Add the motion rails and scroll story using existing CSS/runtime only; keep unavailable product data out.
4. Recheck the Circle Overview and screen hierarchy without changing financial logic.
5. Refine Explore, Circle context, Mandate, Contribute, Exit and Fork in their existing data/transaction surfaces.
6. Check responsive layouts at the brief's breakpoints and verify reduced-motion behavior.
7. Run the web build/type checks and inspect the updated local browser preview. Deployment remains separate; no VPS changes are included in this plan.

## Acceptance checks

- Public landing `/` and workspace `/app` remain distinct and directly navigable.
- Product wording preserves Tenet terminology and never claims direct private-company shareholder ownership.
- Live data is sourced from the existing app state; missing prices, holdings and directory data remain explicitly unavailable.
- Dashboard asks no more than the four intended first-view questions: value, position, mandate status and next action.
- Primary consumer flows remain connected to their existing program/wallet code; UI success is never shown before chain confirmation.
- Light, dark and system themes preserve contrast and layout; mobile widths have no horizontal overflow.
- `prefers-reduced-motion` suppresses nonessential animation.
