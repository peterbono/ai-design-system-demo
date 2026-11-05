---
"@bridge-ds/core": minor
"@bridge-ds/mcp": minor
"@bridge-ds/cli": minor
"@bridge-ds/docs-site": minor
---

The component map: `bridge.components.json` at the design system repo root links each Library component to its Figma
component (file, component or set key, node, property and value mapping) and its code import, reviewed like any change
(docs/COMPONENT-MAP.md). Core adds the typed, versioned schema with a validator in plain words, the proposer (by name,
then by variant properties; ties are reported, never guessed) and `figma.file` in `bridge.config.json` for the team's
Figma file; the repo model reads the map. `bridge_list_components` and `bridge_get_component` add `figma` (the Figma
component and link, or "not linked to Figma yet"); the new `bridge_propose_component_map` opens proposed links for
review (a suggestion, or a draft pull request in direct mode), refused through the hosted connector to members who
joined with their email. `bridge check` reports which components are linked; an invalid file fails it. Studio: Settings
gets "Figma file" (leads and admins send it for review), and a component page shows "In Figma: <name>" with the link,
or "Not linked to Figma yet" with the next step for leads and admins only.
