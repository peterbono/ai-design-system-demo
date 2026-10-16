---
"@bridge-ds/tokens": minor
---

Adds the tokens the Bridge docs app needed to be built on the design system (dogfooding), also requested by the admin demo (apps/admin/DS-GAPS.md):

- Data visualization: `color.chart.series.1` to `6`, `color.chart.track`, `color.chart.grid` and `color.chart.axis`, in both themes. Series are checked at 3:1 and axis text at 4.5:1 against surfaces and the canvas in every brand and theme.
- A `palette.categorical` role per brand (bridge: plum, ocean: orange), the fifth chart hue, kept away from each brand's accent and info hues.
- `color.border.emphasis`: a hairline that reads before the default one (hovered cards, group dividers, dashed placeholders).
- App shell layout: `layout.sidebar.width` (256), `layout.header.height` (56), `layout.content.max-width` (1200).
- Scale steps: `size.40` (160, closes the gap between 80 and 240) and `size.64` (256); display sizes `font.size.900` (50) and `font.size.1000` (60) on the same 1.2 ratio, for landing heroes only.
