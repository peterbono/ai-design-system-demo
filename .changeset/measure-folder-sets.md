---
"@bridge-ds/core": minor
"@bridge-ds/cli": minor
"@bridge-ds/mcp": patch
"@bridge-ds/figma-plugin": patch
---

The measure now writes the Figma sets drawn under a component's folder as their own entries, so Claude can fix them:
popups drawn open (Dialog/Popup, AlertDialog/Popup, Drawer/Popup, Menu/Popup, Popover/Popup, Tooltip/Popup, and
Select/Popup or Combobox/Popup, measured open when the stories show them closed) and sets that fix a prop
(Pagination/Full, Pagination/Compact, Progress/Linear). Each entry names its set (`set`), its axis props read from the
root's classes when the story does not pass them (a DialogContent of size sm), and `--check` gives the set its own
status instead of "measure it open with --open". The fix loop (bridge_get_gap_case, bridge_try_figma_fix, `bridge fix`),
figma-fixes.json and the plugin's overlay find them by the set's name (measuredSetName); `--only Dialog/Popup` measures
Dialog. Measured shots are cut to the measured box: a box on a fractional y (a 20 px badge centred in a 21 px line) no
longer comes out a pixel taller than the size the measure read.
