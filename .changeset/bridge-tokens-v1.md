---
"@bridge-ds/tokens": minor
---

Bridge token system v1. Adds a brand mapping layer (`bridge` default, `ocean` alternate) between primitives and semantic tokens, a component tier (button, input, checkbox, switch, slider, card, popup, dialog, tooltip, toast, table, tabs, progress, nav), comfortable and compact density, motion durations and easings with a reduced-motion override, layers (z-index), icon sizes, breakpoints, a 1.2 type scale from 14px with tracking tokens, and self-hosted IBM Plex Sans and Mono (`@bridge-ds/tokens/fonts.css`). Primitives are regenerated in OKLCH on one lightness ladder. The build now writes `dist/resolved.json` and fails when any pair in `contrast.checks.json` drops below its WCAG minimum in any brand and theme. Fixes `color.border.strong` against `color.surface.default` (now at least 3:1 in both themes).
