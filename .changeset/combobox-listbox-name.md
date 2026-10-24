---
"@bridge-ds/react": patch
---

Combobox: the listbox takes the field's name (its `label`, `aria-label` or `aria-labelledby`), so it is never an anonymous list, including while it closes.
