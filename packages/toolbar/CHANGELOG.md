# @bridge-ds/toolbar

## 0.3.0

### Minor Changes

- e71bc5b: The toolbar shows what changed without being asked. On a token change, opening the bar outlines every changed surface of the screen and counts them in the bar ("3 changes"); the count also turns the outlines off and on (C). Previous and Next scroll to each change in reading order (smooth, or instant with reduced motion), outline the current one stronger and announce it to screen readers. Isolate dims everything but the changes, off by default, and Esc turns it off. Outlines, position and Isolate hold on the Live product side, which shows the same elements. When nothing changes on the screen the bar says so and names the screens the change shows on, with a way to go there. The B shortcut to flip sides in place is shown in the side buttons' tooltip. The token swatches moved from the bar into the Changes sheet, with their before and after values, to keep the bar compact; at 390px the changes take a second row.

### Patch Changes

- 07788aa: The count of changed elements no longer reads like "This change": the bar says "13 changed", then "2 / 13 changed" while stepping, and screen readers hear "Changed element 2 of 13: Avatar" (also with changes tried together). The before and after tooltip of the current element now opens below it when there is room above the bar, else beside it, and above it only as a last resort, so the title above the element stays readable and the tooltip never covers the bar.
- Updated dependencies [4264fa0]
  - @bridge-ds/core@0.24.0

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
