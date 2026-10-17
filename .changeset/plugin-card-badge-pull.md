---
'@bridge-ds/figma-plugin': patch
'@bridge-ds/core': minor
---

Pulled components: Badge md gets its padding and min height (a `calc()` of tokens is resolved and set, reported as "set,
not bound"; a `calc()` of one token is bound). Card is drawn at the `size.80` width, its header, body and footer fill it,
body text wraps instead of collapsing to 0px, and it clips its content so the footer stays inside the rounded corners.
Tag loses its extra "label" wrapper frame (a re-pull moves the layers and removes it). Variant grids keep the same gap
between rows and columns of different sizes. Specs gain `clip` and `fill` on parts and calc() expressions of token paths.
