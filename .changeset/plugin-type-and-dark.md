---
'@bridge-ds/figma-plugin': patch
---

Plugin typography and dark theme:
- **Type:** three sizes per screen (17 headline, 12 body, 11 small). The What / In Figma / From code and Contrast tables use the body type instead of oversized monospace. Token names break at their dots, never inside a word.
- **Window size:** the window fits a short result instead of leaving a large empty area (between Figma's 400 minimum and the 640 default).
- **Dark theme:** help under fields uses the secondary text color. "Fails" chips get their own ground on the blocker panel. Renders sit in a neutral, theme-aware frame instead of a bright white box.
- **Update preview:** before an update, "After" lists what will change instead of an empty box. "Enlarge" shows before and after at the panel's width.
