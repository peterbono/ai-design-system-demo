---
'@bridge-ds/figma-plugin': patch
---

The Pull start screen has one job per block.
- **Getting updates:** keeps one action, "Check for updates". For a file pulled before, "How it works" folds into a one-line "How updates work". First-timers keep it open.
- **Compare with code** (was "Check fidelity") is its own block below. It explains itself in one sentence ("Do the components in this file still look like the code? Bridge compares each one with how it renders in code."), shows the last result ("8 differ, 24 match · compared today at 14:50"), and has one button: "Compare with code", "Compare again" or "See the differences". It does not show before a first pull.
- **Footer:** never two competing buttons. After a first pull that built components, the footer holds only "Compare with code".
- **Docs:** the plugin README, FIGMA-FIXES.md and the Studio plugin docs use the new name.
