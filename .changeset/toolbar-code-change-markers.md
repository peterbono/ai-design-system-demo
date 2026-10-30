---
'@bridge-ds/toolbar': minor
'@bridge-ds/core': patch
'@bridge-ds/mcp': patch
'@bridge-ds/cli': patch
---

Code changes now show what changed in the Bridge toolbar. An exploration marks each new or changed area of the UI with `data-bridge-change="<short plain label>"` on its outermost element; on This change the toolbar outlines those areas, counts them ("1 changed", "1 / 3 changed"), steps through them with Previous and Next, isolates them (Esc exits) and lists them in Changes, and C toggles the outlines. On Live product the bar says how many wait on This change. A change without markers says so plainly. Bridge now asks Claude for these markers wherever it explains how to explore: the MCP server instructions, the start and continue answers, and the section `bridge connect` writes into a product's CLAUDE.md (core exports `CHANGE_MARKER_ATTR` and `CHANGE_MARKER_RULE`).
