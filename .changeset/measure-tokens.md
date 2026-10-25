---
'@bridge-ds/core': patch
'@bridge-ds/cli': patch
'@bridge-ds/visual': patch
---

`bridge specs --measure --tokens` harvests the library's variables: every CSS custom property its stylesheets define (root, provider and theme selectors), the declaration that applies where the story sits, resolved (colors as rgb, lengths in px), per theme, brand or density mode (Storybook globals, or a theme attribute such as `data-carbon-theme`), in two tiers (literal: primitive, `var()`: semantic, and semantic by value when a compiled theme writes a primitive's value per mode), with Figma variable paths and the properties the measured stories use. Written as `tokens` in measured-specs.json (`MeasuredTokens` in core).

`--shots` writes a PNG of each measured root at 2x (one per distinct render) to `measured-shots/` with a manifest keyed by Figma variant, and records `shot` on each story; the measured root part carries `fill` when it spans its container. `@bridge-ds/visual`'s `openMeasurePage` takes a `scale`.
