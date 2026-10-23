---
'@bridge-ds/core': patch
---

Figma plugin: a component updated in place no longer turns black. Bound paints are written with the color they resolve to, not a black base Figma kept showing (on the canvas and in exports) until something refreshed it.
