---
'@bridge-ds/core': patch
---

The before and after section of a `figma-fixes.json` pull request no longer contradicts itself. When no difference
could be measured because the differing variants are not in the rebuilt set, the values referee says so ("The values
referee compared nothing: none of the 32 differing variants is in the rebuilt set") instead of reading as a
measurement ("0 of 0 differences resolved"), and the normal summary counts those variants too. The layout caveat now
comes before the evidence it explains, a variant the rebuilt set does not have reads "not in the rebuilt set" rather
than "gone", and above eight variants the body leads with one line per kind of difference and its values, then folds
the variant by variant list into a `<details>`.
