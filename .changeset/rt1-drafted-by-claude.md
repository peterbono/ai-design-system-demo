---
"@bridge-ds/core": patch
"@bridge-ds/mcp": patch
---

A branch opened from Figma and labelled drafted-by-claude reads as ready for review even while GitHub still calls it a draft (core isDraft, claudeStage), in Studio, the MCP server and the CLI alike; merging it marks it ready first. Studio says where Claude stands: a developer builds it before the draft, the owners review it after.
