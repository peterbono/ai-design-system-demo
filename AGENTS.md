# AGENTS.md

Instructions for AI coding agents (Claude Code and others) working in this repository.
Humans: see `README.md` and `docs/GOVERNANCE.md`.

## What this repo is

A design system as code. Source of truth is the token JSON and the React components here, not Figma.

- `packages/tokens/src/primitives/*.tokens.json`: raw scales (W3C DTCG 2025.10 format)
- `packages/tokens/src/semantic/{light,dark}.tokens.json`: semantic aliases, one file per theme
- `packages/tokens/build.mjs`: Style Dictionary build to `dist/tokens.css` and `dist/tokens.ts`
- `packages/react/src/components/<Name>/`: `Name.tsx`, `Name.module.css`, `Name.stories.tsx`, `index.ts`
- `.storybook/`: docs and a11y checks, light and dark themes via `data-theme`

## Commands

```sh
npm run tokens:build     # DTCG JSON -> CSS variables + TS
npm run typecheck        # tsc, strict
npm run lint:css         # Stylelint: no raw colors or shadows in component CSS
npm run build-storybook  # must build with no errors
npm run changeset        # record semver bump + changelog entry
```

Run all four checks before you open a PR. CI runs the same ones.

## Always

- Work on a branch named `agent/<short-topic>`. One concern per PR.
- Use semantic tokens for color, elevation and focus: `var(--color-action-primary-bg)`, not a primitive and never a literal.
- Use the spacing, radius and type scales (`var(--space-4)`, `var(--radius-md)`). If a value is missing, stop and ask.
- Keep components accessible by default: native elements, visible `:focus-visible` ring from `--focus-ring-*`,
  labels wired with `htmlFor` / `aria-describedby`, color never the only signal.
- Add or update stories for every new state, and check them in light and dark.
- Add a changeset. Pick the bump with the rules in `.changeset/README.md`.
- Fill the PR template, including the risk tier and what a reviewer should look at.
- Say in the PR description that the change is agent-authored.

## Ask before

- Adding, renaming or removing any token (Tier 3, needs design and tech owner approval).
- Adding a new component or a new variant or prop (Tier 2, open as draft PR).
- Changing a public prop name, default or type (breaking change, `major`).
- Adding a dependency.
- Touching `.stylelintrc.json`, `.github/`, `AGENTS.md`, `CLAUDE.md` or `docs/GOVERNANCE.md`.

When in doubt about the tier, choose the higher one.

## Never

- Never write hex, `rgb()`, `hsl()`, named colors or raw `box-shadow` values in component CSS.
- Never disable or loosen a lint rule, add `stylelint-disable`, or use `!important` to get CI green.
- Never delete or skip tests or stories to make a check pass.
- Never edit `packages/tokens/dist/`: it is generated.
- Never treat a Figma file as the source of truth or copy values from it into code. Figma explores; tokens decide.
- Never merge, push to `main`, or publish. Humans merge.

## Token conventions

- DTCG 2025.10: `$value`, `$type`, `$description`. Aliases use `{group.token}` syntax.
- Colors use the object form: `{ "colorSpace": "srgb", "components": [...], "hex": "#..." }`.
- Dimensions use the object form: `{ "value": 16, "unit": "px" }`.
- A semantic token must exist in both `light.tokens.json` and `dark.tokens.json`.
- CSS variable name = token path joined by `-`: `color.feedback.danger.text` -> `--color-feedback-danger-text`.

## Component conventions

- Function components, typed props interface exported as `<Name>Props`.
- Extend the native element's HTML attributes and spread the rest onto it.
- `forwardRef` for focusable elements.
- CSS Modules only. Class per variant (`styles[variant]`).

## If a check fails

Fix the cause, not the check. If the fix needs a new token, stop and describe the token you need in the PR
instead of hardcoding a value.
