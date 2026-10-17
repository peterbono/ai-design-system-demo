---
"@bridge-ds/core": minor
---

Change drafts: `draftRequestText(component, kind, changes)` and `draftPushDescription(entries, components)` write a sentence-case title and a 1 or 2 sentence summary from detected changes only (no reason, no invented number, no em dash), with `pushChangeRows` for a change table of variable edits and `cleanDraftText` to strip em dashes.
