# Bridge: design notes for the docs app

Bridge is the web side of the DS Bridge Figma plugin: "Your design system, one source of truth: Figma for
designers, Git for everyone, docs for humans and agents." This app is where a team reads the system, checks its
health and plays with it. Owner: Florian Gouloubi (Senior Product Designer).

The app is built **with** the design system it documents (dogfooding): every color, length, radius, shadow, duration,
layer and font in its CSS is a Bridge token, and its controls are `@bridge-ds/react` components where one exists.
Two scopes still never blur:

1. **The Bridge chrome** (navigation, dashboards, charts, cards): pinned to the DS `bridge` brand, comfortable
   density, on `<html data-brand="bridge" data-density="comfortable">`. It follows the light or dark theme.
2. **The design system being shown** (stages, the theme playground, do/don't cards, specimens): every preview
   surface sets `data-theme`, and the scope menu copies the picked brand (Bridge, Ocean) and density onto those
   surfaces only (`data-preview-brand` / `data-preview-density` on `<html>` remember the choice).

## Subject and mode

- Audience: designers and product people first, engineers and AI agents second.
- Mode: mostly **Operate** (dashboard, token explorer, playground) and **Read** (component guidance, governance,
  changelog). Only the home hero is allowed to persuade.
- The subject is a bridge between two banks (Figma and Git). Visual vocabulary comes from bridge engineering:
  pillars, a suspended arc, cables, rivets, fog, and the paint every bridge engineer knows: International Orange.

## Palette, type and shape (chrome)

The chrome is the DS `bridge` brand (docs/DESIGN-LANGUAGE.md): Fog canvas (`color.bg.default`), Deck surfaces
(`color.surface.default`), Steel ink (`color.text.default`, `color.action.primary.*`), Slate secondary text
(`color.text.muted`), International Orange only as signal (`color.signal.*`, `focus.ring.color`), Cable for links
(`color.text.link`). Stronger hairlines use `color.border.emphasis`.

Charts use `color.chart.series.1` to `6` (signal, info, success, warning, categorical, neutral), `color.chart.track`,
`color.chart.grid` and `color.chart.axis`, each series paired with a text label, never color alone. Status pills use
`color.feedback.*` text on `color.feedback.*.bg`.

Type is IBM Plex Sans and Mono through `font.family.sans|mono`, on the DS scale: UI text `font.size.200` (14),
meta `font.size.100` (12), page titles `font.size.600`, the Home hero `font.size.1000` (landing only). Tabular
numerals on every number. Sentence case everywhere; no all-caps labels, with one exception: sidebar group labels
(`.rail-label`, the Library and Studio groups of `src/lib/nav.ts`) are uppercase, short, letter-spaced, 600 weight
at the smallest size, in the muted text color. Everything else stays sentence case.

Radius uses the DS roles: `radius.inset` for tags and small marks, `radius.control` for controls, `radius.container`
for cards and panels, `radius.overlay` for the hero, stages, dialogs and drawers, `radius.pill` for badges and dots.
Elevation: `elevation.raised|overlay|modal`. Layers: `layer.*`. Motion: `motion.duration.*`, `motion.easing.*`.
App shell sizes: `layout.sidebar.width`, `layout.header.height`, `layout.content.max-width`.

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

Radius follows hierarchy through the DS radius roles (see above). Shadows only on floating layers and the hero, through the elevation tokens.

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
  blue-steel night (`color.bg.default` in dark, steel 950) and a warmer orange, so dark mode still reads as the same brand.
- Rejected ALL-CAPS eyebrows above headings (the brief's reference uses them); section titles carry their own
  weight instead. Sidebar group labels are the single uppercase exception (see Type), validated with
  the Library and Studio information architecture.
- Rejected "identical card grid" for the home: KPI tiles are a single strip with dividers, charts sit in panels of
  different widths, the flow diagram is a band, not cards.
- Rejected mono for decorative small labels; mono is only for token names, values and SHAs.
- Rejected arrows appended to every link; links are underlined text, CTAs are buttons with an icon only when the
  icon says where you go (Storybook, Figma, GitHub).
- Rejected fade-up on every section. Only the hero arc animates.

## Files

- `src/styles/site.css`: base, shell and shared patterns. `src/styles/*.css`: one file per feature.
  `src/styles/ds-library.css` and `ds-studio.css`: placement glue around DS components only.
- `src/lib/stats.ts`: everything the dashboard computes. `src/lib/nav.ts`: data-driven navigation.
- `src/lib/search.ts`: command palette index (`/search-index.json`).
- Lint: `npm run lint:css` covers `apps/docs-site/src/**/*.css` with the same token-only rules as component CSS,
  plus `bridge/use-tokens`. CI also runs `npm run audit:docs`: the adoption audit of this app against
  `src/data/audits/bridge-site-after.json`, failing on any regression.
- DS gaps found while building this app: `apps/admin/DS-GAPS.md` (shared list).
