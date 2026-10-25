---
"@bridge-ds/core": minor
---

`remoteRenames(base, head)`: tokens the code renamed between two commits (removed and added with the same type, tier and values and a similar path, never guessed on a tie). The Figma plugin uses it so a pull renames the variable in place instead of orphaning it and adding a new one: everything bound to it keeps its binding.
