---
"@bridge-ds/core": patch
"@bridge-ds/mcp": patch
"@bridge-ds/cli": patch
---

A branch updated after every changes request reads "Updated, look again" (core reviewStatusLabel, branchVerdict label) in Studio, the MCP server and the CLI, never a stale "Changes requested". The merge gate is unchanged. Studio's approval checklist says who looks again instead of "Failed".
