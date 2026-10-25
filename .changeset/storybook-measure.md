---
'@bridge-ds/core': patch
'@bridge-ds/cli': patch
'@bridge-ds/visual': patch
---

Storybook measure: `bridge specs --measure --storybook <url>` opens each story in Chrome and records what it really draws (layers, boxes, auto layout, fills, borders, radii, text styles, and the token behind each value), in the component specs shape. Works on any React Storybook, whatever the styling. Core adds `measureStory`, `measuredToSpec` and `compareSpecToMeasured` under `@bridge-ds/core/node`; visual exports `openMeasurePage`. The Figma pull does not read it yet.
