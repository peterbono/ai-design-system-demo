---
'@bridge-ds/core': patch
'@bridge-ds/cli': patch
---

A Figma fix with `width: 'fixed'` no longer pins a part to a width that only hugs its text in code. Each story already gave its own width, but a small Button story labelled "Publish tokens" measures 120.84 px because of its words, while the Figma set draws its own label and the code renders that small button at 72 px, so the fixes merged in #598 made every small button about 49 px too wide. Such a width is now skipped and reported story by story (a new `skipped` result with the measured px and the reason), and so is the width of a root that fills its container. A size the code gives the part (a CSS width, or a box wider than its content) is still pinned, each story to its own. The values referee says when a fix laid nothing on, and the fix prompt tells Claude about the rule.
