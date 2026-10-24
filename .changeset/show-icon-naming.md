---
'@bridge-ds/core': patch
---

Figma plugin: the BOOLEAN of a swappable part is named "Show icon" ("Show icon start"), as Figma kits do, so the swap keeps the plain name "Icon" instead of the "Icon2" Figma gave it. Files built with the old names are renamed in place on the next update (same ids, instances keep their overrides). The hint for an added layer an optional part already draws reads "Icon end already does this: turn on Show icon end".
