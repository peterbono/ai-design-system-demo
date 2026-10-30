---
"@bridge-ds/cli": minor
"@bridge-ds/mcp": minor
---

`bridge connect --ds <owner/name>`: run once inside a product repository to connect it to the team's design system. It
writes `.mcp.json` (the Bridge MCP server), `.bridge/product.json` (the design system and the product key) and a short
Bridge section in `CLAUDE.md` (or `AGENTS.md`), idempotent and without overwriting the team's content. From then on
`bridge explore` and `bridge pieces` work inside the product repository: they read the design system from GitHub instead
of needing token files there, default to that product (`#12` means `shop#12`), and `continue` checks the exploration
branch out in that checkout, never over uncommitted changes. The MCP server started there does the same.
