---
'@bridge-ds/toolbar': minor
'@bridge-ds/admin': patch
---

New package: the Bridge toolbar as a component any React product mounts in one line,
`<BridgeToolbar ds="owner/design-system" product="<key>" />`. Opened from Studio with `?bridge=<change>`, it flips the
real product between Live product (production) and This change (the branch preview) and shows what changed for token
changes. It reads the product's repository, production URL and preview template from the design system's
bridge.config.json, renders nothing and loads nothing without `?bridge=`, and ships its styles inside its lazy chunk.
The Admin demo now mounts it from this package, with the same behaviour.
