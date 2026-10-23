---
'@bridge-ds/core': patch
---

Figma plugin: updating a component no longer adds its icon swap property again (Badge showed Icon2 and Icon3 after Update all). The swap Figma renamed next to its BOOLEAN (Icon -> Icon2) is found, unused duplicates from earlier updates are removed, and the property is read under the code's name so Review does not report a prop change.
