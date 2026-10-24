---
"@bridge-ds/cli": patch
"@bridge-ds/mcp": patch
"@bridge-ds/core": patch
---

Build requests in the CLI and the MCP server: `bridge build list|show` and `bridge_list_build_requests` /
`bridge_get_build_request` (read only, status read from GitHub, the brief for Claude). Branch status, merge and
"what needs me" read a push from the Figma plugin with the shared gate (design approved, token values ship by
themselves). Core: a spec-only or Claude draft branch from Figma never ships by itself.
