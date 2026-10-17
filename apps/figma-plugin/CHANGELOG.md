# @bridge-ds/figma-plugin

## 0.2.0

### Minor Changes

- 5c40693: New brands, from every surface. `planNewBrand` in `@bridge-ds/core` builds a brand file (primary and neutral ramps from the shared ramp engine, the starting brand's radius, fonts and theme overrides), adds the slug to `modes.brand` in `bridge.config.json`, and runs the contrast gate for the new brand in light and dark. The CLI gets `bridge brand create` and `bridge brand list`, the MCP server `bridge_list_brands`, `bridge_plan_brand` and `bridge_propose_brand`, the Figma plugin offers a new Brand mode as a new brand on Push, and the Studio has a four-step New brand flow with a live preview. The token build reads its brands from `bridge.config.json`, and `scripts/ramps.mjs` runs the same ramp engine (primitives unchanged).
- 95db484: Writing help for requests and the Push description. The request form (title and summary) and the Push Description now prefill a draft written from the detected changes, never rewritten once you type. "Copy for Claude" copies a ready prompt for Claude.ai or Claude Desktop (your own Claude plan, no key) and "Paste Claude's answer" fills the fields from the reply. Optionally, with your own Anthropic API key in Settings (Claude (optional), stored in client storage on this computer, billed to your Anthropic account), "Draft with Claude" writes the text from the change table and the before and after images. The manifest now also allows https://api.anthropic.com.
- 1d8204a: Push tab: component change requests. Component changes (new or removed variant, prop change, another variable bound to a part, a visual change no variable explains, a new component) become GitHub issues from a Components group under the variables. Variable edits stay the pull request flow, and a Figma-only restructure triggers nothing. The token now needs Issues: Read and write.
- abe4395: "Draft with my Claude": your own Claude (Claude Desktop or Claude Code on your plan, no API key) writes request and Push texts through the Bridge MCP server. The plugin writes the changes and the before and after images to the `bridge-requests` branch, shows "Waiting for your Claude" with the sentence to say, checks every 5 seconds for up to 10 minutes, fills the fields you did not edit and offers Claude's text for the ones you did, then deletes the file once you send or cancel. Settings, Claude (optional), now lists three ways: MCP (recommended, with the Claude Desktop config and the Claude Code command), Copy for Claude, and an API key ("Draft with Claude (API key)").
- 7261f47: Pulled components get real icons and content slots, swappable like a Figma library. An Icons page holds one
  component per Lucide icon (`Icon/Plus`, drawn from its SVG, bound to the icon tokens) and a Slots page holds
  `Slot/Card body text` and `Slot/Media`. Icon parts of Button, IconButton, Badge and Tag, and Card's body, are instances
  of their code default with an INSTANCE_SWAP property (`Icon`, `Icon start`, `Icon end`, `Body`); Card `Padding=none`
  shows Media. Swapping in a variant is a visual change only when it differs from the code default; a fresh pull still
  sends nothing. Placeholders from earlier pulls are replaced in place.
- cf3f5bb: Pull tab: pull components. The coded components (Button, IconButton, Badge, Tag, Input, Card) become component sets on a Components page, with variant properties from their props, a State axis, text and boolean properties, and every fill, stroke, radius, padding, gap, size and text property bound to the pulled variables. Opt-in from the Pull preview ("Also pull components"), which lists new, updated and unchanged sets and what cannot be bound. Re-pulls update sets in place, flag variants removed in code as orphans and store the signature baseline, so Push shows no request after a pull.
- fa17ca1: Pull reviews component updates like Figma: each generated set that changed in code shows a before thumbnail, then
  the after thumbnail once updated, and what the update changes (variants, props, bound variables). "Update" updates
  one set; "Update all" updates the rest with the variables. Variables stay all-or-nothing; new sets stay opt-in.
- f9c63d7: Push works like publishing a library in Figma: a Changes list grouped Variables and Components with a checkbox per
  item (all checked by default, select all per group), a Description that opens the pull request and every request, and
  one "Push for review". Unchecked variable edits stay in Figma; unchecked component changes are not sent. "Mark as
  experimental" (row menu) stores a durable mark on the variable or component set: experimental items show a tag and
  start unchecked on every push.

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

- 5432de0: Community art in the Field Guide direction (Fraunces, Harbor zone, Deep Harbor), with fresh screenshots of the plugin (595 variables) and Bridge Studio.
- c0c60e9: Community gallery shows the plugin in the Bridge brand.
- 0e51ec2: Published Figma Community id in the manifest, and a Community listing that matches the submitted description.
- 019a220: Pulled components: Badge md gets its padding and min height (a `calc()` of tokens is resolved and set, reported as "set,
  not bound"; a `calc()` of one token is bound). Card is drawn at the `size.80` width, its header, body and footer fill it,
  body text wraps instead of collapsing to 0px, and it clips its content so the footer stays inside the rounded corners.
  Tag loses its extra "label" wrapper frame (a re-pull moves the layers and removes it). Variant grids keep the same gap
  between rows and columns of different sizes. Specs gain `clip` and `fill` on parts and calc() expressions of token paths.
- 427154e: Plugin: "Copy a prompt" removed; Draft with Claude starts your own Claude directly when no API key is saved; the Claude settings card shows two options as rows with their state; code-only details are no longer listed on Pull and Push.
- 0c21140: Action bar buttons are 36px tall, a lone action fills the bar, and a mouse click no longer leaves a focus ring on the tab after re-render.
- 51da15c: Idle Pull and Push screens explain the flow in three steps instead of a Source card with a Change link.
- 73a5142: Pull: "Replace with main" lets main win over Figma edits (Figma-only variables stay), and Apply shows when the only work is recreating variables.
- 7881c5a: Pull recreates variables deleted in Figma that other tokens still alias, does not read an alias it could not set as a Figma edit, and treats a file whose synced collections were deleted as a first pull.
- c6421c0: One verb for the push flow: "Push your edits for review", step "Push for review", button "Push for review".
- f8d80da: Settings: a connected repository shows as one row (repo, branch, folder, Connected) with Edit; the save bar only shows while setting up or editing.
- f949c6f: Settings: a saved GitHub token shows as a Connected state row with Replace and Remove; the field appears only to replace it.
- 1325d8b: Plugin UI in the Bridge brand (Deep Harbor, Instrument Sans, Plex Mono, Fraunces summary in a Harbor zone, light and dark), and a summary-first Pull screen: one status line, then groups whose title, count and action share one line.
- 6d36730: Plugin screens in the Field Guide layout: a Harbor intro with a line drawing on every idle, connect and result screen, a Source card, Settings as cards with a link to create a token, Deep Harbor tab indicator.
- Updated dependencies [e31bac2]
- Updated dependencies [5b9d677]
- Updated dependencies [3e59115]
- Updated dependencies [e54d2a1]
- Updated dependencies [bac1cb2]
- Updated dependencies
- Updated dependencies [a55525d]
- Updated dependencies [f103729]
- Updated dependencies [cd5565e]
- Updated dependencies [95db484]
- Updated dependencies [cf3f5bb]
- Updated dependencies [abe4395]
- Updated dependencies [7261f47]
- Updated dependencies [a6a3a46]
- Updated dependencies [d5d263b]
- Updated dependencies [c66908c]
- Updated dependencies [525217f]
- Updated dependencies [5c40693]
- Updated dependencies [019a220]
- Updated dependencies [a0142d2]
- Updated dependencies [36cb504]
- Updated dependencies [2c79d5d]
  - @bridge-ds/core@0.2.0
