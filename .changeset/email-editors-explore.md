---
"@bridge-ds/core": patch
"@bridge-ds/mcp": patch
"@bridge-ds/docs-site": patch
---

Claude starts product explorations for everyone who can edit. On the hosted connector, a member who joined with their
email (Can edit or Admin) now starts an exploration in the design team's copy of a product, where Bridge writes for them
on explore/ branches only, then saves prototype code there; a Reader still saves nothing. `productRepoAccess` returns
the default branch with `read-only`. The component tools and the server instructions tell Claude to load the Library
with `bridge_get_claude_design_system` in a claude.ai artifact instead of inventing token values. The team's Library in
Claude Design is read under the team's old names too (a connection made before the rename), and saved under the
current one.
