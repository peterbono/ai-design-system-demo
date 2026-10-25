---
'@bridge-ds/figma-plugin': minor
---

The update preview shows the real "After" before you apply. For a component changed in code, the review shows its default variant twice:
- **"Before: in Figma now":** the Figma render of the variant.
- **"After: in code":** the code's own image of the incoming version, from the measured story shots or the published code images, only when they are of that version.
- **"After: drawn by Bridge":** for teams without code images. Bridge draws the incoming version itself, off-canvas, with the same builder as a pull, one component at a time as its row comes into view. It exports the drawing and removes every temporary node, even on an error, so the file is never left modified. A drawing that takes more than 8 seconds falls back to the list of what changes.

A quiet line says "Figma gets as close to this as Bridge can draw it." "Enlarge" stays.
