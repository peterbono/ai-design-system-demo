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

## Pages without React

Static sites, server templates and pages that build rows in plain scripts use `@bridge-ds/react/dom`. Each
renderer returns the exact markup of its React component, with the same CSS Module classes (from the same
stylesheet), so it looks and behaves the same. Parity tests compare every renderer with its component.

```ts
import { badgeHtml, bindCodeBlocks, bindTooltips, codeBlockHtml, tooltipAttributes } from '@bridge-ds/react/dom';

row.innerHTML = badgeHtml('Approved', { tone: 'success', attributes: tooltipAttributes('Approved by the design owner', { focusable: true }) });
panel.innerHTML = codeBlockHtml('npm i @bridge-ds/react', { label: 'Install' });
bindTooltips(); // once per page: every [data-tooltip] element, now or later
bindCodeBlocks(); // once per page: copy buttons of CodeBlocks rendered without hydration
```

Renderers: `badgeHtml`, `badgeClassName`, `codeBlockHtml`, `tokenValueHtml`, `checklistHtml`, `checklistRowHtml`.
Text is escaped; pass `trusted(html)` for markup you built and escaped yourself. `bridge audit` counts these calls as
design system components, and counts homemade look-alikes in script-built markup (`class="pill"`, `data-tip`
tooltips) against adoption. Your bundler must handle CSS Modules imported from the package (Vite, Astro and Next
do), or import `@bridge-ds/react/styles.css` and use the published build.

## Try a design system branch on staging

Install a branch snapshot (see the PR comment "Try this DS branch in your product"), or preview a branch's tokens
without reinstalling: pass `tokenOverride` to `ThemeProvider` with an allowlist, then open staging with
`?bridge-tokens=<url-to-tokens.css>`. Off by default and refused in production builds unless you opt in. Read the
security notes in `docs/PREVIEWS.md` of the repository before enabling it.

MIT license.
