---
"@bridge-ds/core": patch
---

Fix with Claude: a component's gap case no longer hangs. A measure could give a nested `.root` element the root's own id, which made its part tree loop, and pairing parts then never ended; the measure now reserves `root`, pairing stops at a part met twice, and a gap case builds only its own component's set. Files over 1 MB (component-specs.json) are read with the raw media type, so Figma coverage finds them.
