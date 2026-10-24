---
"@bridge-ds/core": patch
---

The Figma plugin draws measured-only sets with core's `specsFromMeasure` (one copy for the plugin, the CLI and the MCP
server). Three general rules from the Carbon v3 run: a frame that paints nothing and holds only overlays (a popover's
container) is out of the flow; a frame that aligns its lone child (a switch and its knob) keeps its measured size; and
`flex-grow` only fills space its parent has (a growing row in a column that hugs stays one line tall).
