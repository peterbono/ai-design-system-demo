# @bridge-ds/docs-site

## 0.2.0

### Minor Changes

- f103729: Owner override for solo maintainers and small teams. `governance.override` in `bridge.config.json` (`allowed`, `requireReason`, `minReasonLength`; absent by default) lets listed logins merge from Reviews when the only thing missing is approvals. It is never offered while CI fails or runs, when changes are requested, or on a draft. Bridge checks the token has write access, asks for a reason in a confirmation dialog, posts a `**Bridge owner override**` comment with the login, reason and missing approvals, then merges with the method the repo allows. If GitHub refuses, its message is shown and the comment is marked not merged.
- ef596ce: Library foundation pages (Color, Typography, Spacing, Radius and borders, Elevation) open each token group with a
  specimen of the real tokens in context, light and dark side by side, then a light list: dual swatch, the token name
  once, a one-line role, a muted alias line and a neutral usage chip. A page-level "Copy as" switch (CSS, JS, Figma)
  sets what a click on a name copies, and a row opens the token explorer's detail panel in read mode. Usage comes from
  the shared `tokenUsage()` definition, so the page background no longer reads as unused. Links in the app chrome are
  ink with a quiet underline; orange stays the signal for focus and the current place.
- 5c40693: New brands, from every surface. `planNewBrand` in `@bridge-ds/core` builds a brand file (primary and neutral ramps from the shared ramp engine, the starting brand's radius, fonts and theme overrides), adds the slug to `modes.brand` in `bridge.config.json`, and runs the contrast gate for the new brand in light and dark. The CLI gets `bridge brand create` and `bridge brand list`, the MCP server `bridge_list_brands`, `bridge_plan_brand` and `bridge_propose_brand`, the Figma plugin offers a new Brand mode as a new brand on Push, and the Studio has a four-step New brand flow with a live preview. The token build reads its brands from `bridge.config.json`, and `scripts/ramps.mjs` runs the same ramp engine (primitives unchanged).
- fdd4fc3: Studio reads as one app: compact page headers with no hero or lede, GitHub status only in the global header (connect button, or your login with repository, access and disconnect), a Drafts counter in the header that opens the draft as a side sheet, and the token explorer full bleed with one toolbar row (search, Filters, Modes, View, New token) and compact 40px rows. Overview starts with a KPI strip and a "Needs you" list whose status chips come from real CI, reviews and the merge gate, so a pull request with failing CI never reads "Ready". The Library is unchanged. Change titles read as text, with inline code rendered as code instead of raw backticks. Without a GitHub token, Overview and Reviews read the open list once and the live status of the 3 most recent pull requests, cached for 10 minutes per commit; other rows say "Status unknown" until you connect. New token and cell edits work without GitHub as drafts in this browser; only Propose, approve, merge and revert need a connection.
- 8c08d95: Studio Changes: one page with two views. In review lists the open pull requests most urgent first (blocked, then waiting for approval, then ready) under a Harbor opener with one status sentence and one action, the local draft as a strip, and branches without a pull request collapsed at the bottom. When GitHub cannot be read, the last list stays on screen "as of" its time, and the nav count keeps the last known number. A pull request opens in place with one sentence on its state, one primary action (open the failing run, connect GitHub, approve or merge) and collapsed sections with counts; the merge, approval and owner override rules are unchanged. History groups merged token changes by release, folds imports into one line, keeps filters behind a Filter button, and undo opens a side panel with one sentence and one primary. Color now means status only: red blocked, violet waiting for approval, green ready, grey otherwise; risk tiers are grey labels. Drafts, Branches, Reviews, Versions and Visual impact redirect to the right view. The Studio header switches to the Library, and the GitHub account moves to the bottom of the Studio nav.
- fb8a737: Component change requests in Studio: a Requests view in Changes (status, linked pull request, Jira key, a detail with "Implement with Claude"), "Request a change" in the Components drawer, an Integrations section in Settings that proposes Jira settings as a pull request, a line on the Overview when requests wait, and a "Component change requests" section in How review works.
- 525217f: Studio Changes gets an Explorations view: draft pull requests labeled `exploration` on `explore/<slug>` branches, summary first ("2 explorations running."), each with its purpose, author, previews, the snapshot install command to copy for a product staging branch and the requests filed on it. "Start an exploration" creates the branch from main with an exploration note and the draft pull request (or shows the `bridge explore start` command without GitHub). The detail opens in place (?exploration=N) with Promote to review (tier labels from the shared classifier, label removed, ready for review) and Close. Running explorations leave the In review list, show "Exploration (not mergeable)" in place of a tier, and never pass the merge gate, owner override included. How review works explains explorations.
- d66a923: Studio Settings is one page with three sections: Connection, Repository, Approvals. Connection opens with one sentence and one action for the GitHub state (Connect GitHub, or Change token once connected), then the Figma plugin and the MCP server as two plain rows. Repository says in one sentence which repository, branch and build it reads, shows Source at rest and folds tiers, modes, owners and previews behind counts; values share one mono style and the default mode reads "(default)" in plain text. Approvals is a compact "Who approves what" table, one row per tier with a grey label that opens Changes filtered to that tier (new ?tier= filter on In review), plus the owner override in one line. The governance prose moved to a new Library page under Use, How review works, with collapsible sections, linked from Approvals and from each pull request. The old Repository, Governance and Integrations URLs redirect to the matching section.

### Patch Changes

- 34b8e1d: Accessibility page, summary first: one status sentence from the contrast gate ("All 296 contrast checks pass across 2 brands and 2 themes", or how many fail and the first failing pair), then the gated pairs grouped by use (text, buttons and controls, UI and borders, focus, feedback, charts) for one brand and theme at a time. Each row shows a live sample, the pair, the ratio and one status (AAA, AA or "Fails, needs 4.5") and opens the token details. "Compare all 4" shows every brand and theme side by side, one at a time on phones. The method moves under "How we check". The wide "All pairs" table is gone.
- 53a02c4: All tokens fills the page, the side panel follows the filter, one Value column when light and dark match, dimension rows show a bar at their real size; wider gutter before the On this page rail.
- a55525d: Bridge brand moves to the "Field Guide" direction: white content, ink text, Harbor zones and Deep Harbor as the one strong color, Fraunces headings over Instrument Sans text, rounder radii. See `docs/DESIGN-LANGUAGE.md` (v2).

  Why this is major for `@bridge-ds/tokens`: the default brand changes what existing tokens resolve to, and consumers must check their screens.

  - Palette roles re-pointed in the bridge brand: `palette.neutral` from steel to the new `color.ink` ramp; `palette.primary`, `palette.accent` and `palette.link` to the new `color.harbor` ramp; `palette.info` from cable to plum. Orange is now only the categorical chart hue (`palette.categorical`).
  - `color.bg.default` is white (`palette.neutral.0`) in bridge light. Ocean keeps its tinted canvas, links and zone through `brands/ocean.light.tokens.json`.
  - Primary action and checked controls move to `primary.700` (hover 800, active 900); links to `link.700` (hover 800); `color.signal.default` to `accent.600`; `focus.ring.color` to `accent.700`. Dark: actions and checked controls use `primary.300/200/100` with `primary.950` text.
  - `font.family.sans` is Instrument Sans in bridge (was IBM Plex Sans).
  - Radius roles in bridge: inset 6, control 12, container 20, overlay 20 (were 2, 6, 10, 14). Primitive `radius.xl` is 12 (was 14).
  - Primitive `font.size` steps changed: `300` 17 to 16, `400` 20 to 21, `600` 29 to 30, `700` 35 to 36, `800` 42 to 44, `1000` 60 to 64.
  - `control.height.md` is 44 in comfortable density (was 40) and 36 in compact (was 32).

  Additions: `color.bg.zone` (Harbor blocks, light `primary.200`, dark `primary.900`, ocean light `primary.50`), `font.family.display` (Fraunces in bridge, Plex Sans in ocean), `font.family.fraunces`, `font.family.instrument-sans`, `typography.<display|h1|h2|h3|body|ui|caption>.{size,line-height,weight,family,tracking}` in both brands, `font.leading.{16,20,26,28,32,38,50,68}`, `size.11` (44px), and the `color.ink.*` and `color.harbor.*` ramps with pinned brand anchors (ink 200 `#E3E8EE`, 600 `#5B6672`, 900 `#15202B`; harbor 200 `#CFE8FF`, 700 `#0B4A8B`). `contrast.checks.json` gains 5 pairs on `color.bg.zone` (296 checks, 0 failing). Fixes a missing `$type` on `color.bg.zone` in the semantic light and dark files.

  `@bridge-ds/react`: no API change, but every component's rendered look changes through the tokens (colors, fonts, radii, 44px default controls). PageHeader, Card, Dialog and Drawer titles read the new `typography.*` roles; medium Badges set at 14/20 (the `ui` role), small Badges stay 12/16.

  `@bridge-ds/docs-site`: the Bridge site wears the Field Guide brand. Top bar of five items, a short side nav (no headings, no counts, collapsible groups), Harbor header blocks on Library section pages, new Library home and Studio overview, version chip by the page title, branch picker by the Studio title, brand and density in the preview toolbars. The theme playground is removed; `/playground/` redirects to the Library home. `.stylelintrc.json` accepts `var(--typography-<role>-family)` for `font-family`.

  `@bridge-ds/core`, `@bridge-ds/cli`, `@bridge-ds/mcp`, `@bridge-ds/eslint-plugin`, `@bridge-ds/stylelint-plugin`, `@bridge-ds/figma-plugin`: test expectations and fixtures follow the new token values (ink chains, white canvas, the ocean overrides, 296 contrast checks). No behavior change.

- 061deb5: Studio Components, "Edit tokens" now opens Studio Tokens on `?component=<slug>`: exactly the tokens that component's CSS module reads, across every collection, with a removable "Used by IconButton" chip in the chip row. The Tokens column, the Library component cards and the component page count the same set, so the link never lands on "No token matches". Components that read no token get no link.
- a914c38: Component pages: the On this page rail sits on the right from the top of the page (from 1320px) instead of inside the reading column, and the Skeleton preview shows an avatar, two lines and a block.
- f7e861c: Studio Components: one family menu instead of nine chips (17 interactive elements on the first screen).
- e2c7742: Click targets: token rows (name, copy, menu, uses chip), the Studio row menu, the logo link, changelog refs and Quality actions are at least 32px tall; standalone links at least 24px. The Preview brand switch hides when the repo has a single brand.
- 7f8972e: Library: home "What changed" lists short headlines with their kind on the full content width, the footer spans wide pages, reading pages get the "On this page" rail again from 1320px, and the Preview brand and density switches use the DS control height (44px).
- 558c78d: The Library is the site, the Studio is a space. No more Library | Studio switch: the Library header keeps logo, centered search, theme, GitHub and a quiet "Open Studio" (with the avatar in one pill when signed in); the Studio has its own "Bridge Studio" header on a soft ground and a "Library, view published library" box at the bottom of its nav. The Library nav is Home, Foundations (with All tokens), Components and Use; the one nav count is the reviews waiting, on Changes. "Edit in Studio" and "View source" show only for a GitHub token with write access. New page meta line and site footer.

  All tokens (`/tokens/`) becomes a read-only reference: filter, type chips with counts, light and dark values, copy on hover and a side panel per token. `?t=` deep links still work.

  Studio Tokens edits through one anchored popover per cell (palette families, a swatch ramp, one contrast line, more options folded), a slim "N changes · Review" bar, and a review sheet with before and after per mode, contrast, usage and a preview of real components. The full editor modal is removed; the detail drawer is read-only with one Edit. The explorer keeps to four font sizes.

  Home "What changed" and Studio activity show one-line titles.

- 75a6174: Studio Tokens: a page header and one toolbar row (filter field "Filter N tokens", type chips with counts, one Options menu for collections, usage, brand and modes, columns and exact match, then New token), and the table at full width with Name, Light and Dark. The collections tree and the Filters, Modes and View menus are gone; Semantic and Base are the default scope. The swatch name in the value editor shows under the ramp, never over the family tabs. "Used by" counts global stylesheets apart from components ("1 global style (base.css)") in the details and the review sheet. All tokens: "Copy variable" copies `var(--name)`. Library foundation pages: no page toolbar; each row has a copy button (CSS variable by default, JS or Figma name from its menu, last choice remembered) and the brand or density switch sits in the header of the specimens it changes.
- 1b1a272: AGENTS.md: a UI quality bar every screen and feature is checked against.
- Updated dependencies [e31bac2]
- Updated dependencies [5b9d677]
- Updated dependencies [3e59115]
- Updated dependencies [e54d2a1]
- Updated dependencies [bac1cb2]
- Updated dependencies
- Updated dependencies [a55525d]
- Updated dependencies [f103729]
- Updated dependencies [b6cb68a]
- Updated dependencies [8180108]
- Updated dependencies [8ec801a]
- Updated dependencies [e8fd4a8]
- Updated dependencies [b6cb68a]
- Updated dependencies [7d3f7cd]
- Updated dependencies [acd1273]
- Updated dependencies [b0da5ed]
- Updated dependencies [b6cb68a]
- Updated dependencies [cd5565e]
- Updated dependencies [95db484]
- Updated dependencies [cf3f5bb]
- Updated dependencies [abe4395]
- Updated dependencies [7261f47]
- Updated dependencies [a6a3a46]
- Updated dependencies [d5d263b]
- Updated dependencies [c66908c]
- Updated dependencies [73b1a6f]
- Updated dependencies [84e1383]
- Updated dependencies [6cd9c3a]
- Updated dependencies [525217f]
- Updated dependencies [e47f4a6]
- Updated dependencies [1f29f63]
- Updated dependencies [5c40693]
- Updated dependencies [fd83606]
- Updated dependencies [019a220]
- Updated dependencies [a0142d2]
- Updated dependencies [cf3f5bb]
- Updated dependencies [7261f47]
- Updated dependencies [36cb504]
- Updated dependencies [2c79d5d]
- Updated dependencies [fd83606]
- Updated dependencies [937bd43]
- Updated dependencies [a914c38]
- Updated dependencies [0cab1bb]
  - @bridge-ds/core@0.2.0
  - @bridge-ds/tokens@1.0.0
  - @bridge-ds/react@1.0.0
