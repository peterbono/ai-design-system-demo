---
"@bridge-ds/core": minor
---

Suggestions can link Figma nodes: `links.figma.nodes` (optional `{ nodeId, url?, name?, state?: "before" | "after" }[]`, payloads without it are unchanged). The issue lists the node links and says Claude Code reads the design straight from Figma (Figma MCP `get_design_context` or the REST API), so no image hosting is needed. A component spec suggestion from Figma fills it from the pushed component (and `figma.before` when known), turns stored screenshots into previews, and its brief names the Figma MCP call. New helper `figmaNodeUrl`.
