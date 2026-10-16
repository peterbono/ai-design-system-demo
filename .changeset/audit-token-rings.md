---
"@bridge-ds/core": patch
---

`bridge audit` and `bridge/use-tokens` no longer report a ring built only from tokens (`inset 0 0 0 var(--border-width-default) var(--color-border-default)`) as a hardcoded shadow: bare zero offsets carry no value. Stylelint already allowed this form.
