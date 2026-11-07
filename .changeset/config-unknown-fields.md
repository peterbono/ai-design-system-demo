---
"@bridge-ds/core": minor
"@bridge-ds/cli": minor
"@bridge-ds/mcp": minor
---

A bridge.config.json field this version does not know is warned about and left alone, never fatal: a config written
for a newer Bridge (a product's design copy, a new setting) still loads in an older CLI, workflow or MCP server. A known
field with a wrong value still fails. `isUnknownField` and `setConfigWarn` are exported.
