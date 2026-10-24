# @bridge-ds/mcp

## 0.9.0

### Minor Changes

- 4fb54b4: Marking a Figma change drafted (`bridge_mark_figma_change_drafted`, `bridge figma drafted <n>`) now also marks its pull request ready for review, in the same step, through GitHub's `markPullRequestReadyForReview` mutation. Ready goes first: when GitHub refuses it, the labels and the description stay as they were and the error says why, so a branch is never labelled `drafted-by-claude` while reviewers cannot see it. `markFigmaChangeDraftedOnGitHub` returns `ready: true`.

  The Bridge MCP server (and `bridge mcp`) uses your gh sign-in (`gh auth token`) when `GITHUB_TOKEN` and `BRIDGE_GITHUB_TOKEN` are not set, and says once at start where its token came from, or that it runs without one (read-only, 60 requests an hour) and how to fix that. It never logs the token. The other CLI commands keep their rule: writes use your gh sign-in only with `--use-gh-auth`.

- 625a692: Try it works without online previews: when nothing reported a deployment for an exploration (explorations and library branches are not deployed on Vercel any more), the Figma plugin says a developer opens it on their computer, the share message gives `git fetch origin && git switch <branch>`, polling stops, and `bridge branch try` / bridge_try_branch return the same local command (`local`). New core helpers: noOnlinePreview, localTryCommand.

### Patch Changes

- 7eb8a27: A hosting platform that refused to run (Vercel "Deployment rate limited") no longer counts as a failed check, and a failed check no longer stops "where is my push" polling: a re-run can still ship it.
- 3364ee9: Build requests in the CLI and the MCP server: `bridge build list|show` and `bridge_list_build_requests` /
  `bridge_get_build_request` (read only, status read from GitHub, the brief for Claude). Branch status, merge and
  "what needs me" read a push from the Figma plugin with the shared gate (design approved, token values ship by
  themselves). Core: a spec-only or Claude draft branch from Figma never ships by itself.
- e52619d: The bridge CLI never writes on GitHub with a credential you did not pass: writes (suggestions, requests, reviews, comments, merges, branches) use `GITHUB_TOKEN`, `BRIDGE_GITHUB_TOKEN` or `--token`, or your gh sign-in only with `--use-gh-auth`. Reads may still use the gh sign-in, say so in one line on stderr, and cannot write. `bridge branch merge --dry-run` needs no write token. A merge the gate blocks exits 1, not 2, and `bridge --help` documents the exit codes. CLI messages name commands and flags (`bridge branch merge 12 --override "why"`), never MCP tools or JSON fields, the rate-limit message says how to pass a token in the CLI, and suggestions, pull requests and docs proposals made from the CLI say "the bridge CLI" and "source: cli". `bridge_get_config`, the server instructions and its start line say what Bridge may write in the same sentence. `bridge docs help`, `bridge brand help` and `-v`/`-h` work, `bridge tokens` says when it shows only the best matches (`--limit`), `bridge diff` explains a bad git ref, `bridge coverage` counts the 53 components once and says what the other numbers are, `bridge audit --fix` keeps what the audit keeps (ignore comments, `--allowlist`, `audit.exclude`) and takes `--json`, and a Figma change drafted by Claude no longer says so twice.
- ea27992: Designer words: screens a designer reads say "change" and "library", never branch, merge or main. The share and
  product-branch sentences of `@bridge-ds/core` (`shareDescription`, `SHARE_EXPLAIN`, `libraryPreviewState`,
  `productBranchSentence`) now read "This change was added to the library", "Your feature uses a preview of the library
  change". The MCP fallback share sentence follows. ChoiceCard docs examples say "your change". Gate reasons, status
  labels and developer texts (CLI, MCP, GitHub) keep their git words.
- 0b3aa07: One merge verdict everywhere: `branchVerdict` and `approvedSuggestionOnGitHub` in core compose the review rules once, and Studio, the MCP tools (`bridge_branch_status`, `bridge_merge_branch`, `bridge_what_needs_me`, `bridge_get_settings`) and the CLI (`bridge branch status|merge|list`, `bridge settings`) read them. Tier 1 needs one owner approval, the owner override is for owners only and always needs a reason (20 characters by default), and a pull request that applies an approved suggestion with `Closes #n` carries its approvals.
- 1635400: A branch updated after a changes request waits on the reviewer who asked: core `lookAgainReviewers`, `Review.commitId` from `listReviews`; Studio says "Your turn: look again" to that reviewer and lists it on their home, the author no longer reads "Your turn: address changes"; `bridge_branch_status` gives `approvals.lookAgain` and the next step, `bridge_what_needs_me` says "Look again: updated after your changes".
- 57f26bf: A branch updated after every changes request reads "Updated, look again" (core reviewStatusLabel, branchVerdict label) in Studio, the MCP server and the CLI, never a stale "Changes requested". The merge gate is unchanged. Studio's approval checklist says who looks again instead of "Failed".
- 0b415fd: MCP server: the README lists every tool, generated from the server (`npm run readme:tools -w @bridge-ds/mcp`), and a test fails when they disagree. `bridge_plan_revert` lists 50 edits, conflicts and changes at a time with the totals (`limit`, `offset`) and cuts a very long PR body; `bridge_draft_docs` returns its prompt in pages (`page`) with a summary first. The docs draft lists only the contrast pairs the component takes part in (both sides among the tokens it reads, aliases followed), not every pair that shares a surface with it. `/llms.txt` no longer links the missing `/foundations/` page and links `/tokens.css` and each component's `/docs-ai/<component>.json`.
- b822435: A merged or closed branch reads as done everywhere: the merge gate gives its state as the one reason and lists no missing approval; `bridge branch status` prints "Merged." and who approved, without approvals, tests or blockers.
- 2b01116: A branch opened from Figma and labelled drafted-by-claude reads as ready for review even while GitHub still calls it a draft (core isDraft, claudeStage), in Studio, the MCP server and the CLI alike; merging it marks it ready first. Studio says where Claude stands: a developer builds it before the draft, the owners review it after.
- 80ee954: Token value changes ship by themselves once the design approval is in (decision TV-1). `branchVerdict` takes
  `autoMerge` (GitHub `auto_merge` set): a design-approved token value change whose merge Bridge armed reads `autoShip`,
  "On its way to the library". `GitHubClient.getPullRequest` returns `autoMerge`, and `bridge_branch_status` says Bridge
  merges it once the automatic checks pass.
- d8e5e84: Token values follow the Figma rule wherever they are made (decision TV-1): a pull request or a suggestion that only
  changes token values (values changed or tokens added, nothing renamed or removed, no code) needs the design approval
  only. Once it is in, the tech approval counts as given and the change ships after the automatic checks
  (`isTokenValueChange`, `mayBeTokenValueChange`, `withTokenValueApprovals`, `branchVerdict` `tokenValues`,
  `suggestionIsTokenValues`, `summarizeSuggestionApprovals` `valuesOnly`, `requiredApprovals(tier, valuesOnly)`).
  Renames and removals still need a developer OK. Studio, the MCP server and the CLI read the same verdict
  (`bridge_branch_status` says "Design approval (token values ship after the checks)").
- Updated dependencies [fbf7f55]
- Updated dependencies [7eb8a27]
- Updated dependencies [efb3281]
- Updated dependencies [3364ee9]
- Updated dependencies [d89f7b7]
- Updated dependencies [57b8d89]
- Updated dependencies [4fd6e15]
- Updated dependencies [e52619d]
- Updated dependencies [48ee872]
- Updated dependencies [af6e3e9]
- Updated dependencies [ea27992]
- Updated dependencies [e65d3ee]
- Updated dependencies [4fb54b4]
- Updated dependencies [f5cfbf0]
- Updated dependencies [02d38ad]
- Updated dependencies [8919183]
- Updated dependencies [7b9e2c2]
- Updated dependencies [7c52639]
- Updated dependencies [eb4ace6]
- Updated dependencies [0ed940f]
- Updated dependencies [9be32eb]
- Updated dependencies [e075f3b]
- Updated dependencies [fe906a6]
- Updated dependencies [a83618b]
- Updated dependencies [7f6064b]
- Updated dependencies [0b3aa07]
- Updated dependencies [9d0dc16]
- Updated dependencies [a9cbbab]
- Updated dependencies [1635400]
- Updated dependencies [57f26bf]
- Updated dependencies [30e8c14]
- Updated dependencies [43b6e31]
- Updated dependencies [e4c34ee]
- Updated dependencies [ce6a8c7]
- Updated dependencies [fd0191c]
- Updated dependencies [4d61987]
- Updated dependencies [44f49ff]
- Updated dependencies [07380d7]
- Updated dependencies [b822435]
- Updated dependencies [d199eb5]
- Updated dependencies [96acdf2]
- Updated dependencies [d157472]
- Updated dependencies [eb4d6ce]
- Updated dependencies [8403d3d]
- Updated dependencies [f198e92]
- Updated dependencies [2b01116]
- Updated dependencies [c46846d]
- Updated dependencies [efa01d6]
- Updated dependencies [d8848ff]
- Updated dependencies [7f9930c]
- Updated dependencies [9ec466a]
- Updated dependencies [d8c7494]
- Updated dependencies [5309e2e]
- Updated dependencies [4aa0cd7]
- Updated dependencies [80ee954]
- Updated dependencies [df92fcf]
- Updated dependencies [d8e5e84]
- Updated dependencies [fe5fb1b]
- Updated dependencies [2d89e58]
- Updated dependencies [625a692]
  - @bridge-ds/core@0.19.0
  - @bridge-ds/visual@0.3.13

## 0.8.5

### Patch Changes

- Updated dependencies [037b56b]
  - @bridge-ds/core@0.18.0
  - @bridge-ds/visual@0.3.12

## 0.8.4

### Patch Changes

- 5ec4a47: One status per branch, everywhere. `reviewStatusKind` is the single derivation for the Branches list, the branch page, the home cards, `bridge_what_needs_me`, `bridge_branch_status` and `bridge branch status`. A repo with no automated checks is a calm state of its own ("No automated checks", `CI_STATE_LABEL`) and the status comes from the approvals, as for any branch. While GitHub computes whether a branch merges cleanly, a missing approval still shows; "Checking for conflicts" only holds back "Ready to merge". The words live in core (`REVIEW_STATUS_LABEL`), and the branch page header now shows the same pill as its row ("Owner override needed", "Design owner to approve") instead of a plain "In review".
- 5ec4a47: Suggestions, visual checks and titles. A suggestion whose change no longer applies to main (main moved and the value it changes is not the one it was suggested from) reads Outdated in Studio, `bridge_list_suggestions` and `bridge_get_suggestion`, through one core rule (`suggestionStalenessOnGitHub`, over `planSuggestionApply`). An applied and closed suggestion keeps only its final label ("suggestion: applied"; "suggestion: declined" when declined): `bridge_apply_suggestion`, `bridge_link_suggestion`, `bridge apply` and a merge from Bridge (`markSuggestionsAppliedOnGitHub`) remove "needs review" and "applying". The visual-check label and "the visual comparison runs again" are offered only when the repo has the visual impact workflow (`hasVisualWorkflow`, `visualOffer`); otherwise the branch page shows a quiet "Set up visual checks" link. Request and suggestion titles are never prefixed twice ("Select: select: ...") and keep component names as written ("EmptyState"), through `subjectTitle`.
- Updated dependencies [5ec4a47]
- Updated dependencies [5ec4a47]
  - @bridge-ds/core@0.17.0
  - @bridge-ds/visual@0.3.11

## 0.8.3

### Patch Changes

- Updated dependencies [da3e4ea]
  - @bridge-ds/core@0.16.0
  - @bridge-ds/visual@0.3.10

## 0.8.2

### Patch Changes

- Updated dependencies [9b0b653]
  - @bridge-ds/core@0.15.0
  - @bridge-ds/visual@0.3.9

## 0.8.1

### Patch Changes

- Updated dependencies [1a560aa]
- Updated dependencies [440f717]
- Updated dependencies [a797699]
- Updated dependencies [9d40c77]
- Updated dependencies [4fb3153]
- Updated dependencies [662fb55]
- Updated dependencies [0986099]
  - @bridge-ds/core@0.14.0
  - @bridge-ds/visual@0.3.8

## 0.8.0

### Minor Changes

- b6f1e68: Opt-in `governance.soloOwnerCanApproveBoth` for a design system run by one person. When it is true and the owners
  resolve to exactly one person holding both roles, that person's approval counts as the design and the tech approval,
  so Tier 2 and Tier 3 pull requests and suggestions can reach approved. Default false: one person still never covers
  both approvals alone. The author of a change still never approves it. Core adds `soloApprover`, `soloOwnerOf`,
  `soloOwnerSentence` and an optional rules argument to `summarizeApprovals`; `summarizeSuggestionApprovals` reads the
  flag from its governance. Studio Settings shows an "Only owner" line when the rule is active, the suggestion and pull
  request reviews say "As the only owner, your approval covers design and code." with one Approve, and
  `bridge settings`, `bridge branch status`, `bridge suggestions show` and the MCP tools say the same.

### Patch Changes

- Updated dependencies [b6f1e68]
  - @bridge-ds/core@0.13.0
  - @bridge-ds/visual@0.3.7

## 0.7.2

### Patch Changes

- Updated dependencies [87cfb75]
  - @bridge-ds/core@0.12.0
  - @bridge-ds/visual@0.3.6

## 0.7.1

### Patch Changes

- Updated dependencies [76c7938]
  - @bridge-ds/core@0.11.0
  - @bridge-ds/visual@0.3.5

## 0.7.0

### Minor Changes

- d193898: Suggestions from Claude and the terminal. How a change reaches the code now follows `"changes"` in `bridge.config.json`: with `"suggest"` (the default when the key is absent) the writing tools file a suggestion, a GitHub issue with the exact change that the owners approve and a developer applies, instead of a branch and a pull request; `"direct"` keeps branches and pull requests. `bridge_propose_token_change`, `bridge_save_docs`, `bridge_propose_brand`, `bridge_propose_revert`, `bridge_open_library_branch` and `bridge_push_figma_component` take `changes` (`"suggest"` or `"direct"`) for one call and return `status: "suggested"` with the issue number in suggest mode; the CLI commands take `--suggest` or `--direct` (`bridge propose`, `bridge brand create`, `bridge revert`, `bridge docs save`, `bridge pieces open`, `bridge figma push`). Writing to an exploration or a branch in review (`branch`, `pr`) is unchanged. `bridge_get_config` says which mode the repo uses.

  New MCP tools (67 in all): `bridge_list_suggestions`, `bridge_get_suggestion` (the change, its checks, its version and the approvals still missing), `bridge_create_suggestion` (any payload, paths checked first), `bridge_review_suggestion` (approve, request changes, comment or decline; counts only for owners read from the default branch, on the version reviewed), `bridge_apply_suggestion` ("Apply Bridge suggestion #42": dry run, a new local branch, the working tree or a patch on a local checkout, the files to write on a remote repo; records on the issue that it is being applied) and `bridge_link_suggestion` (the pull request that applies it). New CLI commands: `bridge suggestions [list | show <n> | link <n> --pr <m>]`, `bridge apply <n> [--write | --patch] [--dry-run] [--accept-edited] [--force-unapproved]` (exit 0 applied or already applied, 1 not approved, blocked or refused, 2 usage, 3 conflict) and `bridge review <n> --approve | --request-changes | --decline`. The token hints say what each mode needs: Issues read and write for suggestions and requests, Contents and Pull requests for direct changes.

## 0.6.0

### Minor Changes

- 22e53c7: Components changed in Figma go back to the library as library branches. The DS Bridge plugin's Push tab reads the diff Pull reads in "Review updates" the other way round and routes each changed component (`planComponentPush`): a token swap on a component token that paints only the changed variants becomes an exact token change, no AI (the shared `planTokenProposal` and `writeTokenProposalOnGitHub`, with the contrast gate run again on the component tokens that alias a checked pair, `componentContrastPairs`, and the other components that share the token named); a new variant, property, layer, swapped instance or component, or a swap a token alone cannot say, opens a draft branch carrying the spec (`.bridge/figma/<name>.json`: variant matrix, properties, bound variables and layers per variant, screenshot) labelled `waiting-for-claude` until Claude AI writes the code there and it becomes `drafted-by-claude`; detached layers, values set by hand, styles and variables the library lacks are listed under "Fix in Figma first" with what to do, never sent. Every branch starts with "From Figma" (`parseFigmaOrigin`) and carries `from-figma`. The set remembers its branch: once it ships or closes, the next Pull rebuilds the set from the reviewed code, so Figma never diverges. MCP: `bridge_figma_changes`, `bridge_get_figma_change`, `bridge_mark_figma_change_drafted`, `bridge_push_figma_component` (61 tools). CLI: `bridge figma`, `bridge figma show <n> [--draft]`, `bridge figma drafted <n>`, `bridge figma push <diff.json>`.

### Patch Changes

- Updated dependencies [22e53c7]
- Updated dependencies [e1f8f0c]
- Updated dependencies [e59366e]
- Updated dependencies [a99fbb9]
  - @bridge-ds/core@0.10.0
  - @bridge-ds/visual@0.3.4

## 0.5.0

### Minor Changes

- 5b93962: Product branches bring what they invent back to the library. `missingPieces` (in `@bridge-ds/core/audit`) runs the adoption audit on each product file a product branch changes, at its start and at its head, and keeps what the branch added that the library lacks: a value written on a library component becomes a variant of it ("Badge: overdue tone"), a component from another UI library with no equivalent becomes a new component, any other hardcoded value becomes a token beside the closest one. Values equal to a token and components the library has are fixes, not pieces. `openLibraryBranchOnGitHub` opens the library side of a piece and links both ways: a token change (through the new shared `planTokenProposal` and `writeTokenProposalOnGitHub`, which `bridge_propose_token_change` now uses too), a library exploration for a variant, or a component request for a new component; the library side says "Needed by" the product branch (label `needed-by-product`), the product branch records the link in its description. The product branch takes the library branch's preview (Bridge merges it in, `GitHubClient.mergeIntoBranch`), and `switchToPublishedOnGitHub` brings main in once the library ships. MCP: `bridge_missing_pieces`, `bridge_open_library_branch`, `bridge_product_branch`, `bridge_use_library_preview`, `bridge_switch_to_published` (57 tools). CLI: `bridge pieces <n> [--record]`, `bridge pieces status|open|preview|switch`.

### Patch Changes

- Updated dependencies [5b93962]
  - @bridge-ds/core@0.9.0
  - @bridge-ds/visual@0.3.3

## 0.4.1

### Patch Changes

- 77ba45a: Create branch in Studio is product first. Step 1 asks what you work on: a feature in a product, or a change to the library. A feature asks what you build and in which product (preselected when there is one, or from `?product=`), starts an exploration with the product's `product: <key>` label and gives you the sentence to say to Claude AI. The library keeps its choices (Adjust the look, Add a variant or option, New component), and "Something looks wrong? Report it" stays one click away. core: `productMarks` (the product label and body line, nothing for the default product) moves from the MCP server into `@bridge-ds/core`, and `startExplorationOnGitHub` takes extra `labels`, so Studio, the CLI and the MCP server write the same label. Studio home: "Your branches" gets a one-line subtitle, and the "Published this week" line is gone.
- 7e9f2df: Docs proposals: one open proposal per component. Sending docs for a component that already has an open docs proposal adds a commit to it instead of opening a second pull request (`proposeDocsOnGitHub` returns `continued`, and `unchanged` when it already says the same). New core helpers `findOpenDocsProposal`, `findOpenDocsProposalOnGitHub`, `isDocsProposalBranch`, `continueDocsProposalOnGitHub` and `docsSlug`, shared by the Library editor and the MCP server (`bridge_save_docs` without `pr` continues the open one). The Library editor opens on the open proposal ("Continues the open proposal by ..., waiting for review", with a link to its review), and Send is off with "Nothing changed since the open proposal" when the text is the same.

  Attribution: the pull request's author line now says who wrote the text (`docsAuthorLine`, `withAuthorLine`, `defaultDocsFooter`): "Drafted by Claude AI, reviewed and sent by @person" when Claude's draft goes out as written, "Drafted by Claude AI, edited by @person" with the edited sections, and "No AI involved" only when no Claude draft is in the text. The editor tracks the text Claude wrote per section (`authorship`).

- Updated dependencies [8cdcb9a]
- Updated dependencies [77ba45a]
- Updated dependencies [7e9f2df]
  - @bridge-ds/core@0.8.0
  - @bridge-ds/visual@0.3.2

## 0.4.0

### Minor Changes

- 51e743c: Studio parity: every action a designer takes in Bridge Studio now works with Claude (MCP) and in the terminal.

  - MCP: 20 new tools for branches in review (what needs me, status, send for review, back to draft, review, ask someone else to review,
    comment and reply, merge through Studio's gate with the owner override, close, reopen, update from main with
    token conflicts, try it in a product and share it, try 2 to 4 branches together), docs saved for review,
    explorations promoted or closed, products, settings and Figma coverage. `bridge_propose_token_change` takes
    `pr` (add edits to a branch in review), `jira` and `product`; explorations and requests take `product`.
  - CLI: `bridge branch ...`, `bridge products`, `bridge settings`, `bridge coverage`, `bridge docs save`, and
    `--product`, `--jira`, `--pr` where work starts.
  - Core: the review and merge rules, the branch writes, update from main, sharing, try in product, try together,
    docs proposals and Jira keys moved from the docs site into `@bridge-ds/core`, so Studio, the MCP server and
    the CLI run one implementation. New `products` list in `bridge.config.json` (schema included), defaulting to
    Admin demo and Library; Studio's Branches page groups by it with the same result.

### Patch Changes

- Updated dependencies [22d186e]
- Updated dependencies [51e743c]
- Updated dependencies [7b53159]
  - @bridge-ds/core@0.7.0
  - @bridge-ds/visual@0.3.1

## 0.3.3

### Patch Changes

- Updated dependencies [f655919]
- Updated dependencies [ed4b28d]
- Updated dependencies [bdca820]
- Updated dependencies [6b07b05]
- Updated dependencies [8376732]
  - @bridge-ds/core@0.6.0
  - @bridge-ds/visual@0.3.0

## 0.3.2

### Patch Changes

- 5bfc7e2: The adoption audit reads Astro, Vue and Svelte files. Template markup counts DS components imported in the frontmatter or `<script>` (Vue kebab case included), native elements a DS component should render (with the DS equivalent), local look-alikes named like a DS component (`Button.astro`), hardcoded values in `style` attributes (`style="..."`, `style={{ ... }}`, Vue `:style`, Svelte `style:prop`), `class` attributes and color attributes, and token references. The frontmatter and `<script>` blocks go through the TS scanner and `<style>` blocks through the CSS audit, with the file's own line numbers. Hidden inputs and elements inside `<noscript>` do not count. New escape hatches, both with a required reason and both kept visible in the report: a `bridge-audit-ignore-next-line: reason` comment on the line above (HTML, JSX, CSS or JS comment; a comment without a reason or above nothing is reported and ignores nothing), and `bridge audit --allowlist file.json` (`allowlist` in `bridge_audit`) for known file:line violations, with stale entries listed. The report gains `files[].ignored`, `files[].ignoreErrors`, `ignored` and the `astro`, `vue` and `svelte` languages (schema updated, still version 1). The docs site's `audit:docs` now sees its raw elements; they sit in a temporary, reasoned allowlist (`apps/docs-site/bridge-audit-allowlist.json`) until the native elements migration removes them.
- 9494004: Studio cleanup. Changes: the "In review" tab is now "All changes", its status filter is one Select named after the status model (All open, Draft, Ready for review, Approved waiting for code, Shipped, Closed), and the "try together" checkboxes appear only after "Choose changes", so the first screen holds about half the controls. A change detail keeps one ship control: Ship sits on the title line once the change can ship, and the disabled Ship in the action bar is gone, as is "Reply on GitHub". Tokens: on a phone the type chips get their own line and every brand and theme stacks into labeled lines; the draft bar reserves room so it never covers the last rows; a token changed in one theme only says which. Core and MCP: when GitHub's hourly limit runs out without a token, the error says so and how to fix it (set GITHUB_TOKEN for the MCP server) instead of blaming "this token".
- Updated dependencies [5bfc7e2]
- Updated dependencies [f1a8b55]
- Updated dependencies [9494004]
  - @bridge-ds/core@0.5.0
  - @bridge-ds/visual@0.2.3

## 0.3.1

### Patch Changes

- 4bfd417: Studio tells design work from developer work, and says who really made it. Work that only touches code (a title that speaks code such as "React" or "props", tests, examples, types, build or tooling only, component code the visual impact run shows no difference for, a "tech" or "developer" label) no longer shows in Needs you, on the board columns or in the Changes badge: the Overview folds it into one quiet line under the board, "Developer work, 1 in progress", that opens its list. Changes keeps every item and tags developer work "Developer", with an All, Design, Developer filter that shows when a list holds some. When nothing says what a change is, it stays with designers. An exploration card says "Claude is building it" when a real marker says an agent made it (the pull request template box, the Claude Code footer or session link, a "Co-Authored-By: Claude" commit, an agent label, an exploration or request started from the MCP server), and "You are trying it" only for what you started from Studio. The exploration block now records where it was started (`source`: studio, figma, cli or mcp) and the agent behind it (`agent`), and the CLI records `agent: "claude"` when Claude Code runs it.
- c499852: The docs now treat npm as the main install path. The Install page leads with `npm install @bridge-ds/react @bridge-ds/tokens` and `npx @bridge-ds/cli check`, lists every package with a link to its npmjs.com page and the version read from its package.json, and keeps the clone install in a "For contributors" disclosure at the bottom. The Agents page connects Claude to a GitHub repository with `npx -y @bridge-ds/mcp --repo owner/name` first (read-only, a token to open pull requests), with a local folder as the alternative. README, docs/AI.md and the package READMEs no longer say the packages are unpublished. `bridge init` now writes `npx -y @bridge-ds/mcp` into `.mcp.json` and the Claude Desktop snippet outside the Bridge repo (it wrote a path into the npx cache), and `bridge --help` exits 0.
- Updated dependencies [6fe9f88]
- Updated dependencies [11f40fd]
- Updated dependencies [4c313d7]
- Updated dependencies [4bfd417]
  - @bridge-ds/core@0.4.0
  - @bridge-ds/visual@0.2.2

## 0.3.0

### Minor Changes

- 80228c0: Claude titles each component request. Change lines in a draft session carry the deterministic request title
  (`DraftLine.title`), and results may answer `lines: [{ id, line, title }]` (`DraftResultLine`; the title is cleaned to
  the title contract by `sanitizeDraftTitle`: one line, sentence case, at most 70 characters, no trailing period, no em
  dash). Older sessions and answers without titles still work. `bridge_pending_drafts` and `bridge_write_drafts` ask for
  the title, the plugin's API-key path asks for and parses it too, and Push uses it for that component's request instead
  of the generic deterministic title ("Add an icon after the label" rather than "Update the look to match Figma").
- adc0df7: Docs drafted with Claude in place, at three levels: the whole page (fill, or rewrite every section), one section, or a
  selected passage (clearer, shorter, or in the Bridge voice). Fill drafts the empty sections and never rewrites written
  ones: when the code is newer than docs.json, written sections are sent as checks, and Claude returns one only when
  something in it is no longer true for the code (the writer's wording kept elsewhere). Results say which checked
  sections are still accurate (`checked`) and which were updated (in `sections`). Same rule for MCP docs items
  (`DocsDraftTask.check`, `DraftResult.checked`).

  Core: new `docs-ai.ts` with the task model (`DocsDraftTask`, `validateDocsTask`), the prompts (`docsTaskPrompt`,
  `docsSelectionPrompt`; `docsPrompt` takes `{ keys, rewrite, outdated }` to ask for only some sections), the answer
  parsing and sanitizing to the docs.json shapes with em dashes removed (`parseDocsReply`, `sanitizeDocsSections`,
  `parseDocsTaskAnswer`, `sanitizeDocsReplacement`), the merges (`applyDocsSections`, and `mergeDocsDraft` for the
  docs-draft Action) and the Messages API request (`anthropicRequest`, `anthropicReplyText`). docs.json gains
  `draftedSections` (the prose sections a partial draft wrote, between `draftedBy` and `needsReview` in
  `formatDocsJson`); `markClaudeDraft(d, sections)` adds to it, `acceptDocsDraft` clears it, `sectionsNeedingReview`
  reads it. The draft exchange takes `docs` items (scope `"docs"`, source `"studio"`) whose results carry `docs` (the
  sections) or `replacement`; `createDocsDraftSession`, `ensureRequestsBranch` and `DraftPoller` move to core.

  MCP: `bridge_pending_drafts` and `bridge_write_drafts` explain docs items and accept `docs` or `replacement` results
  (title and summary are optional now, still required in practice for change items).

  Docs site: `src/scripts/docs-ai.ts` (`draftDocs`, `draftAvailability`, `outdatedSections`, `saveApiKey`,
  `applyDraft`) drafts with the designer's own API key (browser call, key kept in this browser only) or their own
  Claude through the exchange, from `/docs-ai/<slug>.json` (the facts from the code and the repo conventions, built
  with the site). The docs-draft Action now runs the same core code.

- fb40ae8: Claude writes each change line. Draft sessions carry one change line per component change (`DraftItem.lines`, images labeled by line), results may answer `lines: [{ id, line }]` (one sentence, at most 120 characters, no em dash, unknown ids refused; results without lines still work), and `draftChangeLine` gives the deterministic default ("Looks different in Size=sm, State=Default, Variant=primary; no variable explains it"). Requests carry the line (`ComponentChangeRequest.line`, "**What changes:**" in the issue, the brief and Jira). `bridge_pending_drafts` and `bridge_write_drafts` describe and accept lines; the plugin's API-key path asks for and parses them too.

  Push hierarchy in the Figma plugin: "Draft with Claude" is a ghost action on the Description (and request Title) label line, one "Drafted by Claude" status line under the field, each component change row reads name and kind, then one sentence, with the table behind "Details" in one font size, no group checkbox for a single item, the bar alone sums up what is sent ("1 request"), and a shorter Components intro.

- 1e78f3b: Roles by team: `governance.owners` may name GitHub teams (`"@acme/design"`) as well as people, so a company assigns
  roles by team and manages membership in GitHub. Still no database.

  Core: new `teams.ts`. `parseOwnerEntry` reads a person (`"theo"`, `"@theo"`) or a team (`"@org/team-slug"`);
  `loadConfig` and the JSON schema reject anything else with the entry named and both forms spelled out.
  `TeamDirectory` expands teams to logins through any client with the new `GitHubClient` methods
  (`listTeamMembers`, paginated; `getTeamMembership` for one person; `getAccountType`; `listOrgTeams`), cached for five
  minutes. A team it cannot read is a typed state (`no-token`, `missing-permission`, `not-found`, `personal-account`,
  `unreachable`) with the fix in `teamUnreadableMessage`, never an empty list: it keeps its place in the expanded lists
  and matches nobody. `approverLists` and `shipPolicy` take the team states; `whoCanShipSentence` names a team with its
  size ("Only the tech owner can ship this (@acme/web (4 people)).").

  CLI: `bridge check` lists the teams named as owners with their size and reports each team it cannot read, with the
  fix (never part of the exit code). MCP: `bridge_get_review` returns `roles`: who may approve design, approve tech and
  ship, with teams named, and an approval counts when the reviewer is in the team.

  Studio: approvals, who acts, the ship gate (with a membership check for the viewer), the Overview and History
  count team members and name teams as teams. Settings, Review rules gains Design owners and Tech owners rows: a team
  is a chip with its member count and avatars, a team that cannot be read gets one sentence with the reason and the
  fix, and Edit takes a person or a team (a DS Combobox suggesting the organization's teams and the repository's
  people), sent for review on `bridge.config.json`.

### Patch Changes

- 3d3d77d: Library protection: Bridge is the only way into the default branch.

  Core: new `protection.ts` with `protectionRuleset` (the repository ruleset on `~DEFAULT_BRANCH`: no deletion, no
  force push, pull request with at least 1 approval and stale approvals dismissed, required checks, admins may bypass
  in pull request mode only), `protectionState` (protected, partial, unprotected or unknown, with what is missing,
  from rulesets and classic branch protection), `requiredCheckNames` (read from the repository's own CI, without
  Vercel and skipped runs) and `protectionSentence`. `protection-github.ts` adds `loadProtection`,
  `loadRequiredChecks`, `protectLibrary` and `protectRefusal`. The GitHub client gains `listRulesets`, `getRuleset`,
  `createRuleset`, `updateRuleset` and `getBranchProtection` (404 means none, 403 means it cannot be read), and check
  runs carry their app slug.

  CLI: `bridge check` prints whether the library is protected and where to fix it. It never changes the exit code;
  `--offline` (or `BRIDGE_OFFLINE=1`) skips it, and `--json` adds `protection`.

  MCP: the server instructions say every write goes through a branch and a pull request, never straight to the
  default branch.

- 9574d19: The MCP server is on npm: setup is `npx -y @bridge-ds/mcp` (plugin, docs, Agents page). The server reports its real package version.
- 196d02b: Real branch preview URLs and install commands everywhere, never guessed ones. On exploration #64
  (`explore/button-normal-again`) Vercel shortened the admin and Storybook aliases with a hash
  (`bridge-admin-git-explore-button-norm-0ed5ba-peterbonos-projects.vercel.app`), so the template URLs were wrong.

  Core: `branchPreviewUrls(client, prNumber | sha, config)` reads what Vercel reports, in order: GitHub deployments of the
  head commit, the Vercel commit statuses (state of each deploy), the Vercel bot comment (`[vc]` header, decoded), and the
  `previews.apps` template only when its host label fits in 63 characters. Pure parts: `parseVercelComment`,
  `findVercelComment`, `appForProject` (Vercel project to app by the template host), `resolveBranchPreviews`,
  `previewLinksOf`, `previewsSettled`. `explorationTestBuildOnGitHub` returns the install command from the preview comment
  and the real previews in one read. `GitHubClient.listCommitStatuses` and `listDeployments`. The sticky PR comment
  (`previewComment`) takes the resolved previews and never prints a shortened template URL. Removed: `explorationInstall`
  and `ExplorationInstall` (guessed pkg.pr.new commands); `StartedExploration.install` becomes `tryIt` and
  `ExplorationSummary.install` is gone (it gains `headSha`).

  Preview packages workflow: the comment's preview table uses the URLs Vercel reports (deployments, statuses, its comment).

  MCP and CLI: `bridge_list_explorations` / `bridge explore list` return the install command from the preview comment
  (`install.state` building, ready or failed) and the previews Vercel reports; `bridge explore start` no longer prints a
  pkg.pr.new command.

  Studio: the pull request detail ("Preview and install") shows the URLs Vercel reports and the command the workflow
  published, or that the test build is being prepared; the exploration detail fills its previews the same way.

  DS Bridge plugin: the exploration result screen ("Try it") shows the real URLs, checks every 15 seconds for up to 10
  minutes while it is open (stopping once the command and every preview are ready), updates in place without
  re-rendering, and keeps "Check again".

- dd2261c: Roles with default rights, editable per team, and a visual before and after that can run on demand.

  Core: `governance.rights` in `bridge.config.json` says which owner group may approve design, approve tech and ship
  (merge, which publishes to the products): `{ "approveDesign": ["design"], "approveTech": ["tech"], "ship": ["tech"] }`
  by default, and a team may let design owners ship too (`"ship": ["design", "tech"]`). A config without `rights`
  behaves as before: approvals follow `owners`, anyone with write access ships. New top-level `visualImpact.mode`,
  `"auto"` (default) or `"on-demand"`. Both are validated by `loadConfig` and the JSON schema and written back by
  `toConfigJson`. New exports in `rights.ts`: `DEFAULT_RIGHTS`, `normalizeRights`, `holdersOf`, `approverLists`,
  `shipPolicy`, `canShip`, `whoCanShipSentence`, `groupsPhrase`, `RIGHT_LABEL`, `VISUAL_CHECK_LABEL`.

  MCP and CLI: `bridge init` (detected configs) starts from the default rights.

  Studio: Settings gains Roles: one sentence, who holds each right with their avatars, and the visual before and after
  mode; "Change roles" proposes the edit as a pull request on `bridge.config.json` (only `governance.rights` and
  `visualImpact` change). Reviews counts approvals against the rights and keeps Merge off for a viewer without the
  ship right, saying who can ("Only the tech owner can ship this (@theo)."); the owner override never bypasses it.
  In on-demand mode a pull request without a before and after offers "Show the visual impact", which adds the
  `visual-check` label (the workflow runs on it), or links to GitHub without a write token.

- Updated dependencies [80228c0]
- Updated dependencies [adc0df7]
- Updated dependencies [d5bbba9]
- Updated dependencies [3d3d77d]
- Updated dependencies [537abd7]
- Updated dependencies [fb40ae8]
- Updated dependencies [196d02b]
- Updated dependencies [fe29bed]
- Updated dependencies [dd2261c]
- Updated dependencies [a6914d7]
- Updated dependencies [1e78f3b]
- Updated dependencies [7cb1733]
  - @bridge-ds/core@0.3.0
  - @bridge-ds/visual@0.2.1

## 0.2.0

### Minor Changes

- bac1cb2: Measure design system adoption in product code. `@bridge-ds/core/audit` finds hardcoded colors, lengths, radii, shadows, durations, z-index and fonts in CSS, SCSS, style/sx/styled/theme objects, CSS-in-JS and Tailwind classes, suggests the closest token (deltaE in OKLab across every mode, nearest scale step), and counts DS components against foreign UI libraries, native elements and re-created components. `bridge audit <path>` reports token and component adoption as JSON (versioned schema) and Markdown, compares with a baseline, fails CI under a threshold, and `--fix --write` replaces exact CSS matches with `var(--token)`. The MCP server adds `bridge_audit` and the `migrate-file-to-ds` prompt. New `@bridge-ds/stylelint-plugin` (`bridge/use-tokens`) and `@bridge-ds/eslint-plugin` (`no-hardcoded-style-values`, `prefer-ds-components`).
- One `bridge.config.json` and one schema (`packages/core/bridge.config.schema.json`) for the Figma plugin, the docs site, the CLI and the MCP server: tiers, ordered layers with mode placeholders, modes with parity, contrast, components, docs, changesets and governance (protected branches, branch prefix, labels, guardrails, design and tech owners). The MCP server now runs on `@bridge-ds/core` (layered token sets, minimal-diff edits, contrast, diff, PR body, GitHub client, local git writer) and every surface shares one risk classifier: a token added, changed, renamed or removed is Tier 3 (renames and removals major), a description-only edit is Tier 1 patch.
- bffaaa9: History and rollback. `bridge_get_history` and `bridge_get_token_history` read what changed in the tokens (versions, merged PRs and commits, who, when, why, tier, breaking), and `bridge_plan_revert` and `bridge_propose_revert` undo a change against the current base branch, with conflicts shown when a token changed again later, or restore one token to an older value. The CLI adds `bridge history [token]` and `bridge revert <pr|commit> [--dry-run]`. Built on the new history model and revert planner in `@bridge-ds/core`.
- ee19cd7: Bridge MCP server and CLI. `@bridge-ds/mcp` connects Claude Code, Claude Desktop or any MCP client to a DTCG design system repo (local folder or GitHub): 15 tools to read tokens per mode, search, validate, check contrast, read components and docs, propose token changes as branches or draft PRs (never on main), review PRs and scaffold components, plus resources and prompts. `@bridge-ds/cli` adds `bridge init`, `check`, `tokens`, `diff`, `propose` and `mcp`.
- cd5565e: Visual impact analysis for design system changes. `@bridge-ds/core` gains a usage index (CSS variables each component reads, components it renders). New `@bridge-ds/visual` builds Storybook and the admin app at two refs, screenshots the impacted stories (every brand and theme) and the admin screens (every tenant and theme) deterministically, and pixel-diffs them into before, after, diff and composite images plus a JSON manifest. `bridge impact` and the `bridge_visual_impact` MCP tool run it; a workflow posts the result on pull requests.
- d5d263b: Docs drafts. `@bridge-ds/core` computes what code can tell about a component's docs (props table, tokens, anatomy from the CSS module classes, contrast notes, a changelog line) and keeps the review state of AI-drafted prose (`draftedBy`, `needsReview`). The MCP server adds `bridge_draft_docs`, which returns that pre-fill and a prompt for your own Claude to write the prose; the CLI adds `bridge docs draft <Component>` (`--json` for CI).
- 525217f: Explorations for Claude and the terminal: MCP tools `bridge_start_exploration` and `bridge_list_explorations`; CLI `bridge explore start <name> --purpose`, `bridge explore list`, `bridge explore promote <name>` and `bridge explore close <name>`. Write tools take a target exploration branch: `bridge_propose_token_change` and `bridge propose` with `branch` (one commit on GitHub, or the checked-out working tree locally), `bridge_draft_docs` with `branch`, `bridge_get_request` and `bridge request implement` with `branch`, `bridge_create_request` and `bridge request create` with `exploration`. Briefs for an exploration say to work on that branch and never open a pull request to main.
- abe4395: Two tools to draft change texts from Figma with your own Claude: `bridge_pending_drafts` returns the drafts a designer is waiting for (changes, starting draft, notes, voice rules, output contract, and the before and after PNGs as image content) and `bridge_write_drafts` writes the titles and summaries back for the plugin to fill in. Say "Draft my Bridge changes".
- 5c40693: New brands, from every surface. `planNewBrand` in `@bridge-ds/core` builds a brand file (primary and neutral ramps from the shared ramp engine, the starting brand's radius, fonts and theme overrides), adds the slug to `modes.brand` in `bridge.config.json`, and runs the contrast gate for the new brand in light and dark. The CLI gets `bridge brand create` and `bridge brand list`, the MCP server `bridge_list_brands`, `bridge_plan_brand` and `bridge_propose_brand`, the Figma plugin offers a new Brand mode as a new brand on Push, and the Studio has a four-step New brand flow with a live preview. The token build reads its brands from `bridge.config.json`, and `scripts/ramps.mjs` runs the same ramp engine (primitives unchanged).
- e31bac2: Publishable under the @bridge-ds scope: a `source` export condition for the monorepo, built `dist` with types,
  publish fields, and part of `npm run build:packages`. @bridge-ds/core also ships its `./audit` and `./node` entries.
- 2c79d5d: Component change requests for developers: MCP tools `bridge_list_requests`, `bridge_get_request` (with a brief to implement the request) and `bridge_create_request`; CLI `bridge request list|show|implement [--claude]|create`; and `bridge request jira-sync` for the optional bridge-jira GitHub Action. Pull request summaries from the core GitHub client now carry the body, so requests link the pull requests that close them.

### Patch Changes

- a55525d: Bridge brand moves to the "Field Guide" direction: white content, ink text, Harbor zones and Deep Harbor as the one strong color, Fraunces headings over Instrument Sans text, rounder radii. See `docs/DESIGN-LANGUAGE.md` (v2).

  Why this is major for `@bridge-ds/tokens`: the default brand changes what existing tokens resolve to, and consumers must check their screens.

  - Palette roles re-pointed in the bridge brand: `palette.neutral` from steel to the new `color.ink` ramp; `palette.primary`, `palette.accent` and `palette.link` to the new `color.harbor` ramp; `palette.info` from cable to plum. Orange is now only the categorical chart hue (`palette.categorical`).
  - `color.bg.default` is white (`palette.neutral.0`) in bridge light. Ocean keeps its tinted canvas, links and zone through `brands/ocean.light.tokens.json`.
  - Primary action and checked controls move to `primary.700` (hover 800, active 900); links to `link.700` (hover 800); `color.signal.default` to `accent.600`; `focus.ring.color` to `accent.700`. Dark: actions and checked controls use `primary.300/200/100` with `primary.950` text.
  - `font.family.sans` is Instrument Sans in bridge (was IBM Plex Sans).
  - Radius roles in bridge: inset 6, control 12, container 20, overlay 20 (were 2, 6, 10, 14). Primitive `radius.xl` is 12 (was 14).
  - Primitive `font.size` steps changed: `300` 17 to 16, `400` 20 to 21, `600` 29 to 30, `700` 35 to 36, `800` 42 to 44, `1000` 60 to 64.
  - `control.height.md` is 44 in comfortable density (was 40) and 36 in compact (was 32).

  Additions: `color.bg.zone` (Harbor blocks, light `primary.200`, dark `primary.900`, ocean light `primary.50`), `font.family.display` (Fraunces in bridge, Plex Sans in ocean), `font.family.fraunces`, `font.family.instrument-sans`, `typography.<display|h1|h2|h3|body|ui|caption>.{size,line-height,weight,family,tracking}` in both brands, `font.leading.{16,20,26,28,32,38,50,68}`, `size.11` (44px), and the `color.ink.*` and `color.harbor.*` ramps with pinned brand anchors (ink 200 `#E3E8EE`, 600 `#5B6672`, 900 `#15202B`; harbor 200 `#CFE8FF`, 700 `#0B4A8B`). `contrast.checks.json` gains 5 pairs on `color.bg.zone` (296 checks, 0 failing). Fixes a missing `$type` on `color.bg.zone` in the semantic light and dark files.

  `@bridge-ds/react`: no API change, but every component's rendered look changes through the tokens (colors, fonts, radii, 44px default controls). PageHeader, Card, Dialog and Drawer titles read the new `typography.*` roles; medium Badges set at 14/20 (the `ui` role), small Badges stay 12/16.

  `@bridge-ds/docs-site`: the Bridge site wears the Field Guide brand. Top bar of five items, a short side nav (no headings, no counts, collapsible groups), Harbor header blocks on Library section pages, new Library home and Studio overview, version chip by the page title, branch picker by the Studio title, brand and density in the preview toolbars. The theme playground is removed; `/playground/` redirects to the Library home. `.stylelintrc.json` accepts `var(--typography-<role>-family)` for `font-family`.

  `@bridge-ds/core`, `@bridge-ds/cli`, `@bridge-ds/mcp`, `@bridge-ds/eslint-plugin`, `@bridge-ds/stylelint-plugin`, `@bridge-ds/figma-plugin`: test expectations and fixtures follow the new token values (ink chains, white canvas, the ocean overrides, 296 contrast checks). No behavior change.

- Updated dependencies [e31bac2]
- Updated dependencies [5b9d677]
- Updated dependencies [3e59115]
- Updated dependencies [e54d2a1]
- Updated dependencies [bac1cb2]
- Updated dependencies
- Updated dependencies [a55525d]
- Updated dependencies [f103729]
- Updated dependencies [cd5565e]
- Updated dependencies [95db484]
- Updated dependencies [cf3f5bb]
- Updated dependencies [abe4395]
- Updated dependencies [7261f47]
- Updated dependencies [a6a3a46]
- Updated dependencies [d5d263b]
- Updated dependencies [c66908c]
- Updated dependencies [525217f]
- Updated dependencies [5c40693]
- Updated dependencies [019a220]
- Updated dependencies [a0142d2]
- Updated dependencies [e31bac2]
- Updated dependencies [36cb504]
- Updated dependencies [2c79d5d]
  - @bridge-ds/core@0.2.0
  - @bridge-ds/visual@0.2.0
