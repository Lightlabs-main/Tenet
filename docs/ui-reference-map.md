# Tenet UI reference map

The repository contains 18 PNG files representing 11 unique visual references. Seven files are byte-for-byte duplicate copies; they are listed below so the asset inventory remains complete. The references are visual specifications only. Illustrative financial values, member counts, performance, prices, and dates must not be copied into production state.

| IMAGE | THEME | SCREEN | KEY DESIGN DETAILS | IMPLEMENTATION TARGET | STATUS |
|---|---|---|---|---|---|
| `ChatGPT Image Sep 22, 2026, 06_32_51 PM (1).png` | Light | Landing page | Warm Mist background, deep plum hero, editorial serif headline, Peach CTAs, people → Circle → Mandate → Portfolio story, mechanics strip, contribution and fork cards | Marketing landing composition and responsive hero/sections using live or unavailable product data | Mapped; implementation audit pending |
| `ChatGPT Image Sep 22, 2026, 06_32_51 PM (2).png` | Light | Dashboard / Circle overview | Warm editorial shell, left sidebar, Circle header, KPI cards, holdings table, allocation chart, Market vs Mark, Underlying vs Token, supply and corporate-action cards, contribution panel | Authenticated Circle workspace with real data and explicit unavailable states | Mapped; implementation audit pending |
| `ChatGPT Image Sep 22, 2026, 06_32_51 PM (3).png` | Light | Explore / Mandate detail / Circle detail / Fork / Exit flow | Product journey composite showing shared navigation, light cards, restrained charts, Mandate constitution, Fork comparison, and in-kind exit preview | Reusable screen primitives and supported Tenet flows; omit unsupported tabs/data | Mapped; implementation audit pending |
| `ChatGPT Image Sep 22, 2026, 06_32_51 PM (4).png` | Light | Mobile product flow | iPhone compositions for Home, Explore, Circle detail, Contribute, Automate Contributions, and Fork Mandate; bottom navigation and large touch targets | Mobile-first responsive re-composition, not a shrunken desktop layout | Mapped; implementation audit pending |
| `ChatGPT Image Sep 22, 2026, 06_32_51 PM (5).png` | Light | Design system / component reference | Inkberry, Deep Plum, Peach, Warm Mist, semantic status colors, Satoshi/Tiempos-style hierarchy, iconography, 8px spacing, cards, buttons, chips, KPI tiles, charts, navigation | Central CSS tokens and reusable components shared by both themes | Mapped; implementation audit pending |
| `ChatGPT Image Sep 22, 2026, 06_33_18 PM (1).png` | Dark | Landing page | Deep Inkberry foundation, Peach headline emphasis, people contributing into a Tenet Circle, Mandate rule card, asset cards, restrained glow | Dark landing page with the same structure as light mode and different surface treatment | Mapped; implementation audit pending |
| `ChatGPT Image Sep 22, 2026, 06_33_20 PM (1).png` | Dark | Landing page duplicate | Exact duplicate of `06_33_18 PM (1).png` | No separate implementation; retain one canonical reference | Mapped; duplicate |
| `ChatGPT Image Sep 22, 2026, 06_33_20 PM (2).png` | Dark | Dashboard / Circle overview | Deep plum sidebar and cards, contribution panel, portfolio allocation, holdings, Market vs Mark, Underlying vs Token, supply consumption, corporate action | Dark authenticated Circle workspace using the same component structure as light mode | Mapped; implementation audit pending |
| `ChatGPT Image Sep 22, 2026, 06_33_20 PM (2) (1).png` | Dark | Dashboard / Circle overview duplicate | Exact duplicate of `06_33_20 PM (2).png` | No separate implementation; retain one canonical reference | Mapped; duplicate |
| `ChatGPT Image Sep 22, 2026, 06_33_21 PM (3).png` | Dark | Explore Circles | Large editorial Explore hero, filter pills, search, dark Circle cards, asset/theme tags, restrained positive states | Explore screen with real Circle data; omit unavailable performance rather than fabricate it | Mapped; implementation audit pending |
| `ChatGPT Image Sep 22, 2026, 06_33_21 PM (3) (1).png` | Dark | Explore Circles duplicate | Exact duplicate of `06_33_21 PM (3).png` | No separate implementation; retain one canonical reference | Mapped; duplicate |
| `ChatGPT Image Sep 22, 2026, 06_33_21 PM (4).png` | Dark | Circle detail | Circle hero, member/community context, overview tabs, value chart, holdings, contribution options, activity, in-kind exit card | Circle detail with only supported Tenet tabs and real state | Mapped; implementation audit pending |
| `ChatGPT Image Sep 22, 2026, 06_33_21 PM (4) (1).png` | Dark | Circle detail duplicate | Exact duplicate of `06_33_21 PM (4).png` | No separate implementation; retain one canonical reference | Mapped; duplicate |
| `ChatGPT Image Sep 22, 2026, 06_33_22 PM (5).png` | Dark | Mandate detail / Fork Mandate | Mandate constitution hierarchy, version/status, eligible assets, allocation bars, risk limits, amendment policy, lineage, prominent Fork panel | Mandate as the central product object; live rules and real fork action | Mapped; implementation audit pending |
| `ChatGPT Image Sep 22, 2026, 06_33_22 PM (5) (1).png` | Dark | Mandate detail / Fork Mandate duplicate | Exact duplicate of `06_33_22 PM (5).png` | No separate implementation; retain one canonical reference | Mapped; duplicate |
| `ChatGPT Image Sep 22, 2026, 06_33_22 PM (6).png` | Dark | Mobile product flow | iPhone compositions for Home/Circle overview, Contribute, Exit Circle, and Fork Mandate; dark theme, large CTA hierarchy, bottom navigation | Mobile Circle flows with raw data hidden behind consumer-friendly quantities and explicit claim states | Mapped; implementation audit pending |
| `ChatGPT Image Sep 22, 2026, 06_33_22 PM (6) (1).png` | Dark | Mobile product flow duplicate | Exact duplicate of `06_33_22 PM (6).png` | No separate implementation; retain one canonical reference | Mapped; duplicate |

## Shared visual conclusions

- The product uses one information architecture in both themes: landing → Explore → Circle → Mandate → Contribute / Exit / Fork.
- Light mode uses Warm Mist and white cards with Inkberry typography, Peach primary actions, and restrained elevation.
- Dark mode uses Inkberry and deep plum tonal surfaces, with Peach reserved for emphasis and primary actions rather than neon decoration.
- Typography combines a clean sans-serif for UI and a restrained editorial serif for major headings.
- The visual system favors an 8px spacing rhythm, restrained radii, subtle borders, and semantic market/positive/warning/negative colors.
- Screenshots contain illustrative values. Production must continue using the existing Tenet data layer and show unavailable states when verified data is absent.

## Next implementation audit

Before changing components, compare the current app against this map for theme switching, route/screen coverage, responsive behavior, and hardcoded financial values. The first implementation pass should establish shared tokens and shell primitives, then refine the Circle and Mandate surfaces without changing protocol logic.
