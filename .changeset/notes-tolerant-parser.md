---
"@bridge-ds/core": patch
"@bridge-ds/mcp": patch
---

Exploration notes read what AI tools actually write: numbered and `*` lists, heading words in any case, singular or
plural, edge case lines as "Component, state: covered|not covered|yes|no. note", "- [x] Component: state, note" and
"Component / state (covered) note", list marks stripped from Context and Next step, and no text ever dropped.
`normalizeExplorationNotes` rewrites a hand-written note file in Bridge's format. `bridge_save_exploration` now
rewrites a note file sent in `files` in that format in the same commit (title and marker kept, `notes` merged in)
instead of refusing it, and its description tells Claude to pass notes only through `notes`.
