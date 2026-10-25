---
"@bridge-ds/core": patch
---

Measure: colors a page keeps in oklch(), oklab(), lab(), lch() or color() (Tailwind v4 themes, color-mix results) are
turned into sRGB rgb()/rgba() in the measure and the token harvest, in values, shadows and SVG markup, so they become
color variables and Figma paints instead of being skipped.
