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
apps/docs-site    Astro documentation site generated from all of the above, plus /llms.txt
```

## Documentation site

`apps/docs-site` is a static [Astro](https://astro.build) site for designers and product teams. Every page is
generated from the repo at build time, so nothing is typed twice:

| Page | Generated from |
| ---- | -------------- |
| Foundations: color, contrast, type, spacing, radius, elevation, token lookup | `packages/tokens/src/**` (DTCG JSON), `contrast-pairs.json` |
| Components: usage, do/don't, a11y, anatomy and tokens, props, live preview | `<Name>.docs.json` (guidance), `<Name>.tsx` (props), `<Name>.module.css` (tokens), `<Name>.stories.tsx` (stories) |
| Governance | `docs/GOVERNANCE.md`, `AGENTS.md` (+ plain-language rewrites in `apps/docs-site/src/content/agent-rules-plain.json`) |
| Changelog | `.changeset/*.md` and git log (conventional commits) |
| `/llms.txt` and For AI agents | the same sources, as plain text |

Each page shows a "last updated" date from the git history of its source files. The site imports
`@demo-ds/tokens/tokens.css` and uses only those variables, so it dogfoods the tokens (`npm run lint:css` checks it).

Props are parsed from the TypeScript types so the table cannot drift from the code; usage guidance lives in a small
`<Name>.docs.json` next to each component because a parser cannot know when to use a button.

```sh
npm run docs:dev         # tokens:build, then Astro dev server on :4321
npm run docs:build       # tokens:build, then static build to apps/docs-site/dist
STORYBOOK_URL=https://storybook.example.com npm run docs:build   # where component pages embed stories (default http://localhost:6006)
```

Deploy (not done yet): `apps/docs-site/vercel.json` builds from the repo root with `npm run docs:build` and serves
`apps/docs-site/dist`. On Vercel, set the project root directory to `apps/docs-site`. Any static host works:
upload `apps/docs-site/dist`. Set `SITE_URL` for absolute URLs.

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
