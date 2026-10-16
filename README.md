# Bridge design system

The design system behind **Bridge** (provisional name), run as code and evolved with an AI agent (Claude)
through branches and pull requests that humans review. Figma is used for exploration; the tokens and
components in this repo are the source of truth.

- **Tokens**: W3C DTCG 2025.10 in three tiers (primitive, semantic, component) plus a brand mapping layer,
  two brands (`bridge`, `ocean`), light and dark themes, comfortable and compact density, built by
  Style Dictionary 4 with a WCAG contrast gate.
- **Components**: React on [Base UI](https://base-ui.com) (`@base-ui/react` 1.9) for behavior and accessibility,
  CSS Modules that only read `var(--*)` tokens, Lucide icons, IBM Plex Sans and Mono.
- **Quality gates in CI**: token build and contrast, TypeScript, Stylelint (tokens only), Vitest with
  Testing Library and axe-core, Storybook build with the a11y addon in error mode.

Design rationale: [`docs/DESIGN-LANGUAGE.md`](docs/DESIGN-LANGUAGE.md). Architecture: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).
Maintained by Florian Gouloubi, Senior Product Designer. Packages are private and unpublished.

## Quick start (this repo)

Requires Node 20.19+ (see `.nvmrc`).

```sh
npm install
npm run storybook        # builds tokens, opens Storybook on :6006 (toolbar: Theme, Brand, Density)
npm test                 # Vitest: keyboard, ARIA and axe-core checks
npm run ci               # tokens:build, typecheck, lint:css, test, build-storybook
```

## Use it in an app

```tsx
// main.tsx: import the CSS once, in this order
import '@demo-ds/tokens/fonts.css';   // IBM Plex Sans + Mono, self-hosted (@fontsource)
import '@demo-ds/tokens/tokens.css';  // every token as a CSS variable
import '@demo-ds/react/styles.css';   // base: body font, selection, focus, scrollbars

import { Button, Field, Input, ThemeProvider, ToastProvider } from '@demo-ds/react';

export function App() {
  return (
    <ThemeProvider asRoot theme="light" brand="bridge" density="comfortable">
      <ToastProvider>
        <Field label="Repository" description="Owner and name, like acme/design-tokens.">
          <Input placeholder="acme/design-tokens" />
        </Field>
        <Button>Connect repository</Button>
      </ToastProvider>
    </ThemeProvider>
  );
}
```

### Theming

| Attribute | Values | What it switches |
| --------- | ------ | ---------------- |
| `data-theme` | `light` (default), `dark` | Semantic color and elevation tokens |
| `data-brand` | `bridge` (default), `ocean` | Palette roles, radius roles, font roles, a few semantic overrides |
| `data-density` | `comfortable` (default), `compact` | Control heights, paddings, row heights, layout gaps |

`ThemeProvider` sets all three together (on `<html>` with `asRoot`, or on a wrapper `div` for a nested
scope) and passes the scope to portaled overlays. Without React, set the three attributes yourself on the
same element. Values for tooling live in `@demo-ds/tokens` (`cssVar`, `primitives`, `brands`, `themes`,
`densities`, `breakpoints`) and `@demo-ds/tokens/resolved.json` (every value per brand and theme, plus contrast ratios).

To add a brand: add `packages/tokens/src/brands/<name>.tokens.json` mapping palette, radius and font roles,
optionally `<name>.<theme>.tokens.json` overrides, add the name to `BRANDS` in `build.mjs`, and let the
contrast gate tell you which pairs need work.

## Components (v1)

| Family | Components |
| ------ | ---------- |
| Foundations | ThemeProvider, Icon, VisuallyHidden |
| Actions | Button, IconButton, ButtonGroup, Link |
| Forms | Field, Input, Textarea, Select, Combobox, Checkbox, CheckboxGroup, RadioGroup, Switch, Slider, NumberField, Form |
| Feedback | Alert, Toast (ToastProvider, useToast), Progress (linear, circular), Spinner, Skeleton, EmptyState |
| Overlays | Dialog, AlertDialog, Drawer, Popover, Tooltip, Menu (submenus, checkbox and radio items) |
| Navigation | Tabs, Breadcrumb, Pagination, SidebarNav |
| Data display | Card, Badge, Avatar (AvatarGroup), Table, Accordion, Tag, Divider, Kbd |
| Layout | Stack, Inline, Grid, Container |

Every component ships with: a CSS module that only reads tokens, Storybook stories including an
**All states** story, a `<Name>.docs.json` with usage guidance (when to use, do and don't, accessibility,
content guidelines) for the docs site, and unit tests for interactive behavior.

## What is inside

```
packages/tokens   DTCG token JSON (primitives, brands, semantic, density, component tier), build.mjs, contrast gate
packages/react    components on Base UI, CSS Modules reading var(--*) only, stories, docs.json, tests
.storybook        react-vite, addon-docs, addon-a11y, pseudo-states; theme, brand and density toolbars
.changeset        semver bumps and changelog entries
.github           CI guardrails, CODEOWNERS, PR template with design review checklist
AGENTS.md         instructions and component checklist for AI agents (CLAUDE.md just imports it)
docs/             DESIGN-LANGUAGE, ARCHITECTURE, GOVERNANCE, SOURCES, pr-drafts/
```

## The operating model

- **The repo is the source of truth.** Tokens live as W3C DTCG JSON; Figma explores and receives a one-way
  import of what shipped, with no bidirectional sync.
- **Tiers keep decisions in one place.** Primitives hold raw scales; brands map them to roles; semantic
  tokens give them meaning per theme; component tokens give components stable hooks.
- **Guardrails live in CI, not in prompts.** Stylelint rejects raw values, the token build rejects
  contrast failures, tests check keyboard and ARIA. The agent cannot talk its way past a failing check.
- **The agent is a contributor, not a maintainer.** It works on `agent/*` branches, opens PRs, adds a
  changeset and fills the template. It never merges.
- **Review effort scales with risk.** Docs and lint fixes are Tier 1; new variants are Tier 2 drafts;
  token or breaking changes are Tier 3 and need design and tech owner approval (`docs/GOVERNANCE.md`).

## How an AI-authored change flows

```
issue  ->  agent branch  ->  PR + changeset  ->  CI guardrails  ->  design + tech review  ->  merge  ->  release
```

Three local branches simulate agent PRs, each with a draft description in `docs/pr-drafts/`:

| Branch | Tier | Expected outcome |
| ------ | ---- | ---------------- |
| `agent/badge-subtle-variant` | 2, medium | Approve after design review |
| `agent/focus-ring-token` | 3, high | Needs design + tech owner approval |
| `agent/card-elevation-hardcoded` | 2, but CI fails | Request changes: use the elevation token |

## Placeholders

`@design-owner` and `@tech-owner` in `.github/CODEOWNERS` are placeholder handles. Replace them with real
users or teams and enable "Require review from Code Owners" in branch protection.

## References

See `docs/SOURCES.md`.
