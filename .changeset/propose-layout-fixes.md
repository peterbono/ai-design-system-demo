---
"@bridge-ds/core": patch
"@bridge-ds/mcp": patch
"@bridge-ds/cli": patch
---

Fix with Claude: a part fix that sizes, places or lays out a part (width, height, direction, align, overlay) opens for
review even when the values referee says same. The referee can't judge layout; the pull request body says so and that
Check fidelity decides. A fix that goes the wrong way is still refused.
