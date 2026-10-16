# @bridge-ds/react

React components of the Bridge design system. Behavior comes from Base UI (focus, keyboard, ARIA); styling is
token-only CSS, so every component follows the brand, theme and density set by `@bridge-ds/tokens`.

```sh
npm i @bridge-ds/react @bridge-ds/tokens
```

```tsx
import '@bridge-ds/tokens/fonts.css';
import '@bridge-ds/tokens/tokens.css';
import '@bridge-ds/react/styles.css';
import { Button, ThemeProvider } from '@bridge-ds/react';

export function App() {
  return (
    <ThemeProvider asRoot theme="light" brand="bridge" density="comfortable">
      <Button>Save changes</Button>
    </ThemeProvider>
  );
}
```

`@bridge-ds/react/styles.css` holds the global base and every component's styles. Import it once, after the
token CSS. Peer dependencies: `react` and `react-dom` 18 or later.

## Try a design system branch on staging

Install a branch snapshot (see the PR comment "Try this DS branch in your product"), or preview a branch's tokens
without reinstalling: pass `tokenOverride` to `ThemeProvider` with an allowlist, then open staging with
`?bridge-tokens=<url-to-tokens.css>`. Off by default and refused in production builds unless you opt in. Read the
security notes in `docs/PREVIEWS.md` of the repository before enabling it.

MIT license.
