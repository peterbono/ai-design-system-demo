---
'@bridge-ds/core': minor
'@bridge-ds/mcp': minor
'@bridge-ds/cli': patch
'@bridge-ds/figma-plugin': minor
---

The measure has one agreed place: `measured-specs.json` (and `measured-shots/`) in the repo, else on the `bridge-requests` branch, where the automatic measure publishes it next to the plugin's `figma-fidelity.json`. Core: `findMeasure`, `MEASURE_BRANCH`, `measureFromWords`, `measureDir`, and the missing-measure words (`MEASURE_MISSING_TEXT`, `measureSetupSteps`, `MeasureMissingError`). The Claude fix tools (`bridge_figma_gaps`, `bridge_get_gap_case`, `bridge_try_figma_fix`, `bridge_propose_figma_fixes`, `bridge gaps`, `bridge fix`) read the measure there too; with none, `bridge_figma_gaps` answers `status: "no-measure"` with the designer sentence and the steps, never a raw error. The Figma plugin's measured spec sources and "Ask Claude to fix it" read it there (shots from the same branch), so a team on static specs gets the Claude button once it is measured; without a measure the row says "Bridge hasn't measured your components yet. A developer turns it on once: Set up automatic measure." and the copied request says how.
