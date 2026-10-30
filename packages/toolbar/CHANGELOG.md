# @bridge-ds/toolbar

## 0.2.0

### Minor Changes

- 7af0bfc: The Bridge toolbar reads GitHub through Bridge's read proxy (new `proxy` prop, default production Bridge) instead of anonymous browser calls, so Before and After keep working past GitHub's 60 reads an hour per visitor. It reads GitHub directly when Bridge refuses or cannot be reached. Bridge's read proxy answers GET reads of public demo teams to the product origins their bridge.config.json names (CORS, no credentials).

### Patch Changes

- Updated dependencies [a367cfe]
- Updated dependencies [f8a1085]
  - @bridge-ds/core@0.23.0

## 0.1.0

### Minor Changes

- 11926c5: New package: the Bridge toolbar as a component any React product mounts in one line,
  `<BridgeToolbar ds="owner/design-system" product="<key>" />`. Opened from Studio with `?bridge=<change>`, it flips the
  real product between Live product (production) and This change (the branch preview) and shows what changed for token
  changes. It reads the product's repository, production URL and preview template from the design system's
  bridge.config.json, renders nothing and loads nothing without `?bridge=`, and ships its styles inside its lazy chunk.
  The Admin demo now mounts it from this package, with the same behaviour.

### Patch Changes

- Updated dependencies [8f73c2d]
  - @bridge-ds/core@0.22.0
