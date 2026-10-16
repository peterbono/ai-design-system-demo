---
'@bridge-ds/docs-site': minor
---

Library foundation pages (Color, Typography, Spacing, Radius and borders, Elevation) open each token group with a
specimen of the real tokens in context, light and dark side by side, then a light list: dual swatch, the token name
once, a one-line role, a muted alias line and a neutral usage chip. A page-level "Copy as" switch (CSS, JS, Figma)
sets what a click on a name copies, and a row opens the token explorer's detail panel in read mode. Usage comes from
the shared `tokenUsage()` definition, so the page background no longer reads as unused. Links in the app chrome are
ink with a quiet underline; orange stays the signal for focus and the current place.
