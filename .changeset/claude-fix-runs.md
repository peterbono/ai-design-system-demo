---
'@bridge-ds/core': minor
'@bridge-ds/mcp': minor
'@bridge-ds/cli': patch
---

Fix with Claude: the loop as steps in core (`startFixLoop`, `fixLoopRound`, `fixLoopOutcome`) and the change for review (`figmaFixesProposal`, `figmaFixesBranchStem`, `DEFAULT_MEASURED_SPECS_FILE`, `FIGMA_FIXES_LABEL`), shared by the CLI (`bridge fix --with-claude`), the MCP server (`bridge_propose_figma_fixes`, `figmaFixes.loadFixFiles` now exported) and Bridge's server, which runs the loop with a team's connected Claude one round per request. Same behavior for the CLI and the MCP tools.
