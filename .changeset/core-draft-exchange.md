---
"@bridge-ds/core": minor
---

Draft exchange (`draft-exchange.ts`): the pending drafts file the Figma plugin and the MCP server share on the `bridge-requests` branch (`.bridge/drafts/<sessionId>.json`), with compose, parse, validate, sanitize (no em dash, title at most 70 characters, summary at most 3 sentences) and merge helpers, the Bridge voice rules and output contract, and GitHub helpers that read and write sessions with the file sha and retry on 409. `GitHubClient` gains `getFile` (text and sha), `getFileBase64`, `listDirectory` and `deleteFile`.
