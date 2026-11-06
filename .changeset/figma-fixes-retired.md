---
"@bridge-ds/mcp": minor
"@bridge-ds/core": minor
"@bridge-ds/cli": patch
---

Retire `bridge_propose_figma_fixes` and `bridge_try_figma_fix` from the MCP server and the hosted connector: Claude reads the gaps and proposes no fix. Add `isFigmaFixPull`: a pull request labelled figma-fixes or on a bridge/figma-fixes-* branch never waits in a review queue. `bridge fixes check` and `apply` read a missing default figma-fixes.json as no fixes.
