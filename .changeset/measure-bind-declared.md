---
"@bridge-ds/core": patch
---

`withRepoTokenPaths` binds a measured field whose declaration is a variable alone (`var(--cds-button-primary, #0f62fe)`)
to the written token of its chain, so a design system measured without token files gets its colors and type bound to
variables. A calc() of a token, or a value that only matches one, stays a literal. Figma plugin: a measured component
whose root is a text (a link) is a frame that hugs that text.
