---
"@bridge-ds/core": patch
---

Measure: a custom property holding color channels (`--primary: 212 100% 47%`) that every use wraps in one color function
(`hsl(var(--primary))`, through aliases too) is harvested as that color, so it becomes a color variable instead of being
skipped. A field declared as that function around the variable alone is tied to it, so it binds in Figma.
