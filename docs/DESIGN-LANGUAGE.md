# Bridge design language

The visual and verbal rules behind the Bridge design system (v2, direction "Field Guide"). Tokens and
components implement this document; when they disagree, fix the code or open a PR against this file.
Owner: Florian Gouloubi.

## 1. Subject, audience, mode

**Bridge** (provisional name) connects the two banks of a design system: Figma, where designers explore,
and Git, where tokens and components ship. Its screens are token diffs, pull request reviews, component
health tables, contrast matrices, governance queues and settings, plus the guidance people read before they
build.

- **Who:** product designers, front-end engineers, design system leads, PMs, and AI agents reading the same pages.
- **Where:** long sessions on a laptop or an external monitor, often next to Figma and a code editor, in both
  bright offices and late-evening dark mode.
- **Mode:** Operate first (scan, compare, approve), Read second (guidance, changelogs). Field Guide treats
  both like a well-made reference book: white pages, ink text, one strong blue, calm blocks of color that
  tell you where a new part begins. Brand lives in type and in a few deliberate color moments, not in decoration.

## 2. Principles

1. **Deep Harbor is the only strong color in content.** `#0B4A8B` (Deep Harbor) carries primary actions,
   checked controls, links and the focus ring. Nothing else on a content page is saturated. If two things
   compete for the eye, one of them is wrong.
2. **Harbor is a zone, never a highlight.** `#CFE8FF` (Harbor) appears only as large flat blocks that open
   a space: the home hero, section page headers, the Studio greeting, onboarding. Never behind dense UI,
   never as a button, a badge or a hover.
3. **White content, ink text.** Content sits on white paper. Text is ink `#15202B`; secondary text is
   `#5B6672`. Lines are a quiet `#E3E8EE`.
4. **Status is a pale tint with dark text.** Success, warning, danger and info use their `50` tint as a
   background and their `700` step as text. Solid status color is for small marks only (icons, dots).
5. **Hierarchy through type and space, not boxes.** A serif display face, a clear size ladder and generous
   space between sections do the work before borders and shadows. Things that float cast shadows; things that
   sit do not.
6. **Restful.** Long review sessions should not tire the eye: few colors, steady rhythm, no ornament that
   asks for attention twice.
7. **Every state is designed, density is a setting, words are interface.** Hover, focus-visible, pressed,
   disabled, invalid, loading and empty states exist in Storybook. One component set, two densities driven by
   tokens. Sentence case, verbs on buttons, errors that say how to recover (section 10).

## 3. Calibration: what we deliberately avoided

Two-pass plan, reviewed against the defaults a generated product UI drifts toward:

| Default we rejected | What Bridge does instead | Why |
| --- | --- | --- |
| Bright blue primary plus a second accent everywhere | One deep blue (Deep Harbor) for action, link and focus; nothing else saturated | One strong color reads as intent. Two read as noise. |
| Tinted color behind everything, or no color at all | White content, with Harbor only as large flat zone blocks at the start of a space | Color marks where you are, then gets out of the way of the work. |
| Inter as the UI face, the same sans for headings | Fraunces for display and headings, Instrument Sans for body and UI, IBM Plex Mono for code | See section 5. A serif heading gives the guide a voice; the sans keeps the tool quiet. |
| One 8px radius on everything | A radius ramp by rank: inset, control, container, overlay (6 / 12 / 20 / 20) | Radius tells you what kind of object you are looking at; rounder corners suit a softer, guide-like tone. |
| Same grey shadow under every card | Flat plates with hairline borders; shadow only on floating layers | Shadows are information (this floats above), not texture. |
| Saturated status chips and banners | Pale tints with dark text; solid color only on icons and dots | Status should be readable at a glance without shouting over content. |
| Near-black page with a single acid accent | Dark theme on deep navy ink (`ink.950`), a muted deep blue for zones, Deep Harbor lightened for actions | Dark mode is for late sessions, not for drama. |
| Tracked-out all-caps labels, eyebrows, mono as costume | Sentence case labels; mono only for code, token names and values | Labels are read hundreds of times a day; caps slow scanning. |
| Gradient washes, glass panels | Solid surfaces only | Nothing in the use scene earns them. |

## 4. Color

### Core palette (brand "bridge")

| Name | Hex | Token | Role |
| --- | --- | --- | --- |
| Ink | `#15202B` | `color.ink.900` | Text (`color.text.default`), inverse surfaces. A navy ink with a visible hue. |
| Ink secondary | `#5B6672` | `color.ink.600` | Secondary text (`color.text.muted`). 5.85:1 on white. |
| Paper | `#FFFFFF` | `color.white` | Canvas and surfaces (`color.bg.default`, `color.surface.default`). |
| Line | `#E3E8EE` | `color.ink.200` | Borders and dividers (`color.border.default`), muted fills. |
| Harbor | `#CFE8FF` | `color.harbor.200` | `color.bg.zone`: large flat blocks that open a space. Nothing else. |
| Deep Harbor | `#0B4A8B` | `color.harbor.700` | `color.action.primary.bg`, `color.control.checked.bg`, `color.text.link`, `focus.ring.color`. 8.87:1 against white. |

Status tones keep far-apart hues so they never borrow each other's meaning: teal for success
(tint `#EEFAF6`, text `#036252`), ochre for warning (tint `#FEF6EA`, text `#6F4C03`), crimson for danger
(tint `#FFF4F4`, text `#9D0639`), plum for info (tint `#F9F5FF`, text `#653D8C`). Info is plum so it never
collides with the blue of actions and links. Orange survives only as the categorical chart hue
(`palette.categorical`); it has no interface role.

### How the ramps are built

Every ramp (ink, harbor, crimson, teal, ochre, plum, orange, and the ocean brand's slate and sea) is
generated by `packages/tokens/scripts/ramps.mjs` in OKLCH on one shared lightness ladder (`50` = L 0.975 down
to `950` = L 0.205), with chroma peaking around `500`/`600`. Same step, same perceived lightness, whatever the
hue: semantic mapping stays predictable across brands. Edit the script, never the JSON.

The brand anchors are pinned. The `PINS` map in the script replaces a generated step with the exact brand
hex, so the named colors survive regeneration:

| Ramp | Pinned steps |
| --- | --- |
| `color.ink` | `200` `#E3E8EE` (Line), `600` `#5B6672` (Ink secondary), `900` `#15202B` (Ink) |
| `color.harbor` | `200` `#CFE8FF` (Harbor), `700` `#0B4A8B` (Deep Harbor) |

Every pin sits within 0.04 OKLCH lightness of its ladder step, so each ramp stays monotonic and the steps
around a pin still read as one family.

Older ramps (`steel`, `cable`) remain in the primitives for compatibility, but no brand maps to them.

### Contrast commitments (checked by the token build)

`packages/tokens/src/contrast.checks.json` lists every pair the system depends on. The build resolves each
pair for every brand and theme (296 checks today) and **fails** if one drops below its minimum. Values below
are bridge light unless noted, from `packages/tokens/dist/resolved.json`:

- Body text on canvas and surfaces: 4.5:1 minimum. Ink on white is 16.49:1.
- Muted text on canvas, surfaces and subtle backgrounds: 4.5:1. `#5B6672` is 5.85:1 on white, 5.08:1 on
  `bg.subtle`.
- Text on every action and feedback solid: 4.5:1. White on Deep Harbor is 8.87:1.
- Status text on its tint: 4.5:1. Success 6.84, warning 7.22, danger 7.74, info 7.51.
- `color.border.strong` (input, checkbox, radio and switch edges) against `surface.default` and `bg.default`:
  **3:1** (WCAG 1.4.11). Bridge measures 3.5:1.
- Focus ring and signal against canvas and surfaces: 3:1. The Deep Harbor ring is 8.87:1 on white.
- **Zone pairs.** Everything allowed on a Harbor block is checked on `color.bg.zone`:

| Pair on `color.bg.zone` | Min | Bridge light | Bridge dark | Ocean light | Ocean dark |
| --- | --- | --- | --- | --- | --- |
| `color.text.default` | 4.5 | 13.07 | 14.05 | 14.03 | 13.87 |
| `color.text.muted` | 4.5 | 4.64 | 6.40 | 4.90 | 6.37 |
| `color.text.link` | 4.5 | 7.03 | 9.60 | 4.81 | 9.61 |
| `focus.ring.color` | 3 | 7.03 | 6.47 | 4.81 | 6.52 |
| `color.action.primary.bg` | 3 | 7.03 | 9.60 | 4.81 | 9.61 |

Muted text on a bridge zone is the tightest bridge pair (4.64:1): keep secondary text on zones short, and
never lighten it. The tightest pair in the whole set is ocean muted text on `bg.subtle` (4.58:1).

### Dark theme

Canvas is deep navy ink `ink.950` (`#0B1825`), surfaces `ink.900` (`#15202B`), floating layers `ink.800`.
Text inverts to `ink.50`, muted text to `ink.400`. Zones become `harbor.900` (`#00274B`), a muted deep blue
that still marks a new space without glowing. Deep Harbor is lightened to `harbor.300` (`#AAD2FE`) for
primary actions and checked controls, with `harbor.950` (`#001732`) text on top (11.43:1); hover and active
step lighter to `harbor.200` and `harbor.100`. Links use `harbor.300`, the focus ring `harbor.400`. Status
text moves to the `300` steps on `950` tints. Shadows get darker and tighter because light shadows vanish on
dark.

### Second brand: "ocean"

Proves that the system is multi-brand. A brand only re-points the **palette roles** (`palette.neutral`,
`palette.primary`, `palette.accent`, `palette.info`...), the radius and font roles, the `typography.*` roles
and, if needed, a few semantic decisions (`brands/ocean.light.tokens.json`, `brands/ocean.dark.tokens.json`).
Ocean uses a slate neutral, a filled sea-blue primary button (`sea.600`), a plum info tone, sea links
(`link.600`/`700`), and keeps a tinted canvas (`bg.default` on `neutral.50`, slate `#F4F7FB`) behind white
surfaces. Its zones use the palest sea step (`primary.50`), since `sea.200` is too saturated for muted text and
links. Ocean sets every type role in IBM Plex Sans and keeps tighter radii (4 / 10 / 16 / 20): bridge is now
the rounder brand. Components do not change.

### Adding a brand

Studio (Tokens, Options, New brand), `bridge brand create`, the MCP tool `bridge_propose_brand` and a new mode in
the Figma Brand collection all run one planner (`planNewBrand` in `@bridge-ds/core`). It copies a starting brand,
generates the primary and neutral ramps with the same engine as `scripts/ramps.mjs` into
`primitives/<slug>.tokens.json` (`color.<slug>-primary`, `color.<slug>-neutral`; the brand file only aliases them,
never a literal value, Figma values included), pins a hex primary at the
step primary buttons use (700 from Bridge, 600 from Ocean), keeps the neutral's text and line steps at the ink
anchors' lightness, and runs every contrast pair for the new brand in light and dark. A new brand is Tier 3 and
lands only through a reviewed pull request; the token build and the Library pick it up from `bridge.config.json`.

## 5. Typography

Three families, each with one job:

- **Fraunces** (`font.family.fraunces`, role `font.family.display`): display, h1 and h2. Used in its soft
  optical style: optical sizing on and the `SOFT` axis raised, so large headings read warm and rounded
  rather than sharp. Self-hosted with all axes (`@fontsource-variable/fraunces/full.css`).
- **Instrument Sans** (`font.family.instrument-sans`, role `font.family.sans`): h3, body, UI and captions.
- **IBM Plex Mono** (`font.family.plex-mono`, role `font.family.mono`): code, token names, values, keyboard keys.

All are self-hosted and imported once through `@bridge-ds/tokens/fonts.css`.

Why these fonts:

- **A guide needs a voice.** Fraunces gives section openings the feel of a printed field guide: confident,
  warm and a little bookish, which suits a system whose job is to explain decisions.
- **The tool stays quiet.** Instrument Sans is a compact, neutral grotesque with open shapes that stay sturdy at
  12 to 14px, so tables, forms and diffs read without character getting in the way.
- **Code is code.** Plex Mono has distinct `Il1` and `0O` and true tabular figures, so token names and values
  inside sentences and diffs stay unambiguous.
- **Not the default.** The pairing avoids the Inter-everywhere look while staying highly legible.

### Type roles

Use the role tokens, not raw sizes: `typography.<role>.{size,line-height,weight,family,tracking}`.
Line heights are fixed pixel values on the 4px grid (`font.leading.*`).

| Role | Size / line height | Weight | Family (bridge) | Use |
| --- | --- | --- | --- | --- |
| `typography.display` | 64 / 68 | 500 | Fraunces | Home hero only |
| `typography.h1` | 44 / 50 | 500 | Fraunces | Page titles, zone headers |
| `typography.h2` | 30 / 38 | 600 | Fraunces | Section headings |
| `typography.h3` | 21 / 28 | 600 | Instrument Sans | Card, dialog and sub-section titles |
| `typography.body` | 16 / 26 | 400 | Instrument Sans | Reading text, guidance, changelogs |
| `typography.ui` | 14 / 20 | 400 | Instrument Sans | Labels, controls, table cells, dense views |
| `typography.caption` | 12 / 16 | 400 | Instrument Sans | Captions, badges, table meta |

Rules:

- **At most 4 font sizes on one screen.** If a screen needs a fifth, a role is being misused.
- **Measure at most 65ch** for reading text.
- Weights: 400 body, 500 labels and buttons, 600 titles, 700 only for numbers that must win a glance.
- Sentence case everywhere. Numbers in tables use `font-variant-numeric: tabular-nums`.
- Fixed pixel scale, not fluid: product UI is read at a steady distance.

### Primitive scale

The roles alias these primitives. Reach for a primitive only when no role fits, and say why in review.

| Token | px | Typical role |
| --- | --- | --- |
| `font.size.100` | 12 | caption |
| `font.size.200` | 14 | ui |
| `font.size.300` | 16 | body |
| `font.size.400` | 21 | h3 |
| `font.size.500` | 24 | Large UI numbers, KPI labels |
| `font.size.600` | 30 | h2 |
| `font.size.700` | 36 | Empty states, onboarding |
| `font.size.800` | 44 | h1 |
| `font.size.900` | 50 | KPI numbers |
| `font.size.1000` | 64 | display |

Line height primitives: `font.leading.16`, `20`, `26`, `28`, `32`, `38`, `50`, `68` (px). The unitless
`font.line-height.*` and the `font.tracking.*` steps (`tighter` -0.025em to `wide` +0.01em) remain for
component use.

## 6. Space, density and radius

### Space

4px grid: `space.0-5` (2), `1` (4), `1-5` (6), `2` (8), `3` (12), `4` (16), `5` (20), `6` (24), `7` (28),
`8` (32), `10` (40), `12` (48), `16` (64), `20` (80), `24` (96). Tight inside groups, generous between them,
more space above a heading than below it. Separate page sections by 64 to 80px (`space.16` to `space.20`):
space, not rules, tells you a new part has begun.

### Density

| Token | Comfortable | Compact |
| --- | --- | --- |
| `control.height.sm / md / lg` | 32 / 44 / 48 | 28 / 36 / 40 |
| `control.padding-x.sm / md / lg` | 12 / 16 / 20 | 8 / 12 / 16 |
| `control.gap` | 8 | 6 |
| `layout.gap` | 16 | 12 |
| `layout.inset` | 20 | 16 |
| `table.row-height` | 48 | 36 |
| `table.cell-padding-x` | 16 | 12 |
| `menu.item-height` | 36 | 28 |

Comfortable is the default and the right choice on touch: the default control (`md`) is 44px, the
comfortable touch size, through the `size.11` primitive. Compact is for expert, data-dense screens (token
tables, review queues). Both keep every target at or above 24px (WCAG 2.2 target size).

### Radius strategy: rank, not one value

Radius encodes what kind of object you are looking at. Bigger, higher-rank surfaces get bigger radii; small
parts nested inside controls get the smallest. Nested radii follow `outer = inner + padding` so corners stay
concentric.

| Role token | Bridge | Ocean | Used by |
| --- | --- | --- | --- |
| `radius.inset` | 6px | 4px | Checkbox box, tag, kbd, menu item highlight, progress track |
| `radius.control` | 12px | 10px | Buttons, inputs, selects, tabs, segmented controls |
| `radius.container` | 20px | 16px | Cards, zone blocks, alerts, popovers, menus, tables |
| `radius.overlay` | 20px | 20px | Dialogs, drawers, toasts |
| `radius.pill` | 9999px | 9999px | Switch, avatar, badge, slider thumb only |

Primitives: `radius.xs` 2, `sm` 4, `md` 6, `lg` 10, `xl` 12, `2xl` 16, `3xl` 20, `full` 9999. Bridge is the
rounder brand, soft like a well-thumbed guide; Ocean is tighter. Same components, different character.

## 7. Elevation, layers, focus

| Token | Use |
| --- | --- |
| `elevation.raised` | Interactive cards on hover, sticky headers |
| `elevation.overlay` | Popover, menu, select list, combobox list, tooltip |
| `elevation.modal` | Dialog, alert dialog, drawer, toast |

Shadows always have a vertical offset and a soft blur (light from above), two layers (a tight contact shadow
plus a wide ambient one). No zero-offset glows. On a white canvas, cards are separated by their hairline
border, not by a tint or a shadow.

z-index scale: `z.sticky` 100, `z.dropdown` 1000, `z.overlay` 1100, `z.modal` 1200, `z.popover` 1300,
`z.toast` 1400, `z.tooltip` 1500.

**Focus:** a 2px `focus.ring.color` outline (Deep Harbor in light, `harbor.400` in dark) offset by 2px,
shown on `:focus-visible` only. Inputs move the ring inside (`offset 0` plus border color) so it hugs the field.

Breakpoints (`breakpoint.sm/md/lg/xl` = 640/768/1024/1280) are exported to CSS and TS for JS logic; CSS media
queries must use the same literal values (CSS variables cannot be used in media queries).

## 8. Motion

Motion is mechanical and damped, like a well-oiled hinge: it confirms what changed and gets out of the way.

| Token | Value | Use |
| --- | --- | --- |
| `motion.duration.instant` | 75ms | Color and background changes on hover and press |
| `motion.duration.fast` | 150ms | Tooltips, menus, popovers, checkbox ticks |
| `motion.duration.moderate` | 200ms | Dialogs, accordions, tabs indicator |
| `motion.duration.slow` | 300ms | Drawers, toasts entering |
| `motion.easing.standard` | `cubic-bezier(0.2, 0, 0, 1)` | State changes in place |
| `motion.easing.enter` | `cubic-bezier(0.16, 1, 0.3, 1)` | Things appearing (exponential ease-out) |
| `motion.easing.exit` | `cubic-bezier(0.4, 0, 1, 1)` | Things leaving, always shorter than entering |

Popups scale from 0.96 and fade from their anchor (`transform-origin` from Base UI). No bounce, no
orchestrated page loads. `prefers-reduced-motion: reduce` sets every duration to `0ms` in `tokens.css`,
and any transform-based movement is replaced by opacity. Spinners keep rotating, slower, because a frozen
spinner looks like a crash.

Each component page in the Library has a generated "Motion and interaction" section, read from the component's CSS
like the props table: what makes it move (hover, press, check, open), what changes, the duration and easing tokens
with their values, and what reduced motion does. When a change touches motion tokens or transitions, its review
shows a "Motion changes" block with the old and the new motion playing side by side. Both apply the rules above;
they do not add any.

## 9. Iconography

**Lucide** (`lucide-react`, ISC license, a permissive MIT-equivalent license, forked from Feather which is MIT).
Chosen for its consistent 24px grid, rounded joins that sit well next to Instrument Sans, and broad coverage
of developer and design concepts (git branches, diffs, tokens, layers).

- Always through the `Icon` component: `<Icon icon={GitBranch} size="sm" />`.
- Sizes: `icon.size.xs` 12, `sm` 16 (default in controls), `md` 20 (navigation), `lg` 24.
- Navigation items use 20px icons so the side nav reads at a glance; controls keep 16px.
- Stroke `icon.stroke` 1.75 at every size so icons match the text weight; icons inherit `currentColor`.
- Decorative by default (`aria-hidden`). Pass `label` when the icon carries meaning on its own.
- One family only. No emoji or Unicode glyphs standing in for icons.

## 10. Voice and tone for UI copy

Bridge speaks like a calm, precise colleague who reviews your PR: specific, brief, never cute.

- **Sentence case** for everything: buttons, titles, menu items, tabs.
- **Buttons start with a verb and name the outcome:** "Publish tokens", "Approve change", "Open pull request".
  Never "OK", "Submit", "Click here". The same verb follows through: "Publish" produces "Published".
- **Errors** say what happened and how to fix it, without blame or apology:
  "Token name already exists. Pick another name or edit the existing token." Not "Oops, something went wrong."
- **Empty states** invite the next action: "No pull requests yet. Changes you sync from Figma appear here."
- **Confirmation** names the object and the consequence: "Delete 3 tokens? Components that use them will
  fall back to their defaults."
- **Numbers and units**: digits, not words ("3 tokens"); units with a space ("16 px" in prose, `16px` in code).
- **Punctuation**: no exclamation marks in UI, no em dashes (use a colon, a comma or parentheses), no
  trailing periods on buttons, labels or single-sentence tooltips.
- **Vocabulary**: use the user's words. "Token", "component", "theme", "brand", "pull request", "review".
  Not "entity", "artifact", "resource".

## 11. Accessibility floor

- WCAG 2.2 AA. Contrast pairs enforced at build time (section 4), including every pair allowed on a zone.
- Every interactive component: keyboard operable, visible focus, correct role and name, state exposed
  (`aria-checked`, `aria-expanded`, `aria-invalid`, `aria-busy`...). Base UI provides the behavior; our
  wrappers must not break it.
- Color is never the only signal: status has text and an icon, invalid fields have a message.
- Targets at least 24 by 24 px in both densities; the default control is 44px.
- Storybook `addon-a11y` runs in error mode; Vitest + axe-core covers keyboard and ARIA behavior.
