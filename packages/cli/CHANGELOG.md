# @bridge-ds/cli

## 0.14.0

### Minor Changes

- 17f2849: The automatic measure: `measureWorkflowYaml` and `measureWorkflowOptionsFromConfig` (core) generate `.github/workflows/bridge-measure.yml`, which measures a team's Storybook each time it changes (after each deploy of a deployed Storybook, or on pushes that change it with Storybook built in the run, plus a weekly fallback) with `bridge specs --measure --variants --tokens --shots --check` in headless Chrome, and publishes `measured-specs.json` and `measured-shots/` to the `bridge-requests` branch only when the measure changed, with the run's `GITHUB_TOKEN` only. New `bridge measure setup` writes it from `bridge.config.json`, and `bridge init` offers it. Studio, Settings, Claude shows the measure of the components and, for developers, Set up automatic measure (a pull request that adds the workflow, or the file to commit from GitHub when the app cannot write workflows); new docs page /docs/automatic-measure/ and docs/MEASURE.md; templates/bridge-measure.yml for teams.
- 8a83d88: The owner override covers suggestions. An owner `governance.override` allows, whom nobody else can review, approves their own suggestion as owner with a written reason: core `overrideSuggestionOnGitHub`, `composeSuggestionOverrideComment`, `parseSuggestionOverrideComment`, `suggestionOverrideProblem` and `suggestionOverrideOf`, and `summarizeSuggestionApprovals` counts it as every missing approval on its version (`SuggestionGovernance.override`). `bridge review <n> --override --message "..."` and `bridge_review_suggestion` with event `override` do it; `bridge suggestions show` and `bridge_get_suggestion` say "Approved with the owner override by @login".
- 6842370: Tier 1 publish by leads. New `governance.leadsPublishTier1` in `bridge.config.json` (absent counts as on): team admins and the reviewers of the matching domain publish a Tier 1 change without review, and Bridge merges it once the checks pass. Core adds the `tier1-publish` module (`canPublishTier1`, `tier1Domain`, `tier1PublishOf`, `publishedWithoutReview`, `tier1PublishSentence`) and `branchVerdict` reads `tier1Published` as on its way until a check fails. `bridge settings` and the MCP settings and roles say who may publish small changes; `bridge branch status` and `bridge_branch_status` say "Published by <name> without review (Tier 1)."

### Patch Changes

- acff80f: Fix with Claude: the loop as steps in core (`startFixLoop`, `fixLoopRound`, `fixLoopOutcome`) and the change for review (`figmaFixesProposal`, `figmaFixesBranchStem`, `DEFAULT_MEASURED_SPECS_FILE`, `FIGMA_FIXES_LABEL`), shared by the CLI (`bridge fix --with-claude`), the MCP server (`bridge_propose_figma_fixes`, `figmaFixes.loadFixFiles` now exported) and Bridge's server, which runs the loop with a team's connected Claude one round per request. Same behavior for the CLI and the MCP tools.
- 42c7c8f: License: FSL-1.1-MIT (each version becomes MIT after two years). See LICENSING.md.
- 40b45ea: The measure has one agreed place: `measured-specs.json` (and `measured-shots/`) in the repo, else on the `bridge-requests` branch, where the automatic measure publishes it next to the plugin's `figma-fidelity.json`. Core: `findMeasure`, `MEASURE_BRANCH`, `measureFromWords`, `measureDir`, and the missing-measure words (`MEASURE_MISSING_TEXT`, `measureSetupSteps`, `MeasureMissingError`). The Claude fix tools (`bridge_figma_gaps`, `bridge_get_gap_case`, `bridge_try_figma_fix`, `bridge_propose_figma_fixes`, `bridge gaps`, `bridge fix`) read the measure there too; with none, `bridge_figma_gaps` answers `status: "no-measure"` with the designer sentence and the steps, never a raw error. The Figma plugin's measured spec sources and "Ask Claude to fix it" read it there (shots from the same branch), so a team on static specs gets the Claude button once it is measured; without a measure the row says "Bridge hasn't measured your components yet. A developer turns it on once: Set up automatic measure." and the copied request says how.
- Updated dependencies [1186ebf]
- Updated dependencies [acff80f]
- Updated dependencies [42c7c8f]
- Updated dependencies [537952e]
- Updated dependencies [40b45ea]
- Updated dependencies [b447dc4]
- Updated dependencies [8a83d88]
- Updated dependencies [163315e]
- Updated dependencies [6842370]
  - @bridge-ds/mcp@0.10.0
  - @bridge-ds/visual@0.3.14

## 0.13.0

### Minor Changes

- 625a692: Try it works without online previews: when nothing reported a deployment for an exploration (explorations and library branches are not deployed on Vercel any more), the Figma plugin says a developer opens it on their computer, the share message gives `git fetch origin && git switch <branch>`, polling stops, and `bridge branch try` / bridge_try_branch return the same local command (`local`). New core helpers: noOnlinePreview, localTryCommand.

### Patch Changes

- ae25831: The bridge-data workflow template stops when the snapshot fails (pipefail), instead of publishing an empty bridge-data branch.
- 3364ee9: Build requests in the CLI and the MCP server: `bridge build list|show` and `bridge_list_build_requests` /
  `bridge_get_build_request` (read only, status read from GitHub, the brief for Claude). Branch status, merge and
  "what needs me" read a push from the Figma plugin with the shared gate (design approved, token values ship by
  themselves). Core: a spec-only or Claude draft branch from Figma never ships by itself.
- 4fd6e15: CLI errors say how to recover: `propose` names `--file` and `--mode` (not the MCP fields) for a token defined in several files, and explains a missing or non-array `--edits` file instead of a JavaScript error; `audit --baseline` with a file that is not an audit report no longer prints "undefined"; `snapshot --activity` without a token says how to read GitHub without a stray write hint; `request show` on another issue points to `bridge request list`; bad JSON for `docs save` and `figma push` says what to pass.
- e52619d: The bridge CLI never writes on GitHub with a credential you did not pass: writes (suggestions, requests, reviews, comments, merges, branches) use `GITHUB_TOKEN`, `BRIDGE_GITHUB_TOKEN` or `--token`, or your gh sign-in only with `--use-gh-auth`. Reads may still use the gh sign-in, say so in one line on stderr, and cannot write. `bridge branch merge --dry-run` needs no write token. A merge the gate blocks exits 1, not 2, and `bridge --help` documents the exit codes. CLI messages name commands and flags (`bridge branch merge 12 --override "why"`), never MCP tools or JSON fields, the rate-limit message says how to pass a token in the CLI, and suggestions, pull requests and docs proposals made from the CLI say "the bridge CLI" and "source: cli". `bridge_get_config`, the server instructions and its start line say what Bridge may write in the same sentence. `bridge docs help`, `bridge brand help` and `-v`/`-h` work, `bridge tokens` says when it shows only the best matches (`--limit`), `bridge diff` explains a bad git ref, `bridge coverage` counts the 53 components once and says what the other numbers are, `bridge audit --fix` keeps what the audit keeps (ignore comments, `--allowlist`, `audit.exclude`) and takes `--json`, and a Figma change drafted by Claude no longer says so twice.
- 4fb54b4: Marking a Figma change drafted (`bridge_mark_figma_change_drafted`, `bridge figma drafted <n>`) now also marks its pull request ready for review, in the same step, through GitHub's `markPullRequestReadyForReview` mutation. Ready goes first: when GitHub refuses it, the labels and the description stay as they were and the error says why, so a branch is never labelled `drafted-by-claude` while reviewers cannot see it. `markFigmaChangeDraftedOnGitHub` returns `ready: true`.

  The Bridge MCP server (and `bridge mcp`) uses your gh sign-in (`gh auth token`) when `GITHUB_TOKEN` and `BRIDGE_GITHUB_TOKEN` are not set, and says once at start where its token came from, or that it runs without one (read-only, 60 requests an hour) and how to fix that. It never logs the token. The other CLI commands keep their rule: writes use your gh sign-in only with `--use-gh-auth`.

- afa59e8: Foundation of the Claude correction loop for the Figma pull. Core: `buildGapCase` (one component's gap case: the
  variants the story shots say differ, each with its story, args, state, shot and the differences in plain words and
  deltas, like "Height 72 in Figma vs 84 in code: 8 px missing below the label") and `figma-fixes.json` (`parseFigmaFixes`,
  `validateFigmaFixes`, `applyFixes`): the team's corrections of four kinds (part patch, axis mapping, story pointer,
  honest status), laid on every fresh measure with a provenance record per fix. CLI: `bridge fixes check`,
  `bridge fixes apply --in --out` and `bridge gap <component>`. See docs/FIGMA-FIXES.md.
- 9be32eb: Figma references: one variant that fails to render no longer skips every variant after it. The reference story catches a render error and shows it as that variant's skip reason, and the capture reloads the story if Storybook still lands on its error screen. Parts of a compound component (AccordionItem, Radio, menu items, SidebarNavItem, TableEmpty) render inside their parent (`within` in the render plan) and are captured alone, at the width Figma draws them. Menu parts render the part itself instead of the Menu root, and a capture that comes out invisible is skipped with a reason instead of saved as a blank image.
- f7751a1: Fix with Claude: the team's own Claude fixes components whose Figma build differs from their story, Bridge is the
  referee and a person approves; Bridge holds no API key. Core: `figmaGaps`, `gapCaseFor`, `tryFigmaFixes` (the values
  referee: fixes validated, laid on the measure, the set rebuilt, each differing variant compared with the code before
  and after, verdict closer, same or worse), `figmaFixesPrBody`, `fixPrompt` and `parseFixReply`, `FigmaFidelityRun`
  (`figma-fidelity.json`), and `specsFromMeasure` (the plugin's measured-only pull, now in core). MCP:
  `bridge_figma_gaps`, `bridge_get_gap_case`, `bridge_try_figma_fix` and `bridge_propose_figma_fixes` (a draft pull
  request labelled drafted-by-claude). CLI: `bridge gaps` and `bridge fix <component>` (`--case`, `--try`, `--propose`,
  and `--with-claude` with the team's ANTHROPIC_API_KEY). See docs/FIGMA-FIXES.md.
- 60388db: Measure: a story that shows several instances (a gallery) is drawn from its first instance, and its screenshot is now
  cut to that instance, so the fidelity check compares like with like. HeroUI Input and Select were drawn 192 px wide
  (one field) and compared with a 400 px shot of two.
- 0b3aa07: One merge verdict everywhere: `branchVerdict` and `approvedSuggestionOnGitHub` in core compose the review rules once, and Studio, the MCP tools (`bridge_branch_status`, `bridge_merge_branch`, `bridge_what_needs_me`, `bridge_get_settings`) and the CLI (`bridge branch status|merge|list`, `bridge settings`) read them. Tier 1 needs one owner approval, the owner override is for owners only and always needs a reason (20 characters by default), and a pull request that applies an approved suggestion with `Closes #n` carries its approvals.
- a9cbbab: The team snapshot now carries releases, packages and motion, so a team's hosted Library can show its Changelog, Install and motion sections. `bridge snapshot` reads each workspace package and its CHANGELOG.md, the pending changesets and the release dates (tags, or git history on a full clone), and core adds the motion section of every component from its specs. Schema version stays 1: older snapshots still read. Core also exports the Changelog model (collectReleases, groupReleases) and motionDocs, moved from the docs site.

  For you: nothing to change. Add `fetch-depth: 0` to the checkout in bridge-data.yml if you want release dates without release tags.

- 57f26bf: A branch updated after every changes request reads "Updated, look again" (core reviewStatusLabel, branchVerdict label) in Studio, the MCP server and the CLI, never a stale "Changes requested". The merge gate is unchanged. Studio's approval checklist says who looks again instead of "Failed".
- db8e449: Measure what Carbon's form fields and controls really lay out. Child margins become auto layout: a first or last child's margin becomes padding, the space between children becomes the gap when uniform, else the smallest gap plus `spacers` per child. Widths and heights the CSS sets are listed in `sized` (kept fixed, not hugged). A percentage radius becomes px from the box (50% of a knob is half its side). An inline element holding blocks, and a row whose children sit stacked, take their direction from their boxes (a wrapping row stays a row). Closed or hidden content (opacity 0, hidden, inert, clipped away, an aria-hidden popover, an empty zero-size shell) is not a part. `--variants` runs once a component's stories are measured and starts each combination from the closest story; it probes an enum by rendering its default and one other value through args and comparing them with popovers and tooltips left out, so an arg that only opens, aligns or moves a popup is not an axis.
- 4dc69ae: Measure args reach the story: when Storybook drops URL args it cannot validate (a story that declares no args, like Carbon's Button), the measure sends them the way the Controls panel does and waits for the re-render. `--variants` probes a boolean with both values, compared with each other, so a story that renders the non-default value (a toggle shown on) keeps its axis.
- e4c34ee: Measure controls drawn in CSS and keep long runs cheap and safe. The measure reads `::before` / `::after` that draw a box as parts (box, fill, border, radius, pin or cover, with their own declarations in the cascade), gives a grid a direction (flow, tracks, or where its children sit), writes inline SVG with every shape's fill and stroke and currentColor resolved (`vectors`, with strokes), keeps BEM element classes (`cds--toggle__switch`) whole, lays out a root that fills its container at 400 px (`fillWidth`) so the measure and the shot agree, flags gallery stories and orders single-instance stories first, and waits for DOM ready plus a short settle with animations paused. `--variants` varies only the args a story declares; without a Figma set it probes each one once and leaves out args with no visual effect (`variantPlan`), with at most 48 renders per component (each value, then pairs). The CLI stays on the story (links do not navigate), opens a fresh tab per component and after any failure, reads `--tokens` first, writes after each component with `--resume`, and runs `--check` only against a Figma side that belongs to the Storybook.
- ce6a8c7: Measure as the referee: `bridge specs --measure` now opens popups (`--open`), measures parts inside a parent or portal (`--within`), reads tokens defined on provider elements, splits stories that render many instances, records the props each story rendered with, measures every variant (`--variants`, `--states`, hover and focus forced in Chrome, disabled as an arg) and gives each component a status (`--check`: Matches, Differs, or Can't check yet with the reason). Core pairs text layers by their words, and exports the measured-specs shapes, `parseMeasuredSpecsFile`, `pairParts`, `compareSpecToMeasured`, `mapPropsToFigma`, `planVariantMeasures` and `componentStatus` from the browser-safe entry.
- 200dea0: `bridge specs --measure --variants`: when the probe leaves no arg to vary, only the states are measured (it no longer falls back to crossing every enum), and a browser that crashes or runs out of memory is launched again instead of failing every story after it.
- fd0191c: `bridge specs --measure --tokens` harvests the library's variables: every CSS custom property its stylesheets define (root, provider and theme selectors), the declaration that applies where the story sits, resolved (colors as rgb, lengths in px), per theme, brand or density mode (Storybook globals, or a theme attribute such as `data-carbon-theme`), in two tiers (literal: primitive, `var()`: semantic, and semantic by value when a compiled theme writes a primitive's value per mode), with Figma variable paths and the properties the measured stories use. Written as `tokens` in measured-specs.json (`MeasuredTokens` in core).

  `--shots` writes a PNG of each measured root at 2x (one per distinct render) to `measured-shots/` with a manifest keyed by Figma variant, and records `shot` on each story; the measured root part carries `fill` when it spans its container. `@bridge-ds/visual`'s `openMeasurePage` takes a `scale`.

- 4d61987: Measure triage on the full library. The measure: forced states apply to the component and everything in it (a field's Hover is its control's hover), logical properties (`padding-block-start`) are read in the cascade, a declaration whose variable does not give the computed value is not taken as the token, visually hidden text is not a layer, and a component that draws nothing itself is not split into instances. Pairing reads every class of a part, prefers the part's own parent, keeps classless decorations and same-word texts in another role unpaired. The status compares a variant with the closest story that renders its props, names an arg a story refuses, checks sets drawn under a folder (Progress/Linear) and names the open popup Figma draws. `--variants` measures every story as written; parts with no story of their own (MenuItem, MenuSubmenu, AccordionItem) are measured inside their component as `<title>/<Set>` entries, and every measured component, popups and parts included, carries the token values its Figma sets name (`resolved`).
- 44f49ff: `bridge specs --measure`: the set's root class is read from the spec source correctly (it read `module`), so items inside their group are measured alone; a forced Pressed state is also a hover, as a real press is; `--check` gives one status per component name, its own stories and its "Figma variants" stories together.
- 07380d7: `bridge specs --measure` measures the item, not its group: when a story renders a set's component inside its parent (a radio in its fieldset, a menu item in its open menu), the measure reads the element with the Figma set's root class, opening the popup if needed. A Figma `Checked=mixed` value maps to the `indeterminate` prop (`mapPropsToFigma` `also`, `variantCombosFromMapping`), so `--variants` measures it and `--check` compares it.
- b822435: A merged or closed branch reads as done everywhere: the merge gate gives its state as the one reason and lists no missing approval; `bridge branch status` prints "Merged." and who approved, without approvals, tests or blockers.
- d54ace8: Fix with Claude: a part fix that sizes, places or lays out a part (width, height, direction, align, overlay) opens for
  review even when the values referee says same. The referee can't judge layout; the pull request body says so and that
  Check fidelity decides. A fix that goes the wrong way is still refused.
- 4aa0cd7: Storybook measure: `bridge specs --measure --storybook <url>` opens each story in Chrome and records what it really draws (layers, boxes, auto layout, fills, borders, radii, text styles, and the token behind each value), in the component specs shape. Works on any React Storybook, whatever the styling. Core adds `measureStory`, `measuredToSpec` and `compareSpecToMeasured` under `@bridge-ds/core/node`; visual exports `openMeasurePage`. The Figma pull does not read it yet.
- d8e5e84: Token values follow the Figma rule wherever they are made (decision TV-1): a pull request or a suggestion that only
  changes token values (values changed or tokens added, nothing renamed or removed, no code) needs the design approval
  only. Once it is in, the tech approval counts as given and the change ships after the automatic checks
  (`isTokenValueChange`, `mayBeTokenValueChange`, `withTokenValueApprovals`, `branchVerdict` `tokenValues`,
  `suggestionIsTokenValues`, `summarizeSuggestionApprovals` `valuesOnly`, `requiredApprovals(tier, valuesOnly)`).
  Renames and removals still need a developer OK. Studio, the MCP server and the CLI read the same verdict
  (`bridge_branch_status` says "Design approval (token values ship after the checks)").
- Updated dependencies [7eb8a27]
- Updated dependencies [3364ee9]
- Updated dependencies [e52619d]
- Updated dependencies [ea27992]
- Updated dependencies [4fb54b4]
- Updated dependencies [02d38ad]
- Updated dependencies [9be32eb]
- Updated dependencies [f7751a1]
- Updated dependencies [60388db]
- Updated dependencies [0b3aa07]
- Updated dependencies [1635400]
- Updated dependencies [57f26bf]
- Updated dependencies [0b415fd]
- Updated dependencies [fd0191c]
- Updated dependencies [b822435]
- Updated dependencies [d54ace8]
- Updated dependencies [2b01116]
- Updated dependencies [4aa0cd7]
- Updated dependencies [80ee954]
- Updated dependencies [d8e5e84]
- Updated dependencies [625a692]
  - @bridge-ds/mcp@0.9.0
  - @bridge-ds/visual@0.3.13

## 0.12.0

### Minor Changes

- 037b56b: `bridge snapshot --activity [--repo owner/name]` also writes `activity.json`, read with `GITHUB_TOKEN`, so a visitor of a team's hosted Studio who is not signed in spends no GitHub API request on Home, Branches, a branch, Review, History, suggestions and requests. `templates/bridge-data.yml` runs it on pushes, pull request, issue and comment events and every 30 minutes, and keeps one commit on the `bridge-data` branch.

### Patch Changes

- @bridge-ds/mcp@0.8.5
- @bridge-ds/visual@0.3.12

## 0.11.2

### Patch Changes

- 5ec4a47: One status per branch, everywhere. `reviewStatusKind` is the single derivation for the Branches list, the branch page, the home cards, `bridge_what_needs_me`, `bridge_branch_status` and `bridge branch status`. A repo with no automated checks is a calm state of its own ("No automated checks", `CI_STATE_LABEL`) and the status comes from the approvals, as for any branch. While GitHub computes whether a branch merges cleanly, a missing approval still shows; "Checking for conflicts" only holds back "Ready to merge". The words live in core (`REVIEW_STATUS_LABEL`), and the branch page header now shows the same pill as its row ("Owner override needed", "Design owner to approve") instead of a plain "In review".
- 5ec4a47: Suggestions, visual checks and titles. A suggestion whose change no longer applies to main (main moved and the value it changes is not the one it was suggested from) reads Outdated in Studio, `bridge_list_suggestions` and `bridge_get_suggestion`, through one core rule (`suggestionStalenessOnGitHub`, over `planSuggestionApply`). An applied and closed suggestion keeps only its final label ("suggestion: applied"; "suggestion: declined" when declined): `bridge_apply_suggestion`, `bridge_link_suggestion`, `bridge apply` and a merge from Bridge (`markSuggestionsAppliedOnGitHub`) remove "needs review" and "applying". The visual-check label and "the visual comparison runs again" are offered only when the repo has the visual impact workflow (`hasVisualWorkflow`, `visualOffer`); otherwise the branch page shows a quiet "Set up visual checks" link. Request and suggestion titles are never prefixed twice ("Select: select: ...") and keep component names as written ("EmptyState"), through `subjectTitle`.
- Updated dependencies [5ec4a47]
- Updated dependencies [5ec4a47]
  - @bridge-ds/mcp@0.8.4
  - @bridge-ds/visual@0.3.11

## 0.11.1

### Patch Changes

- c4d666e: The CLI reports its own version: `bridge --version`, the help banner, audit reports and snapshots recorded the `@bridge-ds/mcp` version (0.8.3) instead. `bridge --version` also printed the help and exited 2; it now prints the version and exits 0, like `bridge version`.

## 0.11.0

### Minor Changes

- 9b0b653: Hosted Library per team (multi-team PR 4a). `/library/<owner>/<repo>/` serves a team's published design system:
  Home, Foundations (generic token specimens), Components (cards by family; one component with a live Storybook story
  and its `docs.json` guidance) and Tokens (every token with its value per theme). Each page is built once at
  `/library-shell/...` and reached through two new `vercel.json` rewrites; the build fails on a missing shell or on any
  file that would take a team's Library address. Signed out, a Library reads the team's `bridge-data` snapshot from the
  raw host with no GitHub API call; signed in, it reads like Studio. Pages are `noindex` unless `bridge.config.json` sets
  the new `library.public: true` (core `libraryIsPublic`, schema). `bridge snapshot` now also writes `llms.txt` (core
  `snapshotLlmsTxt`), which the Library links for AI agents. On a team's Studio, the header's Library button opens the
  team's Library. `scripts/hosted-smoke.mjs` covers the Library routes.

### Patch Changes

- @bridge-ds/mcp@0.8.2
- @bridge-ds/visual@0.3.9

## 0.10.0

### Minor Changes

- 1a560aa: New `bridge snapshot`: writes the repo model of a checkout for hosted Bridge (`snapshot.json`: the token, contrast and
  component files the model reads, Figma coverage without the 1 MB specs, contrast results, counts) plus
  `audits/<id>.json` (`--audit <folder>[=label]` runs `bridge audit`, `--audit-report` carries existing reports). Core
  gets the snapshot schema: `parseSnapshot`, `buildSnapshot`, `snapshotSource` (a `RepoSource`, so `loadRepoModel`
  reads a snapshot like a repository), `recordingSource`, `snapshotIsFresh`. The `bridge-data` workflow publishes it
  to the orphan `bridge-data` branch; `templates/bridge-data.yml` is the copy for other teams (docs/HOSTED.md).

### Patch Changes

- @bridge-ds/mcp@0.8.1
- @bridge-ds/visual@0.3.8

## 0.9.0

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
  - @bridge-ds/mcp@0.8.0
  - @bridge-ds/visual@0.3.7

## 0.8.0

### Minor Changes

- d193898: Suggestions from Claude and the terminal. How a change reaches the code now follows `"changes"` in `bridge.config.json`: with `"suggest"` (the default when the key is absent) the writing tools file a suggestion, a GitHub issue with the exact change that the owners approve and a developer applies, instead of a branch and a pull request; `"direct"` keeps branches and pull requests. `bridge_propose_token_change`, `bridge_save_docs`, `bridge_propose_brand`, `bridge_propose_revert`, `bridge_open_library_branch` and `bridge_push_figma_component` take `changes` (`"suggest"` or `"direct"`) for one call and return `status: "suggested"` with the issue number in suggest mode; the CLI commands take `--suggest` or `--direct` (`bridge propose`, `bridge brand create`, `bridge revert`, `bridge docs save`, `bridge pieces open`, `bridge figma push`). Writing to an exploration or a branch in review (`branch`, `pr`) is unchanged. `bridge_get_config` says which mode the repo uses.

  New MCP tools (67 in all): `bridge_list_suggestions`, `bridge_get_suggestion` (the change, its checks, its version and the approvals still missing), `bridge_create_suggestion` (any payload, paths checked first), `bridge_review_suggestion` (approve, request changes, comment or decline; counts only for owners read from the default branch, on the version reviewed), `bridge_apply_suggestion` ("Apply Bridge suggestion #42": dry run, a new local branch, the working tree or a patch on a local checkout, the files to write on a remote repo; records on the issue that it is being applied) and `bridge_link_suggestion` (the pull request that applies it). New CLI commands: `bridge suggestions [list | show <n> | link <n> --pr <m>]`, `bridge apply <n> [--write | --patch] [--dry-run] [--accept-edited] [--force-unapproved]` (exit 0 applied or already applied, 1 not approved, blocked or refused, 2 usage, 3 conflict) and `bridge review <n> --approve | --request-changes | --decline`. The token hints say what each mode needs: Issues read and write for suggestions and requests, Contents and Pull requests for direct changes.

### Patch Changes

- Updated dependencies [d193898]
  - @bridge-ds/mcp@0.7.0

## 0.7.0

### Minor Changes

- 22e53c7: Components changed in Figma go back to the library as library branches. The DS Bridge plugin's Push tab reads the diff Pull reads in "Review updates" the other way round and routes each changed component (`planComponentPush`): a token swap on a component token that paints only the changed variants becomes an exact token change, no AI (the shared `planTokenProposal` and `writeTokenProposalOnGitHub`, with the contrast gate run again on the component tokens that alias a checked pair, `componentContrastPairs`, and the other components that share the token named); a new variant, property, layer, swapped instance or component, or a swap a token alone cannot say, opens a draft branch carrying the spec (`.bridge/figma/<name>.json`: variant matrix, properties, bound variables and layers per variant, screenshot) labelled `waiting-for-claude` until Claude AI writes the code there and it becomes `drafted-by-claude`; detached layers, values set by hand, styles and variables the library lacks are listed under "Fix in Figma first" with what to do, never sent. Every branch starts with "From Figma" (`parseFigmaOrigin`) and carries `from-figma`. The set remembers its branch: once it ships or closes, the next Pull rebuilds the set from the reviewed code, so Figma never diverges. MCP: `bridge_figma_changes`, `bridge_get_figma_change`, `bridge_mark_figma_change_drafted`, `bridge_push_figma_component` (61 tools). CLI: `bridge figma`, `bridge figma show <n> [--draft]`, `bridge figma drafted <n>`, `bridge figma push <diff.json>`.

### Patch Changes

- Updated dependencies [22e53c7]
  - @bridge-ds/mcp@0.6.0
  - @bridge-ds/visual@0.3.4

## 0.6.0

### Minor Changes

- 5b93962: Product branches bring what they invent back to the library. `missingPieces` (in `@bridge-ds/core/audit`) runs the adoption audit on each product file a product branch changes, at its start and at its head, and keeps what the branch added that the library lacks: a value written on a library component becomes a variant of it ("Badge: overdue tone"), a component from another UI library with no equivalent becomes a new component, any other hardcoded value becomes a token beside the closest one. Values equal to a token and components the library has are fixes, not pieces. `openLibraryBranchOnGitHub` opens the library side of a piece and links both ways: a token change (through the new shared `planTokenProposal` and `writeTokenProposalOnGitHub`, which `bridge_propose_token_change` now uses too), a library exploration for a variant, or a component request for a new component; the library side says "Needed by" the product branch (label `needed-by-product`), the product branch records the link in its description. The product branch takes the library branch's preview (Bridge merges it in, `GitHubClient.mergeIntoBranch`), and `switchToPublishedOnGitHub` brings main in once the library ships. MCP: `bridge_missing_pieces`, `bridge_open_library_branch`, `bridge_product_branch`, `bridge_use_library_preview`, `bridge_switch_to_published` (57 tools). CLI: `bridge pieces <n> [--record]`, `bridge pieces status|open|preview|switch`.

### Patch Changes

- Updated dependencies [5b93962]
  - @bridge-ds/mcp@0.5.0
  - @bridge-ds/visual@0.3.3

## 0.5.0

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

- Updated dependencies [51e743c]
  - @bridge-ds/mcp@0.4.0
  - @bridge-ds/visual@0.3.1

## 0.4.0

### Minor Changes

- 6b07b05: Check fidelity: the Pull tab compares every generated Figma variant with the same variant rendered from code and says, per component, "Matches the code" or "Differs from the code: 12% of pixels, size 120x40 vs 118x40", with Figma, code and differences side by side. Nothing in the file changes. Core adds the pure comparison (`compareImages`, tolerant of font rasterization and antialiasing), the storable `FidelityReport` and the variant to code mapping (`planReference`); `bridge figma-references` (visual) captures the code images from Storybook, published on main by the Figma references workflow to the `bridge-visual` branch. React adds a hidden Storybook fixture, "Internal/Figma reference", not part of the package.

### Patch Changes

- Updated dependencies [ed4b28d]
- Updated dependencies [6b07b05]
  - @bridge-ds/visual@0.3.0
  - @bridge-ds/mcp@0.3.3

## 0.3.2

### Patch Changes

- 5bfc7e2: The adoption audit reads Astro, Vue and Svelte files. Template markup counts DS components imported in the frontmatter or `<script>` (Vue kebab case included), native elements a DS component should render (with the DS equivalent), local look-alikes named like a DS component (`Button.astro`), hardcoded values in `style` attributes (`style="..."`, `style={{ ... }}`, Vue `:style`, Svelte `style:prop`), `class` attributes and color attributes, and token references. The frontmatter and `<script>` blocks go through the TS scanner and `<style>` blocks through the CSS audit, with the file's own line numbers. Hidden inputs and elements inside `<noscript>` do not count. New escape hatches, both with a required reason and both kept visible in the report: a `bridge-audit-ignore-next-line: reason` comment on the line above (HTML, JSX, CSS or JS comment; a comment without a reason or above nothing is reported and ignores nothing), and `bridge audit --allowlist file.json` (`allowlist` in `bridge_audit`) for known file:line violations, with stale entries listed. The report gains `files[].ignored`, `files[].ignoreErrors`, `ignored` and the `astro`, `vue` and `svelte` languages (schema updated, still version 1). The docs site's `audit:docs` now sees its raw elements; they sit in a temporary, reasoned allowlist (`apps/docs-site/bridge-audit-allowlist.json`) until the native elements migration removes them.
- Updated dependencies [5bfc7e2]
- Updated dependencies [9494004]
  - @bridge-ds/mcp@0.3.2
  - @bridge-ds/visual@0.2.3

## 0.3.1

### Patch Changes

- 4bfd417: Studio tells design work from developer work, and says who really made it. Work that only touches code (a title that speaks code such as "React" or "props", tests, examples, types, build or tooling only, component code the visual impact run shows no difference for, a "tech" or "developer" label) no longer shows in Needs you, on the board columns or in the Changes badge: the Overview folds it into one quiet line under the board, "Developer work, 1 in progress", that opens its list. Changes keeps every item and tags developer work "Developer", with an All, Design, Developer filter that shows when a list holds some. When nothing says what a change is, it stays with designers. An exploration card says "Claude is building it" when a real marker says an agent made it (the pull request template box, the Claude Code footer or session link, a "Co-Authored-By: Claude" commit, an agent label, an exploration or request started from the MCP server), and "You are trying it" only for what you started from Studio. The exploration block now records where it was started (`source`: studio, figma, cli or mcp) and the agent behind it (`agent`), and the CLI records `agent: "claude"` when Claude Code runs it.
- c499852: The docs now treat npm as the main install path. The Install page leads with `npm install @bridge-ds/react @bridge-ds/tokens` and `npx @bridge-ds/cli check`, lists every package with a link to its npmjs.com page and the version read from its package.json, and keeps the clone install in a "For contributors" disclosure at the bottom. The Agents page connects Claude to a GitHub repository with `npx -y @bridge-ds/mcp --repo owner/name` first (read-only, a token to open pull requests), with a local folder as the alternative. README, docs/AI.md and the package READMEs no longer say the packages are unpublished. `bridge init` now writes `npx -y @bridge-ds/mcp` into `.mcp.json` and the Claude Desktop snippet outside the Bridge repo (it wrote a path into the npx cache), and `bridge --help` exits 0.
- Updated dependencies [4bfd417]
- Updated dependencies [c499852]
  - @bridge-ds/mcp@0.3.1
  - @bridge-ds/visual@0.2.2

## 0.3.0

### Minor Changes

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

- Updated dependencies [80228c0]
- Updated dependencies [adc0df7]
- Updated dependencies [3d3d77d]
- Updated dependencies [9574d19]
- Updated dependencies [fb40ae8]
- Updated dependencies [196d02b]
- Updated dependencies [dd2261c]
- Updated dependencies [1e78f3b]
  - @bridge-ds/mcp@0.3.0
  - @bridge-ds/visual@0.2.1

## 0.2.0

### Minor Changes

- bac1cb2: Measure design system adoption in product code. `@bridge-ds/core/audit` finds hardcoded colors, lengths, radii, shadows, durations, z-index and fonts in CSS, SCSS, style/sx/styled/theme objects, CSS-in-JS and Tailwind classes, suggests the closest token (deltaE in OKLab across every mode, nearest scale step), and counts DS components against foreign UI libraries, native elements and re-created components. `bridge audit <path>` reports token and component adoption as JSON (versioned schema) and Markdown, compares with a baseline, fails CI under a threshold, and `--fix --write` replaces exact CSS matches with `var(--token)`. The MCP server adds `bridge_audit` and the `migrate-file-to-ds` prompt. New `@bridge-ds/stylelint-plugin` (`bridge/use-tokens`) and `@bridge-ds/eslint-plugin` (`no-hardcoded-style-values`, `prefer-ds-components`).
- bffaaa9: History and rollback. `bridge_get_history` and `bridge_get_token_history` read what changed in the tokens (versions, merged PRs and commits, who, when, why, tier, breaking), and `bridge_plan_revert` and `bridge_propose_revert` undo a change against the current base branch, with conflicts shown when a token changed again later, or restore one token to an older value. The CLI adds `bridge history [token]` and `bridge revert <pr|commit> [--dry-run]`. Built on the new history model and revert planner in `@bridge-ds/core`.
- ee19cd7: Bridge MCP server and CLI. `@bridge-ds/mcp` connects Claude Code, Claude Desktop or any MCP client to a DTCG design system repo (local folder or GitHub): 15 tools to read tokens per mode, search, validate, check contrast, read components and docs, propose token changes as branches or draft PRs (never on main), review PRs and scaffold components, plus resources and prompts. `@bridge-ds/cli` adds `bridge init`, `check`, `tokens`, `diff`, `propose` and `mcp`.
- cd5565e: Visual impact analysis for design system changes. `@bridge-ds/core` gains a usage index (CSS variables each component reads, components it renders). New `@bridge-ds/visual` builds Storybook and the admin app at two refs, screenshots the impacted stories (every brand and theme) and the admin screens (every tenant and theme) deterministically, and pixel-diffs them into before, after, diff and composite images plus a JSON manifest. `bridge impact` and the `bridge_visual_impact` MCP tool run it; a workflow posts the result on pull requests.
- d5d263b: Docs drafts. `@bridge-ds/core` computes what code can tell about a component's docs (props table, tokens, anatomy from the CSS module classes, contrast notes, a changelog line) and keeps the review state of AI-drafted prose (`draftedBy`, `needsReview`). The MCP server adds `bridge_draft_docs`, which returns that pre-fill and a prompt for your own Claude to write the prose; the CLI adds `bridge docs draft <Component>` (`--json` for CI).
- 525217f: Explorations for Claude and the terminal: MCP tools `bridge_start_exploration` and `bridge_list_explorations`; CLI `bridge explore start <name> --purpose`, `bridge explore list`, `bridge explore promote <name>` and `bridge explore close <name>`. Write tools take a target exploration branch: `bridge_propose_token_change` and `bridge propose` with `branch` (one commit on GitHub, or the checked-out working tree locally), `bridge_draft_docs` with `branch`, `bridge_get_request` and `bridge request implement` with `branch`, `bridge_create_request` and `bridge request create` with `exploration`. Briefs for an exploration say to work on that branch and never open a pull request to main.
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

- Updated dependencies [bac1cb2]
- Updated dependencies
- Updated dependencies [a55525d]
- Updated dependencies [bffaaa9]
- Updated dependencies [ee19cd7]
- Updated dependencies [cd5565e]
- Updated dependencies [d5d263b]
- Updated dependencies [525217f]
- Updated dependencies [abe4395]
- Updated dependencies [5c40693]
- Updated dependencies [e31bac2]
- Updated dependencies [2c79d5d]
  - @bridge-ds/mcp@0.2.0
  - @bridge-ds/visual@0.2.0
