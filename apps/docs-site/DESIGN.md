# Bridge: design notes for the docs app

Bridge is the web side of the DS Bridge Figma plugin: "Your design system, one source of truth: Figma for
designers, Git for everyone, docs for humans and agents." This app is where a team reads the system, checks its
health and plays with it. Owner: Florian Gouloubi (Senior Product Designer).

The app has two visual layers that must never blur:

1. **The Bridge chrome** (navigation, dashboards, charts, cards): its own brand, defined in
   `src/brand/tokens.ts` and emitted as `--br-*` CSS variables.
2. **The design system being documented** (`@bridge-ds/tokens`, `@bridge-ds/react`): only ever shown inside
   *preview surfaces* (stages, the theme playground, do/don't cards). Its indigo brand is the client's color, not ours.

## Subject and mode

- Audience: designers and product people first, engineers and AI agents second.
- Mode: mostly **Operate** (dashboard, token explorer, playground) and **Read** (component guidance, governance,
  changelog). Only the home hero is allowed to persuade.
- The subject is a bridge between two banks (Figma and Git). Visual vocabulary comes from bridge engineering:
  pillars, a suspended arc, cables, rivets, fog, and the paint every bridge engineer knows: International Orange.

## Palette (chrome)

| Name | Light | Dark | Role |
| --- | --- | --- | --- |
| Fog | `#F2F3F1` | `#0F141C` (Night span) | Page canvas. Cool grey with a hint of green, never cream. |
| Deck | `#FFFFFF` | `#161D28` | Cards, panels, drawers. |
| Steel | `#18202E` | `#EDEFF2` | Ink: text, primary buttons, the logo pillars. |
| Slate | `#5A6372` | `#9AA4B2` | Secondary text (5.45:1 on Fog, 7.3:1 on Night span). |
| International Orange | `#E2451F` / strong `#C93A17` | `#FF6B3D` | The one accent: the arc, active nav, focus ring, key data marks. `strong` carries white text at 5.1:1. |
| Cable | `#2F7396` | `#6CB4DA` | Second data color (semantic layer in charts, links in diagrams). |

Data colors (charts only, each paired with a label, never color alone): orange, cable, teal `#1F8A78`, ochre
`#C28A12`, plum `#7B4F9E`, slate. Status text uses one step darker in light mode so pills pass AA on their soft
backgrounds: pass `#15705F` (4.95:1), info `#255F7D` (5.7:1), warn `#8A5F06` (4.8:1), fail `#B3261E` (5.3:1), accent
text `#B5331A` (5.1:1 on its soft tint).

Two tiers, as for any design system we ship: primitives (`fog.50`, `orange.500`...) and semantic aliases
(`--br-bg`, `--br-text-muted`, `--br-accent`) per theme. Pages only use semantic aliases.

## Type

| Role | Face | Setting |
| --- | --- | --- |
| Display (h1, hero, KPI numbers) | Space Grotesk Variable | 600 to 700, tracking -0.035em, line-height 1.02 to 1.1 |
| UI and body | Inter Variable | 400/500/600, 15px base in the chrome, 1.55 line-height, measure under 72ch |
| Code, token names, values, SHAs | JetBrains Mono Variable | 0.86em, only for things a person copies or compares |

Scale (major third, 1.25): 12, 13, 15, 18, 22, 28, 36, 48, 64. Tabular numerals on every number.
All fonts self-hosted via `@fontsource-variable/*`. Sentence case everywhere; no all-caps labels, with one exception:
sidebar group labels (`.rail-label`, the Library and Studio groups of `src/lib/nav.ts`) are uppercase. They stay short
(one or two words), letter-spaced (0.04em to 0.06em), 600 weight at the smallest UI size, in the muted text color, so
they mark where a job starts without competing with the items. Everything else stays sentence case:
eyebrows, buttons, pills, table headers and section titles.

## Layout

8px grid. App shell with a fixed left rail and a slim top bar.

```
+--------------------------------------------------------------------------------+
| [Bridge logo]   [ Search tokens, components, pages...  Cmd K ]  (main@sha, n) ◐ |
+-----------+--------------------------------------------------------------------+
| Overview  |  page header: title (display) + one-line lead + freshness          |
| Playground|                                                                    |
| Tokens  v |  content, max 1180px, left aligned                                 |
|  Explorer |                                                                    |
|  Color    |                                                                    |
|  ...      |                                                                    |
| Components|                                                                    |
|  Badge    |                                                                    |
|  Button   |                                                                    |
| Process   |                                                                    |
+-----------+--------------------------------------------------------------------+
```

Home (dashboard):

```
+------------------------------------------------------------------+
|  Hero (fog grain):  promise headline     |  the bridge: Figma    |
|  lead + 3 CTAs                           |  pillar, arc of real  |
|                                          |  tokens, Git pillar   |
+------------------------------------------------------------------+
| KPI: tokens | layers | themes | components | contrast | last edit |
+------------------------------+-------------------+---------------+
| donut: tokens by type        | stacked bars:     | contrast      |
|                              | category x layer  | pass/fail     |
+------------------------------+-------------------+---------------+
| Health (real issues)         | Recent changes (timeline)          |
+------------------------------------------------------------------+
| How a change travels: Figma -> PR -> CI -> review -> merge -> docs|
+------------------------------------------------------------------+
```

At 390px the rail becomes a sheet behind a menu button, KPI tiles go two per row, charts stack.

Radius follows hierarchy, not one value for everything: 20px stages and hero, 14px cards, 10px controls,
999px chips. Shadows are layered with a real offset (`--br-shadow-1..3`), never a flat grey halo.

## Principles

1. **Every number is computed.** KPIs, charts, health issues and the repo chip are derived from the repo at build
   time. No sample data, no invented customers. Empty states say so plainly ("No deprecated tokens").
2. **Chrome recedes, the system performs.** The chrome is quiet Steel and Fog; color lives in the previews and in
   a single orange accent.
3. **One memorable moment.** The hero bridge: the arc draws once on load, carrying real token names. Everything
   else is still. `prefers-reduced-motion` turns the draw off.
4. **Tactile, but honest.** Playground cards (radius, density, type ratio) change a local preview only, and say so.
5. **Built to scale.** Navigation, component pages, the token explorer and the command palette are generated from
   data, so 30 components and several themes or brands slot in without new templates.
6. **Minimal JS.** Static HTML by default. Vanilla scripts for the palette, explorer, playground and theme toggle;
   one React island for the props playground, because it renders the real components.

## Review against generic defaults (what I changed)

- First instinct was electric indigo on near-white. Rejected: it collides with the documented system's own indigo
  brand and is the default SaaS accent. Replaced by International Orange, which comes from the subject (bridges).
- First instinct for dark mode was `#0B0B0B` with a lime accent: the near-black plus acid accent tell. Replaced by a
  blue-steel night (`#0F141C`) and a warmer orange, so dark mode still reads as the same brand.
- Rejected ALL-CAPS eyebrows above headings (the brief's reference uses them); section titles carry their own
  weight in Space Grotesk instead. Sidebar group labels are the single uppercase exception (see Type), validated with
  the Library and Studio information architecture.
- Rejected "identical card grid" for the home: KPI tiles are a single strip with dividers, charts sit in panels of
  different widths, the flow diagram is a band, not cards.
- Rejected mono for decorative small labels; mono is only for token names, values and SHAs.
- Rejected arrows appended to every link; links are underlined text, CTAs are buttons with an icon only when the
  icon says where you go (Storybook, Figma, GitHub).
- Rejected fade-up on every section. Only the hero arc animates.

## Files

- `src/brand/tokens.ts`: brand primitives and semantic aliases, emitted to CSS in `Layout.astro`.
- `src/styles/site.css`: base, shell and shared patterns. `src/styles/*.css`: one file per feature.
- `src/lib/stats.ts`: everything the dashboard computes. `src/lib/nav.ts`: data-driven navigation.
- `src/lib/search.ts`: command palette index (`/search-index.json`).
- Lint: `npm run lint:css` covers `apps/docs-site/src/**/*.css`. No raw colors in CSS files: colors live in
  `src/brand/tokens.ts` (data, like the DS's own JSON) and every stylesheet uses `var(--br-*)` or `var(--color-*)`.
