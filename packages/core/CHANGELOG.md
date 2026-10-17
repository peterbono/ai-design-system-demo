# @bridge-ds/core

## 0.3.0

### Minor Changes

- 537abd7: Push names structure changes. Each variant keeps a layer outline, so a layer added, removed or moved becomes a
  "Structure change" request (new request kind `structure`) with a line like `New instance layer "Icon" (Icon/Pencil)
after "Label" in primary sm` and the title "Add a layer after Label", instead of a vague visual change. Renames,
  wrappers and hidden layers bound to nothing still send nothing. When an optional part already draws the added layer
  (an icon after the label while "Icon end" exists), the row says "Icon end already does this: show it with the Icon end
  property" and the item starts unchecked; "Keep it as a request" sends it anyway.
- fb40ae8: Claude writes each change line. Draft sessions carry one change line per component change (`DraftItem.lines`, images labeled by line), results may answer `lines: [{ id, line }]` (one sentence, at most 120 characters, no em dash, unknown ids refused; results without lines still work), and `draftChangeLine` gives the deterministic default ("Looks different in Size=sm, State=Default, Variant=primary; no variable explains it"). Requests carry the line (`ComponentChangeRequest.line`, "**What changes:**" in the issue, the brief and Jira). `bridge_pending_drafts` and `bridge_write_drafts` describe and accept lines; the plugin's API-key path asks for and parses them too.

  Push hierarchy in the Figma plugin: "Draft with Claude" is a ghost action on the Description (and request Title) label line, one "Drafted by Claude" status line under the field, each component change row reads name and kind, then one sentence, with the table behind "Details" in one font size, no group checkbox for a single item, the bar alone sums up what is sent ("1 request"), and a shorter Components intro.

## 0.2.0

### Minor Changes

- e31bac2: bridge audit counts every visible UI instance: router links outside a DS component's `render` prop (react-router,
  ra-core `LinkBase`, next/link), anchors with `href`, images and chart libraries (recharts, Nivo, Chart.js...,
  foreign with no DS equivalent). Providers and other non-visual parts no longer count as DS instances.
- e54d2a1: Packages are publishable under the `@bridge-ds` npm scope (renamed from `@demo-ds` and `@bridge`). Each ships built ES modules, type declarations and, for React, one `styles.css`; the monorepo keeps resolving TypeScript sources through the `source` export condition. `@bridge-ds/core` adds branch preview helpers (`previewUrl`, `snapshotUrl`, `previewComment`) and a `previews` section in `bridge.config.json`. `@bridge-ds/react` adds an opt-in staging token override: `ThemeProvider` `tokenOverride` loads an allowlisted `tokens.css` from `?bridge-tokens=`, off by default and refused in production builds unless enabled.
- bac1cb2: Measure design system adoption in product code. `@bridge-ds/core/audit` finds hardcoded colors, lengths, radii, shadows, durations, z-index and fonts in CSS, SCSS, style/sx/styled/theme objects, CSS-in-JS and Tailwind classes, suggests the closest token (deltaE in OKLab across every mode, nearest scale step), and counts DS components against foreign UI libraries, native elements and re-created components. `bridge audit <path>` reports token and component adoption as JSON (versioned schema) and Markdown, compares with a baseline, fails CI under a threshold, and `--fix --write` replaces exact CSS matches with `var(--token)`. The MCP server adds `bridge_audit` and the `migrate-file-to-ds` prompt. New `@bridge-ds/stylelint-plugin` (`bridge/use-tokens`) and `@bridge-ds/eslint-plugin` (`no-hardcoded-style-values`, `prefer-ds-components`).
- One `bridge.config.json` and one schema (`packages/core/bridge.config.schema.json`) for the Figma plugin, the docs site, the CLI and the MCP server: tiers, ordered layers with mode placeholders, modes with parity, contrast, components, docs, changesets and governance (protected branches, branch prefix, labels, guardrails, design and tech owners). The MCP server now runs on `@bridge-ds/core` (layered token sets, minimal-diff edits, contrast, diff, PR body, GitHub client, local git writer) and every surface shares one risk classifier: a token added, changed, renamed or removed is Tier 3 (renames and removals major), a description-only edit is Tier 1 patch.
- f103729: Owner override for solo maintainers and small teams. `governance.override` in `bridge.config.json` (`allowed`, `requireReason`, `minReasonLength`; absent by default) lets listed logins merge from Reviews when the only thing missing is approvals. It is never offered while CI fails or runs, when changes are requested, or on a draft. Bridge checks the token has write access, asks for a reason in a confirmation dialog, posts a `**Bridge owner override**` comment with the login, reason and missing approvals, then merges with the method the repo allows. If GitHub refuses, its message is shown and the comment is marked not merged.
- cd5565e: Visual impact analysis for design system changes. `@bridge-ds/core` gains a usage index (CSS variables each component reads, components it renders). New `@bridge-ds/visual` builds Storybook and the admin app at two refs, screenshots the impacted stories (every brand and theme) and the admin screens (every tenant and theme) deterministically, and pixel-diffs them into before, after, diff and composite images plus a JSON manifest. `bridge impact` and the `bridge_visual_impact` MCP tool run it; a workflow posts the result on pull requests.
- 95db484: Change drafts: `draftRequestText(component, kind, changes)` and `draftPushDescription(entries, components)` write a sentence-case title and a 1 or 2 sentence summary from detected changes only (no reason, no invented number, no em dash), with `pushChangeRows` for a change table of variable edits and `cleanDraftText` to strip em dashes.
- cf3f5bb: Component specs: `ComponentSpec` types and helpers in the main entry, and a generator in `@bridge-ds/core/node` (`generateRepoComponentSpecs`) that derives variant axes, properties, parts and per-variant token bindings from a component's TSX and CSS modules, with a small CSS cascade. New optional `components.specs` config key (default `packages/react/component-specs.json`).
- abe4395: Draft exchange (`draft-exchange.ts`): the pending drafts file the Figma plugin and the MCP server share on the `bridge-requests` branch (`.bridge/drafts/<sessionId>.json`), with compose, parse, validate, sanitize (no em dash, title at most 70 characters, summary at most 3 sentences) and merge helpers, the Bridge voice rules and output contract, and GitHub helpers that read and write sessions with the file sha and retry on 409. `GitHubClient` gains `getFile` (text and sha), `getFileBase64`, `listDirectory` and `deleteFile`.
- 7261f47: Component specs describe swappable parts: `swap` on icon parts (default icon from the docs preview or the AllStates
  story) and on full-bleed compound content (Card body: text or media slot), `slots` per variant, and file-level
  `icons` (normalized Lucide SVGs read from `lucide-react`), `iconStyle` and `slots` sections.
- a6a3a46: Add `tokenUsage()`: one definition of a token in use. A token is in use when a component stylesheet or a global
  stylesheet (base styles, app shell) reads its variable, or when a token in use aliases it. Bridge uses it for the
  Overview counts and the token explorer's Unused flag.
- d5d263b: Docs drafts. `@bridge-ds/core` computes what code can tell about a component's docs (props table, tokens, anatomy from the CSS module classes, contrast notes, a changelog line) and keeps the review state of AI-drafted prose (`draftedBy`, `needsReview`). The MCP server adds `bridge_draft_docs`, which returns that pre-fill and a prompt for your own Claude to write the prose; the CLI adds `bridge docs draft <Component>` (`--json` for CI).
- 525217f: Explorations: `explorations.ts` (branch naming `explore/<slug>`, the `exploration` label, the draft pull request body with purpose, snapshot install command, previews and promote or close, status running, promoted or closed, and the promotion plan with tier labels from the shared classifier) and `explorations-github.ts` (start, list, promote, close). `GitHubClient` gains `withBranchPrefix`, `commitToBranch` and `markReadyForReview` (GraphQL `markPullRequestReadyForReview`, since REST cannot unset draft). Component change requests take an optional `exploration` branch: the issue gets the `exploration` label and the brief says to work on that branch, never in a pull request to main. The branch preview comment says "Try this exploration in your product" for explorations and installs them as `name@url`.
- 5c40693: New brands, from every surface. `planNewBrand` in `@bridge-ds/core` builds a brand file (primary and neutral ramps from the shared ramp engine, the starting brand's radius, fonts and theme overrides), adds the slug to `modes.brand` in `bridge.config.json`, and runs the contrast gate for the new brand in light and dark. The CLI gets `bridge brand create` and `bridge brand list`, the MCP server `bridge_list_brands`, `bridge_plan_brand` and `bridge_propose_brand`, the Figma plugin offers a new Brand mode as a new brand on Push, and the Studio has a four-step New brand flow with a live preview. The token build reads its brands from `bridge.config.json`, and `scripts/ramps.mjs` runs the same ramp engine (primitives unchanged).
- 019a220: Pulled components: Badge md gets its padding and min height (a `calc()` of tokens is resolved and set, reported as "set,
  not bound"; a `calc()` of one token is bound). Card is drawn at the `size.80` width, its header, body and footer fill it,
  body text wraps instead of collapsing to 0px, and it clips its content so the footer stays inside the rounded corners.
  Tag loses its extra "label" wrapper frame (a re-pull moves the layers and removes it). Variant grids keep the same gap
  between rows and columns of different sizes. Specs gain `clip` and `fill` on parts and calc() expressions of token paths.
- a0142d2: Branch previews: `previews.production` in `bridge.config.json` holds the production URL of each app (docs, Storybook,
  admin demo), and `appUrl()` picks the branch preview on a feature branch and the production URL on the default branch
  or in a local build. The docs site links its Storybook through it.
- 36cb504: Component change requests: `composeRequestIssue`, `parseRequestIssue`, `requestStatus`, `requestBrief`, Jira field mapping, GitHub issue methods, and an `integrations` block in bridge.config.json.

### Patch Changes

- 5b9d677: `bridge audit` no longer counts a native element passed as a component's render element (`<Button render={<a href="/tokens" />}>`) as a separate native UI instance, as it already did for router links: the DS component is the UI.
- 3e59115: `bridge audit` and `bridge/use-tokens` no longer report a ring built only from tokens (`inset 0 0 0 var(--border-width-default) var(--color-border-default)`) as a hardcoded shadow: bare zero offsets carry no value. Stylelint already allowed this form.
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

- c66908c: `patchDocsJson` writes edited docs.json as a minimal diff of the file it replaces, and `acceptDocsText` now changes only the needsReview line.
- 2c79d5d: Component change requests for developers: MCP tools `bridge_list_requests`, `bridge_get_request` (with a brief to implement the request) and `bridge_create_request`; CLI `bridge request list|show|implement [--claude]|create`; and `bridge request jira-sync` for the optional bridge-jira GitHub Action. Pull request summaries from the core GitHub client now carry the body, so requests link the pull requests that close them.
