# @bridge-ds/mcp

An MCP server that connects your own Claude (Claude Code, Claude Desktop or any MCP client) to your own
design system repo. Claude can read your DTCG tokens, components and docs, run your contrast gate, and
propose token changes as reviewable branches and pull requests. It never writes to `main`.

Free and open source (MIT). Local, no backend, no account: it reads files on your disk, or a GitHub repo
with your own token.

## Run it

From npm, nothing to build:

```sh
npx -y @bridge-ds/mcp --repo owner/name                  # GitHub repo, read-only
GITHUB_TOKEN=... npx -y @bridge-ds/mcp --repo owner/name # GitHub repo, can open PRs
npx -y @bridge-ds/mcp --root .                           # local folder (default: current directory)
npx -y @bridge-ds/mcp --help
```

Connect it to Claude Code:

```sh
claude mcp add bridge -s user -- npx -y @bridge-ds/mcp --repo owner/name
# so Claude can open pull requests (a fine-grained token limited to that repo):
claude mcp add bridge -s user -e GITHUB_TOKEN=your-github-token -- npx -y @bridge-ds/mcp --repo owner/name
# or a local checkout:
claude mcp add bridge -- npx -y @bridge-ds/mcp --root /abs/path/to/your-ds
```

Or commit a project `.mcp.json`. Claude Desktop, other clients and the full guide: [docs/AI.md](../../docs/AI.md).

Working on the server itself: `npm run mcp:build` in a clone of this repo builds it to
`packages/mcp/dist/index.js`, which this repo's own `.mcp.json` runs.

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
| `bridge_review_pr` | Comment, approve or request changes (token required; `bridge_review_branch` is the designer version) |
| `bridge_scaffold_component` | New component folder per the repo checklist |
| `bridge_visual_impact` | Before/after screenshots of the impacted stories and admin screens, pixel diff, manifest (local, needs Chrome; `plan` for the selection only) |
| `bridge_get_history` | Token history: versions, merged PRs and commits, who, when, why, tier |
| `bridge_get_token_history` | Every change of one token, before and after per mode |
| `bridge_plan_revert` | Dry run of a revert (or a one-token restore) against the current base, conflicts shown |
| `bridge_propose_revert` | The revert as a local bridge/* branch or a draft PR labelled revert |
| `bridge_audit` | Adoption in a product folder or file (local): CSS, SCSS, Less, TS/JS, TSX/JSX, Astro, Vue and Svelte. Token and component adoption, hardcoded values with the closest token, foreign and native components with the DS one to use, top files and fixes; `allowlist` and `bridge-audit-ignore-next-line: reason` comments leave known exceptions out, listed under `ignored` |
| `bridge_list_requests` | Component change requests (issues labeled `component-change`) with status and linked pull requests |
| `bridge_get_request` | One request with the component's files and a brief to implement it in a pull request that says "Closes #n" |
| `bridge_create_request` | File a request as an issue labeled `component-change` (token required; `dryRun` previews; `exploration` targets an exploration branch) |
| `bridge_start_exploration` | Start an exploration: `explore/<name>` branch and a draft pull request labeled `exploration`, previews and a snapshot package, never merged as is |
| `bridge_list_explorations` | Explorations with status, previews, the snapshot install command and linked requests |
| `bridge_promote_exploration`, `bridge_close_exploration` | Promote an exploration to review, or close it |
| `bridge_list_products` | Products (`products` in bridge.config.json) and the one the current folder belongs to |
| `bridge_what_needs_me` | The review queue, the branches where you act now first |
| `bridge_branch_status` | One branch: status, approvals, tests, main, whether you may merge, next step |
| `bridge_list_comments`, `bridge_comment` | Read the conversation and line threads; comment or reply |
| `bridge_send_for_review`, `bridge_back_to_draft` | Ready for review, or back to draft (the author) |
| `bridge_review_branch` | Approve, request changes or comment on the version seen |
| `bridge_ask_someone_else` | Ask the other people who can give the missing approvals to review |
| `bridge_merge_branch` | Merge through Studio's gate; owner override with a reason posted first (token required) |
| `bridge_close_branch`, `bridge_reopen_branch` | Close without merging; reopen with Studio's rule |
| `bridge_update_from_main` | Update from main; token conflicts to pick, code conflicts left to a developer |
| `bridge_try_branch` | Product previews Vercel reported, the install command and a message for a product team |
| `bridge_combine_branches` | Try 2 to 4 token branches together (writes nothing) |
| `bridge_save_docs` | Save usage guidance on a new branch for review, or on an open branch |
| `bridge_get_settings` | Roles, who ships, owner override, protection, products |
| `bridge_figma_coverage` | Which components are in Figma, code images for the fidelity check |

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
