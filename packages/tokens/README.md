# @bridge-ds/tokens

Bridge design tokens in W3C DTCG 2025.10 format, built to CSS variables, a typed TypeScript map and a resolved
JSON for tooling. Primitives, brands (`bridge`, `ocean`), semantic light and dark, density (`comfortable`,
`compact`) and a component tier. The build fails when a contrast pair drops below its WCAG minimum.

```sh
npm i @bridge-ds/tokens
```

```ts
import '@bridge-ds/tokens/fonts.css';
import '@bridge-ds/tokens/tokens.css';
import { cssVar, type Theme } from '@bridge-ds/tokens';
```

Set `data-theme`, `data-brand` and `data-density` on a scope element (or `<html>`): every semantic and component
token re-resolves inside it.

| Entry | What |
| --- | --- |
| `@bridge-ds/tokens/tokens.css` | every token as a CSS variable, per brand, theme and density |
| `@bridge-ds/tokens/fonts.css` | self-hosted IBM Plex Sans and Mono |
| `@bridge-ds/tokens` | `cssVar`, `primitives`, `brands`, `themes`, `densities`, `defaults`, types |
| `@bridge-ds/tokens/resolved.json` | resolved values per mode and the contrast report |

Source DTCG JSON ships in `src/`. MIT license.
