---
"@bridge-ds/core": minor
"@bridge-ds/mcp": minor
"@bridge-ds/figma-plugin": minor
---

Claude titles each component request. Change lines in a draft session carry the deterministic request title
(`DraftLine.title`), and results may answer `lines: [{ id, line, title }]` (`DraftResultLine`; the title is cleaned to
the title contract by `sanitizeDraftTitle`: one line, sentence case, at most 70 characters, no trailing period, no em
dash). Older sessions and answers without titles still work. `bridge_pending_drafts` and `bridge_write_drafts` ask for
the title, the plugin's API-key path asks for and parses it too, and Push uses it for that component's request instead
of the generic deterministic title ("Add an icon after the label" rather than "Update the look to match Figma").
