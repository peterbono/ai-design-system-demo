# DS Bridge (Figma plugin)

DS Bridge lets designers edit design tokens as Figma Variables and send those edits back to this repo
as a pull request. **Git stays the source of truth; Figma is the editing surface.** A designer's change
reaches `main` the same way an AI-authored change does: through a PR, the CI guardrails and
CODEOWNERS review (`docs/GOVERNANCE.md`, Tier 3).

```
GitHub main  --Pull-->  Figma Variables  --edit-->  Push  --PR-->  CI + design/tech review  -->  main
```

The plugin has three tabs: **Pull** (code to Figma, "Bring the latest tokens from main into Figma"),
**Push** (Figma to code, "Send your Figma edits to the repo as a pull request for review") and
**Settings**. The token logic is `@bridge-ds/core` (`packages/core`); this package is the Figma glue.

It works on the free Figma plan: it only uses the Plugin API (`figma.variables`) and the GitHub REST
API. Nothing is synced live and nothing is written to `main` directly.

See it with real data on the live Bridge site: the [token explorer](https://bridge.floriangouloubi.com/studio/tokens/)
shows what a Pull brings into Figma, and [Reviews](https://bridge.floriangouloubi.com/studio/reviews/?pr=4) shows
the pull request a Push opened (PR #4). Components are in [Storybook](https://bridge-storybook.floriangouloubi.com).

## Install (Figma desktop)

1. From the repo root: `npm install`, then `npm run plugin:build` (writes `apps/figma-plugin/dist/`).
2. In the Figma desktop app: **Plugins > Development > Import plugin from manifest...** and pick
   `apps/figma-plugin/manifest.json`.
3. Run it from **Plugins > Development > DS Bridge**.

Published on Figma Community: https://www.figma.com/community/plugin/1693034743850648023 (in review since 2026-10-16). The `id` in `manifest.json` is that published id. The Community listing (copy, icon, cover,
gallery) and the publishing steps are in [`community/`](community/listing.md).

## Sign in with Bridge

Designers connect with **Sign in with Bridge** in Settings: it opens Studio in the browser, they pick their team, and
the plugin receives the team's repository and a GitHub sign-in, with no token to paste (docs/SIGN-IN.md, "The Figma
plugin"). When that sign-in expires, the plugin says "Sign in again". The token below stays available to developers
under **For developers: connect with a token**.

## GitHub token (for developers)

DS Bridge can also use a fine-grained personal access token limited to this repository:

1. GitHub **Settings > Developer settings > Personal access tokens > Fine-grained tokens > Generate new token**.
2. **Repository access**: "Only select repositories", pick this repository.
3. **Repository permissions**, by how the repo takes changes (`"changes"` in `bridge.config.json`):
   - **Suggestions** (`"suggest"`, the default): **Issues: Read and write**, **Contents: Read**,
     **Pull requests: Read**. Add **Contents: Read and write** to attach screenshots (they go to the
     `bridge-requests` branch); without it the suggestion links the Figma nodes instead.
   - **Branches and pull requests** (`"direct"`): **Contents: Read and write**, **Pull requests: Read and write**,
     **Issues: Read and write** (component change requests).
   Metadata (read-only) is added automatically.
4. Paste it in the plugin's **Settings** tab and save.

Repository, branch and tokens path are prefilled from `bridge.config.json` at the root of this repo.
At scan time the plugin also reads `bridge.config.json` from the configured repository; when it exists,
its `tokens.root`, tier folders, contrast checks file, mode order and changeset package win over the
tokens path in Settings. Without one, the plugin uses the Settings path with the default folder names
and writes no changeset.

On save the plugin checks the token with `GET /repos/{owner}/{repo}` and refuses it if it cannot write
to the repository, unless the repository takes suggestions (then read access to the code is enough). The token is stored with `figma.clientStorage`, which is local to this computer and
this plugin; it is not stored in the Figma file and is never displayed again (the field stays empty,
showing only that a token is saved). Repository, base branch (`main`) and tokens path
(`packages/tokens/src`) are stored in the file's shared plugin data so the whole team uses the same ones.

The manifest allows `https://api.github.com` and, for the optional "Draft with Claude" (below),
`https://api.anthropic.com`. File contents are read through the git trees and blobs endpoints, never from
`raw.githubusercontent.com`. Without an Anthropic API key, the plugin never calls Anthropic.

## Writing help: drafts, optionally written by Claude

Designers should not have to document every change by hand. Three levels, in this order on screen:

1. **Plugin draft (always on, no AI, offline).** The request form prefills its title and summary, and the Push
   **Description** prefills, from the detected changes only (`draftRequestText` and `draftPushDescription` in
   `@bridge-ds/core`, `change-drafts.ts`). Example: a new `danger` value on Badge's Tone axis gives "Add a danger
   tone" / "Badge gets a new Tone value, danger." The title never repeats the component, because the issue title
   already starts with it ("Badge: add a danger tone"). Drafts never give a reason or a number the diff does not
   show, use sentence case and no em dash. They stay editable and are never rewritten once you type: the Push
   description follows the checked changes only while it is still the plugin's draft (while it is, each request
   sent with the push gets its own drafted summary instead of the variables line).
2. **Draft with my Claude (your own Claude plan, through MCP, recommended).** Third-party apps cannot use a Claude
   plan and Bridge has no backend, so the plugin and your Claude meet in the GitHub repo both already reach with
   your token. Clicking the button uploads the before and after PNGs and writes `.bridge/drafts/<session>.json` on
   the `bridge-requests` branch (protocol: `draft-exchange.ts` in `@bridge-ds/core`), then shows **Waiting for your
   Claude** with the sentence to say, "Draft my Bridge changes", a copy button and Cancel. In Claude Desktop or
   Claude Code with the Bridge MCP server, `bridge_pending_drafts` returns the changes and the images, Claude writes
   the texts and one line per component change, and `bridge_write_drafts` puts them back. The plugin checks the file every 5 seconds while it is open,
   stops after 10 minutes ("Check again"), and fills the fields, marked "Drafted by Claude, review before sending".
   A field you edited after clicking is never overwritten: Claude's text for it shows under the buttons with
   **Use Claude's draft**. The file and its images are deleted once you send or cancel. Setup (once) is in
   Settings, **Claude (optional)**, under **For developers: set up Claude**: the Claude Desktop config and the Claude Code command for this repository, with
   the same GitHub token (`GITHUB_TOKEN`, Contents read and write). See [docs/AI.md](../../docs/AI.md).
3. **Draft with Claude, API key (only with your own Anthropic API key, billed to your Anthropic account).** Settings,
   **Claude (optional)**, under **For developers: set up Claude** (a developer's job, folded): paste a key from [console.anthropic.com](https://console.anthropic.com/settings/keys) and
   pick a model (Claude Sonnet 5.5 by default, or Claude Opus 5.5, Claude Haiku 5.5). The key is stored with
   `figma.clientStorage` like the GitHub token: on this computer only, never in the file, never shown again, and
   only sent to `api.anthropic.com` ("Remove key" deletes it). The designer never picks a way: with a key, **Draft with Claude**
   drafts in one click with it; without one, the same button starts Draft with my Claude. The UI iframe calls the Messages API directly (`anthropic-dangerous-direct-browser-access`)
   with the change table and, for a request, the component's before image (a small PNG stored in private plugin data
   when its baseline is taken) and after image (the current export), skipping either when missing. Claude's text is marked "Drafted by Claude, review before sending" until you edit it.
   Errors (invalid key, rate limit, network) say what to do and keep the plugin draft.

Whatever Claude writes, nothing is sent until you press Send request, Send for review or Send to exploration.

## How it works

### Figma layout: one collection per tier

| Git (under the tokens root) | Figma collection | Modes | Values alias |
| --- | --- | --- | --- |
| `primitives/*.tokens.json` | **Primitives** | Value | literals (or another primitive) |
| `brands/<brand>.tokens.json` (palette, radius and font roles) | **Brand** | Bridge, Ocean (one per brand file) | Primitives |
| `semantic/base.tokens.json` (motion, layers, icon sizes, border widths) | **Base** | Value | Primitives, or a literal |
| `semantic/light.tokens.json`, `semantic/dark.tokens.json` | **Semantic** | Light, Dark | Brand palette roles (`palette.*`) |
| `density/comfortable.tokens.json`, `density/compact.tokens.json` | **Density** | Comfortable, Compact | Primitives |
| `components/*.tokens.json` | **Component** | Value | Semantic (and Brand radius roles, Base, Density) |
| `brands/<brand>.<theme>.tokens.json` (brand theme overrides) | none | | code-only, see below |

Aliases cross collections, as in code: a Semantic variable points to a Brand variable, which points to
a Primitive. In Figma, a frame picks one mode per collection, so setting Brand to Ocean and Semantic to
Dark shows exactly what `data-brand="ocean" data-theme="dark"` shows in code (minus the overrides).

**Base** has its own single-mode collection instead of being copied into both Semantic modes: a
theme-independent token edited in one mode only would otherwise be ambiguous, and a single value reads
back losslessly.

**Brand theme overrides** stay code-only. A Figma variable has one value per mode of its own
collection, while an override depends on brand and theme together (ocean x light). Mapping them would
need a fake brand x theme mode or duplicated variables that break aliasing. So the plugin never writes
or reads them, lists them as a warning after each scan, still uses them for contrast, and warns when
you edit a semantic token that a brand overrides ("this edit does not change Ocean light").

**Free plan.** The plugin tries to add the modes of each multi-mode tier (Brand, Semantic, Density).
If Figma refuses (plans limited to one mode per collection), it creates one collection per mode
(`Brand/Bridge`, `Brand/Ocean`, `Semantic/Light`, ...) with identical variable names. Both layouts read
back the same way. In the split layout, aliases target the first mode's collection (the default brand).

Variable names use `/` where token paths use `.`: `color.action.primary.bg` is `color/action/primary/bg`.

| DTCG `$type` | Figma variable | Notes |
| --- | --- | --- |
| `color` (sRGB object or hex) | COLOR | Written back as the 2025.10 object form (components rounded to 3 decimals, `hex`, `alpha` when below 1) |
| `dimension` (`px`, `rem`) | FLOAT | Unit kept in plugin data and restored on export |
| `number`, `fontWeight` | FLOAT | Original DTCG type kept in plugin data |
| `fontFamily` (list) | STRING | Joined with `", "` and split back into a list |
| `string`, `boolean` | STRING, BOOLEAN | |
| `shadow`, `duration`, `cubicBezier` and other composites | none | Code-only: never created in Figma, never touched by a push |

### Pull (Git to Figma)

1. Reads `main` (`bridge.config.json`, the token files of every tier and `contrast.checks.json`) through the GitHub API.
2. Builds a plan: variables to create, update, rename, and orphans. You see it before anything is written.
3. Applies it in batches: collections and modes, then literal values, then aliases in a second pass
   (so every alias target exists), then orphan flags.
4. Stores the pulled commit as the file's **base** (`baseSha`).

A pull never overwrites a local edit silently: tokens you changed in Figma since the last pull are
kept, and tokens changed on both sides are shown as conflicts for you to decide. Tokens removed on
`main` are **not deleted** in Figma: the variable gets plugin data `orphan=true` and an `[orphan] `
prefix in its description, so you can rebind layers before deleting it yourself.

### Pull components (code to Figma component sets)

The Pull preview has a **Components** group when the repo has `packages/react/component-specs.json` (or
`components.specs` in `bridge.config.json`). It lists each coded component as new, updated or unchanged, and
what cannot be bound. Nothing is written unless you tick **Also pull components (N)** and apply.

Coverage is said, never implied: the group opens with "47 of 47 components are in Figma, 1 drafted with Claude" (from
the `coverage` list in the specs file). Components not in Figma are folded under the count, each with the generator's
plain reason ("Not supported yet: opens a popup"), and so are the ones drafted with Claude. Layout helpers (Stack,
Inline, Grid, Container, ButtonGroup, VisuallyHidden) are counted apart: nothing to draw, use auto layout. The
generator decides support itself from what it can read; there is no list to maintain.

The specs are derived from code: `npm run specs` (root) reads each component's TSX and CSS module with the generator
in `@bridge-ds/core/node` (`component-specs.ts`, `spec-css.ts`), and a core test fails when the committed JSON is out
of date.

**One component never stops the others.** Each set, and each variant inside it, is built on its own. When Figma
refuses something (a font that will not load, a property, a layer), that variant or set is rolled back, so nothing half
built stays in the file, and the others are built. The end of the pull says it in words: "Built 54 of 56 components.
Not built: Select (a font could not be loaded), Tabs (...)". A set built without some variants keeps no spec hash, so
**Try again** (or the next pull) builds exactly what is missing, in place, never a duplicate. **Stop** ends the build
after the set in progress; Try again goes on from there. A set is tagged before the first await, so a file closed
mid-pull is picked up the same way.

**Drafted with Claude.** What the generator still cannot read (today Toast: it is shown from the `useToast` hook under
`ToastProvider`, never placed as a component) can be drafted: Claude writes the spec by hand from the code, in the same
format, in `packages/react/component-spec-overrides/<Name>.json` marked `"source": "drafted"`, with the files it was
read from and their hash (`codeHash`). `npm run specs` validates it like a generated spec (one variant per axis
combination, known parts and properties, every token path in the repo with a type the field takes) and fails when it
does not match. A drafted set is never counted as generated: its coverage is `drafted`, the Pull preview marks it
"Drafted, check it" ("the code changed since" once the files no longer match `codeHash`), its Figma description says
so, and Check fidelity compares it with the code like any other set. When the generator learns to read the
component, the generated set wins.

| From code | In Figma |
| --- | --- |
| A string-literal union prop that changes the styles (`variant`, `size`, `tone`, `appearance`, `padding`) | A variant property with the code values (`Variant=primary`) |
| `:hover`, `:active`, `[data-disabled]` / `:disabled` rules that change a value | A `State` axis (Default, Hover, Pressed, Disabled), only the states that differ |
| Base UI `[data-checked]`, `[data-indeterminate]` rules (checkbox, switch, radio) | A `Checked` axis (false, true, mixed), glyphs hidden per variant |
| Content props (`label`, `description`, `error`) | TEXT properties; optional ones behind a BOOLEAN ("Show description") |
| `display: none`, `opacity: 0`, `scale(0)` in a state | The layer hidden in that variant |
| `translateX` of a switch thumb, `row-reverse`, `flex: 1`, `flex-wrap` | Padding and alignment per variant, reversed order, Fill container, auto layout wrap |
| Lists and selections of the docs preview (`items.map(...)`, `defaultValue`) | The items drawn, the selected one checked |
| `text-decoration: underline`, `em` sizes, a transparent border | Underlined text, a multiple of the font size token, a transparent stroke that still takes its room |
| A Base UI popup (select list, menu, dialog, drawer, popover, tooltip, combobox) | Its own set drawn open ("Select/Popup"), next to the trigger set when the component styles one; submenus closed, arrows left out |
| An inline `<svg>` (spinner, progress ring) | One vector layer, each shape's stroke bound to its token, dashes and rotation written in |
| Layers some variants do not render; a prop that moves layers elsewhere | Hidden layers in those variants; one set per value ("Progress/Linear", "Progress/Circular") |
| A value indicator (`<Progress.Indicator>`), `position: absolute` with token offsets, `width: 100%` | Its share of the track, an absolute layer pinned to its parent's edges, Fill container |
| React context, `useState` defaults, local render functions, `useMemo`, list methods, examples of the component sandbox | Read to draw what the code shows by default |
| Functions as values (a default prop), string and list methods, helpers that return elements, plain modules of the package (`utils/color`) | Read too: a token name broken after its dots, a swatch shown when the value is a color |
| CSS grid whose children span every column, rows with `grid-template-columns: subgrid` | Rows stacked; each row an auto layout row, `0` edge tracks as the gap at its ends, `1fr` tracks Fill container (columns line up per row only) |
| `::before` / `::after` with empty content that paint (a tab list hairline) | A "Decoration" layer, pinned like the CSS places it, under its siblings when its z-index is negative |
| A Base UI indicator sized to the selected item (`left: var(--active-tab-left)`), tab panels | Drawn in the selected tab, along its edge or filling it, per variant; only the selected panel |
| A slider (`<Slider.Thumb>`, a value render function) | The range as a share of the track, the thumb centered at the value, the formatted value |
| Tables (`<table>`, `<tr>`, `<td>`) | Rows of cells, each cell an equal share of its row, aligned like `vertical-align` and `text-align` |
| A form's server `errors` | The error summary and the error under the field of the same name; an example's typed value in its field |
| `children` (or a compound component's parts: CardHeader, CardBody, CardFooter) | A text layer with a TEXT property (`Label`, `Header`...) |
| A `LucideIcon` prop (`icon`, `iconStart`) | An instance of an icon component (`Icon/Plus`) with an INSTANCE_SWAP property (`Icon`, `Icon start`); optional icons get a BOOLEAN named "Show icon start" (as Figma kits name them), so the swap keeps the plain name; files built with the older `Icon start` / `Icon start2` names are renamed in place on the next update |
| A compound part drawn full-bleed in some variant (Card body with `padding="none"`) | An instance of a slot component (`Slot/Card body text` or `Slot/Media`) with an INSTANCE_SWAP property (`Body`) |
| `background-color`, `color` | Fill, text fill |
| `border` (width and color), `border-top` | Stroke and stroke weight, or one side's weight |
| `border-radius`, `padding*`, `gap`, `width`, `height`, `min-width`, `min-height` | Corner radius, padding, item spacing, sizes |
| `font-size`, `font-weight`, `line-height` (px), `letter-spacing` | Text properties |
| `display: flex`, `flex-direction`, `justify-content`, `align-items` | Auto layout direction and alignment |

**Icons and slots, like a Figma library.** A pull draws the spec's icons on an **Icons** page: one component per
Lucide icon, `Icon/<Name>`, made with `createNodeFromSvg` and flattened into one vector named `Icon` (so color
overrides survive a swap), its stroke bound to `color.text.default` and `icon.stroke`, its size to `icon.size.lg`
(Lucide's 24 grid). Content slots go on a **Slots** page: `Slot/Card body text` (the body text, bound like the card's,
TEXT property `Text`) and `Slot/Media` (a `color.bg.muted` plate at 16:9, `size.80` wide, with `Icon/Image` centered).
They are found again by shared plugin data (`dsbridge` / `iconId`, `slotId`), redrawn only when their SVG or spec
changed, and never listed by Push. In every variant, the swappable part is an instance of the default component
(IconButton: `Icon/Pencil` from its docs preview; Button: `Icon/Plus` and `Icon/ChevronDown`; Badge: `Icon/CircleCheck`;
Tag: `Icon/Layers`; Card: `Slot/Media` for `Padding=none`, `Slot/Card body text` otherwise), sized and colored by the
variant's tokens (instance size bound to `icon.size.*`, vector stroke bound to the variant's text color), with an
INSTANCE_SWAP property whose preferred values are every icon (or the slot's options). A re-pull swaps a part back to
its code default and replaces placeholder frames from earlier pulls in place.

Only `var(--token)` values are recorded, as token paths (the CSS variable is the path joined by `-`, `cssVar` in the
config); custom properties (`--_bg`) are resolved through the cascade per variant. Every value is bound with
`setBoundVariable` / `setBoundVariableForPaint` to the variable of the token in its tier's collection (Component,
Semantic, Density, Base, Primitives; the split `Semantic/Light` layout too), so the sets follow the Brand, Semantic
and Density modes like any layer. Exceptions, listed in the preview:

- A `calc()` of tokens (Badge md: `calc(var(--space-2) + var(--space-0-5))`) is resolved from the tokens' values in the
  default brand, theme and density and set as a number, not bound ("set, not bound" in the preview). A `calc()` of a
  single token is bound like the token. Percentages and literals have no variable: not bound.
- A root that is block-level in code (`display: flex | block | grid` or `width: 100%`: Card, Input) fills its container
  there; Figma draws it at the width of `size.80` (bound), and its stretched children fill it (`layoutSizingHorizontal`
  FILL, wrapping text). `overflow: hidden` clips the frame (Card's footer stays inside the rounded corners).
- A wrapper frame that only adds padding and gap to the root (Tag's label) is merged into the root, so the text is one
  `Label` layer like Badge and Button. A re-pull moves the existing layers out of the old wrapper and removes it.
- Unitless line heights and em letter spacing (`font.line-height.*`, `font.tracking.*`) are set as a percent, not
  bound: Figma's line height and letter spacing variables are pixels.
- The font family is a CSS stack (`Instrument Sans Variable, Instrument Sans, system-ui...`): the first family
  installed in Figma is used, never bound. When none is, text uses Inter and the report says so once.
- Shadows, focus rings, transforms and slot props (`prefix`, `hint`, `loading`...) are not drawn.

**Review updates**, like Figma's library updates. When sets DS Bridge generated changed in code since the last pull,
the preview lists each one under **Component updates**:

- **Before**: a thumbnail of the set as it is now (`exportAsync`, 2x). **After**: shown once the set is updated (a
  thumbnail cannot exist before the build).
- **What changes**: the variants, props and bound variables an update changes, by comparing the set's signature in
  Figma (read like Push reads it) with the signature the plan builds, using the same diff as Push. Changes that are
  not bindings (sizes, layout, set values) read "Values set from code".
- **Update** on a row updates that set alone; **Update all** (the primary action) updates the rest with the variables.
  Variables stay all-or-nothing: if main has variable changes, Update on one set applies them first, so the set binds
  to the variables it expects. On a first pull new sets are included by default; later, new sets are opt-in ("Include components" next to Apply to Figma).

Idempotent: a set is found again by shared plugin data (`dsbridge` / `componentId`), a variant by `variant`, a layer by
`part`. A re-pull updates them in place (same node ids, so instances keep their overrides), adds new variants, and
flags variants removed in code with an `[orphan] ` description, like variables. Nothing outside generated sets is
touched, and new sets go on a **Components** page. After building, each set's signature is stored as its baseline
(`signature`, the one Push compares), so a Push right after a pull sends no component request.

Interactions: the variants are wired for prototype mode with the code's motion. The generator reads each set's
State and Checked axes and the CSS `transition` of the parts that change (component-specs.json `interactions`):
hover is **While hovering** (Default to Hover), press is **While pressing** (Hover to Pressed), a Checked axis
toggles **On click** (a radio only checks), and a set with a Checked axis uses **Mouse enter** / **Mouse leave** for
hover so the click is not undone when the pointer leaves. Each reaction is **Change to** the other variant with
**Smart animate**, the duration and easing of the motion tokens (`motion.duration.*`, `motion.easing.*` played as
Figma's custom cubic bezier). When parts move at several speeds, Figma plays the longest and the preview says it was
approximated. The reactions DS Bridge set are remembered per variant (`reactions`), replaced on the next pull and
never written twice; reactions a designer added stay, and on the same trigger the designer's one wins (the pull
says so). The Pull preview shows **Interactions: N** per set and lists, folded, the motion Figma cannot play
(looping keyframes, keyboard focus, a popup opening from its trigger). Reduced motion has no Figma equivalent: the
set description says "In code, reduced motion turns this off."

### Check fidelity (does each component look like the code?)

The generator can build a set that has the right variants and bindings but still looks wrong (a compound part
drawn too short, a missing transparent border, a text style not carried over). **Check fidelity**, under the
Components group of the Pull preview, catches that: it exports every generated variant with `exportAsync` (PNG,
2x) and compares it, in the plugin, with an image of the same variant rendered from code. Per component it says
**Matches the code** or **Differs from the code: 12% of pixels, size 120x40 vs 118x40** (the variant that differs
most), with **In Figma**, **In code** and **Differences** (the code image faded, different pixels in red) side by
side, and the other variants that differ under a disclosure. Nothing in the file changes.

- **Code images.** `.github/workflows/figma-references.yml` runs on main when components, tokens, the specs or
  Storybook change: it builds Storybook and runs `bridge figma-references`, which renders each variant with the
  hidden story `Internal/Figma reference` (props from the variant axes, the Figma texts and icons, the state forced
  with the pseudo-states addon, block-level roots at the `size.80` width the plugin draws them at), Bridge brand,
  light, comfortable, at 2x. Images go to the `bridge-visual` branch (the one Visual impact publishes to) under
  `figma-references/`: `manifest.json` (commit, scale, spec hash and image per variant key) and one PNG per variant.
- **Mapping.** `planReference` in `@bridge-ds/core` reads the same spec the set was built from. An axis with a
  prop becomes that prop; State becomes hover, pressed or focus (pseudo-states) or `disabled`; the Label text is
  the children; an input placeholder becomes `placeholder`; a compound component's parts become its exported
  parts (`CardHeader`...). A variant that code cannot render the same way is not compared and says why (Card
  `Padding=none` shows the `Slot/Media` placeholder, which code has no example of). A set pulled from another
  version of the specs than the images is not compared ("Update the component, then check again").
- **Tolerance.** Two pixels are the same when their color distance is under 0.1 (YIQ, as pixelmatch), or when each
  one's color is found within one CSS pixel of the same place in the other image: Figma and Chrome rasterize text
  and curves differently, half a pixel apart. Where only one image has pixels (a size difference), any visible
  color counts. A variant matches when at most 3% of its pixels differ and its size is within 1 CSS pixel. On the
  current sets, correct variants stay under 2%.
- **Network.** The manifest and images are read through `api.github.com` (contents API, branch `bridge-visual`)
  with the token already saved: no new domain, the token goes nowhere new.
- **Report.** `runFidelityCheck` (`src/sync/fidelity.ts`) returns a `FidelityReport` (`@bridge-ds/core`): JSON with
  the commit of the code images, the options and one result per component and variant, ready to be stored and
  shown in Studio Quality later.

### Push (Figma to Git)

1. Snapshot of the variables, converted back to DTCG.
2. **Three-way diff per token**: base (the file at `baseSha`), Figma (now), `main` (now).
   - Changed only in Figma: goes into the PR (added, changed, renamed, removed).
   - Changed only on `main`: kept as it is on `main` (listed for information).
   - Changed on both sides: **conflict**, shown side by side; you pick Figma or `main` for each one.
     Nothing is overwritten silently. Without a base (first sync), every difference is a conflict.
3. Push screen: color swatches (old and new), contrast badges per brand and theme (AAA, AA, fail),
   plain-language guardrail messages. Blocking problems disable the **Send for review**
   button (**Push to pull request #N** when adding to your open PR).
4. Opens the PR: one branch `tokens/<slug>-<yyyymmdd-hhmm>`, **one atomic commit** containing only
   the changed token files plus a changeset (`minor`, or `major` when a token is renamed or removed),
   a **draft** PR labelled `tokens` with a change table (token, tier, old -> new per mode of its tier,
   contrast before -> after), the guardrail checklist and the risk tier
   ("Tier 3: token change, needs design + tech approval"). If the PR from your last push is still
   open, you can add the commit to it instead of opening a new one.

**Suggest mode** (`"changes": "suggest"` in `bridge.config.json`, the default when the key is absent; a repo with
no `bridge.config.json` keeps the branch flow). The button reads **Send suggestion** and nothing is written to git:

- The checked variable edits become one token suggestion: a GitHub issue (`bridge-suggestion`,
  `bridge.suggestion/1`) holding the exact token edits (set, add, remove, rename per token file), the contrast and
  validation checks and the tier. A new brand is a brand suggestion with its whole files. A developer applies it
  with `bridge apply <n>` or the `bridge_apply_suggestion` MCP tool once owners approve.
- A component change is a token suggestion (exact swap) or a component spec suggestion (`from-figma`, waiting for
  Claude). Its payload links the Figma file key and node ids (`links.figma.nodes`, before and after when the file
  keeps a before node): Claude Code reads the design straight from Figma through the Figma MCP server or the REST
  API, so no image hosting is needed.
- Screenshots still go to the `bridge-requests` branch when the token can write contents, and are linked in the
  suggestion. With a suggest-only token the plugin says screenshots need write access and sends the node links.
- Explorations (branches) and "add to your open branch" are not offered; the result reads
  "Suggestion #N sent to your DS lead".

Each changed value is written back to the file of its tier and mode: a palette edit in the Ocean mode
of Brand goes to `brands/ocean.tokens.json`, a Dark edit in Semantic to `semantic/dark.tokens.json`, a
Compact edit in Density to `density/compact.tokens.json`, a new Component variable to
`components/<first path segment>.tokens.json` (or next to its closest sibling).

### Changes list: like publishing a library in Figma

The Push screen mirrors Figma's Publish library dialog, so it reads like something designers already know:

- **Where it goes**, the main decision at the top of the Changes: a segmented control, **Send for review** (default:
  "Owners approve it, then it reaches the product.") or **Try in an exploration** ("Test it in a preview and a staging
  build. It never reaches the product as is."). An exploration is picked in a select of the running ones (open draft
  pull requests labeled `exploration` on `explore/*`, listed with `listExplorationsOnGitHub` from `@bridge-ds/core`)
  or started with **New exploration** (a name and what you want to learn, `startExplorationOnGitHub`: the branch
  from the base with its note and the draft pull request). See docs/EXPLORATIONS.md.
- **Changes**, grouped **Variables** and **Components**. Each item has a checkbox, all checked by default, and a
  group of 2 or more items has a select-all checkbox in its header (tri-state when some are unchecked).
- A component change row reads: the component name and the kind tag, then one sentence of what changed (its change
  line, written by Claude from the before and after images when you draft with Claude, else drafted from the diff),
  then, only for concrete changes (a variant axis or its values, a prop, a token binding), a compact before and
  after with the same value chips as variable rows ("Tone  info, neutral -> + danger"). Visual and structure changes
  show the sentence only; the full table goes into the GitHub issue.
- Checked variable edits go into the pull request. **Unchecked variable edits stay in Figma**, untouched, and show up
  again on the next scan. Unchecked component changes are not sent and keep their baseline.
- **Exploration only** (the experimental mark, like Figma's "Hide when publishing"): a checkable item of the row menu,
  "Never sent for review. Goes to explorations only." The mark is stored on the variable (every variable of the token
  in the split layout) or on the component set, as shared plugin data `dsbridge` / `experimental` = `"true"`, so it
  lasts and the whole team sees it. Marked items carry an "Exploration only" tag, **start unchecked for review and
  checked for an exploration**; switching the destination resets them to its default, other choices stay.
- **Message to the team**: its own section after a divider, with **Draft with Claude** on its label line, prefilled
  with the plugin's draft of the checked changes (see "Writing help"). It becomes the pull request's "What changed and
  why" (or the comment on the exploration) and the summary of every request sent with it. The pull request title is
  optional, under "Pull request title" ("Commit title" for an exploration).
- One primary action that follows the destination, **Send for review** or **Send to exploration**, with what it sends
  summed up once in the bar ("2 variables, 1 request"). For review: the pull request for the checked variables (none
  when no variable is checked), then one request per checked component change, with the component attached. To an
  exploration: the variable edits become one commit on `explore/<slug>` (composed again on the exploration's own
  token files, so its earlier commits stay; no new pull request to main, a comment on its draft), and each request is
  labeled `exploration` with `exploration: explore/<slug>`, to be built on that branch. The result screen says
  "Sent to <name>" with `explore/<slug>`, the preview links and the snapshot install command, and Open on GitHub. A
  failed request is listed; the rest is still sent.

At the very bottom, one quiet line: "Something the scan cannot see? Request a component change" (also on the idle
screen). It opens the request form in its own region; while any request form is open, its **Send request** is the
only primary action (the bar steps aside). "Not in the design system yet" sits under the Components group. A detected
change can also be edited and sent on its own from its row menu (**Edit the request**).

### Push components: back to the library as a library branch

For review, each checked component change goes to its own library branch, routed by what DS Bridge can write with
certainty (`src/sync/component-push.ts`, rules in `planComponentPush` from `@bridge-ds/core`). It reads the diff Pull
reads in "Review updates" (the set's baseline against Figma now), the other way round. The row says where it goes, in
a neutral tag and one sentence:

- **Exact token change** (no AI). The only change is a token swap: a property now bound to another variable, on a
  component token (`button.primary.bg`) that paints only the variants the designer changed. That token then points
  to the new variable: the shared token proposal write (`planTokenProposal`, `writeTokenProposalOnGitHub`), with
  the contrast gate (the semantic pairs of `contrast.checks.json`, checked again on the component tokens that alias
  them, so a pale fill under white text is held back before anything is sent), tier, changeset and labels, plus
  `from-figma`. Other components that share the token (IconButton uses button tokens) are named in the sentence.
- **Claude AI drafts** (a person reviews). A new variant, property, layer or swapped instance, a new component (from
  "Not in the design system yet", "Send to Claude AI"), or a token swap a token alone cannot say: code paints the
  property with a semantic token directly, or other variants still use the token. A draft branch
  (`bridge/figma-<name>`) carries the spec, `.bridge/figma/<name>.json`: variant matrix, properties, bound
  variables and layers of every variant, what code gave Figma before, the exact token swaps to make too, and a
  screenshot on the `bridge-requests` branch. Labels `from-figma`, `component-change`, `waiting-for-claude`: until
  Claude writes the code there (`bridge_get_figma_change`, then `bridge_mark_figma_change_drafted`, which marks it
  ready for review and swaps the label to `drafted-by-claude`), the branch is honestly a request.
- **Fix in Figma first**. What the scan cannot read with confidence is listed in its own group with what to do,
  never sent and never dropped: a layer detached from its component, a look that changed with the same variables (a
  value set by hand), a shared style, a property bound to nothing, a variable the library does not have yet (push
  the variable first). "Send as a request instead" is one click away on each row.

Each library branch starts with "From Figma" (a link to the component) and a hidden block tools read. The set
remembers its branch (shared plugin data `dsbridge` / `pushed`) and takes a new baseline, so the next scan does not
send it twice. **Never diverge:** once the branch ships (or closes), the next Pull lists the set under Component
updates ("Your change from Figma: shipped, rebuilt from the reviewed code") even when its spec did not change, and
Update rebuilds it from code, which clears the mark. While the branch is in review, Pull says so under Components
and keeps the Figma version. To an exploration, component changes stay requests built on the exploration branch.

### Two flows: variables become pull requests, components go to library branches

The Push tab has two groups, one under the other.

- **Variables**: every variable edit (value, alias, name, description), including component-tier tokens
  such as `button.radius`, goes through the pull request above. Tokens are data: people approve the PR.
  Variables never create a request.
- **Components**: for review, see "Push components" above. "Send as a request instead", the manual "Request a
  component change" and pushes to an exploration still make a **request**: a GitHub issue (`composeRequestIssue` in `@bridge-ds/core`, labels
  `component-change`, `request: <kind>`, `source: figma`, plus `integrations.requests.labels` and
  `assignees` from `bridge.config.json`) that people or Claude implement in their own pull request.

What counts as a component change, and its suggested kind:

| Change in Figma | Kind |
| --- | --- |
| A variant value or axis added or removed | New variant |
| A component property added, removed, or its type or default changed (an INSTANCE_SWAP default too) | Option change (prop) |
| A layer added, removed or moved in a variant, when the render moves with it or the layer is bound to a property | Structure change |
| Another icon or slot swapped in a variant, when the variant then differs from its code default | Visual change |
| Another variable bound to a part (fill, stroke, radius, padding, gap, typography...) | Token change |
| The render changed, with the same bound variables and the same variable values | Visual change |
| A component with no folder under `components.dir` in the repo | New component (opt-in) |

**Rule: swaps.** The INSTANCE_SWAP property is part of the API (its name, type and default are in the signature).
Swapping the instance inside a variant is a visual change only when the variant then shows another component than
the one code gives it (stored on the instance at pull, `dsbridge` / `slotDefault`); swapping back to it is no change.
A swap explains the bindings and render that move with it in that variant (Media brings its own fill), so it is never
read as a token change.

**Rule: structure.** Each variant keeps a layer outline: its children in order, with the children of a wrapper (a
frame or group) listed in its place, so wrapping or unwrapping layers is not a change. A layer is known by its type
and, for an instance, its main component (a part DS Bridge generated by its part id), never by its name, so a rename
is not a change. Hidden layers bound to no property are left out. A layer added, removed or moved is a structure
change, named in its row: `New instance layer "Icon" (Icon/Pencil) after "Label" in primary sm`. When an optional
part of the component already draws the added layer in that place (an icon after the label while `Icon end` exists,
a text where an optional text exists), the row says so ("Icon end already does this: show it with the Icon end
property") and the item **starts unchecked**: "Keep it as a request" checks it and sends it anyway. DS Bridge never
changes the file for it. Baselines taken before this rule have no outline: their render changes stay visual changes
until the next baseline.

**Rule: a Figma-only restructure triggers nothing.** Layers renamed or regrouped, auto layout refactored, with
the same API, the same bound variables and the same render: the scan says "Figma-only changes, nothing to
send". A render that changed only because a bound variable's value changed is explained by the variables
pull request, so it is not a request either.

How it works:

1. **Signature** (`src/sync/components.ts`, pure). Per component set (or single component): variant axes and
   values, component properties (name, type, default), the bound variable names per property kind, collected
   over the whole layer tree so a regroup does not change them, and per variant a hash of the bound values and
   a render hash (FNV-1a over a 1x PNG export). The main thread (`src/main/components.ts`) reads it from
   `componentPropertyDefinitions`, `variantProperties`, `boundVariables` and `exportAsync`.
2. **Baseline**, stored on each component node in shared plugin data (`dsbridge` / `signature`):
   - after a pull: coded components seen for the first time, and components whose only differences come from
     variables. A component with a pending change keeps its old baseline, so a pull never swallows it.
   - after a request is sent for that component.
   - a coded component (same name as a folder under `packages/react/src/components/`) with no baseline takes
     one silently on the first scan: nothing to send.
   - a component with no baseline and no folder in code is listed under "Not in the design system yet",
     collapsed, each with "Request as new component". Nothing is sent on its own.
3. **Request form**, inline: kind (prefilled), title and summary (prefilled drafts, see "Writing help"; "Draft with
   Claude" sits on the Title label line) and "Attach the selected variant" (a 2x PNG). The row above the form keeps
   the change line and its value chips. Each request opens with its change line ("**What changes:** ..."):
   Claude's when it wrote one, else `draftChangeLine` from the diff. Its title is Claude's title for that component
   (written with the change line, at most 70 characters) when there is one, else the drafted title (structure: "Add a
   layer after Label"). On send, images go to the
   `bridge-requests` branch (created from the base branch head when missing, never moved) under
   `.bridge/requests/`, then the issue is created and the new baseline stored. "Request #N opened" links to it.
4. **Request a component change**: for what the diff cannot see (behavior, a bug, an idea). Pick a coded
   component, describe it, attach the current selection.

The Figma link needs `figma.fileKey`, which published plugins often do not get: the request then names the
node without a link.

### Contrast: which pairs a change affects

Pairs come from `contrast.checks.json` (`{ "pairs": [[foreground, background, min], ...] }`), the same
file the token build gates on. A pair is a text pair when `min` is 4.5 or more, a UI pair otherwise.
Every pair is resolved for every brand x theme, with brand overrides applied, so the plugin's ratios
match `dist/resolved.json` (a test checks all of them).

The alias-resolution rule for the PR's "Contrast (before -> after)" column: a pair is listed under a
changed token when the foreground or the background resolves through that token in that brand x theme,
directly or through any alias in between, and the mode that changed is the one used there. Examples:

- `color.bg.default` changed in Light: every pair with `color.bg.default` as foreground or background,
  in Bridge light and Ocean light. Dark is not listed.
- `palette.neutral.50` changed in the Bridge mode of Brand: every pair whose colors resolve through
  `palette.neutral.50` in Bridge light and Bridge dark (for example `color.text.default` on
  `color.bg.default`, which aliases it). Ocean is not listed.
- `color.steel.50` (a primitive) changed: every pair that reaches it through a palette role and a
  semantic token, in the brands whose palette uses it.
- A semantic token that Ocean overrides for light: Ocean light is not listed, since the override wins
  there.

Before this rule, the column was empty when `color.bg.default` changed (PR #4): the plugin read pairs
from a file in another format and only matched pairs naming the token directly.

### Stable ids and renames

Every variable the plugin writes carries a token id in its plugin data. The id is
`$extensions["com.dsbridge.id"]` when the token declares one, otherwise `path:<path>`. Matching is by
id first, then by name, so renaming a variable in Figma becomes a rename in Git, not a delete plus an
add. The extension is only written into the JSON when the id no longer matches the default
`path:<current path>` (after a rename), which keeps the files lean.

Variables created in Figma have no id yet. When one looks like a renamed token (same type, same values,
similar path), the plugin suggests the rename; it only counts as a rename after you confirm it.

### Lossless round trip

Native exports lose information; DS Bridge edits the JSON in place instead of regenerating it:

- A format-preserving JSON parser keeps each node's original text. A file nobody changed is
  byte-identical after parse and serialize (tested on every token file in the repo).
- An edited token keeps its key order and its file's layout (inline or multi-line objects, indent,
  number spelling). `$description`, `$type` (group inheritance included), `$extensions` from other
  tools (`com.figma.scopes`, `com.dsbridge.id`, anything else) are preserved.
- Float noise from Figma is ignored: colors compare by 8-bit hex plus alpha, numbers to 1e-4. A value
  that did not really change keeps main's exact spelling.

### Guardrails (checked before the push button is enabled)

- Tier order, matching `docs/ARCHITECTURE.md` "Token tiers":
  - Brand and Density tokens alias primitives.
  - Semantic colors alias a Brand palette role (`palette.*`); translucent primitives (`color.alpha.*`)
    are the only raw colors allowed. Other semantic tokens alias a primitive or a Brand role.
  - Component tokens alias semantic tokens (or Base, Density, Brand radius roles, primitive scale
    steps), never a palette role, a raw color or another component token.
  - Base tokens and primitives may hold literals.
- No raw values where an alias is required (Brand, Semantic, Density, Component).
- No broken references and no alias cycles, in every mode.
- Every Brand, Semantic and Density token exists in every mode of its tier.
- Brand theme overrides follow the semantic rule and override an existing semantic token.
- No variable scoped to `ALL_SCOPES` ("All supported properties").
- Type changes are not allowed (create a new token instead).
- Contrast: every pair in `contrast.checks.json` meets its own minimum in every brand x theme.

Problems that already exist on `main` are shown as warnings, not blockers, so an unrelated issue does
not stop a designer's change. Everything the change introduces blocks. CI and the code owners remain
the authority; the plugin only gives the answer earlier.

### Scopes

Figma's default scope (`ALL_SCOPES`) shows every variable in every picker. When a token does not declare
`$extensions["com.figma.scopes"]`, the plugin sets sensible defaults from its path and type: primitive
colors and Brand palette roles are hidden from pickers (use semantic tokens), `text` colors get `TEXT_FILL`, `border` gets
`STROKE_COLOR`, `bg`/`surface` get frame and shape fills, `radius` gets `CORNER_RADIUS`, `space` gets
`GAP` and `WIDTH_HEIGHT`, and so on. Scopes are written to the JSON only when you change them away from
these defaults.

### Reliability

- Reads (and content-addressed writes: blobs, trees, commits) are retried with backoff on network
  errors, 5xx and secondary rate limits. Branch and PR creation are never retried blindly.
- An exhausted hourly rate limit says when it resets. 401, 403 and 404 errors explain what to fix
  (expired token, missing permission, wrong repository or branch). Every failed action offers "Try again".
- Branch updates never force-push: if the branch moved, the push fails instead of losing work.
- Large token sets: files are fetched with limited concurrency, Figma writes are batched with yields
  and report progress, and long change lists render in pages.

## Limitations

- **Modes on the free plan**: one mode per collection, hence the `Semantic/Light` + `Semantic/Dark`
  (and `Brand/*`, `Density/*`) fallback. Aliases then follow the default brand only.
- **Brand theme overrides** are code-only (see Figma layout).
- **Type changes are not allowed** (for example COLOR to FLOAT). Create a new token instead.
- **No live sync**: you pull and push explicitly. Main can move between your pull and your push; the
  three-way diff handles it.
- **Line height**: DTCG `number` line heights are unitless multipliers (1.5); Figma's line-height
  variables are in pixels. The value round-trips but means something different when applied in Figma.
- **Library variables**: aliases to variables from another library cannot be exported.
- **No deletion in Figma**: tokens removed on `main` are flagged as orphans, never deleted.
- **GitHub only**: no GitLab or Bitbucket.
- Shadows, durations, easings and other composite tokens stay code-only.
- **Component render hash**: a PNG export, so it moves when Figma's renderer, a font or an image fill changes,
  and it can differ between machines. A change that touches both a variable value and the look of the same
  variant is read as a variable change (the render is explained by the value). Variant-level bindings are
  compared, not per layer: moving a binding from one layer to another within a variant is not seen.
- **Components from a library** (remote) are not scanned; only local components of the file are.
- **Pulled components** are rebuilt from CSS, not rendered by a browser: hover, pressed and disabled are the only
  states; icons are Lucide SVGs imported by Figma (`createNodeFromSvg`), flattened; an icon's stroke width is bound
  to `icon.stroke` at every size, as the token says; the BOOLEAN of a swappable part is `Show <part>` so its
  INSTANCE_SWAP keeps `<part>` (Figma renames a name another type took: `Icon` would become `Icon2`); `calc()` values are set, not bound, so they do not follow a
  density or brand switch; shadows and focus rings are not drawn.
  The generator is tested on the 6 base components; it runs on the other component folders but their output has not
  been reviewed yet.

## Why not Tokens Studio or the native export

- Tokens Studio works well, but its multi-file and branch sync features are part of the paid Pro plan;
  this repo needs branch plus PR per change for every designer.
- Figma's native export of variables to DTCG JSON has been reported by users on the Figma community
  forum (2025 to 2026) to drop descriptions and to flatten aliases into resolved values. This repo's
  semantic layer is aliases, so a lossy export would turn every push into a regression.
- The Variables REST API (read and write) is only available on Enterprise plans. On other plans, only
  the Plugin API can read and write variables, which is what DS Bridge uses.

## Development

```sh
npm run build -w @bridge-ds/figma-plugin       # dist/code.js + dist/ui.html (JS and CSS inlined)
npm run watch -w @bridge-ds/figma-plugin       # rebuild on change
npm run test -w @bridge-ds/figma-plugin        # node:test, compiled with esbuild
npm run typecheck -w @bridge-ds/figma-plugin   # tsc, strict, against @figma/plugin-typings
npm run plugin:build                         # same build, from the repo root
```

```
apps/figma-plugin/
  manifest.json          name, editorType, dynamic-page access, network allowlist (api.github.com, api.anthropic.com)
  community/             Figma Community listing (listing.md), icon, cover and gallery PNGs, and their sources
  scripts/               esbuild build and test runner (both bundle @bridge-ds/core from source)
  src/main/              main thread: figma.variables, clientStorage, plugin data (no network)
  src/ui/                UI iframe: Pull, Push and Settings tabs, rendering, GitHub calls, Anthropic calls (with a key)
  src/shared/messages.ts typed message protocol between the two, collection names, default settings
  src/sync/              Figma glue on top of @bridge-ds/core:
    mapping.ts           tiers <-> Figma collections and modes, pull plan, snapshot back to tokens
    flows.ts             pull and push orchestration (analyze, buildPull, buildPush, openPullRequest)
    components.ts        component signatures, diff, classification (changed, new, Figma-only)
    component-pull.ts    pull components: load component-specs.json, plan sets and bindings (main/build-components.ts builds them)
    requests.ts          send a component change request (image on bridge-requests, then the issue)
    claude.ts            writing help: the Messages API call (user's key), answer parsing
  test/                  end-to-end pull/edit/push flows against an in-memory GitHub and a simulated
                         Figma (single and split layouts), including the PR #4 contrast regressions
```

Everything else (DTCG codec, tiers, resolver, contrast, validators, diff, PR body, risk tier,
changesets, GitHub client) is in `packages/core`, tested with Vitest from the root `npm test`. See
[`packages/core/README.md`](../../packages/core/README.md).
