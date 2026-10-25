---
'@bridge-ds/core': patch
'@bridge-ds/cli': patch
---

`bridge specs --measure` measures the item, not its group: when a story renders a set's component inside its parent (a radio in its fieldset, a menu item in its open menu), the measure reads the element with the Figma set's root class, opening the popup if needed. A Figma `Checked=mixed` value maps to the `indeterminate` prop (`mapPropsToFigma` `also`, `variantCombosFromMapping`), so `--variants` measures it and `--check` compares it.
