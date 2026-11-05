---
"@bridge-ds/core": patch
"@bridge-ds/cli": patch
---

The measure finds a popup set by the first class of its root (Popover.module.css .popup), not every class the static
spec names: Popover/Popup, whose spec folds the body's class into the root, is now measured like the other popups.
