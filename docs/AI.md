# Use Bridge with your own Claude

Bridge gives Claude (Claude Code, Claude Desktop or any MCP client) a structured view of your design system:
tokens resolved in every brand, theme and density, the contrast gate, components with their props and usage
docs, the design language and the agent rules. Claude can then build UI with real tokens and propose token
changes as pull requests that your design and tech owners review.

- **Free and open source** (MIT). No account, no backend, no hosted service.
- **Bring your own**: your repo, your Claude, your GitHub token (optional).
- **Repo-agnostic**: point it at any DTCG token repo. `bridge.config.json` says where things are; without it
  Bridge detects them.

> The packages (`@bridge-ds/mcp`, `@bridge-ds/cli`) are **not published to npm yet**. Use the local path commands
> below. The `npx` forms are shown for when they are.

## 1. Build once

```sh
git clone https://github.com/peterbono/ai-design-system-demo && cd ai-design-system-demo
npm install
npm run mcp:build
```

The server is now at `packages/mcp/dist/index.js` and the CLI at `packages/cli/dist/index.js`.

## 2. Point it at your design system

In your design system repo:

```sh
node /path/to/ai-design-system-demo/packages/cli/dist/index.js init
```

`bridge init` detects your token folder, tiers and modes, writes `bridge.config.json` (edit it if the
detection is off), writes `.mcp.json` for Claude Code, and prints the Claude Desktop snippet.
`bridge check` then validates tokens and runs the contrast gate; use it in CI (exit 0 ok, 1 failures,
2 setup error).

## 3. Connect your client

### Claude Code

Project-scoped (shared with your team through git), in `.mcp.json` at the repo root:

```json
{
  "mcpServers": {
    "bridge": { "command": "node", "args": ["packages/mcp/dist/index.js", "--root", "."] }
  }
}
```

This repo ships that file. Claude Code asks you to approve project servers the first time.

Or user-scoped, from a terminal:

```sh
claude mcp add bridge -- node /abs/path/packages/mcp/dist/index.js --root /abs/path/to/your-ds
# once published to npm:
claude mcp add bridge -- npx -y @bridge-ds/mcp
```

### Claude Desktop

Settings > Developer > Edit config, then add to `claude_desktop_config.json` and restart:

```json
{
  "mcpServers": {
    "bridge": {
      "command": "node",
      "args": ["/abs/path/packages/mcp/dist/index.js", "--root", "/abs/path/to/your-ds"]
    }
  }
}
```

To work on a GitHub repo instead of a local folder, use `"args": [".../index.js", "--repo", "owner/name"]`
and, only if you want Claude to open pull requests, `"env": { "GITHUB_TOKEN": "..." }`.

### Other MCP clients

Any client that speaks MCP over stdio works: run `node packages/mcp/dist/index.js` with `--root <dir>` or
`--repo owner/name [--ref branch]`. Options can also come from env: `BRIDGE_ROOT`, `BRIDGE_REPO`,
`BRIDGE_REF`, `GITHUB_TOKEN` (or `BRIDGE_GITHUB_TOKEN`).

## What Claude can do

28 tools: 6 for tokens (config, browse, read, search, contrast, validation), 6 for components and guidance,
5 for proposals and reviews (visual impact included), 3 for brands, 4 for history and revert, 1 for adoption
audits, 3 for component change requests.

| Tool | Use it to |
| --- | --- |
| `bridge_get_config` | See where the design system is, which modes exist, and what Bridge may write |
| `bridge_list_tokens` | Browse tokens by tier (primitive, brand, semantic, density, component), type, prefix, mode |
| `bridge_get_token` | Get a token's value in every mode, its alias chain, what aliases it and which components use it |
| `bridge_search_tokens` | Find the right token by intent ("danger text"), CSS variable or value (`#c2410c`, `16px`) |
| `bridge_check_contrast` | Run the WCAG contrast gate; preview the effect of edits before proposing them |
| `bridge_validate_tokens` | Check DTCG shapes, aliases (broken, circular), type mismatches, light and dark parity |
| `bridge_list_components` | Pick an existing component before writing new markup |
| `bridge_get_component` | Read props (types, defaults, allowed values), when to use, dos and donts, accessibility, anatomy |
| `bridge_scaffold_component` | Generate a component folder that follows the repo checklist |
| `bridge_draft_docs` | Start or refresh a component's docs.json: what the code tells (props, tokens, anatomy, contrast, changelog line) plus a prompt for you to write the prose (see [Docs drafts](#docs-drafts)) |
| `bridge_get_design_language` | Read the relevant section of the design language |
| `bridge_get_guidelines` | Read the agent rules (always, ask before, never) and the risk tiers |
| `bridge_propose_token_change` | Turn token edits into a branch (local) or a draft PR (GitHub), with a designer-friendly body |
| `bridge_list_brands` | See the brands: slug, name, default, primary action color, theme overrides |
| `bridge_plan_brand` | Dry run of a new brand: generated ramps, every contrast pair in light and dark, files, tier, PR body |
| `bridge_propose_brand` | Turn that plan into a `bridge/brand-<slug>` branch (local) or a draft PR (GitHub), never `main` |
| `bridge_list_reviews` | List open PRs and local proposal branches |
| `bridge_get_review` | Review a token PR: diff table, contrast before and after, downstream impact, tier, CI, approvals |
| `bridge_review_pr` | Comment, approve or request changes on a PR, as you |
| `bridge_visual_impact` | See what a change does on screen: before/after/diff of the impacted stories and app screens |
| `bridge_get_history` | See what changed in the tokens: versions, merged PRs and commits, who, when, why, tier, breaking |
| `bridge_get_token_history` | Every change of one token: value before and after per mode, the PR and why, renames followed |
| `bridge_plan_revert` | Dry run of undoing a change (or restoring one token) against today's base branch, conflicts shown |
| `bridge_propose_revert` | Turn that plan into a branch (local) or a draft PR labelled `revert` (GitHub), never `main` |
| `bridge_audit` | Measure how a product codebase adopts the design system: token and component adoption, hardcoded values with the closest token, foreign UI components with the DS component to use, top files and fixes |
| `bridge_list_requests` | List component change requests (GitHub issues labeled `component-change`) with status: requested, in progress (an open pull request says "Closes #n"), done, declined |
| `bridge_get_request` | Read one request with the component's files, the agent rules and a brief to implement it in a pull request that closes it |
| `bridge_create_request` | File a request as an issue labeled `component-change` (`source: mcp`); needs `GITHUB_TOKEN`; `dryRun` previews it |

Resources: `bridge://tokens/resolved`, `bridge://design-language`, `bridge://guidelines`,
`bridge://components/{name}`.

Prompts (slash commands in Claude Code, for example `/mcp__bridge__audit-ui-for-tokens`):

- `review-token-pr`: review a token PR like the design system owner, then post only after you confirm.
- `add-component`: check for an existing component, plan the API and tokens, then scaffold.
- `audit-ui-for-tokens`: paste CSS or TSX; Bridge flags hardcoded colors, lengths, durations, shadows and
  z-index and suggests the token for each, matched to the property (a background gets a surface token).
- `migrate-file-to-ds`: give a product file; Bridge audits it (values and components with line numbers), then
  Claude rewrites it with DS components and tokens, explains each change and re-runs the audit.

Things to ask:

- "What does darkening the danger palette change on screen? Plan first, then run it."

- "Which token should this card background use in dark mode?"
- "Darken muted text in the light theme and show me the contrast impact first."
- "Review PR 42 for the design owner."
- "Audit this component's CSS for hardcoded values."
- "When did muted text change, and why?"
- "Draft the docs of VisuallyHidden from its code, then show me what you could not tell."
- "Undo PR 12, but show me what changed since first."
- "Plan a brand called Acme from Ocean with #1F5F3A as primary, and tell me which contrast pairs fail."

## New brands

A brand re-points palette, radius and font roles; components never change. `bridge_plan_brand` starts from
an existing brand (or `blank`), generates the primary and neutral ramps with the same engine as
`packages/tokens/scripts/ramps.mjs` as primitives (`primitives/<slug>.tokens.json`, aliased by the brand file), copies the starting brand's theme overrides, adds the slug to
`modes.brand` in `bridge.config.json` and runs every contrast pair for the new brand in light and dark. A hex
primary is pinned at the step primary buttons use (700 in Bridge, 600 in Ocean), so a color too light for
white button text fails the gate and says which pairs break. `bridge_propose_brand` writes the same plan to a
new branch, and is blocked when a pair fails. A new brand is Tier 3 (minor bump of `@bridge-ds/tokens`): it
needs design and tech owner approval.

```sh
bridge brand list
bridge brand create acme --from bridge --primary "#1F5F3A" --neutral "#2A2F2C" --dry-run
bridge brand create acme --name "Acme" --from ocean --primary "#1F5F3A" --neutral 230 \
  --radius crisp --heading fraunces --text plex-sans   # new local bridge/brand-acme branch
```

`--primary`, `--neutral`, `--accent` and `--link` take `#rrggbb` or an OKLCH hue in degrees. `--radius` takes
`soft`, `balanced`, `crisp` or four px values on the radius scale (inset, control, container, overlay). Fonts
are the ones the tokens package self-hosts: `fraunces` (headings only), `instrument-sans`, `plex-sans`,
`system`. Exit 1 when blocked.

## History and rollback

`bridge_get_history` reads the token history Bridge can see: locally the first-parent commits of `HEAD`
that touched the tokens (a merged branch is one entry), on GitHub each commit's pull request (a PR is one
entry, diffed as it merged). Each entry has the token diff, who, when, why (the changeset summary, else the
PR or commit description), its risk tier and semver bump, and the version it shipped in (CHANGELOG sections
and tags; changes after the last release are `Unreleased`). Imports of more than 60 tokens are flagged as
bulk.

Undoing a change is not a blind `git revert`. `bridge_plan_revert` computes the inverse token edits against
the base branch as it is now. A token that changed again later, was removed, came back or is now aliased by
other tokens is a conflict: Bridge shows the later change that explains it and keeps the current value
unless you choose to restore the old one (`resolutions`, or `--use-before path@file` in the CLI). Changes
already undone are skipped. The rest goes through the same edits, validation, contrast gate, tier and
changeset as any proposal, and the PR body starts with "Reverts #n". To put a single token back to an older
value, pass `restore: { path, entry, mode }`.

From a terminal:

```sh
bridge history                       # versions and merged token changes
bridge history color.text.muted      # every change of one token
bridge revert 12 --dry-run           # plan: edits, conflicts, contrast, PR body
bridge revert 12                     # new local bridge/revert-... branch, nothing pushed
```

## Visual impact

Token diffs and contrast ratios say what changed; screenshots say what it looks like. `bridge impact` (and the
`bridge_visual_impact` tool) compares two refs:

```sh
npm run mcp:build
node packages/cli/dist/index.js impact --base main --head HEAD            # full run, a few minutes
node packages/cli/dist/index.js impact --base main --head HEAD --plan     # what would be captured, in seconds
node packages/cli/dist/index.js impact --only stories --out /tmp/vi       # Storybook only
```

1. **Selection.** Tokens whose resolved value differs (in any brand, theme or density, through aliases) become
   CSS variables. The usage index in `@bridge-ds/core` knows which variables each component's CSS reads and which
   components it renders, so a change reaches the components that read it, then the components that render
   those. Changed component files map to their own stories. Each directly impacted component gets up to 4
   stories (`AllStates` first); one reached only through what it renders gets its `AllStates` story. Shared
   library code, global styles reading a changed token, the Storybook config or the token build fall back to
   every `AllStates` story. Docs, tests and `*.docs.json` are ignored.
2. **Builds.** The merge base and the head are checked out as git worktrees in a temp folder, reusing the
   installed `node_modules` (workspace packages point at each worktree), then tokens, Storybook and the admin
   app are built. Builds are cached by commit under `node_modules/.cache/bridge-visual`; worktrees are removed.
3. **Capture.** One headless Chrome (playwright-core, the installed Chrome, no download): stories in
   bridge/ocean x light/dark at 1024 px; the admin dashboard, orders list, a cancelled order, a rejected review
   with the drawer open, customers and products per tenant x theme at 1280 x 800. Deterministic: fixed clock and
   `Math.random`, reduced motion, animations, transitions and caret off, fonts and images loaded, a DOM that
   stopped changing, remote requests stubbed, `[data-visual-mask]` painted over.
4. **Diff.** pixelmatch (threshold 0.03, anti-aliasing ignored; one step of a color ramp is about 0.1),
   bounding boxes of changed regions, and a before | after | diff composite with a zoom on the largest change.

Output: `visual-impact/manifest.json` (every shot: status, changed %, boxes, image paths) and `before/`,
`after/`, `diff/`, `composite/` PNGs for changed shots. Diffs never fail the command.

On pull requests, `.github/workflows/visual-impact.yml` runs it when tokens, components, the admin or the
Storybook config change, publishes the images to the orphan branch `bridge-visual` under
`pr-<number>/<head sha>/`, and keeps one sticky comment up to date with the table and the composites. It labels
the PR `visual-change` and never fails it. Reviews in the Bridge docs site reads the same manifest: before/after
slider, diff toggle, brand and theme filters.
- "How much of apps/admin uses the design system? Which files should we migrate first?"

## Docs drafts

Every component page in Bridge reads its `<Name>.docs.json`. Part of it comes from the code and is never
invented: the props table (from the TypeScript props), the tokens its stylesheet reads (and the ones it reads
through another component's stylesheet, like IconButton through Button), the anatomy (one entry per CSS module
class), the contrast checks those tokens take part in, and a changelog line. The rest is prose a person writes:
summary, when to use and not, do and don't, accessibility, content guidelines. Claude can draft that prose, and
a reviewer accepts it.

- **Your own Claude, no setup.** `bridge_draft_docs` (MCP) returns the pre-fill, the target path, the keys still
  missing and a prompt with the repo conventions (AGENTS.md, the voice section of the design language,
  `Button.docs.json` as the example, the component source). Ask "Draft the docs of Icon": Claude writes the
  prose, sets `"draftedBy": "claude"` and `"needsReview": true`, and saves the file. Nothing is written by the
  tool itself.
- **From a terminal.** `bridge docs draft Icon` prints the same pre-fill and prompt; `--json` prints
  `{ path, prefill, prompt }` for scripts.
- **On pull requests, optional.** The `Docs drafts` workflow (`.github/workflows/docs-draft.yml`) runs when a
  pull request touches components or tokens. Without the `ANTHROPIC_API_KEY` repository secret it posts one
  comment, "AI doc drafts are off. Add ANTHROPIC_API_KEY to enable.", and passes. With it, each touched
  component whose docs are missing, incomplete or older than its code gets a draft from `claude-sonnet-5-5`,
  committed to the pull request branch with `"draftedBy": "claude"` and `"needsReview": true`; the comment lists
  what was drafted. It never blocks a pull request, skips pull requests from forks, and never drafts on top of
  its own commit.
- **Review.** In Bridge Studio, a pull request's Docs section lists the drafted files with a "Draft by Claude,
  needs review" badge: Accept commits `"needsReview": false` to the branch, Edit opens the docs editor. Studio
  Quality lists every docs file that still needs review. A docs-only change is Tier 1 (patch).

## Component change requests

Variables are pull requests people approve. Components need code, so a change to one (new component, structure,
variant, prop, visual, token binding) becomes a **request**: a GitHub issue labeled `component-change`, filed
from Figma, Bridge Studio, the CLI or Claude, that a developer implements (with their own Claude if they like) in
a pull request that says `Closes #n`. Jira is optional. See [REQUESTS.md](REQUESTS.md).

```sh
bridge request list --status requested            # what is waiting
bridge request show 42                            # one request, its component files, linked pull requests
bridge request implement 42                       # the brief for Claude, on stdout
bridge request implement 42 --claude              # start Claude Code with that brief
bridge request create --component Button --kind new-variant --title "Add a danger ghost variant" \
  --summary "Toolbars need a quieter danger button." --change variant=:danger-ghost
```

Ask Claude: "Which component requests are waiting?", "Implement request 42."

## Measure adoption in product code

`bridge audit` reads a product codebase that consumes the design system and tells you how much of it really
uses it. Run it from the design system repo (or pass `--ds <dir>`):

```sh
bridge audit ../my-app/src                         # summary in the terminal
bridge audit ../my-app/src --json audit.json --md audit.md --label "my-app"
bridge audit ../my-app/src --baseline audit.json --no-regress --fail-under 60   # CI: exit 1 when it drops
bridge audit ../my-app/src --fix                   # dry run: CSS values equal to a token
bridge audit ../my-app/src --fix --write           # replace them with var(--token)
```

- **Token adoption** = token references / (token references + hardcoded values). Hardcoded colors, spacing,
  sizes, radii, borders, shadows, durations, easings, z-index and fonts are found in CSS, SCSS, CSS modules,
  `style`, MUI `sx`, `styled()`, theme objects, CSS-in-JS templates and Tailwind classes (`p-[13px]`,
  `bg-blue-500`). Each gets the closest token: colors by perceptual distance (deltaE in OKLab) across every
  brand, theme and density, lengths by the nearest scale step, with a confidence.
- **Component adoption** = DS component instances / all UI component instances: DS, foreign libraries (MUI,
  react-admin, antd, Chakra, Radix, Headless UI, Mantine, shadcn/ui local components), native elements that
  should be DS components (`button`, `input`, `select`, `textarea`, `dialog`, `table`, `a` with `href`, `img`), router links
  outside a DS component's `render` prop, chart libraries (recharts...: no DS equivalent) and local components
  named like a DS component.
- The JSON report is versioned (`packages/core/audit-report.schema.json`). Commit it under
  `apps/docs-site/src/data/audits/` and the docs site shows it in Studio Quality (each report on its own page), with the trend across
  baselines. Exit codes: 0 ok, 1 under `--fail-under` or regressed with `--no-regress`, 2 setup error.
- In the editor, the lint plugins give the same feedback while you type: `@bridge-ds/stylelint-plugin`
  (`bridge/use-tokens`, autofix for exact matches) and `@bridge-ds/eslint-plugin`
  (`bridge/no-hardcoded-style-values`, `bridge/prefer-ds-components`). See their READMEs.
- `bridge.config.json` takes an optional `audit` section: `packages` (where DS components are imported from),
  `foreignLibraries`, `nativeElements`, `exclude`.

## Safety model

- **Read-only by default.** Without `GITHUB_TOKEN` nothing remote is written. Locally, read tools never
  write.
- **Never `main`.** Proposals go to new branches named `bridge/<title>`. The protected list (`main`,
  `master`, the configured base branch) is checked in the GitHub client and the local git writer, whatever
  the caller asks. Existing branches are never overwritten; a new suffix is used instead.
- **Pull requests, not pushes.** Remote proposals open a **draft** PR labelled `source: mcp` and `tier: N`.
  Local proposals commit to a local branch through git plumbing: your checkout, index and working tree are
  untouched, and nothing is pushed.
- **Reverts are planned, not blind.** A revert is computed against today's base branch; tokens that
  changed again since are shown as conflicts and kept unless you choose otherwise.
- **Gates before writes.** A proposal that adds a validation error or makes a contrast pair fail is
  blocked and nothing is written.
- **Tiers.** Any token added, changed, renamed or removed is Tier 3 (design and tech owner approval), as in
  `docs/GOVERNANCE.md`. Renames and removals are `major`; a description-only edit is Tier 1, `patch`. The
  Figma plugin, the docs site and the MCP server use the same classifier. Bridge computes the tier from the diff, writes the
  changeset, and warns in reviews when a PR is labelled lower than its real tier.
- **Humans merge.** Bridge has no merge tool. `bridge_review_pr` posts a review under your account only
  when you ask.
- **Tokens.** Use a fine-grained GitHub token limited to the one repo, with contents and pull requests
  read and write. Bridge sends it only to `api.github.com`.

## How it compares

Tokens Studio offers AI and MCP features as part of its hosted platform. Bridge covers the same loop
(read tokens, check, propose, review) as a free, local, open source tool on top of the files you already
have, with your own Claude and your own GitHub token.

## Status

v0.1, not yet published to npm. The server is built on `@bridge-ds/core`, the same package as the DS Bridge Figma
plugin and the docs site: one `bridge.config.json` (schema in `packages/core/bridge.config.schema.json`), one
risk classifier, one GitHub client with the same protected-branch guard.
