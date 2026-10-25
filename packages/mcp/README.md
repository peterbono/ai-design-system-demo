# @bridge-ds/mcp

An MCP server that connects your own Claude (Claude Code, Claude Desktop or any MCP client) to your own
design system repo. Claude can read your DTCG tokens, components and docs, run your contrast gate, and
propose token changes as reviewable branches and pull requests. It never writes to `main`.

Free and open source (MIT). Local, no backend, no account: it reads files on your disk, or a GitHub repo
with your own token.

## Run it

From npm, nothing to build:

```sh
npx -y @bridge-ds/mcp --repo owner/name                  # GitHub repo: your gh sign-in, else read-only
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

<!-- tools:start (generated from the server: npm run readme:tools -w @bridge-ds/mcp) -->

73 tools. "writes" tools change files, branches, pull requests or issues; they need a token in remote mode and only run when the person asked.

| Tool | Access | What it does |
| --- | --- | --- |
| `bridge_apply_suggestion` | writes | Apply a Bridge suggestion to today's code ("Apply Bridge suggestion #42"). |
| `bridge_ask_someone_else` | writes | Ask the other people who can give the missing approvals to review a branch, as "Ask someone else to review" in the Studio review queue, and take the person off its requested reviewers. |
| `bridge_audit` | reads | Measure how a product codebase uses this design system (local only). |
| `bridge_back_to_draft` | writes | Take a branch out of review back to draft, as in Studio's More menu. |
| `bridge_branch_status` | reads | One branch in review as Studio shows it: its product, status (draft, in review, needs design or tech approval, blocked by tests, conflict, ready to merge, merged, closed), approvals (Tier 1: one owner approval; a branch that applies an approved suggestion carries its approvals), tests, how it stands against main, whether the person may merge it (the same verdict as the Merge button and status chips in Studio), and the next step. |
| `bridge_check_contrast` | reads | Run the repo's WCAG contrast gate (every pair in every brand x theme). |
| `bridge_close_branch` | writes | Close a branch without merging it, as in Studio's More menu. |
| `bridge_close_exploration` | writes | Close an exploration without merging it, as in Studio. |
| `bridge_combine_branches` | reads | Combined preview of 2 to 4 token branches, as "Try together" in Studio: each branch's own token edits on the latest main, the tokens two branches set differently (pick one per key with picks), and the links that open the combination (the admin demo with the Bridge toolbar, the library views). |
| `bridge_comment` | writes | Post a comment on a branch, or reply in the thread of a line comment (replyTo: its id from bridge_list_comments). |
| `bridge_create_request` | writes | File a component change request as a GitHub issue labeled component-change (source: mcp), in the same format as Figma and Bridge Studio requests. |
| `bridge_create_suggestion` | writes | File any change as a suggestion from its payload (schema bridge.suggestion/1: kind, title, summary, and tokens edits, docs, componentSpec or files). |
| `bridge_draft_docs` | reads | Start or refresh a component's docs.json. |
| `bridge_figma_changes` | reads | The library branches the DS Bridge Figma plugin opened for components changed in Figma (label from-figma), with where each stands: an exact token change (no AI, contrast gated), or a branch carrying the spec, waiting for Claude AI to draft the code, then drafted by Claude AI and reviewed by a person. |
| `bridge_figma_coverage` | reads | Which components are in Figma, in Studio's words (Yes, Drafted, Auto layout, Not yet with the reason), and whether code images exist for the fidelity check the DS Bridge Figma plugin runs (its scores live in Figma). |
| `bridge_figma_gaps` | reads | The components whose Figma build differs from their story (Differs) or cannot be checked (Can't check, with the reason), from the latest Check fidelity run of the DS Bridge plugin (the story shots are the referee), else from the measure's own check; a status fix in figma-fixes.json shows with its reason. |
| `bridge_get_build_request` | reads | One build request, ready to build: what the designer sent (the request, before and after images, props needed, the spec when the issue keeps it), the status timeline, the linked pull request, the Jira key, the component files and `brief`, the prompt to build it in this repo. |
| `bridge_get_component` | reads | One component: props parsed from TypeScript (type, default, description, allowed values), usage docs (summary, whenToUse, whenNotToUse, dos/donts with examples, accessibility, contentGuidelines, anatomy), CSS variables it uses, and story names. |
| `bridge_get_config` | reads | Where the design system lives and what Bridge may do: source (local path or GitHub repo), write access, token tiers, modes (brand/theme/density...) and the full bridge.config.json. |
| `bridge_get_design_language` | reads | The design language doc (principles, color, type, space, density, radius, elevation, motion, icons, voice, accessibility). |
| `bridge_get_figma_change` | reads | One library branch sent from Figma: its spec (variant matrix, properties, bound variables per variant, layers, what code gave Figma before, the exact token swaps) and the brief to draft the code on that branch. |
| `bridge_get_gap_case` | reads | One component's gap case: per differing variant, its story, args, state, shot and every difference with the part id, property, expected (code) and actual (Figma) and the delta in px, plus the figma-fixes.json schema. |
| `bridge_get_guidelines` | reads | Rules for agents in this repo (AGENTS.md): always / ask before / never lists, token conventions, risk tiers, and what Bridge enforces. |
| `bridge_get_history` | reads | History of the design tokens: merged token-changing PRs and commits (local git: first parent of HEAD; GitHub: PR merge commits), newest first, each with author, date, why (changeset summary, PR or commit body), version it shipped in, risk tier, semver bump, breaking flag and change counts, plus the timeline of design system versions. |
| `bridge_get_request` | reads | One request, ready to implement: the parsed request (component, kind, summary, changes asked, Figma link, images), its status and linked pull requests, the component files found under the components directory, the agent rules file, and `brief`: the prompt to implement it in this repo. |
| `bridge_get_review` | reads | Review a token change: designer-readable diff table, contrast before -> after, new validation errors, downstream impact, computed risk tier (and a warning if labelled lower), and for PRs the CI status, approvals and roles: who may approve design, approve tech and ship, with GitHub teams named and their size, and any team that cannot be read with the fix. |
| `bridge_get_settings` | reads | What Studio Settings shows that is safe to read: who approves design and tech (GitHub teams named with their size), who may merge, the owner override (who, what reason), whether main is protected, the products, the preview apps and the visual impact mode. |
| `bridge_get_suggestion` | reads | One suggestion: the change (tokens before and after, docs, component spec, files), the checks when suggested, links, its version (payloadSha: what approvals bind to), who approved it, which approvals are missing for its tier, reviews that no longer count (an older version, or not an owner), whether the machine-readable block was edited by hand, linked pull requests, and for a component spec the brief to implement it. |
| `bridge_get_token` | reads | Everything about one token: CSS variable, type, tier, description, the files that define it, resolved value in every mode (brand x theme x density, collapsed where equal) with its alias chain, tokens that alias it, and components whose CSS uses it (directly or through a component token). |
| `bridge_get_token_history` | reads | Every recorded change of one token, newest first, renames followed: value before and after per mode (raw and resolved CSS), who, when, the PR and why. |
| `bridge_link_suggestion` | writes | Record the pull request (or branch, or commit) that applies a suggestion: a comment on the issue and the "suggestion: applying" label. |
| `bridge_list_brands` | reads | Brands of the repo: slug, name, default, primary action color and theme override files. |
| `bridge_list_build_requests` | reads | Build requests: structure changes pushed from Figma (a new variant, option, layout or component) that developers build, as GitHub issues labeled component-change and bridge-build, plus library branches from Figma waiting for a developer. |
| `bridge_list_comments` | reads | The conversation on a branch and its line comment threads, with the ids to reply to (bridge_comment with replyTo). |
| `bridge_list_components` | reads | List design system components with family and one-line summary (what it is for). |
| `bridge_list_explorations` | reads | Explorations of the repo (draft pull requests labeled exploration on explore/* branches): name, purpose, status (active: running; promoted: ready for review; closed), author, last update, for running ones the preview links Vercel reports (url null while it has not reported one yet) and the install command a product staging branch uses, read from the preview comment on the pull request (state building until the snapshot of the latest commit is published, never a guessed command), and the component requests implemented on each. |
| `bridge_list_products` | reads | The products of this design system (bridge.config.json "products": name, repo or folder, preview link pattern, framework) and the one the current folder or repo belongs to, which tools that start work use when no product is given. |
| `bridge_list_requests` | reads | Component change requests: GitHub issues labeled component-change (from Figma, Bridge Studio, the CLI or Claude). |
| `bridge_list_reviews` | reads | Open pull requests on the repo (flagging the ones Bridge opened) and, locally, the bridge/* proposal branches. |
| `bridge_list_suggestions` | reads | Suggestions in the repo: GitHub issues labeled bridge-suggestion, each an exact change (tokens, docs, a component spec, a brand, a revert, settings) that the owners approve and a developer applies. |
| `bridge_list_tokens` | reads | List tokens with their resolved CSS value in one mode. |
| `bridge_mark_figma_change_drafted` | writes | After you pushed the code for a component change from Figma to its branch: mark its pull request ready for review, label it drafted-by-claude (no longer waiting-for-claude) and say so in its description, in one step, for a person to review. |
| `bridge_merge_branch` | writes | Merge a branch into main through the same gate as Studio's Merge button: tests pass, the approvals its tier needs (Tier 1: one owner approval; Tier 2 and 3: design and tech; a branch that applies an approved suggestion with Closes #n carries its approvals while the suggestion stays approved and the tier is not higher), no changes requested, no conflict, not a draft or an exploration, and the person holds the right to ship (governance.rights). |
| `bridge_missing_pieces` | writes | Check a product branch (an exploration started for a product) against the library: the adoption audit on each product file it changes, at its start and at its head, keeps what the branch added. |
| `bridge_open_library_branch` | writes | Turn one recorded missing piece into a library branch linked to the product branch, as Bridge Studio does: a token piece opens a token change (same gate and body as bridge_propose_token_change, a draft for design and tech review) and the product branch takes its preview; a variant opens a library exploration with the brief to build it (build it there, then bridge_use_library_preview); a new component opens a component request. |
| `bridge_pending_drafts` | reads | Change texts a designer asked their own Claude to write from the DS Bridge Figma plugin ("Draft with my Claude"), waiting on the bridge-requests branch. |
| `bridge_plan_brand` | reads | Dry run of a new brand: the brand token file (generated primary and neutral ramps, radius and font roles), copied theme overrides, the bridge.config.json change, every contrast pair for the new brand in light and dark (ok, or the failing pairs), validation issues, the risk tier (always Tier 3, minor) and the PR body. |
| `bridge_plan_revert` | reads | What undoing a merged token change takes, computed against the CURRENT base branch (not a blind git revert): the inverse edits, conflicts where a token changed again later (with the later PR), changes already undone, contrast before and after, new validation errors, risk tier, files and the PR body ("Revert: <title>", links the original PR). |
| `bridge_product_branch` | reads | A product branch as Studio shows it: the summary sentence, each linked library branch with its status and reviewers, what its preview means for the product branch and the next action, and the pieces with no library branch yet. |
| `bridge_promote_exploration` | writes | Promote an exploration (explore/<name>) to review, as in Studio: the draft becomes ready for review with its tier labels, the exploration label and note go, and the component requests it implements are linked so they close when it merges. |
| `bridge_propose_brand` | writes | Propose a new brand as a reviewable change. |
| `bridge_propose_figma_fixes` | writes | Opens the accepted fixes for review like other Bridge changes: figma-fixes.json with them on a new bridge/* branch and a draft pull request labelled drafted-by-claude, figma-fixes and its tier (locally: a new local branch, never pushed). |
| `bridge_propose_revert` | writes | Plans the revert (or restore) like bridge_plan_revert, then: local repo, commits to a new local bridge/* branch without touching your working tree (never pushes); GitHub with token, new bridge/* branch and a PR labelled revert and its tier (draft for Tier 2 and 3). |
| `bridge_propose_token_change` | writes | Propose token edits as a reviewable change. |
| `bridge_push_figma_component` | writes | What the DS Bridge plugin Push tab does, from a structured diff of a Figma component (the v 1 spec shape: component, figmaName, coded, kind, title, summary, changes, rebinds, needsCode, unknown, variantAxes, properties, bindings, anatomy). |
| `bridge_reopen_branch` | writes | Reopen a closed branch, with Studio's rule: its author or an owner with write access, and only while its work is still on GitHub. |
| `bridge_review_branch` | writes | Approve, request changes or comment on a branch, as the review box in Studio, on the version the person saw, under their GitHub account. |
| `bridge_review_pr` | writes | Post a review on a PR as the token owner: comment, approve or request changes, with a body. |
| `bridge_review_suggestion` | writes | Approve, request changes on, comment on or decline a suggestion, as the person whose GitHub token the server has. |
| `bridge_save_docs` | writes | Save a component's usage guidance (docs.json sections: summary, whenToUse, whenNotToUse, dos, donts, accessibility, contentGuidelines, anatomy, preview) the way the Library edit mode does: merged into the docs on the branch, cleaned and checked (a summary, no empty items, no em dash). |
| `bridge_scaffold_component` | writes | Generate a new component folder per the repo checklist: Name.tsx (forwardRef, typed props), Name.module.css (existing tokens only), stories with AllStates, docs.json with the reference component's keys, a keyboard + axe test when interactive, index.ts. |
| `bridge_search_tokens` | reads | Find tokens by words in the path or description ("danger text", "focus ring"), by CSS variable, or by value ("#c2410c", "16px": exact and near colors). |
| `bridge_send_for_review` | writes | Ask for review: a draft branch becomes ready for review, as "Mark as ready" in Studio. |
| `bridge_start_exploration` | writes | Start an exploration: a branch explore/<slug> from the default branch with a note file, and a DRAFT pull request labeled exploration that gets per-branch previews and a snapshot package a product staging branch installs (npm i @bridge-ds/react@<snapshot>). |
| `bridge_switch_to_published` | writes | Once its library branches shipped, bring main into the product branch (GitHub update branch): it stops carrying the library change and uses the shipped one. |
| `bridge_try_branch` | reads | Try a branch before it merges: the preview link of each product Vercel reported for it (the admin demo opens with the Bridge toolbar on, as "Try it in the product" in Studio), the other previews, and "Share with a product team": the install command a product team runs in a staging branch, or why there is none yet, with a ready-to-paste message. |
| `bridge_try_figma_fix` | reads | Checks proposed fixes offline, nothing is written: validates them (the strict figma-fixes.json validator), lays them on the measure, rebuilds the set the way the plugin pulls it, and compares each differing variant with what the code renders. |
| `bridge_update_from_main` | writes | Bring the latest main into a branch, as "Update from main" in Studio. |
| `bridge_use_library_preview` | writes | The product branch takes the latest commits of the library branch of a piece (Bridge merges it in), so the product preview shows the real library change before it ships. |
| `bridge_validate_tokens` | reads | Validate tokens: DTCG 2025.10 shape per $type, names, broken and circular aliases in every mode, alias type mismatches, missing layer files, and mode parity (a semantic token must exist in both light and dark). |
| `bridge_visual_impact` | writes | Screenshots what a design system change touches, before and after, and pixel-diffs them. |
| `bridge_what_needs_me` | reads | The review queue, as Studio counts it (open branches, without running explorations and the release automation), each with its status in designer words, and first the ones where the person acts now: an approval they can give, their own branch blocked, ready for them to merge. |
| `bridge_write_drafts` | writes | Write the titles, summaries and change lines (or, for docs items, the docs sections or the rewritten passage) you drafted for a session from bridge_pending_drafts. |

<!-- tools:end -->

Resources: `bridge://tokens/resolved`, `bridge://design-language`, `bridge://guidelines`,
`bridge://components/{name}`. Prompts: `review-token-pr`, `add-component`, `audit-ui-for-tokens`,
`migrate-file-to-ds`.

### The merge gate is Studio's

`bridge_branch_status`, `bridge_merge_branch` and `bridge_what_needs_me` (and `bridge branch status|merge|list` in the
CLI) read the same verdict as Studio's branch page and status chips: `branchVerdict` in `@bridge-ds/core`. Tier 1
needs one owner approval; Tier 2 and 3 a design owner and a tech owner. A branch whose body says `Closes #<n>` for an
approved suggestion carries that suggestion's approvals while it stays approved and the branch's tier is not higher.
The owner override (`overrideReason`) is for owners named in `governance.override.allowed` only, skips missing
approvals only, and always needs a reason of at least `minReasonLength` characters (20 by default). See
[GOVERNANCE.md](../../docs/GOVERNANCE.md#one-verdict-everywhere).

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
