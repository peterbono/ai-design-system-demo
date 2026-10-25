---
'@bridge-ds/core': patch
'@bridge-ds/cli': patch
---

Measure as the referee: `bridge specs --measure` now opens popups (`--open`), measures parts inside a parent or portal (`--within`), reads tokens defined on provider elements, splits stories that render many instances, records the props each story rendered with, measures every variant (`--variants`, `--states`, hover and focus forced in Chrome, disabled as an arg) and gives each component a status (`--check`: Matches, Differs, or Can't check yet with the reason). Core pairs text layers by their words, and exports the measured-specs shapes, `parseMeasuredSpecsFile`, `pairParts`, `compareSpecToMeasured`, `mapPropsToFigma`, `planVariantMeasures` and `componentStatus` from the browser-safe entry.
