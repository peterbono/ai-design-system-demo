---
"@bridge-ds/core": patch
"@bridge-ds/cli": patch
---

Foundation of the Claude correction loop for the Figma pull. Core: `buildGapCase` (one component's gap case: the
variants the story shots say differ, each with its story, args, state, shot and the differences in plain words and
deltas, like "Height 72 in Figma vs 84 in code: 8 px missing below the label") and `figma-fixes.json` (`parseFigmaFixes`,
`validateFigmaFixes`, `applyFixes`): the team's corrections of four kinds (part patch, axis mapping, story pointer,
honest status), laid on every fresh measure with a provenance record per fix. CLI: `bridge fixes check`,
`bridge fixes apply --in --out` and `bridge gap <component>`. See docs/FIGMA-FIXES.md.
