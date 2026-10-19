# @bridge-ds/tokens

## 1.4.0

### Minor Changes

- 837d215: Dark mode polish and leftovers from the critiques.

  - Tokens: `color.surface.strong` (Deep Harbor in both themes, for a strong mode surface) and `color.feedback.neutral.bg` (the fill of a status with no tone, one step off every surface in both themes), each checked by a new contrast pair. `popup.border` steps up to `color.border.emphasis` so a list opened inside a Dialog keeps an edge in dark.
  - SegmentedControl: the selected segment takes the checked control color as its edge, like a pressed Button toggle; it had no edge in dark.
  - Banner `appearance="strong"`: `color.surface.strong` with `color.text.on-solid` and a matching focus ring. In dark it was the light primary action color and read like a Harbor zone.
  - Badge neutral (subtle): `color.feedback.neutral.bg`, so grey status chips keep their fill on dark cards.
  - Docs site: the owner override confirmation is the DS Dialog for plain scripts (Textarea, Alert, SegmentedControl, ButtonGroup) instead of a native dialog; All tokens filter controls share one size; Quality audit tables stack on phones; the Changes tabs fit a phone; Changes rows say "Library moved on: N updates"; failing developer tests are never "Your turn" for the designer who made the change; the search palette shows the nav icons; Tokens type chips use the selected look; rows of a viewed change say "Changed" or "New"; "Bring in the latest library" uses the standard control height.

## 1.0.0

### Major Changes

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

### Minor Changes

- e54d2a1: Packages are publishable under the `@bridge-ds` npm scope (renamed from `@demo-ds` and `@bridge`). Each ships built ES modules, type declarations and, for React, one `styles.css`; the monorepo keeps resolving TypeScript sources through the `source` export condition. `@bridge-ds/core` adds branch preview helpers (`previewUrl`, `snapshotUrl`, `previewComment`) and a `previews` section in `bridge.config.json`. `@bridge-ds/react` adds an opt-in staging token override: `ThemeProvider` `tokenOverride` loads an allowlisted `tokens.css` from `?bridge-tokens=`, off by default and refused in production builds unless enabled.
- 8180108: Data display: Card restyled as a flat plate with an `interactive` option and padding sizes; Badge gains `appearance` (subtle, now the default, or solid), a dot, icons and sizes (existing solid badges must pass `appearance="solid"` to keep their look); new Avatar and AvatarGroup, Table (sortable headers with aria-sort, selectable rows, sticky header, focusable scroll region, useTableSort), Accordion, Tag (removable, toggleable), Divider and Kbd. Adds avatar, tag, kbd, divider and accordion component tokens.
- 8ec801a: Feedback: Alert (five tones, actions, dismiss, correct live region), Toast (ToastProvider and useToast with success, error, warning, info, promise, update and close), Progress (linear and circular, determinate and indeterminate), Skeleton, EmptyState, plus Spinner stories and guidance. Adds alert and skeleton component tokens.
- b0da5ed: Overlays: Dialog (sizes, scrolling body, footer, close last in focus order), AlertDialog (destructive confirmations, async confirm), Drawer (start, end, bottom with swipe), Popover, Tooltip with TooltipProvider, Menu (icons, shortcuts, groups, submenus, checkbox and radio items, danger items). Every popup carries the theme, brand and density scope. Adds menu and drawer component tokens.
- b6cb68a: Bridge token system v1. Adds a brand mapping layer (`bridge` default, `ocean` alternate) between primitives and semantic tokens, a component tier (button, input, checkbox, switch, slider, card, popup, dialog, tooltip, toast, table, tabs, progress, nav), comfortable and compact density, motion durations and easings with a reduced-motion override, layers (z-index), icon sizes, breakpoints, a 1.2 type scale from 14px with tracking tokens, and self-hosted IBM Plex Sans and Mono (`@bridge-ds/tokens/fonts.css`). Primitives are regenerated in OKLCH on one lightness ladder. The build now writes `dist/resolved.json` and fails when any pair in `contrast.checks.json` drops below its WCAG minimum in any brand and theme. Fixes `color.border.strong` against `color.surface.default` (now at least 3:1 in both themes).
- 84e1383: test change bg (from Figma via DS Bridge).

  - changed `color.bg.default`

- 1f29f63: Initial foundation: DTCG 2025.10 primitives and light/dark semantic tokens built to CSS variables, plus Button, Input, Badge and Card consuming tokens only.
- 0cab1bb: Adds the tokens the Bridge docs app needed to be built on the design system (dogfooding), also requested by the admin demo (apps/admin/DS-GAPS.md):

  - Data visualization: `color.chart.series.1` to `6`, `color.chart.track`, `color.chart.grid` and `color.chart.axis`, in both themes. Series are checked at 3:1 and axis text at 4.5:1 against surfaces and the canvas in every brand and theme.
  - A `palette.categorical` role per brand (bridge: plum, ocean: orange), the fifth chart hue, kept away from each brand's accent and info hues.
  - `color.border.emphasis`: a hairline that reads before the default one (hovered cards, group dividers, dashed placeholders).
  - App shell layout: `layout.sidebar.width` (256), `layout.header.height` (56), `layout.content.max-width` (1200).
  - Scale steps: `size.40` (160, closes the gap between 80 and 240) and `size.64` (256); display sizes `font.size.900` (50) and `font.size.1000` (60) on the same 1.2 ratio, for landing heroes only.

### Patch Changes

- 73b1a6f: Add usage guidance files for Button, Input, Badge and Card, plus the list of color pairs to check for contrast. They feed the new documentation site; no visual or API change.

  For you: Nothing changes in your designs. Usage guidance, contrast checks and this changelog now live on the documentation site.

- 5c40693: New brands, from every surface. `planNewBrand` in `@bridge-ds/core` builds a brand file (primary and neutral ramps from the shared ramp engine, the starting brand's radius, fonts and theme overrides), adds the slug to `modes.brand` in `bridge.config.json`, and runs the contrast gate for the new brand in light and dark. The CLI gets `bridge brand create` and `bridge brand list`, the MCP server `bridge_list_brands`, `bridge_plan_brand` and `bridge_propose_brand`, the Figma plugin offers a new Brand mode as a new brand on Push, and the Studio has a four-step New brand flow with a live preview. The token build reads its brands from `bridge.config.json`, and `scripts/ramps.mjs` runs the same ramp engine (primitives unchanged).
