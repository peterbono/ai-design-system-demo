# @bridge-ds/react

## 1.8.1

### Patch Changes

- 009a5ee: Compare with code: popup examples with HTML elements (a list, a paragraph) are compared instead of skipped, a tooltip is rendered with its trigger instead of failing, a size difference is said first ("height 89 in Figma vs 48 in code") instead of a small pixel score, and the list says "Show all 57 compared" next to a headline that counts every set.

## 1.8.0

### Minor Changes

- 29162d9: Badge: the sm size gets 8px side padding (space-2) instead of 6px, so small badges no longer feel cramped. Drafted from a Figma change (#325).

### Patch Changes

- aaac948: AvatarGroup: avatars overlap by a sixth instead of a quarter, so the second of two initials is never cut.
- 57b8d89: Component specs treat a button or a select (including the Base UI part that renders one, read from Base UI's docs) as border-box: NumberField steppers are their height token wide again.
- 3ed1ee5: ButtonGroup: the focus rule of attached groups uses `> :focus-visible`, same behaviour, no universal selector.
- 64d3e8b: Combobox: a chip cut by the field width shows its full value on hover (title).
- 9044d1a: Combobox: the listbox takes the field's name (its `label`, `aria-label` or `aria-labelledby`), so it is never an anonymous list, including while it closes.
- ea27992: Designer words: screens a designer reads say "change" and "library", never branch, merge or main. The share and
  product-branch sentences of `@bridge-ds/core` (`shareDescription`, `SHARE_EXPLAIN`, `libraryPreviewState`,
  `productBranchSentence`) now read "This change was added to the library", "Your feature uses a preview of the library
  change". The MCP fallback share sentence follows. ChoiceCard docs examples say "your change". Gate reasons, status
  labels and developer texts (CLI, MCP, GitHub) keep their git words.
- e1d05e0: Drawer: a body taller than the sheet is now a focusable region named by the title, so it can be scrolled with the keyboard.
- 788b3f8: Stories per Figma variant for the sets whose checked state comes from their group (ChoiceCard, Radio, MenuRadioItem), with a `checked` arg the render turns into the group's value, so the Storybook measure maps each story to its variant.
- ff50cd9: Button stories take `disabled` as a control, so the Storybook measure reaches the Disabled variants. The Figma plugin reads measured specs with the core types, part pairing and state matching.
- 1c5563b: Menu: the item highlight is concentric with the popup corners.
- 8fa49c7: Popover: the arrow no longer makes the popup show scrollbars when it opens above its trigger. The content scrolls inside its own padded area.
- efa01d6: Component specs count height and width as the content box (a bordered table cell is its height plus its border), the Figma build draws an empty sized slot at its padding instead of 100px, and stories reach every Figma variant: a disabled control on IconButton, Input, Select, Combobox and Textarea, and Figma variant stories for AccordionItem, MenuItem, MenuCheckboxItem, MenuSubmenu and TableEmpty.
- 9ec466a: Component specs match the code in two places the generator misread: menu parts drawn alone take the popup's snug line height, and the page header title takes its desktop (h1) size, as width media queries are now read at the 1200 px the code images use.

## 1.7.0

### Minor Changes

- d1e0bc5: The agent mark of `Avatar kind="agent"` (and `avatarHtml({ kind: 'agent' })`) is now the Field Guide robot from the
  landing page: a rounded head with an antenna, two dot eyes, a smile, side ears and two legs, drawn as one round-cap
  stroke in currentColor with no fill, so it keeps the tile contrast in light and dark and reads at the xs size (16px
  mark). It replaces the prompt chevron and cursor. `AGENT_MARK` keeps its shape (`viewBox`, `path`, `strokeWidth`,
  `color`); its `viewBox` is now `0 -0.8 24 24` and its `strokeWidth` 1.8. The accessible name stays "Claude AI". Studio,
  the Library and the docs pick it up through the Avatar; the regenerated component specs carry it to the Figma plugin.

### Patch Changes

- c96cdc2: Page filter bars use one control size, md, like the Library tokens page. Studio Components (search and family
  Select), the Show filter of change requests and explorations, the History filters and the branch filter on Studio
  home moved from sm to md, so the search, Select and SegmentedControl in a bar share one height. The Input, Select and
  SegmentedControl guidance now says md for a page's filter bar and keeps sm for dense toolbars, menus and panels.

## 1.6.0

### Minor Changes

- 8cdcb9a: Avatar agent: Bridge now draws its own agent mark (a prompt chevron and cursor line, Deep Harbor on a Harbor rounded square tile) instead of shipping the Claude logo, which is an Anthropic trademark. `brand="claude"` still works and keeps the name "Claude AI". New `AGENT_MARK` export; `CLAUDE_MARK` stays as a deprecated alias of it. New optional `mark` prop for a vendor logo you have the brand owner's approval to use. The agent tile token `color.agent.surface` now follows the Harbor zone in every theme and brand. The Figma UI kit gets a Kind axis (person, agent) drawing the new mark, and the spec generator keeps an SVG line join.

### Patch Changes

- Updated dependencies [8cdcb9a]
  - @bridge-ds/tokens@1.6.0

## 1.5.0

### Minor Changes

- b4edf85: Avatar: illustrated faces and Claude's identity.

  - `Avatar fallback="illustrated"`: without a photo (or when it fails), a drawn face that is always the same for the same `seed` (a login), on the Harbor zone color. The drawings are the DiceBear "Notionists" style (design CC0 1.0 by Zoish, code MIT), generated locally with no network. They weigh about 120 kB gzipped, so they live in a separate entry: import `Avatar` from `@bridge-ds/react/avatar-illustrated`. The main entry keeps initials as the default and stays light; `illustration` takes a ready image if you draw faces yourself.
  - `Avatar kind="agent" brand="claude"`: the Claude mark on a cream tile, same round shape as people, named "Claude AI", to attribute work Claude did. The Claude mark is an Anthropic trademark: check the Anthropic brand guidelines before shipping it in a product.
  - `avatarHtml()` in `@bridge-ds/react/dom`, the same markup for rows built in plain scripts.
  - Tokens: `color.illustration.surface` (the Harbor zone color, a lighter step in dark so line drawings stay readable) and `avatar.illustrated-bg`; `color.agent.surface` (cream, the same in both themes), `avatar.agent-bg` and `avatar.agent-border`.
  - Studio: change rows, the change and history details and explorations show a face and the person's display name instead of "@login"; work Claude made, and Claude's guidance drafts, show Claude's identity.
  - Studio Quality: the library health cards (contrast checks, adoption, guidance) open the page, with their detail below, and Share copies a short summary for Slack or a slide or downloads the header as an image.

### Patch Changes

- 7b53159: Motion is documented and reviewed from the code. The spec generator now records how a part opens and closes: the "Opening and closing" motion note carries the code's `enter` and `exit` transitions (duration, easing and their motion tokens, read per element so a drawer's side class and its popup class count together), and looping animations carry their `durationToken`. `componentMotion` returns them as `opening` and lists their tokens, so `componentsUsingMotionToken(specs, "motion.duration.moderate")` finds Dialog and AlertDialog. component-specs.json is regenerated (popup sets gain their open and close motion).

  Every Library component page has a generated "Motion and interaction" section in its Tokens tab: when it moves (hover, press, check, open, close, loops), what changes, the duration token with its value and the easing token in words, and what reduced motion does, in one sentence. Components without motion say so in one line; motion the specs cannot place is said, never denied.

  For branch reviews, `MotionChanges` (components/ds/studio/MotionChanges.tsx) shows a plain sentence per motion change, two looping previews of the same component at the old and new motion with Replay, and the other components it touches; still frames under reduced motion. `motionChanges` (lib/motion-changes.ts) computes the changes from the token sets and specs at both commits; `mountMotionChanges` (scripts/reviews/motion-changes.ts) mounts the block from a review page.

- Updated dependencies [b4edf85]
  - @bridge-ds/tokens@1.5.0

## 1.4.1

### Patch Changes

- 6b07b05: Check fidelity: the Pull tab compares every generated Figma variant with the same variant rendered from code and says, per component, "Matches the code" or "Differs from the code: 12% of pixels, size 120x40 vs 118x40", with Figma, code and differences side by side. Nothing in the file changes. Core adds the pure comparison (`compareImages`, tolerant of font rasterization and antialiasing), the storable `FidelityReport` and the variant to code mapping (`planReference`); `bridge figma-references` (visual) captures the code images from Storybook, published on main by the Figma references workflow to the `bridge-visual` branch. React adds a hidden Storybook fixture, "Internal/Figma reference", not part of the package.

## 1.4.0

### Patch Changes

- 837d215: Dark mode polish and leftovers from the critiques.

  - Tokens: `color.surface.strong` (Deep Harbor in both themes, for a strong mode surface) and `color.feedback.neutral.bg` (the fill of a status with no tone, one step off every surface in both themes), each checked by a new contrast pair. `popup.border` steps up to `color.border.emphasis` so a list opened inside a Dialog keeps an edge in dark.
  - SegmentedControl: the selected segment takes the checked control color as its edge, like a pressed Button toggle; it had no edge in dark.
  - Banner `appearance="strong"`: `color.surface.strong` with `color.text.on-solid` and a matching focus ring. In dark it was the light primary action color and read like a Harbor zone.
  - Badge neutral (subtle): `color.feedback.neutral.bg`, so grey status chips keep their fill on dark cards.
  - Docs site: the owner override confirmation is the DS Dialog for plain scripts (Textarea, Alert, SegmentedControl, ButtonGroup) instead of a native dialog; All tokens filter controls share one size; Quality audit tables stack on phones; the Changes tabs fit a phone; Changes rows say "Library moved on: N updates"; failing developer tests are never "Your turn" for the designer who made the change; the search palette shows the nav icons; Tokens type chips use the selected look; rows of a viewed change say "Changed" or "New"; "Bring in the latest library" uses the standard control height.

- Updated dependencies [837d215]
  - @bridge-ds/tokens@1.4.0

## 1.3.0

### Minor Changes

- a54ac38: `@bridge-ds/react/dom` gains the Dialog for pages without React at runtime: `dialogHtml()` renders the exact markup of `<DialogContent>` (same classes, same look), and `bindDialogs()`, `openDialog()`, `closeDialog()`, `isDialogOpen()` and `dialogReturnValue()` give it the React Dialog behavior: focus moves in and is trapped, the page behind is inert and does not scroll, Escape and the scrim close it, focus returns to the trigger, `aria-modal`, `open`, `cancel` and `close` events, and a `<form method="dialog">` inside closes it with the submit button's value. A parity test compares it with the React Dialog. SegmentedControl: the selected segment uses the raised surface, so it no longer disappears into its track in dark mode (light is unchanged).

  The audit counts a native element only when the design system has a component that replaces it: `<img>` is no longer a miss in a design system without an Image component.

  The docs site has no temporary audit allowlist any more: its prose links are the DS Link or ButtonLink, its icons are the DS Icon (the site's own glyphs, drawn through `createLucideIcon`), the Quality audit table is the DS Table, and the search palette, New token, Send for review, Connect GitHub and Undo planner dialogs are DS Dialogs opened by their scripts. Every Studio header control is the DS sm size.

## 1.2.1

### Patch Changes

- 71bbb8e: Usage guidance for Icon.

## 1.2.0

### Minor Changes

- f1a8b55: Five new components and a supported path for pages without React. `CodeBlock` (code or a command in Plex Mono with a copy button that says "Copied"), `TokenValue` (a token name and value with a color swatch, for before and after values), `Checklist` and `ChecklistRow` (status icon, title, one line of detail and the action on the same row), `ChoiceCardGroup` and `ChoiceCard` (radio choices shown as cards with a title and a description) and `Banner` (a page-level mode banner, Deep Harbor or neutral, optionally sticky). The new `@bridge-ds/react/dom` entry renders Badge, CodeBlock, TokenValue and Checklist as HTML strings with the exact markup and classes of the React components, and adds `tooltipAttributes()` with `bindTooltips()` and `bindCodeBlocks()` for plain-script pages. `bridge audit` counts these renderers as design system components and now flags homemade look-alikes in script-built markup (`class="pill"`, `data-tip` tooltips). Studio and the Library adopt them in place of their homemade pills, tooltips, command rows, value chips, checklist, radio cards and mode banners.
- 67ae8f7: Variants and props for the gaps Studio and the admin worked around.

  - Button and IconButton: `pressed` makes a toggle (`aria-pressed`, a selected fill and a Deep Harbor edge; the look follows the attribute, so a script can drive a static toggle). Button `variant="link"` looks like a text link and stays a button, with the DS focus ring. `variant="inverse"` is the action on a strong surface (Deep Harbor, `color.surface.inverse`).
  - SegmentedControl: `appearance="strong"` fills the selected segment with Deep Harbor. Any number of segments: when they do not fit (a phone), the track scrolls sideways and fades the edge that hides segments instead of widening the page, and the selected segment scrolls into view. The focus ring now sits inside the segment so the track never clips it.
  - Select: `badge` on an option (a status or a count), shown on the item and in the trigger once selected. `portalContainer` on Select and Combobox.
  - Combobox, Select and Menu popups sit on the popover layer, above a Dialog or Drawer, so a list opened inside a dialog is never covered.
  - Menu: `icon` also takes an element (a brand mark); leading icons and indicators show reliably and keep labels aligned.
  - Table: `width` (token length, percentage or a fraction like `0.35`) and `minWidth` on TableHead and TableCell, `layout="fixed"`, and `narrowLayout="stack"`: under about 480px each row becomes a card, every value beside its column name (`label` on a cell, or the header text).
  - Alert: `actionsPlacement="inline"` puts the action at the end of a short message and under it on a phone.

  Adopted in Studio (Changes status filter on phones, the Viewing select's status badges, view and edit banners, Components "need guidance" filter, Settings approvals on phones, Start a change menu icons and families), on the Library site (terminal Copy buttons, Accessibility Compare) and in the admin Bridge toolbar (Before/After and Show what changed toggles). Homemade CSS for these is removed.

### Patch Changes

- 0cfc3ff: Select: the label and badge row in the trigger now applies to every Select, not only disabled ones. A stray selector limited it to disabled triggers, so badges sat under the label and the narrow-trigger rule never ran.

## 1.1.0

### Minor Changes

- dfa95ed: Textarea gets `appearance="inline"` for editing existing text in place: no border, no resize handle, the surrounding
  font, size and line height, a height that fits the content (`field-sizing: content`, measured without moving the page
  where it is not supported), a fill and hairline on hover and the DS focus ring on focus. Never use it in forms.
  The Library edit mode now uses it instead of restyling Textarea internals.

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
