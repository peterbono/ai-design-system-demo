# @bridge-ds/mcp

An MCP server that connects your own Claude (Claude Code, Claude Desktop or any MCP client) to your own
design system repo. Claude can read your DTCG tokens, components and docs, run your contrast gate, and
propose token changes as reviewable branches and pull requests. It never writes to `main`.

Free and open source (MIT). Local, no backend, no account: it reads files on your disk, or a GitHub repo
with your own token.

> On npm: `npx -y @bridge-ds/mcp` runs it, nothing to build. The local path form (`node packages/mcp/dist/index.js`)
> is for working on the server itself.

## Run it

```sh
npm run mcp:build                                   # builds packages/mcp and packages/cli
node packages/mcp/dist/index.js --root .            # local repo (default: current directory)
node packages/mcp/dist/index.js --repo owner/name   # GitHub repo, read-only
GITHUB_TOKEN=... node packages/mcp/dist/index.js --repo owner/name   # GitHub repo, can open PRs
```

Connect it to Claude Code:

```sh
claude mcp add bridge -- npx -y @bridge-ds/mcp --root /abs/path/to/your-ds
# or a GitHub repo (pull requests need a token):
claude mcp add bridge -s user -e GITHUB_TOKEN=your-github-token -- npx -y @bridge-ds/mcp --repo owner/name
```

Or commit a project `.mcp.json` (this repo has one), or run `bridge init`. Claude Desktop, other clients
and the full guide: [docs/AI.md](../../docs/AI.md).

## Modes

| Mode | Start with | Reads | Writes |
| --- | --- | --- | --- |
| Local | `--root <dir>` (default cwd) | working tree | a commit on a new local `bridge/*` branch, via git plumbing: your checkout, index and working tree are untouched. Never pushes. |
| Remote, no token | `--repo owner/name` | GitHub (raw files, one API call for the tree) | nothing |
| Remote, token | `--repo owner/name` + `GITHUB_TOKEN` | GitHub API | new `bridge/*` branch, commit, draft PR labelled `source: mcp` and `tier: N` |

## Tools

| Tool | What it does |
| --- | --- |
| `bridge_get_config` | Source, write access, tiers, modes, the effective `bridge.config.json` |
| `bridge_list_tokens` | Tokens with resolved values, filtered by tier, `$type`, path prefix, mode |
| `bridge_get_token` | One token: value per mode with alias chain, defining files, tokens aliasing it, components using it |
| `bridge_search_tokens` | By words, CSS variable or value (exact and near colors) |
| `bridge_check_contrast` | The contrast gate in every brand x theme; with `edits`, before/after and new failures |
| `bridge_validate_tokens` | DTCG shapes, names, broken/circular aliases, type mismatches, light/dark parity |
| `bridge_list_components` | Components with family and summary |
| `bridge_get_component` | Props parsed from TypeScript, docs.json usage guidance, CSS variables used |
| `bridge_draft_docs` | docs.json pre-fill from the code (props, tokens, anatomy, contrast, changelog line, missing keys) and a prompt to write the prose; writes nothing |
| `bridge_get_design_language` | Sections of the design language doc |
| `bridge_get_guidelines` | AGENTS.md rules, risk tiers, what Bridge enforces |
| `bridge_propose_token_change` | Edits, validation, contrast, tier, changeset, PR body; branch (local) or PR (remote) |
| `bridge_list_brands` | Brands: slug, name, default, primary action color, theme override files |
| `bridge_plan_brand` | Dry run of a new brand: generated ramps, contrast for every theme, files, tier 3, PR body |
| `bridge_propose_brand` | The new brand as a local `bridge/brand-<slug>` branch or a draft PR; blocked when a pair fails |
| `bridge_list_reviews` | Open PRs (Bridge ones flagged) and local `bridge/*` branches |
| `bridge_get_review` | Diff table, contrast before/after, impact, tier check, CI status, approvals |
| `bridge_review_pr` | Comment, approve or request changes (token required) |
| `bridge_scaffold_component` | New component folder per the repo checklist |
| `bridge_visual_impact` | Before/after screenshots of the impacted stories and admin screens, pixel diff, manifest (local, needs Chrome; `plan` for the selection only) |
| `bridge_get_history` | Token history: versions, merged PRs and commits, who, when, why, tier |
| `bridge_get_token_history` | Every change of one token, before and after per mode |
| `bridge_plan_revert` | Dry run of a revert (or a one-token restore) against the current base, conflicts shown |
| `bridge_propose_revert` | The revert as a local bridge/* branch or a draft PR labelled revert |
| `bridge_audit` | Adoption in a product folder or file (local): token and component adoption, hardcoded values with the closest token, foreign components with the DS one to use, top files and fixes |
| `bridge_list_requests` | Component change requests (issues labeled `component-change`) with status and linked pull requests |
| `bridge_get_request` | One request with the component's files and a brief to implement it in a pull request that says "Closes #n" |
| `bridge_create_request` | File a request as an issue labeled `component-change` (token required; `dryRun` previews; `exploration` targets an exploration branch) |
| `bridge_start_exploration` | Start an exploration: `explore/<name>` branch and a draft pull request labeled `exploration`, previews and a snapshot package, never merged as is |
| `bridge_list_explorations` | Explorations with status, previews, the snapshot install command and linked requests |

Resources: `bridge://tokens/resolved`, `bridge://design-language`, `bridge://guidelines`,
`bridge://components/{name}`. Prompts: `review-token-pr`, `add-component`, `audit-ui-for-tokens`,
`migrate-file-to-ds`.

## Configuration

`bridge.config.json` at the repo root says where tokens live, how they layer per mode, and what Bridge may
write. It is the same file the Figma plugin and the docs site read, with one schema:
[`packages/core/bridge.config.schema.json`](../core/bridge.config.schema.json). Without one, Bridge detects a
config (token directory, tiers by folder name, light/dark and density files as modes); `bridge init` writes the
detected one so you can pin and edit it.

```jsonc
{
  "$schema": "./packages/core/bridge.config.schema.json",
  "repo": { "owner": "acme", "name": "design-system", "defaultBranch": "main" },
  "tokens": {
    "root": "packages/tokens/src",
    "include": ["**/*.tokens.json"],
    "tiers": { "primitive": ["primitives"], "semantic": ["semantic"], "component": ["components"] },
    // lowest first; {mode} placeholders pick the file per mode value
    "layers": [
      { "files": "primitives/*.tokens.json" },
      { "files": "brands/{brand}.tokens.json" },
      { "files": "semantic/{theme}.tokens.json" },
      { "files": "brands/{brand}.{theme}.tokens.json", "optional": true },
      { "files": "components/*.tokens.json" }
    ]
  },
  "modes": { "theme": { "values": ["light", "dark"], "default": "light", "parity": true } },
  "contrast": { "path": "packages/tokens/src/contrast.checks.json" },
  "components": { "dir": "packages/react/src/components" },
  "changesets": { "dir": ".changeset", "package": "@acme/tokens" },
  "governance": {
    "protectedBranches": ["main", "master"],
    "branchPrefix": "bridge/",
    "labels": ["source: mcp"],
    "owners": { "design": ["designer-login"], "tech": ["engineer-login"] }
  }
}
```

## Develop

```sh
npm run mcp:test     # builds both packages, runs vitest (real repo tokens, a fixture repo, fake GitHub, stdio smoke test)
```

All design-system logic comes from `@bridge-ds/core`, through `src/core-adapter.ts`: layered token sets,
validation, contrast, minimal-diff edits, diffs, the PR body, changesets, the GitHub client, the local git
writer (`@bridge-ds/core/node`) and the risk classifier the Figma plugin and the docs site use too. `npm run
mcp:build` bundles the server and the CLI with esbuild, compiling `@bridge-ds/core` in.

## License

MIT
