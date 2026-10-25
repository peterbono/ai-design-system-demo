---
'@bridge-ds/mcp': patch
'@bridge-ds/docs-site': patch
---

Hardening: deleting a Bridge account ends its connections in Claude and deletes the GitHub tokens Bridge kept sealed for them; the Figma plugin hand-off keeps the GitHub token sealed while it waits, bound to its own link; the hosted connector never merges (`bridge_merge_branch` is neither listed nor run there, a person merges from Studio or GitHub). `createServer` and `handleHttp` take `{ exclude }` to leave tools out; the local CLI and MCP server keep every tool.
