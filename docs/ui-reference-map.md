# Tenet UI reference map

The reference screenshots have been removed from the repository. This text map preserves the intended visual direction without retaining the image files. Illustrative financial values, member counts, performance, prices, and dates from the screenshots must not be copied into production state.

| THEME | SCREEN | KEY DESIGN DETAILS | IMPLEMENTATION TARGET |
|---|---|---|---|
| Light | Landing page | Warm Ivory background, Graphite hero, editorial serif headline, Peach CTAs, people → Circle → Mandate → Portfolio story, mechanics strip, contribution and fork cards | Marketing landing composition and responsive hero/sections using live or unavailable product data |
| Light | Dashboard / Circle overview | Warm editorial shell, left sidebar, Circle header, KPI cards, holdings table, allocation chart, Market vs Mark, Underlying vs Token, supply and corporate-action cards, contribution panel | Authenticated Circle workspace with real data and explicit unavailable states |
| Light | Explore / Mandate / Circle / Fork / Exit | Shared navigation, light cards, restrained charts, Mandate constitution, Fork comparison, and in-kind exit preview | Reusable screen primitives and supported Tenet flows; omit unsupported tabs/data |
| Light | Mobile product flow | Home, Explore, Circle detail, Contribute, Automate Contributions, and Fork Mandate; bottom navigation and large touch targets | Mobile-first responsive re-composition, not a shrunken desktop layout |
| Light | Design system | Graphite, Warm Ivory, Peach, Sage, Market Blue, semantic status colors, Instrument Serif/Inter hierarchy, iconography, spacing, cards, buttons and navigation | Central CSS tokens and reusable components shared by both themes |
| Dark | Landing page | Graphite foundation, Peach headline emphasis, people contributing into a Tenet Circle, Mandate rule card, asset cards, restrained glow | Same structure as light mode with a distinct dark surface treatment; applied to public landing |
| Dark | Dashboard / Circle overview | Graphite sidebar and surfaces, focused Circle value/position/rules summary, with Portfolio, Prices, Contribute, Exit and Fork on separate screens | Dark authenticated Circle workspace using the same component structure as light mode |
| Dark | Explore Circles | Large editorial Explore hero, filter pills, search, dark Circle cards, asset/theme tags, restrained positive states | Explore screen with real Circle data; omit unavailable performance rather than fabricate it |
| Dark | Circle detail | Circle hero, member/community context, overview tabs, value chart, holdings, contribution options, activity, in-kind exit card | Circle detail with only supported Tenet tabs and real state |
| Dark | Mandate detail / Fork Mandate | Mandate constitution hierarchy, version/status, eligible assets, allocation bars, risk limits, amendment policy, lineage, prominent Fork panel | Mandate as the central product object; live rules and real fork action |
| Dark | Mobile product flow | Home/Circle overview, Contribute, Exit Circle, and Fork Mandate; large CTA hierarchy and bottom navigation | Mobile Circle flows with raw data hidden behind consumer-friendly quantities and explicit claim states |

## Shared visual conclusions

- The product uses one information architecture in both themes: landing → Explore → Circle → Mandate → Contribute / Exit / Fork.
- Light mode uses Warm Ivory and cream cards with Graphite typography, Peach primary actions, and restrained elevation.
- Dark mode uses Graphite and dark surfaces, with Peach reserved for emphasis and primary actions rather than neon decoration.
- Typography combines a clean sans-serif for UI and a restrained editorial serif for major headings.
- The visual system favors an 8px spacing rhythm, restrained radii, subtle borders, and semantic market/positive/warning/negative colors.
- Screenshots contain illustrative values. Production must continue using the existing Tenet data layer and show unavailable states when verified data is absent.

## Current implementation status

The public landing and Circle workspace are separate routes. The workspace now presents focused Overview, Explore, Portfolio, Prices, Mandate, Contribute, Exit and Fork screens. Mobile and tablet navigation is specified in CSS; device-size browser validation is still required. No illustrative stock holdings or prices from the reference screenshots are used as live data.

## Final UI build update — 2026-09-23

- Repository image inventory contains only `apps/web/public/tenet-community-hero.png`; this is the four-person community illustration used by the landing hero. No other supplied design screenshots or issuer logos are currently present in the repository.
- The public landing now explains the problem, the five product mechanics, Epoch/Mandate separation, current Mandate limits, asset categories, market-data boundaries, contribution automation state, in-kind exit and independent Forks.
- Actual permitted asset metadata is shown from the loaded Circle registry and is distinguished from non-zero vault holdings. Devnet assets are labeled test-only; no sample stock symbols, quotes, AUM, returns or performance are shown as live data.
- Both the public page and Circle workspace use the same persisted System / Light / Dark setting. Marquees and entrance effects respect `prefers-reduced-motion`.
- The public landing has been inspected at the currently available phone-sized viewport. Desktop/tablet viewport verification remains outstanding; the current preview is local at port 5177 and has not been deployed to the VPS.
