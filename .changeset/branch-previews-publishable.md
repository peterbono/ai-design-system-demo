---
"@bridge-ds/tokens": minor
"@bridge-ds/core": minor
"@bridge-ds/react": minor
---

Packages are publishable under the `@bridge-ds` npm scope (renamed from `@demo-ds` and `@bridge`). Each ships built ES modules, type declarations and, for React, one `styles.css`; the monorepo keeps resolving TypeScript sources through the `source` export condition. `@bridge-ds/core` adds branch preview helpers (`previewUrl`, `snapshotUrl`, `previewComment`) and a `previews` section in `bridge.config.json`. `@bridge-ds/react` adds an opt-in staging token override: `ThemeProvider` `tokenOverride` loads an allowlisted `tokens.css` from `?bridge-tokens=`, off by default and refused in production builds unless enabled.
