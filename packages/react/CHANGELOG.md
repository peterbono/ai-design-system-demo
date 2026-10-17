# @bridge-ds/react

## 1.0.0

### Minor Changes

- e54d2a1: Packages are publishable under the `@bridge-ds` npm scope (renamed from `@demo-ds` and `@bridge`). Each ships built ES modules, type declarations and, for React, one `styles.css`; the monorepo keeps resolving TypeScript sources through the `source` export condition. `@bridge-ds/core` adds branch preview helpers (`previewUrl`, `snapshotUrl`, `previewComment`) and a `previews` section in `bridge.config.json`. `@bridge-ds/react` adds an opt-in staging token override: `ThemeProvider` `tokenOverride` loads an allowlisted `tokens.css` from `?bridge-tokens=`, off by default and refused in production builds unless enabled.
- b6cb68a: Actions: Button gains `danger` variant, `lg` size, `iconStart`, `iconEnd`, `fullWidth` and `render` (a link stays a link); loading keeps focus. New IconButton, ButtonGroup (spaced or attached) and Link (inline, standalone, subtle, external).
- 8180108: Data display: Card restyled as a flat plate with an `interactive` option and padding sizes; Badge gains `appearance` (subtle, now the default, or solid), a dot, icons and sizes (existing solid badges must pass `appearance="solid"` to keep their look); new Avatar and AvatarGroup, Table (sortable headers with aria-sort, selectable rows, sticky header, focusable scroll region, useTableSort), Accordion, Tag (removable, toggleable), Divider and Kbd. Adds avatar, tag, kbd, divider and accordion component tokens.
- 8ec801a: Feedback: Alert (five tones, actions, dismiss, correct live region), Toast (ToastProvider and useToast with success, error, warning, info, promise, update and close), Progress (linear and circular, determinate and indeterminate), Skeleton, EmptyState, plus Spinner stories and guidance. Adds alert and skeleton component tokens.
- e8fd4a8: Forms: Field (label, description, error wired by Base UI Field) and Input rebuilt on it (prefix, suffix, sizes; label, hint and error props kept). New Textarea (autosize, character count), Select (groups, descriptions), Combobox (filtering, async loading and empty states, multiple with chips), Checkbox (indeterminate, parent), CheckboxGroup, RadioGroup, Switch, Slider (single and range), NumberField (steppers, units) and Form (server errors with a focusable error summary, FormActions footer).
- b6cb68a: Base UI foundation: components now wrap `@base-ui/react` for behavior and accessibility. Adds `ThemeProvider` (theme, brand and density scope, passed to portaled overlays), `Icon` (Lucide with token sizes), `VisuallyHidden`, and global base styles at `@bridge-ds/react/styles.css`.
- 7d3f7cd: Layout utilities: Stack, Inline, Grid (fixed columns or auto-fit by minimum item width) and Container (token widths and gutters). Gaps only accept space-scale keys.
- acd1273: Navigation: Tabs (underline with a sliding signal indicator, contained, icons, counts, vertical), Breadcrumb (aria-current, collapsing middle levels), Pagination (full and compact, getPageItems helper) and SidebarNav (sections, collapsible groups, counts, current page mark).
- b0da5ed: Overlays: Dialog (sizes, scrolling body, footer, close last in focus order), AlertDialog (destructive confirmations, async confirm), Drawer (start, end, bottom with swipe), Popover, Tooltip with TooltipProvider, Menu (icons, shortcuts, groups, submenus, checkbox and radio items, danger items). Every popup carries the theme, brand and density scope. Adds menu and drawer component tokens.
- 1f29f63: Initial foundation: DTCG 2025.10 primitives and light/dark semantic tokens built to CSS variables, plus Button, Input, Badge and Card consuming tokens only.
- fd83606: PageHeader: the top of a page with the title (h1 by default), a one-line lead, an optional meta line and the page actions, which wrap under the text on narrow screens. Lead, meta and actions are props, so the header also renders from Astro named slots.
- fd83606: SegmentedControl: pick one of two to five views or modes in a row of attached buttons (Base UI RadioGroup with native button radios). Takes an `items` array so it also renders from Astro and other static templates; the static HTML keeps role, aria-checked and data-value so a small script can drive it without hydration.

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

- 73b1a6f: Add usage guidance files for Button, Input, Badge and Card, plus the list of color pairs to check for contrast. They feed the new documentation site; no visual or API change.

  For you: Nothing changes in your designs. Usage guidance, contrast checks and this changelog now live on the documentation site.

- 6cd9c3a: Target sizes: SegmentedControl `sm` segments are at least the small control height (32px), and standalone Links are at least 24px tall (WCAG 2.5.8).
- e47f4a6: Usage guidance for Icon and VisuallyHidden, drafted by Claude from their code and marked for review.
- cf3f5bb: Adds the generated `component-specs.json` (run `npm run specs`) for Button, IconButton, Badge, Tag, Input and Card, read by the DS Bridge Figma plugin to pull them as component sets. No change to the components.
- 7261f47: Regenerates `component-specs.json` with icon and content slot swaps and the icons section. No change to the components.
- 937bd43: SegmentedControl docs: a visible label goes outside the track, to its left, and names the group with aria-labelledby. New do and don't, a WithVisibleLabel story, an external label row in AllStates and a test for the accessible name. Bridge foundation pages now show "Preview brand" and "Preview density" as captions beside the switch instead of inside the pill.
- a914c38: Skeleton docs: the preview shows an avatar, two text lines and a block (it rendered at zero width).
- Updated dependencies [e54d2a1]
- Updated dependencies [a55525d]
- Updated dependencies [8180108]
- Updated dependencies [8ec801a]
- Updated dependencies [b0da5ed]
- Updated dependencies [b6cb68a]
- Updated dependencies [73b1a6f]
- Updated dependencies [84e1383]
- Updated dependencies [1f29f63]
- Updated dependencies [5c40693]
- Updated dependencies [0cab1bb]
  - @bridge-ds/tokens@1.0.0
