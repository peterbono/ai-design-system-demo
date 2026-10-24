---
"@bridge-ds/core": patch
"@bridge-ds/cli": patch
"@bridge-ds/mcp": patch
---

Fix with Claude: the team's own Claude fixes components whose Figma build differs from their story, Bridge is the
referee and a person approves; Bridge holds no API key. Core: `figmaGaps`, `gapCaseFor`, `tryFigmaFixes` (the values
referee: fixes validated, laid on the measure, the set rebuilt, each differing variant compared with the code before
and after, verdict closer, same or worse), `figmaFixesPrBody`, `fixPrompt` and `parseFixReply`, `FigmaFidelityRun`
(`figma-fidelity.json`), and `specsFromMeasure` (the plugin's measured-only pull, now in core). MCP:
`bridge_figma_gaps`, `bridge_get_gap_case`, `bridge_try_figma_fix` and `bridge_propose_figma_fixes` (a draft pull
request labelled drafted-by-claude). CLI: `bridge gaps` and `bridge fix <component>` (`--case`, `--try`, `--propose`,
and `--with-claude` with the team's ANTHROPIC_API_KEY). See docs/FIGMA-FIXES.md.
