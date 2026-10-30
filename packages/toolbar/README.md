# @bridge-ds/toolbar

The Bridge toolbar for a product built with the Bridge design system. Bridge Studio opens the product with
`?bridge=<change>` ("Try it in the product"); the toolbar then lets anyone browse the real product and flip between
**Live product** (before) and **This change** (after), with **Show what changed** for token changes.

- **Code changes** (an exploration in the product's repository, a feature branch): Before is the product in
  production, After is the branch's preview. Flipping keeps the screen and the scroll position.
- **Token changes** of the design system: the live tokens swap in without a reload, and Show what changed outlines
  every surface that differs.

Without `?bridge=` (or the session that remembers it) it renders nothing and loads nothing: the toolbar and its styles
are one lazy chunk.

## Mount it

```sh
npm i @bridge-ds/toolbar
```

One line at the root of the app, inside the design system's `ThemeProvider`:

```tsx
import { BridgeToolbar } from '@bridge-ds/toolbar';

<BridgeToolbar ds="acme/design-system" product="checkout" />
```

`ds` is the design system repository and `product` the product's key in its `bridge.config.json` `products[]`. When
Studio opens the page, the toolbar reads that config from GitHub once per session: the product's repository (where its
explorations are pull requests), `production` (Before of a code change), `preview` (the branch preview template, the
only hosts allowed to hand over to production) and production Studio (`previews.production.docs`, the way back and the
live tokens). `bridge connect` prints this line with your values.

```json
{ "key": "checkout", "name": "Checkout", "repo": "acme/checkout", "framework": "react",
  "preview": "https://checkout-git-{branch}-acme.vercel.app", "production": "https://checkout.acme.com" }
```

## Options

| Prop | What it does |
| --- | --- |
| `studio`, `production`, `preview` | Override what the config says (for example a staging URL as Before). |
| `deployEnv` | `"production"` or `"preview"` when your build knows it (Vercel: `VERCEL_ENV`). |
| `build` | Every fact at once, read at build time: no config read at run time. |
| `scope` | A hook returning `{ theme, brand, density, shop, set }` when your app keeps theme and shop in state. Default: the `data-theme`, `data-brand` and `data-density` attributes `ThemeProvider asRoot` puts on `<html>`. |
| `shops` | `{ id, name, brand }[]` of a multi-brand product, for the screens list and "Switch to <shop>". |
| `together` | A loader of the latest library's token files (`togetherBase` from `@bridge-ds/toolbar/together`), so Studio's "Try them together" runs on your production. |

Reads are anonymous (public repositories): at most a few GitHub API reads per change and session.
