# @bridge-ds/cli

## 0.2.1

### Patch Changes

- Updated dependencies [9574d19]
- Updated dependencies [fb40ae8]
  - @bridge-ds/mcp@0.3.0
  - @bridge-ds/visual@0.2.1

## 0.2.0

### Minor Changes

- bac1cb2: Measure design system adoption in product code. `@bridge-ds/core/audit` finds hardcoded colors, lengths, radii, shadows, durations, z-index and fonts in CSS, SCSS, style/sx/styled/theme objects, CSS-in-JS and Tailwind classes, suggests the closest token (deltaE in OKLab across every mode, nearest scale step), and counts DS components against foreign UI libraries, native elements and re-created components. `bridge audit <path>` reports token and component adoption as JSON (versioned schema) and Markdown, compares with a baseline, fails CI under a threshold, and `--fix --write` replaces exact CSS matches with `var(--token)`. The MCP server adds `bridge_audit` and the `migrate-file-to-ds` prompt. New `@bridge-ds/stylelint-plugin` (`bridge/use-tokens`) and `@bridge-ds/eslint-plugin` (`no-hardcoded-style-values`, `prefer-ds-components`).
- bffaaa9: History and rollback. `bridge_get_history` and `bridge_get_token_history` read what changed in the tokens (versions, merged PRs and commits, who, when, why, tier, breaking), and `bridge_plan_revert` and `bridge_propose_revert` undo a change against the current base branch, with conflicts shown when a token changed again later, or restore one token to an older value. The CLI adds `bridge history [token]` and `bridge revert <pr|commit> [--dry-run]`. Built on the new history model and revert planner in `@bridge-ds/core`.
- ee19cd7: Bridge MCP server and CLI. `@bridge-ds/mcp` connects Claude Code, Claude Desktop or any MCP client to a DTCG design system repo (local folder or GitHub): 15 tools to read tokens per mode, search, validate, check contrast, read components and docs, propose token changes as branches or draft PRs (never on main), review PRs and scaffold components, plus resources and prompts. `@bridge-ds/cli` adds `bridge init`, `check`, `tokens`, `diff`, `propose` and `mcp`.
- cd5565e: Visual impact analysis for design system changes. `@bridge-ds/core` gains a usage index (CSS variables each component reads, components it renders). New `@bridge-ds/visual` builds Storybook and the admin app at two refs, screenshots the impacted stories (every brand and theme) and the admin screens (every tenant and theme) deterministically, and pixel-diffs them into before, after, diff and composite images plus a JSON manifest. `bridge impact` and the `bridge_visual_impact` MCP tool run it; a workflow posts the result on pull requests.
- d5d263b: Docs drafts. `@bridge-ds/core` computes what code can tell about a component's docs (props table, tokens, anatomy from the CSS module classes, contrast notes, a changelog line) and keeps the review state of AI-drafted prose (`draftedBy`, `needsReview`). The MCP server adds `bridge_draft_docs`, which returns that pre-fill and a prompt for your own Claude to write the prose; the CLI adds `bridge docs draft <Component>` (`--json` for CI).
- 525217f: Explorations for Claude and the terminal: MCP tools `bridge_start_exploration` and `bridge_list_explorations`; CLI `bridge explore start <name> --purpose`, `bridge explore list`, `bridge explore promote <name>` and `bridge explore close <name>`. Write tools take a target exploration branch: `bridge_propose_token_change` and `bridge propose` with `branch` (one commit on GitHub, or the checked-out working tree locally), `bridge_draft_docs` with `branch`, `bridge_get_request` and `bridge request implement` with `branch`, `bridge_create_request` and `bridge request create` with `exploration`. Briefs for an exploration say to work on that branch and never open a pull request to main.
- 5c40693: New brands, from every surface. `planNewBrand` in `@bridge-ds/core` builds a brand file (primary and neutral ramps from the shared ramp engine, the starting brand's radius, fonts and theme overrides), adds the slug to `modes.brand` in `bridge.config.json`, and runs the contrast gate for the new brand in light and dark. The CLI gets `bridge brand create` and `bridge brand list`, the MCP server `bridge_list_brands`, `bridge_plan_brand` and `bridge_propose_brand`, the Figma plugin offers a new Brand mode as a new brand on Push, and the Studio has a four-step New brand flow with a live preview. The token build reads its brands from `bridge.config.json`, and `scripts/ramps.mjs` runs the same ramp engine (primitives unchanged).
- e31bac2: Publishable under the @bridge-ds scope: a `source` export condition for the monorepo, built `dist` with types,
  publish fields, and part of `npm run build:packages`. @bridge-ds/core also ships its `./audit` and `./node` entries.
- 2c79d5d: Component change requests for developers: MCP tools `bridge_list_requests`, `bridge_get_request` (with a brief to implement the request) and `bridge_create_request`; CLI `bridge request list|show|implement [--claude]|create`; and `bridge request jira-sync` for the optional bridge-jira GitHub Action. Pull request summaries from the core GitHub client now carry the body, so requests link the pull requests that close them.

### Patch Changes

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

- Updated dependencies [bac1cb2]
- Updated dependencies
- Updated dependencies [a55525d]
- Updated dependencies [bffaaa9]
- Updated dependencies [ee19cd7]
- Updated dependencies [cd5565e]
- Updated dependencies [d5d263b]
- Updated dependencies [525217f]
- Updated dependencies [abe4395]
- Updated dependencies [5c40693]
- Updated dependencies [e31bac2]
- Updated dependencies [2c79d5d]
  - @bridge-ds/mcp@0.2.0
  - @bridge-ds/visual@0.2.0
