# @bridge-ds/eslint-plugin

ESLint rules for product apps that use a Bridge design system. They read the tokens and the component list
through `@bridge-ds/core` and the design system's `bridge.config.json`, so they agree with `bridge audit` and the
`bridge_audit` MCP tool.

## Install

```sh
npm install --save-dev eslint @bridge-ds/eslint-plugin
```

```js
// eslint.config.js (flat config, ESLint 9)
import bridge from '@bridge-ds/eslint-plugin';

export default [
  bridge.configs.recommended,
  {
    settings: { bridge: { designSystem: '../design-system' } },
    rules: {
      'bridge/no-hardcoded-style-values': ['warn', { minConfidence: 'medium' }],
      'bridge/prefer-ds-components': ['error', { allow: ['Box'] }],
    },
  },
];
```

The design system root comes from the rule option `designSystem`, then `settings.bridge.designSystem`, then the
`BRIDGE_DS` environment variable, then the nearest folder with a `bridge.config.json`.

## bridge/no-hardcoded-style-values

Raw design values in `style`, MUI `sx`, `styled()`, `makeStyles`, `createTheme` and style-named objects
(`styles`, `classes`, `*Sx`, `*Theme`). Numbers follow React and MUI: `padding: 16` in `style` is 16px; `p: 2` in
`sx` is a theme spacing unit and is not reported. Exact whole-value matches are fixed: `padding: 16` becomes
`padding: 'var(--space-4)'`.

```tsx
<Box sx={{ color: '#1c2735', marginTop: '13px' }} />
// Use var(--color-text-default) instead of #1c2735: it is the same color (#1c2735).
// Raw spacing 13px: use a token, closest is var(--space-3) (12px, high match).
```

| Option | Default | |
| --- | --- | --- |
| `designSystem` | see above | Design system repo root. |
| `minConfidence` | `"none"` | `none` reports every hardcoded value; `exact`, `high`, `medium`, `low` only those with a token that close. |
| `categories` | all | Same categories as the audit. |

## bridge/prefer-ds-components

Imports of UI components from foreign libraries (MUI, react-admin, antd, Chakra, Radix, Headless UI, Mantine,
shadcn/ui local `components/ui`...) and native `button`, `input`, `select`, `textarea`, `dialog`, `table`, `a` (with `href`), `img`
elements, with the DS component to use when one fits (`TextField` -> `Input`, `<input type="checkbox">` ->
`Checkbox`). Providers, hooks and icon packages are ignored.

| Option | Default | |
| --- | --- | --- |
| `designSystem` | see above | Design system repo root. |
| `packages` | from the config | Packages DS components are imported from. |
| `nativeElements` | `button, input, select, textarea, dialog, table, a, img` | |
| `foreignLibraries` | built-in list | Extra import prefixes to treat as foreign UI libraries. |
| `allow` | none | Component names or import sources to accept. |

Tests run the rules through a small ESTree harness (`test/harness.ts`, @babel/parser), so the plugin has no
runtime dependency on ESLint.
