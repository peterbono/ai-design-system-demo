---
"@bridge-ds/core": minor
"@bridge-ds/eslint-plugin": minor
---

bridge audit counts every visible UI instance: router links outside a DS component's `render` prop (react-router,
ra-core `LinkBase`, next/link), anchors with `href`, images and chart libraries (recharts, Nivo, Chart.js...,
foreign with no DS equivalent). Providers and other non-visual parts no longer count as DS instances.
