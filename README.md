# AI design system demo

A small design system run as code, evolved with an AI agent (Claude) through branches and pull requests
that humans review. Figma is used for exploration; the tokens and components in this repo are the source
of truth.

> **Demo repository illustrating an operating model; not a production library.** It is deliberately small
> (4 components, 1 brand, 2 themes) so the process is easy to follow. Packages are private and unpublished.

Maintained by Florian Gouloubi, Senior Product Designer.

## Quick start

Requires Node 20.19+ (see `.nvmrc`).

```sh
npm install
npm run storybook        # builds tokens, opens Storybook on :6006 (toolbar: Theme light/dark)
npm run ci               # tokens:build, typecheck, lint:css, build-storybook
```

## What is inside

```
packages/tokens   DTCG 2025.10 token JSON (primitives + light/dark semantic) -> Style Dictionary -> CSS vars + TS
packages/react    Button, Input, Badge, Card. CSS Modules that read var(--*) tokens only
.storybook        react-vite, addon-docs, addon-a11y, theme toggle via data-theme
.changeset        semver bumps and changelog entries
.github           CI guardrails, CODEOWNERS, PR template with design review checklist
AGENTS.md         short instructions for agents (CLAUDE.md just imports it)
docs/             ARCHITECTURE, GOVERNANCE, SOURCES, pr-drafts/
```

## The operating model

- **The repo is the source of truth.** Tokens live as W3C DTCG JSON; Figma explores and receives a one-way
  import of what shipped, with no bidirectional sync.
- **Two tiers of tokens.** Primitives hold raw scales; semantic tokens alias them per theme. Components
  only use semantic tokens for color, elevation and focus.
- **Guardrails live in CI, not in prompts.** Stylelint rejects raw colors and shadows, TypeScript checks
  the API, Storybook must build. The agent cannot talk its way past a failing check.
- **The agent is a contributor, not a maintainer.** It works on `agent/*` branches, opens PRs, adds a
  changeset and fills the template. It never merges.
- **Review effort scales with risk.** Docs and lint fixes are Tier 1; new variants are Tier 2 drafts;
  token or breaking changes are Tier 3 and need design and tech owner approval (`docs/GOVERNANCE.md`).
- **Short context beats long context.** A sub-120-line `AGENTS.md` plus typed tokens and lint errors give
  the agent better signal than a long prose style guide.

## How an AI-authored change flows

```
issue  ->  agent branch  ->  PR + changeset  ->  CI guardrails  ->  design + tech review  ->  merge  ->  release
```

1. **Issue.** A designer or engineer describes the need, often with a Figma exploration linked.
2. **Agent branch.** Claude reads `AGENTS.md`, creates `agent/<topic>`, changes tokens or components.
3. **PR with changeset.** The PR template asks for the risk tier, the bump level and what to review.
4. **CI guardrails.** Token build, typecheck, Stylelint, Storybook build, changeset check.
5. **Design + tech review.** Reviewers open Storybook in light and dark, read the CSS diff, check a11y.
   CODEOWNERS routes token changes to both owners.
6. **Merge.** A human code owner merges.
7. **Release.** `changeset version` bumps packages and writes the changelog.

Three local branches simulate agent PRs, each with a draft description in `docs/pr-drafts/`:

| Branch | Tier | Expected outcome |
| ------ | ---- | ---------------- |
| `agent/badge-subtle-variant` | 2, medium | Approve after design review |
| `agent/focus-ring-token` | 3, high | Needs design + tech owner approval |
| `agent/card-elevation-hardcoded` | 2, but CI fails | Request changes: use the elevation token |

```sh
git switch agent/card-elevation-hardcoded && npm run lint:css   # see the guardrail fail
```

## Placeholders

`@design-owner` and `@tech-owner` in `.github/CODEOWNERS` are placeholder handles. Replace them with real
users or teams and enable "Require review from Code Owners" in branch protection.

## References

See `docs/SOURCES.md`.
