# Bridge: design notes for the docs app

Bridge is the web side of the DS Bridge Figma plugin: "Your design system, one source of truth: Figma for
designers, Git for everyone, docs for humans and agents." This app is where a team reads the system and changes it
through reviewed pull requests. Owner: Florian Gouloubi (Senior Product Designer).

The app is built **with** the design system it documents (dogfooding): every color, length, radius, shadow, duration,
layer and font in its CSS is a Bridge token, and its controls are `@bridge-ds/react` components where one exists.
Two scopes still never blur:

1. **The Bridge chrome** (navigation, headers, cards, lists): pinned to the DS `bridge` brand, comfortable
   density, on `<html data-brand="bridge" data-density="comfortable">`. It follows the light or dark theme.
2. **The design system being shown** (stages, do/don't cards, specimens): every preview surface sets `data-theme`,
   and the preview menu in each preview toolbar copies the picked brand (Bridge, Ocean) and density onto those
   surfaces only (`data-preview-brand` / `data-preview-density` on `<html>` remember the choice).

## Subject and mode

- Audience: designers and product people first, engineers and AI agents second.
- Mode: mostly **Operate** (Studio: reviews, token edits, checks) and **Read** (Library: foundations, component
  guidance, changelog). Only the Library home hero and the Studio greeting are allowed to welcome.
- Direction: **Field Guide** (brand direction B, chosen by the owner as the "more restful" one). Editorial and
  friendly: a serif display face, generous space, large flat Harbor blocks that open a space, hand-drawn ink
  illustrations, and one strong color (Deep Harbor) for what you can act on. Everything else is ink on white.

## Palette, type and shape (chrome)

The chrome is the DS `bridge` brand (docs/DESIGN-LANGUAGE.md): white content (`color.bg.default`,
`color.surface.default`), ink text `#15202B` (`color.text.default`), secondary `#5B6672` (`color.text.muted`), hairlines
`#E3E8EE` (`color.border.default`). **Harbor** `#CFE8FF` (`color.bg.zone`) only as large flat blocks: the Library home
hero, the header block of every Library section page, the Studio greeting and onboarding. Never behind tables or
forms. **Deep Harbor** `#0B4A8B` is the only strong color in content: primary buttons (`color.action.primary.*`), links
(`color.text.link`), the current nav entry (`color.text.signal`) and the focus ring. Status shows as pale tints with
dark text (`color.feedback.*.bg` + `.text`), always with a word. Dark theme: deep navy canvas and surfaces, Harbor as a
muted deep-blue zone (`harbor.900`), Deep Harbor lightened to `harbor.300` for actions and links (AA checked by the
token build).

Type comes from the brand typography roles (`--typography-<role>-size|line-height|weight|family|tracking`):

| Role | Face | Size / line | Used for |
| --- | --- | --- | --- |
| display | Fraunces 500, soft | 64 / 68 | Home hero only (44 / 50 on phones) |
| h1 | Fraunces 500, soft | 44 / 50 | Page titles: Library headers, the Studio greeting (30 / 38 on phones) |
| h2 | Fraunces 600 | 30 / 38 | Studio page titles |
| h3 | Instrument Sans 600 | 21 / 28 | Section titles inside a page, card titles |
| body | Instrument Sans 400 | 16 / 26 | Reading text and leads, at most 65ch |
| ui | Instrument Sans 400-600 | 14 / 20 | Navigation, controls, tables, meta, code |
| caption | Instrument Sans 500 | 12 / 16 | Small DS badges only |

**At most 4 font sizes per screen.** The site CSS never uses a raw `font.size.*` step: every size is a role.
IBM Plex Mono for token names, values, code and SHAs only. Sentence case everywhere, no uppercase labels.

Shape: radius roles from the brand: `radius.control` 12 (buttons, inputs, nav entries, the search field),
`radius.container` 20 (cards and zone blocks), `radius.pill` for badges, chips and the drafts count. Controls are
44px by default (`control.height.md`), 36px in the compact Studio tables and toolbars. 4px grid, 64 to 80px between
sections. Icons 20px in the navigation, 16px in controls. Cards are flat white plates with a hairline edge; only
popovers, menus and dialogs cast shadows.

Illustrations: hand-drawn ink line art (`src/brand/illustrations.ts`, rendered by `components/Illustration.astro`),
kept exactly as validated in the brand mockups and to be replaced later. Strokes follow `currentColor`; fills carry
`data-fill="paper|zone|deep"` and are painted with tokens in `styles/brand.css`, so every drawing follows the theme.

## Layout

4px grid. The Library is the site; the Studio is a space inside it, with its own header. No Library | Studio switch.

```
Library
+--------------------------------------------------------------------------------+
| [Bridge]          [ Search tokens, components, pages ]       ◐  GH | Open Studio|
+-----------+--------------------------------------------------------------------+
| Home      |  +--------------------------------------------------------------+  |
| Foundat. v|  | Harbor block: page title [Edit in Studio], lead   [drawing]  |  |
| | Color   |  +--------------------------------------------------------------+  |
| | Typogr. |  content, one 960px column on reading pages                        |
| | ...     |                                                                    |
| | All tok.|  Updated Oct 16, 2026   <> View source                            |
| Components|  ----------------------------------------------------------------  |
| Use     > |  Bridge, Free and open source design system, MIT   GitHub  AI  Contribute |
+-----------+--------------------------------------------------------------------+

Studio (header and nav on a soft ground, white canvas)
+--------------------------------------------------------------------------------+
| [Bridge | Studio]     [ Search tokens, components, changes ]     ◐ | Library ↗ |
+-----------+--------------------------------------------------------------------+
| Overview  |                                                                    |
| Tokens    |                                                                    |
| Components|                                                                    |
| Changes 3 |                                                                    |
| Quality  >|                                                                    |
| Settings >|                                                                    |
| --------- |                                                                    |
| [GitHub] Connect GitHub, Read only until connected                             |
+-----------+--------------------------------------------------------------------+
```

Library header, five items at most: logo, search on the true center axis, theme and GitHub (4px apart), a hairline,
then the team entry: a quiet outline "Open Studio" for visitors; for a reader signed in with a GitHub token, "Open
Studio" and the avatar share one pill. Studio header: "Bridge Studio" ("Studio" in Fraunces, Deep Harbor), search,
theme, then a quiet "Library ↗" in the same far-right slot as "Open Studio" (that slot always switches space; icon
only on narrow screens). The GitHub account sits at the bottom of the Studio nav.

Maintainer tools appear only with a GitHub token that has write access (`<html data-maintainer>`, set by
`scripts/maintainer.ts` and painted before first render from the last check): "Edit in Studio" right after a Library page
title (`LibraryHeader studio=`), and "View source" in the page meta line. Visitors see neither, and nothing else moves.

Page end: one quiet meta line ("Updated <date>", then "View source" opening a small popover of the source files), then
the site footer on the content column: wordmark and "Free and open source design system, MIT" on the start side;
GitHub, For AI agents (llms.txt) and Contribute (Storybook workbench) on the end side, underlined on hover only. The
Studio keeps the meta line and has no site footer. The version picker sits in the Changelog header.

Side nav: at most 7 top-level entries, no group headings, one count (reviews waiting, on Changes), two levels at most.
A group is a button with `aria-expanded` and a chevron; only the current group starts open. Its pages hang off a
hairline guide; the current page gets a Deep Harbor marker on that line. Deeper levels (each component) appear as cards
on their group page, not in the nav.

- Library: Home, Foundations (Color, Typography, Spacing, Radius and borders, Elevation, Accessibility, then slightly
  apart All tokens), Components, Use (Install, Agents, Changelog). All tokens (`/tokens/`) is a read-only reference:
  filter, type chips, rows with light and dark values, a side panel per token. Editing happens in Studio Tokens.
- Studio: Overview, Tokens, Components, Changes (one page: In review and History tabs, a pull request opens in place),
  Quality (Checks, Adoption), Settings (Repository, Governance, Integrations). Under a divider, the GitHub account:
  "Connect GitHub" and "Read only until connected", or the avatar, login and repository opening the account menu.

Studio Changes: In review opens with a Harbor block (one status sentence about the most urgent pull request, one
primary "Review #N"); a draft strip only when this browser holds a draft; the pull requests on one card (plain title
and #, one status chip, date, the tier as a grey label), most urgent first; "Other branches (N)" collapsed at the end.
Without GitHub, the last list stays "as of" its time. A pull request: a compact Harbor opener (title, one sentence
on its state, one primary), then collapsed sections with counts (Files, Checks, Visual impact, Preview and install,
Changeset, Conversation) and a footer action bar. History: one sentence on the release, one timeline grouped by
release, imports folded, filters behind "Filter", the demo switch at the bottom; undo is a side panel. Status colors
everywhere in the Studio: red blocked, violet waiting for approval, green ready to merge, grey for the rest. Risk
tiers never take a color.

Library home: Harbor hero (display headline, one line on what Bridge is with the current release, one primary
action, the bridge drawing), three topic cards (Foundations, All tokens, Components, with counts from the data) with
their drawings, then what changed: one line per change (the first sentence, plain text, ellipsis), real dates, and the
full notes on the Changelog.

Studio overview: Harbor greeting ("Hello Florian." when a GitHub login is known, else "Hello."; then how many
changes need a review and one status sentence, both from the open pull requests and their live CI and review status),
"Start reviewing", the contrast gate in one line; two suggestion cards from real data (unblock a pull request with a
failing check, add missing usage guidance); then activity (open pull requests with their status, then merged changes
waiting for the next release).

At 390px the side nav becomes a sheet behind the menu button (it also carries Theme and GitHub with their names, and
in the Library a quiet "Maintaining Bridge? Open Studio" box), the top bar keeps logo, search and menu, drawings move
above or out of the way, nothing scrolls sideways.

## Principles

1. **Every number is computed.** Review counts, statuses, the contrast line and suggestions come from the repo at
   build time or from GitHub in the browser. No sample data. Empty states say so plainly.
2. **Restful by default.** One strong color, white space, few sizes. Color blocks open a space, they never fill it.
3. **Fewer doors, clearer doors.** At most 20 interactive elements on the first screen of the two home pages.
4. **Built to scale.** Navigation, component cards, the token explorer and search are generated from data, so new
   components, brands or modes slot in without new templates.
5. **Minimal JS.** Static HTML by default; small vanilla scripts; React islands only where they render real
   components (props playground, version and preview menus).

## Files

- `src/styles/site.css`: base, shell and shared patterns. `src/styles/brand.css`: Field Guide patterns (zone
  blocks, drawings, cards, type role helpers). `src/styles/*.css`: one file per feature.
  `src/styles/ds-library.css` and `ds-studio.css`: placement glue around DS components only.
- `src/lib/stats.ts`: everything the dashboard computes. `src/lib/nav.ts`: data-driven navigation.
- `src/lib/search.ts`: command palette index (`/search-index.json`).
- Lint: `npm run lint:css` covers `apps/docs-site/src/**/*.css` with the same token-only rules as component CSS,
  plus `bridge/use-tokens`. CI also runs `npm run audit:docs`: the adoption audit of this app against
  `src/data/audits/bridge-site-after.json`, failing on any regression.
- DS gaps found while building this app: `apps/admin/DS-GAPS.md` (shared list).
