---
"@bridge-ds/figma-plugin": minor
---

One progress bar for every long job in the plugin. Check for updates and Update (building component sets), Compare
with code, Send my edits and Claude working through "Ask Claude to fix all N" each show a bar where their result will
appear: the step in words ("Building Button, 12 of 62"), the percentage and the time left ("about 3 min left", "less
than a minute left") when the work can count its items, or a bar that moves without a percentage, with what is
happening in words, when it cannot. The time left comes from the observed pace, smoothed, shown only after a few steps
and never jumping around; for Claude's list it comes from the fixes Claude already finished. The bar is a progressbar
for screen readers (value, maximum and the same words as text) and stands still with reduced motion. The main thread
now sends items done of total with its progress (variables written, components read, icons drawn, sets built).
