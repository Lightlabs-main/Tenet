# Tenet UI reference map

The reference screenshots have been removed from the repository. This text map preserves the intended visual direction without retaining the image files. Illustrative financial values, member counts, performance, prices, and dates from the screenshots must not be copied into production state.

| THEME | SCREEN | KEY DESIGN DETAILS | IMPLEMENTATION TARGET |
|---|---|---|---|
| Light | Landing page | Warm Mist background, deep plum hero, editorial serif headline, Peach CTAs, people → Circle → Mandate → Portfolio story, mechanics strip, contribution and fork cards | Marketing landing composition and responsive hero/sections using live or unavailable product data |
| Light | Dashboard / Circle overview | Warm editorial shell, left sidebar, Circle header, KPI cards, holdings table, allocation chart, Market vs Mark, Underlying vs Token, supply and corporate-action cards, contribution panel | Authenticated Circle workspace with real data and explicit unavailable states |
| Light | Explore / Mandate / Circle / Fork / Exit | Shared navigation, light cards, restrained charts, Mandate constitution, Fork comparison, and in-kind exit preview | Reusable screen primitives and supported Tenet flows; omit unsupported tabs/data |
| Light | Mobile product flow | Home, Explore, Circle detail, Contribute, Automate Contributions, and Fork Mandate; bottom navigation and large touch targets | Mobile-first responsive re-composition, not a shrunken desktop layout |
| Light | Design system | Inkberry, Deep Plum, Peach, Warm Mist, semantic status colors, Satoshi/Tiempos-style hierarchy, iconography, 8px spacing, cards, buttons, chips, KPI tiles, charts, navigation | Central CSS tokens and reusable components shared by both themes |
| Dark | Landing page | Deep Inkberry foundation, Peach headline emphasis, people contributing into a Tenet Circle, Mandate rule card, asset cards, restrained glow | Same structure as light mode with a distinct dark surface treatment; applied to public landing |
| Dark | Dashboard / Circle overview | Deep plum sidebar and cards, contribution panel, portfolio allocation, holdings, Market vs Mark, Underlying vs Token, supply consumption, corporate action | Dark authenticated Circle workspace using the same component structure as light mode |
| Dark | Explore Circles | Large editorial Explore hero, filter pills, search, dark Circle cards, asset/theme tags, restrained positive states | Explore screen with real Circle data; omit unavailable performance rather than fabricate it |
| Dark | Circle detail | Circle hero, member/community context, overview tabs, value chart, holdings, contribution options, activity, in-kind exit card | Circle detail with only supported Tenet tabs and real state |
| Dark | Mandate detail / Fork Mandate | Mandate constitution hierarchy, version/status, eligible assets, allocation bars, risk limits, amendment policy, lineage, prominent Fork panel | Mandate as the central product object; live rules and real fork action |
| Dark | Mobile product flow | Home/Circle overview, Contribute, Exit Circle, and Fork Mandate; large CTA hierarchy and bottom navigation | Mobile Circle flows with raw data hidden behind consumer-friendly quantities and explicit claim states |

## Shared visual conclusions

- The product uses one information architecture in both themes: landing → Explore → Circle → Mandate → Contribute / Exit / Fork.
- Light mode uses Warm Mist and white cards with Inkberry typography, Peach primary actions, and restrained elevation.
- Dark mode uses Inkberry and deep plum tonal surfaces, with Peach reserved for emphasis and primary actions rather than neon decoration.
- Typography combines a clean sans-serif for UI and a restrained editorial serif for major headings.
- The visual system favors an 8px spacing rhythm, restrained radii, subtle borders, and semantic market/positive/warning/negative colors.
- Screenshots contain illustrative values. Production must continue using the existing Tenet data layer and show unavailable states when verified data is absent.

## Next implementation audit

Before changing components, compare the current app against this map for theme switching, route/screen coverage, responsive behavior, and hardcoded financial values. The first implementation pass should establish shared tokens and shell primitives, then refine the Circle and Mandate surfaces without changing protocol logic.
