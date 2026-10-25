---
"@bridge-ds/core": patch
---

Tokens from a measure: a variable that resolves to nothing (a font family that names itself) is skipped instead of
written as an empty `palette.string.` token, so what uses it keeps its computed value. Figma plugin: a system font
family (system-ui, ui-sans-serif, ui-monospace) draws with the platform font Figma lists before falling back to Inter.
