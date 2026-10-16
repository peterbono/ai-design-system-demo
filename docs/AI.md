# Use Bridge with your own Claude

Bridge gives Claude (Claude Code, Claude Desktop or any MCP client) a structured view of your design system:
tokens resolved in every brand, theme and density, the contrast gate, components with their props and usage
docs, the design language and the agent rules. Claude can then build UI with real tokens and propose token
changes as pull requests that your design and tech owners review.

- **Free and open source** (MIT). No account, no backend, no hosted service.
- **Bring your own**: your repo, your Claude, your GitHub token (optional).
- **Repo-agnostic**: point it at any DTCG token repo. `bridge.config.json` says where things are; without it
  Bridge detects them.

> The packages (`@bridge/mcp`, `@bridge/cli`) are **not published to npm yet**. Use the local path commands
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
claude mcp add bridge -- npx -y @bridge/mcp
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
| `bridge_get_design_language` | Read the relevant section of the design language |
| `bridge_get_guidelines` | Read the agent rules (always, ask before, never) and the risk tiers |
| `bridge_propose_token_change` | Turn token edits into a branch (local) or a draft PR (GitHub), with a designer-friendly body |
| `bridge_list_reviews` | List open PRs and local proposal branches |
| `bridge_get_review` | Review a token PR: diff table, contrast before and after, downstream impact, tier, CI, approvals |
| `bridge_review_pr` | Comment, approve or request changes on a PR, as you |
| `bridge_scaffold_component` | Generate a component folder that follows the repo checklist |

Resources: `bridge://tokens/resolved`, `bridge://design-language`, `bridge://guidelines`,
`bridge://components/{name}`.

Prompts (slash commands in Claude Code, for example `/mcp__bridge__audit-ui-for-tokens`):

- `review-token-pr`: review a token PR like the design system owner, then post only after you confirm.
- `add-component`: check for an existing component, plan the API and tokens, then scaffold.
- `audit-ui-for-tokens`: paste CSS or TSX; Bridge flags hardcoded colors, lengths, durations, shadows and
  z-index and suggests the token for each, matched to the property (a background gets a surface token).

Things to ask:

- "Which token should this card background use in dark mode?"
- "Darken muted text in the light theme and show me the contrast impact first."
- "Review PR 42 for the design owner."
- "Audit this component's CSS for hardcoded values."

## Safety model

- **Read-only by default.** Without `GITHUB_TOKEN` nothing remote is written. Locally, read tools never
  write.
- **Never `main`.** Proposals go to new branches named `bridge/<title>`. The protected list (`main`,
  `master`, the configured base branch) is checked in the GitHub client and the local git writer, whatever
  the caller asks. Existing branches are never overwritten; a new suffix is used instead.
- **Pull requests, not pushes.** Remote proposals open a **draft** PR labelled `source: mcp` and `tier: N`.
  Local proposals commit to a local branch through git plumbing: your checkout, index and working tree are
  untouched, and nothing is pushed.
- **Gates before writes.** A proposal that adds a validation error or makes a contrast pair fail is
  blocked and nothing is written.
- **Tiers.** Any token added, changed, renamed or removed is Tier 3 (design and tech owner approval), as in
  `docs/GOVERNANCE.md`. Renames and removals are `major`. Bridge computes the tier from the diff, writes the
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

v0.1, not yet published to npm. The design-system logic in `packages/mcp/src/core-adapter.ts` is a
temporary local implementation that moves to `@bridge/core`; `bridge.config.json` follows a draft schema
that will be reconciled with it.
