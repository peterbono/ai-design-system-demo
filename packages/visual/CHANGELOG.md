# @bridge-ds/visual

## 0.3.16

### Patch Changes

- Updated dependencies [8f73c2d]
  - @bridge-ds/core@0.22.0

## 0.3.15

### Patch Changes

- Updated dependencies [dc3fec0]
- Updated dependencies [949b731]
- Updated dependencies [dc3fec0]
- Updated dependencies [32948b0]
- Updated dependencies [51da8b4]
- Updated dependencies [fedd0c0]
- Updated dependencies [54a8c8c]
- Updated dependencies [6a44454]
- Updated dependencies [e8a6e7b]
- Updated dependencies [4ffd06f]
  - @bridge-ds/core@0.21.0

## 0.3.14

### Patch Changes

- 42c7c8f: License: FSL-1.1-MIT (each version becomes MIT after two years). See LICENSING.md.
- Updated dependencies [17f2849]
- Updated dependencies [acff80f]
- Updated dependencies [009a5ee]
- Updated dependencies [579f4a2]
- Updated dependencies [00cdee5]
- Updated dependencies [40b45ea]
- Updated dependencies [8a83d88]
- Updated dependencies [8cef447]
- Updated dependencies [6842370]
  - @bridge-ds/core@0.20.0

## 0.3.13

### Patch Changes

- 02d38ad: Fidelity: popups drawn open in Figma (dialogs, drawers, popovers, selects, comboboxes, tooltips) get a code image of the popup rendered open, instead of being skipped. A popup drawn from no code example (the menu) and the Card media placeholder stay skipped, each with why.
- 9be32eb: Figma references: one variant that fails to render no longer skips every variant after it. The reference story catches a render error and shows it as that variant's skip reason, and the capture reloads the story if Storybook still lands on its error screen. Parts of a compound component (AccordionItem, Radio, menu items, SidebarNavItem, TableEmpty) render inside their parent (`within` in the render plan) and are captured alone, at the width Figma draws them. Menu parts render the part itself instead of the Menu root, and a capture that comes out invisible is skipped with a reason instead of saved as a blank image.
- 60388db: Measure: a story that shows several instances (a gallery) is drawn from its first instance, and its screenshot is now
  cut to that instance, so the fidelity check compares like with like. HeroUI Input and Select were drawn 192 px wide
  (one field) and compared with a 400 px shot of two.
- fd0191c: `bridge specs --measure --tokens` harvests the library's variables: every CSS custom property its stylesheets define (root, provider and theme selectors), the declaration that applies where the story sits, resolved (colors as rgb, lengths in px), per theme, brand or density mode (Storybook globals, or a theme attribute such as `data-carbon-theme`), in two tiers (literal: primitive, `var()`: semantic, and semantic by value when a compiled theme writes a primitive's value per mode), with Figma variable paths and the properties the measured stories use. Written as `tokens` in measured-specs.json (`MeasuredTokens` in core).

  `--shots` writes a PNG of each measured root at 2x (one per distinct render) to `measured-shots/` with a manifest keyed by Figma variant, and records `shot` on each story; the measured root part carries `fill` when it spans its container. `@bridge-ds/visual`'s `openMeasurePage` takes a `scale`.

- 4aa0cd7: Storybook measure: `bridge specs --measure --storybook <url>` opens each story in Chrome and records what it really draws (layers, boxes, auto layout, fills, borders, radii, text styles, and the token behind each value), in the component specs shape. Works on any React Storybook, whatever the styling. Core adds `measureStory`, `measuredToSpec` and `compareSpecToMeasured` under `@bridge-ds/core/node`; visual exports `openMeasurePage`. The Figma pull does not read it yet.
- Updated dependencies [fbf7f55]
- Updated dependencies [7eb8a27]
- Updated dependencies [401cdcc]
- Updated dependencies [efb3281]
- Updated dependencies [3364ee9]
- Updated dependencies [d89f7b7]
- Updated dependencies [57b8d89]
- Updated dependencies [afd9ba2]
- Updated dependencies [4fd6e15]
- Updated dependencies [e52619d]
- Updated dependencies [48ee872]
- Updated dependencies [af6e3e9]
- Updated dependencies [ea27992]
- Updated dependencies [e65d3ee]
- Updated dependencies [4fb54b4]
- Updated dependencies [e806350]
- Updated dependencies [f5cfbf0]
- Updated dependencies [02d38ad]
- Updated dependencies [8919183]
- Updated dependencies [7b9e2c2]
- Updated dependencies [7c52639]
- Updated dependencies [afa59e8]
- Updated dependencies [eb4ace6]
- Updated dependencies [0ed940f]
- Updated dependencies [9be32eb]
- Updated dependencies [e075f3b]
- Updated dependencies [fe906a6]
- Updated dependencies [a83618b]
- Updated dependencies [7f6064b]
- Updated dependencies [f7751a1]
- Updated dependencies [60388db]
- Updated dependencies [4f3102a]
- Updated dependencies [e9fd0c7]
- Updated dependencies [0b3aa07]
- Updated dependencies [dd97e25]
- Updated dependencies [9d0dc16]
- Updated dependencies [a9cbbab]
- Updated dependencies [1635400]
- Updated dependencies [57f26bf]
- Updated dependencies [30e8c14]
- Updated dependencies [4c8a5dc]
- Updated dependencies [43b6e31]
- Updated dependencies [d37207a]
- Updated dependencies [db8e449]
- Updated dependencies [4dc69ae]
- Updated dependencies [e4c34ee]
- Updated dependencies [ce6a8c7]
- Updated dependencies [fd0191c]
- Updated dependencies [4d61987]
- Updated dependencies [1c4e347]
- Updated dependencies [44f49ff]
- Updated dependencies [07380d7]
- Updated dependencies [b822435]
- Updated dependencies [c0731d6]
- Updated dependencies [d54ace8]
- Updated dependencies [d199eb5]
- Updated dependencies [96acdf2]
- Updated dependencies [d157472]
- Updated dependencies [eb4d6ce]
- Updated dependencies [8403d3d]
- Updated dependencies [f198e92]
- Updated dependencies [2b01116]
- Updated dependencies [27dff7f]
- Updated dependencies [c46846d]
- Updated dependencies [efa01d6]
- Updated dependencies [d8848ff]
- Updated dependencies [7f9930c]
- Updated dependencies [9ec466a]
- Updated dependencies [d8c7494]
- Updated dependencies [fb3815b]
- Updated dependencies [306774c]
- Updated dependencies [5309e2e]
- Updated dependencies [4aa0cd7]
- Updated dependencies [80ee954]
- Updated dependencies [df92fcf]
- Updated dependencies [d8e5e84]
- Updated dependencies [fe5fb1b]
- Updated dependencies [2d89e58]
- Updated dependencies [625a692]
  - @bridge-ds/core@0.19.0

## 0.3.12

### Patch Changes

- Updated dependencies [037b56b]
  - @bridge-ds/core@0.18.0

## 0.3.11

### Patch Changes

- Updated dependencies [5ec4a47]
- Updated dependencies [5ec4a47]
  - @bridge-ds/core@0.17.0

## 0.3.10

### Patch Changes

- Updated dependencies [da3e4ea]
  - @bridge-ds/core@0.16.0

## 0.3.9

### Patch Changes

- Updated dependencies [9b0b653]
  - @bridge-ds/core@0.15.0

## 0.3.8

### Patch Changes

- Updated dependencies [1a560aa]
- Updated dependencies [440f717]
- Updated dependencies [a797699]
- Updated dependencies [9d40c77]
- Updated dependencies [4fb3153]
- Updated dependencies [662fb55]
- Updated dependencies [0986099]
  - @bridge-ds/core@0.14.0

## 0.3.7

### Patch Changes

- Updated dependencies [b6f1e68]
  - @bridge-ds/core@0.13.0

## 0.3.6

### Patch Changes

- 87cfb75: Core reads a Storybook without the repo. `fetchStorybookIndex` tries `index.json` (Storybook 7 and later, v4 and v5)
  then `stories.json` (v3), skips HTML fallbacks, and reports why it failed (`not-found`, `not-json`, `private`, `empty`,
  `http`, `network`). `parseStorybookIndex` groups entries into components by title and keeps test entries out of the
  story list. `normalizeStorybookUrl`, `storybookIframeUrl` and `storybookManagerUrl` build the addresses. The visual
  impact tool now parses `storybook-static/index.json` and builds story URLs through core; its output is unchanged.
- Updated dependencies [87cfb75]
  - @bridge-ds/core@0.12.0

## 0.3.5

### Patch Changes

- Updated dependencies [76c7938]
  - @bridge-ds/core@0.11.0

## 0.3.4

### Patch Changes

- Updated dependencies [22e53c7]
- Updated dependencies [e1f8f0c]
- Updated dependencies [e59366e]
- Updated dependencies [a99fbb9]
  - @bridge-ds/core@0.10.0

## 0.3.3

### Patch Changes

- Updated dependencies [5b93962]
  - @bridge-ds/core@0.9.0

## 0.3.2

### Patch Changes

- Updated dependencies [8cdcb9a]
- Updated dependencies [77ba45a]
- Updated dependencies [7e9f2df]
  - @bridge-ds/core@0.8.0

## 0.3.1

### Patch Changes

- Updated dependencies [22d186e]
- Updated dependencies [51e743c]
- Updated dependencies [7b53159]
  - @bridge-ds/core@0.7.0

## 0.3.0

### Minor Changes

- ed4b28d: Every visual component is in Figma: 47 of 47, 46 generated from code and 1 drafted with Claude. The generator now draws Checklist, Form, Slider, Table (and TableEmpty), Tabs and TokenValue from their code examples. New generator capabilities: CSS grid rows and subgrid rows as auto layout, `::before` / `::after` decorations as layers, Base UI indicators sized to the selected item (a tab underline) drawn in that item, unselected tab panels hidden, `data-orientation`, sliders (thumb at the value, value render functions), tables as rows of cells, form errors reaching their field, typed values in fields, functions as values, string and list methods, helpers that return elements, plain modules of the package, React's JSX text spacing, screen reader text left out of sentences, example texts shown by default, and absolute layers placed per variant. Side effects on sets already in Figma: Field and Dialog lose an empty error layer, NumberField steppers get their dividers, ChoiceCard text wraps, CodeBlock reads its wrap style.

  Toast, shown from the `useToast` hook and never placed, is drafted with Claude: a spec written from the code in `packages/react/component-spec-overrides/Toast.json` (`"source": "drafted"`), validated against the format and the repo's tokens by `npm run specs`, counted as drafted (never as generated), marked "Drafted, check it" in the Pull preview and in its Figma description, and stale once its code changes. Specs record the code example they were drawn from, so the fidelity check renders the same content (rows, fields, tabs), and the Figma references capture renders hook-shown components (a toast) through their hook.

- 6b07b05: Check fidelity: the Pull tab compares every generated Figma variant with the same variant rendered from code and says, per component, "Matches the code" or "Differs from the code: 12% of pixels, size 120x40 vs 118x40", with Figma, code and differences side by side. Nothing in the file changes. Core adds the pure comparison (`compareImages`, tolerant of font rasterization and antialiasing), the storable `FidelityReport` and the variant to code mapping (`planReference`); `bridge figma-references` (visual) captures the code images from Storybook, published on main by the Figma references workflow to the `bridge-visual` branch. React adds a hidden Storybook fixture, "Internal/Figma reference", not part of the package.

### Patch Changes

- Updated dependencies [f655919]
- Updated dependencies [ed4b28d]
- Updated dependencies [bdca820]
- Updated dependencies [6b07b05]
- Updated dependencies [8376732]
  - @bridge-ds/core@0.6.0

## 0.2.3

### Patch Changes

- Updated dependencies [5bfc7e2]
- Updated dependencies [f1a8b55]
- Updated dependencies [9494004]
  - @bridge-ds/core@0.5.0

## 0.2.2

### Patch Changes

- Updated dependencies [6fe9f88]
- Updated dependencies [11f40fd]
- Updated dependencies [4c313d7]
- Updated dependencies [4bfd417]
  - @bridge-ds/core@0.4.0

## 0.2.1

### Patch Changes

- Updated dependencies [80228c0]
- Updated dependencies [adc0df7]
- Updated dependencies [d5bbba9]
- Updated dependencies [3d3d77d]
- Updated dependencies [537abd7]
- Updated dependencies [fb40ae8]
- Updated dependencies [196d02b]
- Updated dependencies [fe29bed]
- Updated dependencies [dd2261c]
- Updated dependencies [a6914d7]
- Updated dependencies [1e78f3b]
- Updated dependencies [7cb1733]
  - @bridge-ds/core@0.3.0

## 0.2.0

### Minor Changes

- cd5565e: Visual impact analysis for design system changes. `@bridge-ds/core` gains a usage index (CSS variables each component reads, components it renders). New `@bridge-ds/visual` builds Storybook and the admin app at two refs, screenshots the impacted stories (every brand and theme) and the admin screens (every tenant and theme) deterministically, and pixel-diffs them into before, after, diff and composite images plus a JSON manifest. `bridge impact` and the `bridge_visual_impact` MCP tool run it; a workflow posts the result on pull requests.
- e31bac2: Publishable under the @bridge-ds scope: a `source` export condition for the monorepo, built `dist` with types,
  publish fields, and part of `npm run build:packages`. @bridge-ds/core also ships its `./audit` and `./node` entries.

### Patch Changes

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
