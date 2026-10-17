# AGENTS.md

Instructions for AI coding agents (Claude Code and others) working in this repository.
Humans: see `README.md`, `docs/DESIGN-LANGUAGE.md` and `docs/GOVERNANCE.md`.

## What this repo is

The Bridge design system as code. Source of truth is the token JSON and the React components here, not Figma.

- `packages/tokens/src/`: DTCG 2025.10 tokens in tiers: `primitives/`, `brands/` (palette, radius, font roles),
  `semantic/{light,dark,base}`, `density/`, `components/` (component tier). `contrast.checks.json` is the contrast gate.
- `packages/tokens/build.mjs`: Style Dictionary build to `dist/tokens.css`, `dist/tokens.ts`, `dist/resolved.json`.
- `packages/react/src/components/<Name>/`: `Name.tsx`, `Name.module.css`, `Name.stories.tsx`, `Name.docs.json`,
  `Name.test.tsx` (interactive components), `index.ts`. Behavior comes from `@base-ui/react`.
- `docs/DESIGN-LANGUAGE.md`: principles, palette, type, radius, motion, icons, voice. Read it before UI work.
- Storybook = workbench and visual test fixtures; user docs live in Bridge (`apps/docs-site`). Its build output
  `storybook-static/index.json` lists every story and is the source for visual impact screenshots.

## Commands

```sh
npm run tokens:build     # DTCG JSON -> CSS variables + TS, fails on contrast
npm run typecheck        # tsc, strict
npm run lint:css         # Stylelint: tokens only in component CSS
npm test                 # Vitest + Testing Library + axe-core
npm run build-storybook  # must build with no errors
npm run changeset        # record semver bump + changelog entry
```

Run all five checks before you open a PR. CI runs the same ones.

## New component checklist

1. Check Base UI first (`node_modules/@base-ui/react/docs/react/components/*.md`). Wrap the primitive; do not
   re-implement focus, keyboard or ARIA it already handles.
2. `Name.tsx`: `export interface NameProps`, `forwardRef(function Name({ prop = default }, ref))`, extend the
   native element's attributes, spread the rest. Our own prop names, never Base UI's internals in the API.
3. `Name.module.css`: only `var(--*)`. Semantic or component tokens for color, elevation and focus; density
   tokens for heights and paddings; radius roles (`--radius-inset|control|container|overlay|pill`).
4. States: hover (inside `@media (hover: hover)`), `:focus-visible` ring from `--focus-ring-*`, active,
   disabled, invalid, loading where relevant. Check light, dark, ocean brand and compact density.
5. Portaled popups spread `useScopeAttributes()` so theme, brand and density follow.
6. `Name.stories.tsx`: title `<Family>/<Name>`, plus an `AllStates` story (StateGrid). No `autodocs`: stories are
   workbench and visual test fixtures, user docs live in Bridge (`Name.docs.json` feeds the docs site).
7. `Name.docs.json`: same keys as `Button.docs.json` (summary, preview, whenToUse, whenNotToUse, dos, donts,
   accessibility, contentGuidelines, anatomy keyed by CSS class).
8. `Name.test.tsx` for anything interactive: keyboard path, ARIA state, `expectNoAxeViolations()`.
9. Export from `packages/react/src/index.ts` under its family. Add a changeset.

## UI quality bar (every screen and every new feature)

Check each item on a real screenshot before opening the PR, and say in the PR how the screen meets it.

- Progressive disclosure: one summary sentence first, details collapsed or on demand, never every option at once.
- Gestalt: an action sits on the same line as what it acts on (proximity); the same kind of thing uses the same row
  component (similarity); related content shares a region (common region); sections share one width.
- Fitts: main actions at the DS control height (36 to 44px), a lone action fills its bar, no target under 24px,
  no homemade controls where a DS component exists.
- One primary action per view, at most 4 font sizes and 20 interactive elements on the first screen, no empty
  column on wide screens.
- Bridge brand (docs/DESIGN-LANGUAGE.md): Fraunces display, Instrument Sans, Plex Mono for tokens and code, one
  Harbor zone per screen, Deep Harbor the only strong color, the Field Guide drawings, the Bridge voice.
- When users already know a pattern from their tools (Figma library publish and review updates, GitHub reviews),
  mirror it.

## Always

- Work on a branch named `agent/<short-topic>`. One concern per PR.
- Use semantic or component tokens for color, elevation and focus: `var(--color-action-primary-bg)`, never a
  primitive (`--color-orange-500`) and never a literal.
- Use the space, size, radius, type and motion scales. If a value is missing, stop and ask.
- Accessible by default: native elements or Base UI parts, visible focus, labels wired, color never the only signal.
- Write UI copy in the Bridge voice: sentence case, verbs on buttons, errors that say how to fix. No em dashes.
- Add a changeset. Pick the bump with the rules in `.changeset/README.md`.
- Fill the PR template, including the risk tier, and say the change is agent-authored.

## Ask before

- Adding, renaming or removing any token (Tier 3, needs design and tech owner approval).
- Adding a new component or a new variant or prop (Tier 2, open as draft PR).
- Changing a public prop name, default or type (breaking change, `major`).
- Adding a dependency, or upgrading `@base-ui/react`.
- Touching `.stylelintrc.json`, `.github/`, `AGENTS.md`, `CLAUDE.md`, `docs/GOVERNANCE.md` or `contrast.checks.json`.

When in doubt about the tier, choose the higher one.

## Never

- Never write hex, `rgb()`, named colors, raw `box-shadow`, `px`/`rem` lengths, `ms`/`s` durations,
  `cubic-bezier()` or raw z-index values in component CSS.
- Never disable or loosen a lint rule or a contrast pair, add `stylelint-disable`, or use `!important`.
- Never delete or skip tests or stories to make a check pass.
- Never edit `packages/tokens/dist/`: it is generated.
- Never treat a Figma file as the source of truth or copy values from it into code. Figma explores; tokens decide.
- Never merge, push to `main`, or publish. Humans merge.

## Token conventions

- DTCG 2025.10: `$value`, `$type`, `$description`. Aliases use `{group.token}` syntax.
- Colors use the object form `{ "colorSpace": "srgb", "components": [...], "hex": "#..." }`; ramps are
  generated by `packages/tokens/scripts/ramps.mjs`, edit the script, not the JSON.
- Dimensions `{ "value": 16, "unit": "px" }`; durations `{ "value": 150, "unit": "ms" }`.
- Semantic tokens reference `palette.*` only. A semantic token exists in both `light` and `dark`.
- CSS variable name = token path joined by `-`: `color.feedback.danger.text` -> `--color-feedback-danger-text`.

## If a check fails

Fix the cause, not the check. If the fix needs a new token, stop and describe the token you need in the PR
instead of hardcoding a value.
