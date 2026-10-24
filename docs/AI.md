# Use Bridge with your own Claude

Bridge gives Claude (Claude Code, Claude Desktop or any MCP client) a structured view of your design system:
tokens resolved in every brand, theme and density, the contrast gate, components with their props and usage
docs, the design language and the agent rules. Claude can then build UI with real tokens and propose token
changes as pull requests that your design and tech owners review.

- **Free and open source** (MIT). No account, no backend, no hosted service.
- **Bring your own**: your repo, your Claude, your GitHub token (optional).
- **Repo-agnostic**: point it at any DTCG token repo. `bridge.config.json` says where things are; without it
  Bridge detects them.

Everything runs from npm: `npx -y @bridge-ds/mcp` (the MCP server) and `npx @bridge-ds/cli` (the `bridge`
command). No clone, no build.

## 1. Connect your client

The simplest path is your design system repository on GitHub, with no clone. Without a token Bridge is
read-only (and GitHub allows 60 requests an hour). To let Claude open pull requests, add `GITHUB_TOKEN`: a
fine-grained token limited to that one repository, with contents and pull requests read and write. When
`GITHUB_TOKEN` and `BRIDGE_GITHUB_TOKEN` are not set, the server uses your `gh` sign-in (`gh auth token`) and says
so once at start; with no token at all it says it runs read-only. It never logs the token.

### Claude Code

```sh
claude mcp add bridge -s user -- npx -y @bridge-ds/mcp --repo owner/name
# with a token, so Claude can open pull requests:
claude mcp add bridge -s user -e GITHUB_TOKEN=your-github-token -- npx -y @bridge-ds/mcp --repo owner/name
```

### Claude Desktop

Settings > Developer > Edit config, then add to `claude_desktop_config.json` and restart:

```json
{
  "mcpServers": {
    "bridge": {
      "command": "npx",
      "args": ["-y", "@bridge-ds/mcp", "--repo", "owner/name"],
      "env": { "GITHUB_TOKEN": "your GitHub token, optional" }
    }
  }
}
```

### A local folder instead

Pass `--root` with the path to your design system checkout:

```sh
claude mcp add bridge -- npx -y @bridge-ds/mcp --root /abs/path/to/your-ds
```

Or share it with your team through git, in `.mcp.json` at the repo root (Claude Code asks you to approve
project servers the first time):

```json
{
  "mcpServers": {
    "bridge": { "command": "npx", "args": ["-y", "@bridge-ds/mcp", "--root", "."] }
  }
}
```

### Other MCP clients

Any client that speaks MCP over stdio works: run `npx -y @bridge-ds/mcp` with `--repo owner/name [--ref branch]`
or `--root <dir>`. Options can also come from env: `BRIDGE_REPO`, `BRIDGE_REF`, `BRIDGE_ROOT`, `GITHUB_TOKEN` (or
`BRIDGE_GITHUB_TOKEN`), else the `gh` sign-in.

## 2. Check your design system from a terminal

In your design system repo:

```sh
npx @bridge-ds/cli check     # validate tokens and run the contrast gate
npx @bridge-ds/cli help      # every command
```

`bridge check` validates tokens and runs the contrast gate; use it in CI (exit 0 ok, 1 failures, 2 setup
error). `bridge.config.json` says where your tokens, tiers and modes are; without it Bridge detects them on
every run.

### Working on Bridge itself

From a clone, `npm install && npm run mcp:build` builds the server to `packages/mcp/dist/index.js` and the
CLI to `packages/cli/dist/index.js`. This repo's `.mcp.json` runs that local build, so Claude Code here uses
the code you are changing.

## What Claude can do

67 tools: 6 for tokens (config, browse, read, search, contrast, validation), 7 for components and guidance
(docs saved for review included), 5 for proposals and reviews (visual impact included), 3 for brands, 4 for
history and revert, 1 for adoption audits, 3 for component change requests, 4 for explorations, 2 for change
texts from Figma, 14 for branches in review (the Studio actions, see [Studio parity](#studio-parity)), 3 for
products, settings and Figma coverage, 5 for product branches and the library (see
[Product branches and the library](#product-branches-and-the-library)), 4 for components from Figma (see
[Components from Figma](#components-from-figma)), and 6 for suggestions (see [Suggestions](#suggestions)).

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
| `bridge_propose_token_change` | Turn token edits into a suggestion (an issue a developer applies, the default) or, in direct mode, a branch (local) or a draft PR (GitHub), with a designer-friendly body, for a `product` and with a `jira` key; with `branch`, commit them to an exploration; with `pr`, add them to a branch already in review |
| `bridge_list_brands` | See the brands: slug, name, default, primary action color, theme overrides |
| `bridge_plan_brand` | Dry run of a new brand: generated ramps, every contrast pair in light and dark, files, tier, PR body |
| `bridge_propose_brand` | Turn that plan into a `bridge/brand-<slug>` branch (local) or a draft PR (GitHub), never `main` |
| `bridge_list_reviews` | List open PRs and local proposal branches |
| `bridge_get_review` | Review a token PR: diff table, contrast before and after, downstream impact, tier, CI, approvals |
| `bridge_review_pr` | Comment, approve or request changes on a PR, as you (kept for older prompts; `bridge_review_branch` is the designer version) |
| `bridge_visual_impact` | See what a change does on screen: before/after/diff of the impacted stories and app screens |
| `bridge_get_history` | See what changed in the tokens: versions, merged PRs and commits, who, when, why, tier, breaking |
| `bridge_get_token_history` | Every change of one token: value before and after per mode, the PR and why, renames followed |
| `bridge_plan_revert` | Dry run of undoing a change (or restoring one token) against today's base branch, conflicts shown |
| `bridge_propose_revert` | Turn that plan into a branch (local) or a draft PR labelled `revert` (GitHub), never `main` |
| `bridge_audit` | Measure how a product codebase adopts the design system (CSS, SCSS, Less, TS/JS, TSX/JSX, Astro, Vue, Svelte): token and component adoption, hardcoded values with the closest token, foreign UI components and native elements with the DS component to use, top files and fixes, and what was ignored on purpose with its reason |
| `bridge_list_requests` | List component change requests (GitHub issues labeled `component-change`) with status: requested, in progress (an open pull request says "Closes #n"), done, declined |
| `bridge_get_request` | Read one request with the component's files, the agent rules and a brief to implement it in a pull request that closes it |
| `bridge_create_request` | File a request as an issue labeled `component-change` (`source: mcp`); needs `GITHUB_TOKEN`; `dryRun` previews it; `exploration` implements it on an exploration branch |
| `bridge_start_exploration` | Start an exploration: an `explore/<name>` branch and a draft pull request labeled `exploration`, with previews and a snapshot package for a product staging branch, never merged as is (see [Explorations](#explorations)) |
| `bridge_list_explorations` | List explorations: purpose, status (running, promoted, closed), previews, the snapshot install command and the requests implemented on each |
| `bridge_promote_exploration` | Promote an exploration to review (ready for review, tier labels, its requests linked); never merges |
| `bridge_close_exploration` | Close an exploration without merging it |
| `bridge_missing_pieces` | What a product branch adds that the library lacks (the audit on its diff against main): variants of library components, new components, token values; `record` saves them where Studio shows them |
| `bridge_open_library_branch` | Open the library side of one piece, linked both ways: a token change (and the product branch takes its preview), a library exploration for a variant, or a component request |
| `bridge_product_branch` | A product branch as Studio shows it: the summary, each linked library branch with its status, reviewers, preview and next action |
| `bridge_use_library_preview` | The product branch takes the latest library branch of a piece (merged in), so its preview shows the real library change |
| `bridge_switch_to_published` | Once the library shipped, bring main into the product branch so it uses the published version |
| `bridge_figma_changes` | The library branches the DS Bridge plugin opened for components changed in Figma (label `from-figma`): exact token changes, and branches waiting for Claude AI or drafted by Claude AI |
| `bridge_get_figma_change` | One of them: its spec (variant matrix, properties, bound variables and layers per variant, exact token swaps) and the brief to draft the code on its branch |
| `bridge_mark_figma_change_drafted` | Once the code is pushed to that branch: mark the pull request ready for review and label it `drafted-by-claude`, in one step, for a person to review (refused while the branch only carries the spec; when GitHub refuses ready for review, the labels stay as they were) |
| `bridge_push_figma_component` | The plugin's push from a structured component diff: an exact token change (contrast gated), a draft branch with the spec for Claude AI, or what to fix in Figma; `dryRun` shows the route |
| `bridge_list_suggestions` | List suggestions (issues labeled `bridge-suggestion`): kind, tier, status (needs review, changes requested, approved, being applied, applied, declined, outdated) and linked pull requests |
| `bridge_get_suggestion` | Read one: the change, the checks when suggested, its version, who approved it and which approvals are missing, and for a component spec the brief to implement it |
| `bridge_create_suggestion` | File any change as a suggestion from its payload (`bridge.suggestion/1`); paths checked against the kind's folders and the guardrails first; `dryRun` previews it |
| `bridge_review_suggestion` | Approve, request changes, comment or decline, as the token's owner; counts only for owners, on the version you read (`payloadSha`) |
| `bridge_apply_suggestion` | "Apply Bridge suggestion #42": re-applies it on today's code and re-runs the checks; `dry-run` first, then a new local branch (default), the working tree (`write`) or a `patch`; on a remote repo, the files to write |
| `bridge_link_suggestion` | Record the pull request that applies a suggestion (it must say `Closes #n`) |
| `bridge_list_products` | See the products (`products` in `bridge.config.json`) and the one the current folder or repo belongs to |
| `bridge_what_needs_me` | The review queue as Studio counts it, with the branches where you act now first |
| `bridge_branch_status` | One branch: product, status, approvals, tests, how it stands against main, whether you may merge it, next step |
| `bridge_list_comments` | The conversation on a branch and its line threads, with the ids to reply to |
| `bridge_send_for_review` | Send a draft branch for review (its author) |
| `bridge_back_to_draft` | Take a branch back to draft (its author) |
| `bridge_review_branch` | Approve, request changes or comment, on the version you saw |
| `bridge_ask_someone_else` | Ask the other people who can give the missing approvals to review (the review queue action) |
| `bridge_comment` | Comment on a branch, or reply in a line thread |
| `bridge_merge_branch` | Merge through the same gate as Studio's Merge button; owner override with a reason posted first |
| `bridge_close_branch` | Close a branch without merging it |
| `bridge_reopen_branch` | Reopen a closed branch (its author or an owner, while its work is still there) |
| `bridge_update_from_main` | Bring the latest main into a branch; token conflicts come back to pick ("mine" or "theirs") |
| `bridge_try_branch` | Try it in a product (the preview Vercel reported) and share it with a product team (install command, message) |
| `bridge_combine_branches` | Try 2 to 4 token branches together: conflicts to pick, links to open the combination |
| `bridge_save_docs` | Save a component's usage guidance on a new branch sent for review, or on an open branch |
| `bridge_get_settings` | Studio settings that are safe to read: roles, who ships, owner override, protection, products |
| `bridge_figma_coverage` | Which components are in Figma, and whether code images exist for the fidelity check |
| `bridge_pending_drafts` | Read the change texts a designer asked you to write from the Figma plugin ("Draft with my Claude"): the changes, the starting draft, their notes, the voice rules, the output contract, and the before and after images as image content (see [Change texts from Figma](#change-texts-from-figma)) |
| `bridge_write_drafts` | Write the titles, summaries and change lines back; the plugin fills them in within seconds for the designer to review |

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
- "What needs me today?"
- "Bring main into #118 and keep my values for the tokens we both changed."
- "Try #101 and #118 together and give me the link."
- "Merge #42." (Claude checks the gate first and tells you what blocks it.)

## Studio parity

Everything a designer does in Bridge Studio can be done with Claude (MCP) and, where a terminal makes sense, with
the `bridge` command. Both call the same `@bridge-ds/core` functions as Studio (`review-gate`, `branch-actions`,
`library-update`, `share-branch`, `try-in-product`, `combine-branches`, `docs-proposal`, `products`), so a merge
from Claude passes the same gate and sends GitHub the same requests as the Merge button. Reads need no token on a
public repo. Writes need a fine-grained GitHub token for the one repository with the rights below, the same as
Studio asks for, and GitHub's own branch rules still apply. Writes are their own tools, never a side effect of a
read, and Claude runs them only when you ask.

Before this matrix, 10 of these 32 actions worked from Claude, 9 in part (the CLI only, explorations only, or
read without the "needs me" part) and 13 not at all. Now all 32 do.

| In Studio | With Claude (MCP tool) | In the terminal | GitHub token rights |
| --- | --- | --- | --- |
| Create a branch, pick its product, add a Jira key | `bridge_propose_token_change` with `product`, `jira` | `bridge propose --product admin --jira DS-42 ...` | Contents, Pull requests: write |
| Edit tokens on a new branch | `bridge_propose_token_change` | `bridge propose --set path=value` | Contents, Pull requests: write (locally: none) |
| Edit tokens in a branch already in review | `bridge_propose_token_change` with `pr` | `bridge propose --pr 12 ...` | Contents: write; its author or write access |
| Write or edit usage guidance (docs) | `bridge_draft_docs`, then `bridge_save_docs` | `bridge docs draft Button`, `bridge docs save Button --file docs.json` | Contents, Pull requests: write |
| Request review (mark as ready) | `bridge_send_for_review` | `bridge branch ready 12` | Pull requests: write; its author |
| Approve | `bridge_review_branch` (`approve`) | `bridge branch review 12 --approve` | Pull requests: write |
| Request changes | `bridge_review_branch` (`request_changes`) | `bridge branch review 12 --request-changes "..."` | Pull requests: write |
| Ask someone else to review | `bridge_ask_someone_else` | `bridge branch ask 12` | Pull requests: write |
| Comment, reply in a thread | `bridge_comment`, `bridge_list_comments` | `bridge branch comment 12 "..." [--reply-to id]` | Pull requests: write |
| Merge | `bridge_merge_branch` | `bridge branch merge 12` | Contents, Pull requests: write, and the right to ship (`governance.rights`) |
| Merge as owner override | `bridge_merge_branch` with `overrideReason` | `bridge branch merge 12 --override "reason"` | As merge, and your login in `governance.override.allowed` |
| Back to draft | `bridge_back_to_draft` | `bridge branch draft 12` | Pull requests: write; its author |
| Close | `bridge_close_branch` | `bridge branch close 12` | Pull requests: write |
| Reopen | `bridge_reopen_branch` | `bridge branch reopen 12` | Pull requests: write; its author or an owner |
| Update from main | `bridge_update_from_main` | `bridge branch update 12` | Contents, Pull requests: write |
| Resolve token conflicts (keep mine, use main's) | `bridge_update_from_main` with `choices` | `bridge branch update 12 --choice <key>=theirs` | Contents: write |
| Try it in the product (preview link) | `bridge_try_branch` | `bridge branch try 12` | None |
| Share with a product team | `bridge_try_branch` (install command and message) | `bridge branch try 12` | None |
| Try 2 to 4 branches together | `bridge_combine_branches` | `bridge branch combine 101 118 [--pick <key>=118]` | None |
| Start an exploration | `bridge_start_exploration` with `product` | `bridge explore start ... --product admin` | Contents, Pull requests: write |
| Promote an exploration | `bridge_promote_exploration` | `bridge explore promote <name>` | Contents, Pull requests: write |
| Close an exploration | `bridge_close_exploration` | `bridge explore close <name>` | Pull requests: write |
| See what a product branch adds outside the library | `bridge_missing_pieces` (`record` to show it in Studio) | `bridge pieces 12 [--record]` | None to read; Pull requests: write to record |
| Open a library branch for a missing piece | `bridge_open_library_branch` | `bridge pieces open 12 <piece>` | Contents, Pull requests, Issues: write |
| A product branch and its library branches | `bridge_product_branch` | `bridge pieces status 12` | None |
| Use the library preview in the product branch | `bridge_use_library_preview` | `bridge pieces preview 12 <piece>` | Contents: write |
| Switch to the published version | `bridge_switch_to_published` | `bridge pieces switch 12` | Contents, Pull requests: write |
| Components sent from Figma (list, read the spec, mark drafted) | `bridge_figma_changes`, `bridge_get_figma_change`, `bridge_mark_figma_change_drafted` | `bridge figma`, `bridge figma show 12 [--draft]`, `bridge figma drafted 12` | Pull requests: write to mark |
| Send a component change like the Figma plugin | `bridge_push_figma_component` | `bridge figma push diff.json [--dry-run]` | Contents, Pull requests: write |
| Component change requests (list, read, file) | `bridge_list_requests`, `bridge_get_request`, `bridge_create_request` with `product` | `bridge request list / show / create --product admin` | Issues: write to file one |
| History, undo a change, restore one token | `bridge_get_history`, `bridge_plan_revert`, `bridge_propose_revert` | `bridge history`, `bridge revert` | Contents, Pull requests: write to propose |
| Review a token change (diff, contrast, impact) | `bridge_get_review` | `bridge diff main` | None |
| Visual impact (before and after) | `bridge_visual_impact` | `bridge impact` | None (local, needs Chrome) |
| New brand | `bridge_plan_brand`, `bridge_propose_brand` | `bridge brand create` | Contents, Pull requests: write |
| What needs me (review queue) | `bridge_what_needs_me` | `bridge branch list` | Any token, so Bridge knows who you are |
| Branch status, who acts, may I merge | `bridge_branch_status` | `bridge branch status 12` | None (who you are needs a token) |
| Settings (safe to read) | `bridge_get_settings` | `bridge settings` | None |
| Quality and adoption | `bridge_validate_tokens`, `bridge_check_contrast`, `bridge_audit` | `bridge check`, `bridge audit <path>` | None |
| Figma coverage and fidelity | `bridge_figma_coverage` | `bridge coverage [Component]` | None |

What stays in Studio, and why:

- **Changing settings** (roles, the owner override, protecting `main`, integrations). They change who may do
  what, so they go through a reviewed branch of `bridge.config.json` or GitHub's own settings, which need admin
  rights. Claude and the CLI read them (`bridge_get_settings`, `bridge check`) and can propose the
  `bridge.config.json` change like any other file.
- **Signing in with GitHub.** In a terminal the token comes from `GITHUB_TOKEN` (or `--token`). Writes never use
  your `gh` sign-in on their own: add `--use-gh-auth` for that. Reads may use it, and say so in one line. The
  MCP server (and `bridge mcp`) falls back to the `gh` sign-in when no token is set, and says so once at start.
- **Seeing the work.** The visual editors (color pickers, the Library edit mode with its live preview), the
  before and after images CI built for a branch, the quality trend charts of past audits and the fidelity scores
  (computed in the DS Bridge Figma plugin, they live in Figma). Claude edits by value, reads the same facts as
  text and gives you the links to look at them.

### Pick the product

Products are listed in `bridge.config.json` under `products` (name, the folder or GitHub repo they live in, a
preview link pattern, the framework). Without the key, Bridge uses this repository's two: Admin demo
(`apps/admin`) and Library, the default. A branch belongs to the product named by its `product: <key>` label,
else to the product whose folder it changes, else to the default product: Studio's Branches page groups by the
same rule.

- **In Studio:** Create branch asks first what you work on. "A feature in a product" asks in which product
  (step 2; preselected when there is only one, or from the page's `?product=`), starts an exploration with its
  `product: <key>` label, and gives you the sentence to say to Claude. "A change to the library" keeps the default
  product.
- **In the terminal:** `--product <key>` on `bridge propose`, `bridge explore start`, `bridge request create` and
  `bridge docs save`. Without it, the product of the folder you run it in (a product folder of this repository,
  or a product repository named in `products`), else the default. `bridge products` lists them and marks yours.
- **With Claude:** the tools that start work take `product`. Claude infers it from the repository or folder it
  works in (`bridge_list_products` says which one and how), and asks you when it is not obvious.

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

## Suggestions

How a change reaches the code is `"changes"` in `bridge.config.json`. With `"suggest"` (the default), the writing
tools (`bridge_propose_token_change`, `bridge_save_docs`, `bridge_propose_brand`, `bridge_propose_revert`,
`bridge_open_library_branch`, `bridge_push_figma_component`) file a **suggestion**: a GitHub issue labeled
`bridge-suggestion` with the exact change, its checks and its tier, and return `status: "suggested"` with its number.
The owners approve it on the issue; a developer applies it. With `"direct"` they open branches and pull requests as
before. Each tool takes `changes` (`"suggest"` or `"direct"`) for one call, and the CLI `--suggest` or `--direct`.
See [REQUESTS.md](REQUESTS.md#suggestions).

```sh
bridge suggestions --status approved     # ready to apply
bridge apply 42 --dry-run                # the plan on today's code
bridge apply 42                          # a new local branch bridge/suggestion-42-<slug>, nothing pushed
bridge review 42 --approve               # as an owner
```

Ask Claude: "Which suggestions are approved?", "Apply Bridge suggestion #42." Claude runs `bridge_apply_suggestion`
as a dry run first, then on a branch, and opens the pull request that says `Closes #42`.

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

## Change texts from Figma

A designer can have their own Claude (Claude Desktop or Claude Code, on their own plan, no API key) write the title
and summary of a component change request or the Push description, from the DS Bridge Figma plugin. Third-party
apps cannot use a Claude plan and Bridge has no backend, so the plugin and the MCP server meet in the GitHub repo
both already reach with the designer's token.

1. In Figma, "Draft with my Claude" uploads the before and after PNGs and writes
   `.bridge/drafts/<sessionId>.json` on the `bridge-requests` branch:
   `{ version: 1, sessionId, createdAt, status: "pending", source: "figma", items: [{ id, scope: "request" | "push",
   component, kind, changes: [{ field, before, after }], variables (push only), notes, images: [{ label: "before" |
   "after", url, path, line? }], draft: { title, summary }, lines?: [{ id, component, kind, changes, line }] }] }`.
   `lines` are the component changes to describe in one sentence each (one for a request, one per requested
   component for a push), with the deterministic line (`draftChangeLine`) as a starting point.
2. The designer says **"Draft my Bridge changes"** to their Claude. `bridge_pending_drafts` returns the pending
   sessions (newest first) with a brief per item, the Bridge voice and the output contract, and the PNGs as MCP image
   content (up to 8 images under 750 KB each; larger ones stay links), so Claude sees the before and after.
3. Claude writes what changes for developers and why it matters (sentence case, no em dash, no invented numbers)
   and, per change line, one short sentence read from the images ("Icon added after the label in primary sm: Pencil,
   16px") and the title of the request it becomes ("Add an icon after the label"), then calls `bridge_write_drafts`
   `{ sessionId, results: [{ id, title, summary, lines?: [{ id, line, title? }] }] }`. The plugin uses each line's
   title for that component's request instead of its deterministic title; answers without line titles still work.
   Bridge cleans each text to the contract (no em dash, titles at most 70 characters with no trailing period, summary
   at most 3 sentences, each line at most 120 characters with no trailing period, unknown line ids refused), adds
   `{ by: "claude", at }`, and sets `status: "drafted"` once every item has a result. Writers send the file sha and
   retry on 409, so a concurrent write is never lost.
4. The plugin reads the file every 5 seconds while it is open (it stops after 10 minutes and offers "Check again"),
   fills the fields it may fill and offers Claude's text for any field the designer edited meanwhile. It deletes
   the file and its images once the request or push is sent, or cancelled.

Setup, once: connect the server from npm with the same GitHub token as the plugin (`GITHUB_TOKEN`, Contents read
and write on the design system repo):

```sh
claude mcp add bridge -s user -e GITHUB_TOKEN=your-github-token -- npx -y @bridge-ds/mcp --repo owner/name
```

Claude Desktop (Settings, Developer, Edit config, then restart):

```json
{
  "mcpServers": {
    "bridge": {
      "command": "npx",
      "args": ["-y", "@bridge-ds/mcp", "--repo", "owner/name"],
      "env": { "GITHUB_TOKEN": "your GitHub token" }
    }
  }
}
```

The plugin's Settings, **Claude (optional)**, shows both with the repository filled in. Nothing reaches `main`: the
session files live on `bridge-requests`, next to the request images.

## Product branches and the library

Designers explore a product feature with Claude on a product branch (Studio: Create branch, A feature in a
product), built with the real components. What the branch invents outside the library comes back to the library as
library branches, linked to the product branch, instead of a ticket and a redo in the Figma kit.

1. **Find the missing pieces.** `bridge_missing_pieces` (or `bridge pieces 12`) runs the adoption audit on each
   product file the branch changes, at the branch start (its merge base with main) and at its head, and keeps what
   the branch added. A value written on a library component (an inline style, or a CSS module class used on it)
   becomes a variant of that component, "Badge: overdue tone", with the closest library value ("danger"). A component
   from another UI library with no library equivalent becomes a new component. Any other hardcoded value becomes a
   token beside the closest token. Values equal to a token and components the library already has are fixes: use
   them in the product code. With `record` the pieces go into the branch description, where Studio's product branch
   page shows them. Studio cannot run the audit in the browser: it shows what Claude or the CLI recorded.
2. **Open a library branch per piece.** `bridge_open_library_branch` opens the library side, honestly labelled by
   what Bridge can write: a token piece opens a token change (the same gate, body, tier and changeset as
   `bridge_propose_token_change`, a draft for design and tech review); a variant opens a library exploration
   (`explore/<name>`) with the brief to build it; a new component opens a component request. Both sides link: the
   library side starts with "Needed by" the product branch and carries the `needed-by-product` label, the product
   branch records the link. Studio's Branches page lists the library branch under its product branch.
3. **Preview before it ships.** The product branch takes the library branch: Bridge merges it into the product
   branch, so the product preview deploy shows the real library change. A token change is merged in as soon as it
   opens; a variant once it has code (`bridge_use_library_preview`); a request has nothing to preview until it is
   built. New commits on the library branch show as "Get the latest preview".
4. **Ship.** The library branch goes through its own review, with the product context on its review page ("Why it
   exists", the product preview, "Suggest danger" when the closest value may do). Once it ships, "Switch to the
   published version" (`bridge_switch_to_published`) brings main into the product branch: it stops carrying the
   library change and uses the shipped one. In Figma, the next Pull in the DS Bridge plugin brings the new token
   into the variables and the new variant into the kit's component set.

What is automatic and what is one action:

| Step | Automatic | One action (Studio, Claude or the CLI) |
| --- | --- | --- |
| Find the pieces | When Claude finishes an exploration (the server instructions ask it to check) | `bridge pieces 12 --record`; not on every push (no CI job yet) |
| Open the library side | Never on its own: a person decides | Studio "Open a library branch", `bridge_open_library_branch`, `bridge pieces open` |
| Link both ways | Yes, when the library side opens | |
| Product branch uses the token change preview | Yes, when the token change opens | "Get the latest preview" after new library commits |
| Product branch uses a variant preview | | "Use its preview in my branch", once the library exploration has code |
| Library branch status and reviewers on the product branch | Yes, read live from GitHub | |
| Switch to the published version | No: Bridge never writes on its own when a page opens | "Switch to the published version" |
| Use the new token or variant in the product code | No: Bridge does not rewrite product code | Ask Claude once the library ships |
| Update the Figma kit | No | Pull in the DS Bridge Figma plugin (tokens and component variants from code) |

Bridge does not block the product branch from shipping before its library branches: ship the library first, or
the library change reaches main inside the product branch without its own review. Products in another repository
install the library branch's preview package instead (the install command on the library branch, see
[Explorations](#explorations)); the product branch page covers products in this repository.

## Components from Figma

Designers also change components in Figma (with Claude through the Figma MCP server, or by hand). The DS Bridge
plugin's Push tab sends each changed component back to the library as a library branch, routed by what Bridge can
write with certainty. It reads the same signatures Pull compares in "Review updates", the other way round.

| What changed in Figma | Where it goes | Who writes the code |
| --- | --- | --- |
| A property now bound to another variable (fill, radius, padding...), on a component token that paints only those variants | An exact token change: that component token points to the new variable. Contrast gated (the semantic pairs, checked on the component tokens that alias them), tier and changeset like any token change. Other components that share the token are named | Nobody: exact, no AI |
| A new variant, property, layer or swapped instance; a new component; a token swap a token alone cannot say (code paints with a semantic token directly, or other variants still use the token) | A draft branch carrying the spec (`.bridge/figma/<name>.json`: variant matrix, properties, bound variables and layers per variant, what code gave Figma before, a screenshot), labelled `from-figma`, `waiting-for-claude` | Claude AI, through `bridge_get_figma_change`; then `bridge_mark_figma_change_drafted` marks it ready for review and labels it `drafted-by-claude`. Until then the branch is honestly a request |
| A detached layer, a value set by hand, a shared style, a variable the library lacks | Nowhere: listed under "Fix in Figma first" with what to do | The designer, in Figma |

Every library branch from Figma starts with "From Figma" (a link to the component) and keeps a hidden block tools
read (`parseFigmaOrigin`). The set remembers its branch; once the branch ships (or closes), the next Pull rebuilds
the set from the reviewed code, so Figma never diverges from code. While it is in review, Pull says so and keeps the
Figma version. `@bridge-ds/core`: `planComponentPush`, `openComponentPushOnGitHub`, `figmaChangeOnGitHub`,
`markFigmaChangeDraftedOnGitHub`, `figmaPushStatusesOnGitHub`.

## Explorations

Try experimental variables and components in a product staging branch without touching `main`: a coded prototype
for a user test, a stakeholder demo, an A/B idea, or a designer exploring from the terminal with Claude Code. An
exploration is an `explore/<name>` branch with a draft pull request labeled `exploration`: it gets the branch
previews and a snapshot package (`npm i @bridge-ds/react@<snapshot>`), and it is never merged as is. A person
promotes it to review or closes it. See [EXPLORATIONS.md](EXPLORATIONS.md).

```sh
bridge explore start "Pill buttons" --purpose "Do rounder buttons feel friendlier in checkout?"
git switch explore/pill-buttons
bridge propose --branch explore/pill-buttons --title "Pill radius" --set radius.control=999px
bridge request implement 42 --branch explore/pill-buttons     # the brief: work there, no pull request to main
bridge explore promote pill-buttons                           # ready for review, tier labels; never merges
```

Ask Claude: "Start an exploration for denser tables", "Darken muted text on explore/dense-tables", "Which
explorations are running?". Claude passes `"branch": "explore/<name>"` to `bridge_propose_token_change`,
`bridge_draft_docs` and `bridge_get_request`, and never opens a pull request to `main` from an exploration.

## Measure adoption in product code

`bridge audit` reads a product codebase that consumes the design system and tells you how much of it really
uses it. Run it from the design system repo (or pass `--ds <dir>`):

```sh
bridge audit ../my-app/src                         # summary in the terminal
bridge audit ../my-app/src --json audit.json --md audit.md --label "my-app"
bridge audit ../my-app/src --baseline audit.json --no-regress --fail-under 60   # CI: exit 1 when it drops
bridge audit ../my-app/src --fix                   # dry run: CSS values equal to a token
bridge audit ../my-app/src --fix --write           # replace them with var(--token)
bridge audit ../my-app/src --allowlist known.json  # leave known file:line violations out, each with a reason
```

- **Token adoption** = token references / (token references + hardcoded values). Hardcoded colors, spacing,
  sizes, radii, borders, shadows, durations, easings, z-index and fonts are found in CSS, SCSS, CSS modules,
  `style`, MUI `sx`, `styled()`, theme objects, CSS-in-JS templates and Tailwind classes (`p-[13px]`,
  `bg-blue-500`), and in Astro, Vue and Svelte files: `<style>` blocks, `style` attributes (`style="..."`,
  `style={{ ... }}`, Vue `:style`, Svelte `style:prop`), the frontmatter and `<script>` blocks. Each gets the closest token: colors by perceptual distance (deltaE in OKLab) across every
  brand, theme and density, lengths by the nearest scale step, with a confidence.
- **Component adoption** = DS component instances / all UI component instances: DS, foreign libraries (MUI,
  react-admin, antd, Chakra, Radix, Headless UI, Mantine, shadcn/ui local components), native elements that
  should be DS components (`button`, `input`, `select`, `textarea`, `dialog`, `table`, `a` with `href`, `img`), router links
  outside a DS component's `render` prop, chart libraries (recharts...: no DS equivalent) and local components
  named like a DS component. JSX and the template markup of `.astro`, `.vue` and `.svelte` files count the same
  way: a tag is a DS component when the frontmatter or `<script>` imports it from the DS package, and a local
  `Button.astro` (or `.vue`, `.svelte`) is a re-created DS component. `<input type="hidden">`, anchors without
  `href` and elements inside `<noscript>` do not count.
- **Exceptions stay visible.** When a native element is the right call, say why on the line above:

  ```html
  <!-- bridge-audit-ignore-next-line: third-party embed reads this native select -->
  <select name="region">...</select>
  ```

  The same works in `{/* */}`, `/* */` and `//` comments. The reason after the colon is required; a comment
  without one, or above a line with nothing to ignore, ignores nothing and is printed as an error. For a batch of
  known violations, `--allowlist known.json` takes `{ "entries": [{ "file": "pages/a.astro", "line": 12, "what":
  "select", "reason": "..." }] }` (paths relative to the audited folder). Ignored items leave the counts but stay
  in the report with their reason (`--md` lists them under "Ignored on purpose"), and allowlist entries that
  match nothing any more are printed so the list only shrinks.
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
- **Never `main`.** Proposals go to new branches named `bridge/<title>`, or to an exploration branch
  `explore/<name>` when you pass one (its draft pull request is never merged as is: the check "Exploration not
  merged as is" fails while the `exploration` label is on). The protected list (`main`,
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
- **Merges pass the Studio gate, and only when you ask.** `bridge_merge_branch` merges only what Studio's
  Merge button would (tests pass, the approvals the tier needs, no changes requested, no conflict, the right
  to ship), under your GitHub account; the owner override skips missing approvals only, with your reason
  posted on the branch first. Reviews, comments and closes are explicit tools too, never side effects of a
  read.
- **Suggestions write issues, not code.** In suggest mode the writing tools only create issues; applying one
  checks its paths, the owners' approvals on its current version and the gates on today's code, and commits to a
  new local branch (never pushes).
- **Tokens.** Use a fine-grained GitHub token limited to the one repo: Contents read and Issues read and write is
  enough for suggestions; direct mode needs contents and pull requests read and write. Bridge sends it only to
  `api.github.com`.

## How it compares

Tokens Studio offers AI and MCP features as part of its hosted platform. Bridge covers the same loop
(read tokens, check, propose, review) as a free, local, open source tool on top of the files you already
have, with your own Claude and your own GitHub token.

## Status

Published on npm as `@bridge-ds/mcp` and `@bridge-ds/cli` (versions in each `package.json` and on npmjs.com). The server is built on `@bridge-ds/core`, the same package as the DS Bridge Figma
plugin and the docs site: one `bridge.config.json` (schema in `packages/core/bridge.config.schema.json`), one
risk classifier, one GitHub client with the same protected-branch guard.
