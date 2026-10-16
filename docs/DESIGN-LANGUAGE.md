# Bridge design language

The visual and verbal rules behind the Bridge design system (v1). Tokens and components implement this
document; when they disagree, fix the code or open a PR against this file. Owner: Florian Gouloubi.

## 1. Subject, audience, mode

**Bridge** (provisional name) connects the two banks of a design system: Figma, where designers explore,
and Git, where tokens and components ship. Its screens are token diffs, pull request reviews, component
health tables, contrast matrices, governance queues and settings.

- **Who:** product designers, front-end engineers, design system leads, PMs, and AI agents reading the same pages.
- **Where:** long sessions on a laptop or an external monitor, often next to Figma and a code editor, in both
  bright offices and late-evening dark mode.
- **Mode:** Operate first (scan, compare, approve), Read second (guidance, changelogs). The interface should
  disappear into the task. Brand lives in precise details, not in decoration.

## 2. Principles

1. **Structure is steel, signal is orange.** The interface is built from a calm steel-blue neutral ramp.
   International Orange, the paint on the world's best-known suspension bridge, is reserved for one job:
   showing *where you are and what is happening now* (focus, the active tab, the current page, progress).
   It never decorates. If everything is orange, nothing is.
2. **Selection is ink.** Checked, selected and primary states use the steel ink, not a hue. Ink keeps
   committed choices calm and leaves color free to mean status.
3. **Hierarchy through radius, weight and space, not boxes.** Radii grow with the size and rank of a surface
   (section 6). Weight and spacing carry hierarchy before borders and shadows do.
4. **Things that float cast shadows; things that sit do not.** Cards and panels are flat plates with a hairline
   edge. Only popovers, menus, dialogs, drawers and toasts get elevation.
5. **Every state is designed.** Hover, focus-visible, pressed, disabled, invalid, loading, empty. A state
   that is not in Storybook does not exist.
6. **Density is a setting, not a fork.** One component set, two densities (comfortable, compact) driven by tokens.
7. **Words are interface.** Sentence case, verbs on buttons, errors that say how to recover (section 10).

## 3. Calibration: what we deliberately avoided

Two-pass plan, reviewed against the defaults a generated product UI drifts toward:

| Default we rejected | What Bridge does instead | Why |
| --- | --- | --- |
| Indigo or blue primary button, one accent everywhere | Steel ink primary; orange only as a signal; blue only for links and info | Blue-everything reads as any SaaS. Ink is calm for an approval tool and frees color for status. |
| Inter as the UI face | IBM Plex Sans + IBM Plex Mono | See section 5. Plex has a mechanical, engineered voice that fits a tool about systems. |
| One 8px radius on everything | A radius ramp by hierarchy: inset, control, container, overlay | Radius tells you what kind of object you are looking at. |
| Same grey shadow under every card | Flat plates with hairline borders; shadow only on floating layers | Shadows are information (this floats above), not texture. |
| Near-black page with a single acid accent | Dark theme on a blue-steel night (`steel.950`, a visible hue), orange still rare | Dark mode is for late sessions, not for drama. |
| Tracked-out all-caps labels, eyebrows, mono as costume | Sentence case labels; mono only for code, token names and values | Labels are read hundreds of times a day; caps slow scanning. |
| Gradient washes, glass panels | Solid surfaces only | Nothing in the use scene earns them. |

## 4. Color

### Core palette (brand "bridge")

| Name | Hex | Token | Role |
| --- | --- | --- | --- |
| Fog | `#F4F7FA` | `color.steel.50` | Light canvas behind panels. A cool, faintly blue grey: never cream. |
| Deck | `#FFFFFF` | `color.white` | Surfaces: cards, inputs, menus, dialogs. |
| Steel ink | `#1C2735` | `color.steel.900` | Text, primary buttons, checked controls. A steel navy with a visible hue. |
| Slate | `#636D79` | `color.steel.600` | Secondary text. 4.9:1 on Fog. |
| Signal orange | `#E64611` | `color.orange.500` | Focus ring, active indicators, progress. 3.7:1 on Fog (non-text, passes 1.4.11). |
| Cable blue | `#22749E` | `color.cable.600` | Links and the info tone. |

Status hues sit far apart on the color wheel so they never borrow each other's meaning:
teal for success (`#007E6A`), ochre for warning (`#8E6201`), crimson for danger (`#C3184C`, a raspberry red
pushed away from the orange signal), cable blue for info.

### How the ramps are built

Every ramp (steel, orange, crimson, teal, ochre, cable, and the ocean brand's slate, sea and plum) is
generated in OKLCH on the same lightness ladder (`50` = L 0.975 down to `950` = L 0.205), with chroma peaking
around `500`/`600`. Same step, same perceived lightness, whatever the hue: `600` on white always lands near
5:1, `700` near 7.5:1. That makes semantic mapping predictable across brands.

### Contrast commitments (checked by the token build)

`packages/tokens/src/contrast.checks.json` lists every pair the system depends on. The build resolves each
pair for every brand and theme and **fails** if one drops below its minimum:

- Body and muted text on canvas, surfaces and subtle backgrounds: 4.5:1.
- Text on every action and feedback solid: 4.5:1.
- `color.border.strong` (input, checkbox, radio and switch edges) against `surface.default` and `bg.default`:
  **3:1** (WCAG 1.4.11). v0 failed this at 1.5:1 (`neutral.300` on white); v1 uses `steel.500`.
- Focus ring and signal against canvas and surfaces: 3:1.

### Dark theme

Canvas `steel.950`, surfaces `steel.900`, floating layers `steel.800`. Text inverts to `steel.50`; the
primary button inverts to a light steel plate with ink text. Status text moves to the `300` steps, solids stay
at `600` so white text keeps 4.5:1. Shadows get darker and tighter because light shadows vanish on dark.

### Second brand: "ocean"

Proves that the system is multi-brand. A brand only re-points the **palette roles** (`palette.neutral`,
`palette.primary`, `palette.accent`, `palette.info`...), the radius roles and, if needed, a few semantic
decisions. Ocean uses a slate neutral, a filled sea-blue primary button, a plum info tone (so info never
collides with the blue primary) and rounder radii. Components do not change.

## 5. Typography

**IBM Plex Sans** (UI and text) and **IBM Plex Mono** (code, token names, values, keyboard keys).
Self-hosted with `@fontsource-variable/ibm-plex-sans` and `@fontsource/ibm-plex-mono`, imported once through
`@bridge-ds/tokens/fonts.css`.

Why Plex:

- **Subject fit.** Plex was drawn around the relationship between people and machines. Bridge exists to
  connect human design decisions to machine-readable code. Its grotesque has engineered, slightly squared
  curves that suit a tool about systems, without the coldness of a DIN.
- **Operate mode needs.** True tabular figures for diffs and tables, distinct `Il1` and `0O`, sturdy
  shapes at 12 to 14px, a variable weight axis (100 to 700) in a single file.
- **One superfamily.** Plex Mono shares metrics and voice with Plex Sans, so a token name inside a sentence
  does not jump out of the line.
- **Not the default.** It avoids the Inter-everywhere look while staying familiar and highly legible.

### Scale

Modular, ratio **1.2 (minor third)** anchored at a **14px** UI base, rounded to whole pixels. A tight ratio
suits product UI, where there are many type roles and big jumps create noise.

| Token | px | Role | Line height | Tracking |
| --- | --- | --- | --- | --- |
| `font.size.100` | 12 | Captions, badges, table meta | 1.4 (`snug`) | +0.01em |
| `font.size.200` | 14 | UI text, labels, table cells, body in dense views | 1.5 (`normal`) | 0 |
| `font.size.300` | 17 | Reading body, inputs on touch screens, lead text | 1.5 | 0 |
| `font.size.400` | 20 | Card and dialog titles | 1.35 (`snug`) | -0.01em |
| `font.size.500` | 24 | Section headings | 1.25 (`tight`) | -0.015em |
| `font.size.600` | 29 | Page titles | 1.2 | -0.02em |
| `font.size.700` | 35 | Empty states, onboarding | 1.15 | -0.02em |
| `font.size.800` | 42 | Rare display moments | 1.1 | -0.025em |

Weights: 400 body, 500 labels and buttons, 600 titles, 700 only for numbers that must win a glance.
Prose measure 65 to 75ch. Sentence case everywhere. Numbers in tables use `font-variant-numeric: tabular-nums`.
Fixed rem-free pixel scale, not fluid: product UI is read at a steady distance.

## 6. Space, density and radius

### Space

4px base: `space.0-5` (2), `1` (4), `1-5` (6), `2` (8), `3` (12), `4` (16), `5` (20), `6` (24), `8` (32),
`10` (40), `12` (48), `16` (64), `20` (80). Tight inside groups, generous between them, more space above a
heading than below it.

### Density

| Token | Comfortable | Compact |
| --- | --- | --- |
| `control.height.sm / md / lg` | 32 / 40 / 48 | 28 / 32 / 40 |
| `control.padding-x.sm / md / lg` | 12 / 16 / 20 | 8 / 12 / 16 |
| `control.gap` | 8 | 6 |
| `layout.gap` | 16 | 12 |
| `table.row-height` | 48 | 36 |
| `menu.item-height` | 36 | 30 |

Comfortable is the default and the right choice on touch. Compact is for expert, data-dense screens
(token tables, review queues). Both keep every target at or above 24px (WCAG 2.2 target size).

### Radius strategy: rank, not one value

Radius encodes what kind of object you are looking at. Bigger, higher-rank surfaces get bigger radii; small
parts nested inside controls get the smallest. Nested radii follow `outer = inner + padding` so corners stay
concentric.

| Role token | Bridge | Ocean | Used by |
| --- | --- | --- | --- |
| `radius.inset` | 2px | 4px | Checkbox box, tag, kbd, menu item highlight, progress track |
| `radius.control` | 6px | 10px | Buttons, inputs, selects, tabs, segmented controls |
| `radius.container` | 10px | 16px | Cards, alerts, popovers, menus, tables |
| `radius.overlay` | 14px | 20px | Dialogs, drawers, toasts |
| `radius.pill` | 9999px | 9999px | Switch, avatar, badge, slider thumb only |

Bridge is engineered and tight (plates and rivets); Ocean is softer. Same components, different character.

## 7. Elevation, layers, focus

| Token | Use |
| --- | --- |
| `elevation.raised` | Interactive cards on hover, sticky headers |
| `elevation.overlay` | Popover, menu, select list, combobox list, tooltip |
| `elevation.modal` | Dialog, alert dialog, drawer, toast |

Shadows always have a vertical offset and a soft blur (light from above), two layers (a tight contact shadow
plus a wide ambient one). No zero-offset glows.

z-index scale: `z.sticky` 100, `z.dropdown` 1000, `z.overlay` 1100, `z.modal` 1200, `z.popover` 1300,
`z.toast` 1400, `z.tooltip` 1500.

**Focus:** a 2px `focus.ring.color` outline (signal orange) offset by 2px, shown on `:focus-visible` only.
Inputs move the ring inside (`offset 0` plus border color) so it hugs the field.

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

## 9. Iconography

**Lucide** (`lucide-react`, ISC license, a permissive MIT-equivalent license, forked from Feather which is MIT).
Chosen for its consistent 24px grid, 2px-family strokes with rounded joins that sit well next to Plex, and
broad coverage of developer and design concepts (git branches, diffs, tokens, layers).

- Always through the `Icon` component: `<Icon icon={GitBranch} size="sm" />`.
- Sizes: `icon.size.xs` 12, `sm` 16 (default in controls), `md` 20, `lg` 24.
- Stroke 1.75 at every size so icons match Plex's text weight; icons inherit `currentColor`.
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

- WCAG 2.2 AA. Contrast pairs enforced at build time (section 4).
- Every interactive component: keyboard operable, visible focus, correct role and name, state exposed
  (`aria-checked`, `aria-expanded`, `aria-invalid`, `aria-busy`...). Base UI provides the behavior; our
  wrappers must not break it.
- Color is never the only signal: status has text and an icon, invalid fields have a message.
- Targets at least 24 by 24 px in both densities.
- Storybook `addon-a11y` runs in error mode; Vitest + axe-core covers keyboard and ARIA behavior.
