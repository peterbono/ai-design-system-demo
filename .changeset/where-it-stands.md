---
"@bridge-ds/core": minor
"@bridge-ds/mcp": minor
"@bridge-ds/docs-site": minor
---

"Where it stands": handover notes for every exploration, so another designer or AI tool carries on. The note file keeps
Context, Decisions, Edge cases (per component, covered or open), Open questions and Next step as readable text;
`@bridge-ds/core` parses and merges them section by section without losing hand-written lines
(`parseExplorationNotes`, `mergeExplorationNotes`, `notesSpec`). `bridge_save_exploration` takes `notes` in the same
save, `bridge_continue_exploration` returns them and starts from the next step, and Done exploring hands the decisions
and edge cases to developers as the design spec. Studio's exploration page shows them above the activity and lets
whoever can edit change them in place.
