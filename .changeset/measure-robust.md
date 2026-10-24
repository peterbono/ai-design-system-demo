---
'@bridge-ds/cli': patch
---

`bridge specs --measure --variants`: when the probe leaves no arg to vary, only the states are measured (it no longer falls back to crossing every enum), and a browser that crashes or runs out of memory is launched again instead of failing every story after it.
