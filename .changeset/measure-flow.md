---
'@bridge-ds/core': patch
---

Measured parts carry what auto layout needs, in general CSS terms: `margins` per part, a `wrap: { padding }` for a child whose margin makes an uneven gap (uniform gaps and edge margins already become the parent's gap and padding), `overlay: true` for out-of-flow parts that overlap their siblings or leave their parent (the root's size never includes them), `align: { x, y }` for a lone out-of-flow decoration rebuilt in auto layout (the parent aligns it start, center or end and its padding carries the offset, instead of a pin), and `fullRadius` when a radius is half the shorter side or more (a percentage, or a 9999px pill).
