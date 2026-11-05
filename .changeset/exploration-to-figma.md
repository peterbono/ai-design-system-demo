---
"@bridge-ds/core": minor
"@bridge-ds/mcp": minor
"@bridge-ds/docs-site": minor
---

Put an exploration in Figma. Say so to Claude, or use Put in Figma on the exploration page (for people who can edit, when the team has a Figma file): the new `bridge_exploration_to_figma` tool gives Claude the team's file, the changed screens, the Library components with their Figma links, what has no link, the preview and the recipe, and Claude builds a new page with real instances through its own Figma connector. Bridge never writes to Figma. `bridge_save_exploration` keeps the page link (`notes.figmaPage`) so Studio links to it, and `bridge_propose_component_map` now asks for component keys.
