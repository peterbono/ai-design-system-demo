# @bridge-ds/stylelint-plugin

Stylelint rule for product apps that use a Bridge design system: raw colors, lengths, radii, borders, shadows,
durations, easings, z-index and fonts are reported where a design token exists, with the token to use.
`stylelint --fix` replaces values that equal a token with `var(--token)`; nothing else is rewritten.

It reads the tokens (every brand, theme and density) through `@bridge-ds/core` and the design system's
`bridge.config.json`, so the suggestions are the same as `bridge audit` and the `bridge_audit` MCP tool.

## Install

```sh
npm install --save-dev stylelint @bridge-ds/stylelint-plugin
```

```json
// .stylelintrc.json in the product app
{
  "plugins": ["@bridge-ds/stylelint-plugin"],
  "rules": {
    "bridge/use-tokens": [true, { "designSystem": "../design-system" }]
  }
}
```

## bridge/use-tokens

```css
.card {
  color: #1c2735;   /* Use var(--color-text-default) instead of #1c2735: it is the same color (#1c2735). */
  padding: 13px;    /* Use a token instead of the raw spacing 13px: closest is var(--space-3) (12px, high match). */
  z-index: 1000;    /* fixed to var(--layer-dropdown) */
}
```

| Option | Default | |
| --- | --- | --- |
| `designSystem` | `BRIDGE_DS`, else the nearest folder with `bridge.config.json` | Design system repo root. |
| `minConfidence` | `"medium"` | Report a value only when a token is at least this close: `exact`, `high`, `medium`, `low`. |
| `categories` | all | `color`, `spacing`, `size`, `radius`, `border-width`, `shadow`, `duration`, `easing`, `z-index`, `font-family`, `font-size`, `font-weight`, `line-height`. |
| `ignoreProperties` | none | Property names or `/regex/` strings to skip. |

Colors are matched by perceptual distance (deltaE in OKLab) across every mode; semantic tokens and tokens
that fit the property (a background gets a surface token) win near-ties. Lengths go to the nearest scale step.
`var()` fallbacks, percentages, `0`, `auto` and local stacking (`z-index` 0, 1, -1) are not reported.
