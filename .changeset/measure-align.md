---
'@bridge-ds/core': patch
---

Measured layout shapes the Figma pull codes against: a decoration rebuilt in auto layout is aligned through its parent's layout (`MeasuredLayout.align[childId] = { primary, counter }`, Figma's terms relative to the parent's direction), with the parent's padding in `values`; the part-level `align` is gone. A full radius is 999 px in `values`, unless it is bound to a token.
