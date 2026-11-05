---
"@bridge-ds/figma-plugin": minor
"@bridge-ds/core": patch
"@bridge-ds/mcp": patch
"@bridge-ds/cli": patch
---

Components follow the measure by default, so the fixes Claude proposes and the team approves reach the file. The plugin's Spec source is now Automatic until a developer picks one: the sets are built from the measure (measured-specs.json, with figma-fixes.json) whenever the team has one, in the repo or on bridge-requests, else from component-specs.json. A developer's choice, Static included, is kept. A file pulled from the static spec moves onto the measure on its next Check for updates, in place: same sets and variants, layers that keep their name (or the one text of a group) carry over so instances keep their overrides, what only the static spec drew goes with its unused properties, variants the stories do not render are flagged "[orphan]", and the designer's own layers stay. The update list says it once: "Components now follow how they look in code, measured in Storybook." Compare with code records the spec source in figma-fidelity.json, and the gap case tools (bridge_figma_gaps, bridge_get_gap_case, bridge fix) say a run from a file not built from the measure needs Spec source Automatic and a Check for updates, instead of reporting parts missing or asking for fixes that cannot reach it.
