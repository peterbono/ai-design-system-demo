# @bridge-ds/core

## 0.23.0

### Minor Changes

- a367cfe: Being built: a request closed as not planned stays in All for 7 days after it was closed (`BUILD_DECLINED_DAYS`), then leaves the list, its counts, the page sentence and the empty state; a library branch from Figma closed without building is dated by its close. Each row's thumbnail shows the request's own In code now and In Figma pictures, labelled with its component (the component placeholder otherwise), and each of Claude's fixes is its own row, hovered as "Button: Claude's fix from Figma".

### Patch Changes

- f8a1085: Every way into an exploration opens its exploration page. A link that names it as a change (Home, notifications, search, an old `?pr=` address) now lands on the exploration page instead of the change review, so designers never see the review footer or developer checks there. A running exploration whose `exploration` label is missing (an open draft on `explore/*` or with the Bridge block) still counts as running everywhere (core `isUnlabeledExploration`, used by `explorationStatus` and `isHeldExploration`), and Studio puts the label back when someone who can write opens it. Starting one labels it more reliably: `exploration` goes on by itself with retries, a product label GitHub refuses no longer takes it down too, and what is still missing is reported (`labelsMissing`). The feature sentence is no longer copied into the purpose when it is the name.

## 0.22.0

### Minor Changes

- 8f73c2d: A product in `bridge.config.json` `products[]` can say where it runs in production (`"production": "https://..."`):
  the Bridge toolbar shows it as Live product and Studio as the product today. `bridge connect` in a React product now
  prints the one line that mounts the Bridge toolbar (`@bridge-ds/toolbar`), says when it is already installed, and
  warns when the product has no production URL. It never edits the app's code. The design system adds Product admin
  (`admin-app`, peterbono/bridge-product-admin).

## 0.21.0

### Minor Changes

- e8a6e7b: Missing pieces now include a library component restyled from outside with tokens only: CSS on a class the component carries, often on a state selector such as `[aria-pressed='true']`, or a token-only inline style tied to its `pressed` prop, reads "IconButton: restyled when pressed" with what changed (`fill (icon) currentColor`) and a `restyle` mark that sets it apart from hand-picked values. Layout around the component (margin, position, inset, gap) is not a piece. Requests from pieces say the closest library value once, in the "Needed by" line with its token and value, and drop the "Now" column when nothing says what is there today. Done exploring says when no piece goes to the DS lead (none picked, or never checked), and the developer note follows the branch checks instead of always saying the code is not tested.

### Patch Changes

- dc3fec0: Exploration fixes from dogfooding. The draft pull request title keeps the name as typed and never doubles the prefix ("Exploration: Exploration page, pick up where you left off"). Branch slugs go up to 60 characters, cut on a word boundary, so a valid name is kept whole. A person's commit with Claude's co-author trailer is credited to the person ("Florian with Claude"); Claude alone only when no person authored it (`isClaudeAssisted`, `humanAuthorOf`, `actorName`). The pull request body lists every configured preview app and points to the Vercel comment when the branch is too long for a predictable link, instead of saying previews are not set up. In Studio, signed-out visitors read display names from the commits and the author's public profile, and visitors without write access no longer see the Done exploring card; while the preview builds, the button reads "Preview is building" with a spinner at full contrast. `npm run build -w @bridge-ds/cli` builds @bridge-ds/mcp first when its dist is missing or stale, so the CLI no longer crashes in a fresh worktree.
- 949b731: "Done exploring" replaces "Promote to review" for explorations: the pieces the designer ticks go to the DS lead as requests with a link to the preview, the `exploration` label gives way to `ready-for-devs`, and developers take the branch as a starting point (`git fetch origin`, `git checkout explore/<name>`). Nothing is closed or merged, so the preview link stays alive; statuses read Waiting for code, Being built, Shipped. "Archive" (the `archived` label) hides an exploration from the lists without closing it, with an Archived filter in Changes. New: `doneExploringOnGitHub`, `archiveExplorationOnGitHub`, `proposePiecesOnGitHub`, `pieceRequest`, `bridge explore done|archive|unarchive`, `bridge_archive_exploration`; `bridge_promote_exploration` and `bridge explore promote` keep their names and now do Done exploring.
- dc3fec0: The exploration page picks up where you left off. While an exploration runs, Studio shows one of two states. Not started (nothing on the branch beyond the Bridge note): "Not started", who started it, "Nothing built yet" with the line to paste in Claude (Claude app or Terminal), "Continue in Claude" that copies it, "See the product today" and an empty "Your preview" frame. Exploring: who changed what and when in words (files mapped to screens and components, else the commit subject), the preview with "Open the preview" and "Continue in Claude", the "Happy with it?" card with Done exploring, and the last 3 events. The breadcrumb items sit on one baseline. Core adds the shared words (`explorationStage`, `continueLines`, `explorationActivity`, `lastActivity`, `whereItStands`) and `GitHubClient.listPullRequestCommits`. Claude resolves "Continue Bridge exploration #12" (or shop#12) with the new `bridge_continue_exploration` tool (`bridge explore continue` in the CLI): it switches a clean checkout to the branch and starts by saying where it stands. At the start of a session the server instructions have Claude offer, once, to continue the person's running explorations (`bridge_list_explorations` takes `mine`).
- 32948b0: Explorations created in a product's own repository (`products[].repo`) are no longer invisible after creation. Studio (Changes, home, Being built), `bridge explore list` and `bridge_list_explorations` read each product repository once (through the GitHub sign-in or Bridge's read proxy) and list its explorations under their product; a repository Bridge cannot read is skipped silently in lists and shown as not connected in Settings, `bridge products` and `bridge_list_products`. They open at `changes/?exploration=<n>&product=<key>` and are named `shop#12` by the CLI and Claude. Missing pieces, Done exploring, Archive and the developer section run against the product pull request; the requests from ticked pieces are filed in the design system repository with a link back (`owner/name#12`) and the product preview. Status follows the product pull request. New in core: `listProductExplorationsOnGitHub`, `parseExplorationRef`, `explorationRefLabel`, `productRepos`, `productOfRepo`, and a `library` client option on `doneExploringOnGitHub`, `proposePiecesOnGitHub`, `openLibraryBranchOnGitHub` and `productBranchViewOnGitHub`.
- 51da8b4: Explorations for a product with its own repository (`products[].repo`) are now created in that product repository by default: the `explore/<name>` branch and its draft pull request live where developers already work, and the library arrives as the npm package. Studio's "Create branch", `bridge_start_exploration` and `bridge explore start` share the rule (`productRepoOf`, `productRepoAccess`). When Bridge cannot reach the product repository, Studio says so in one line with "Ask an admin to connect <product>" and starts it in the library only if the person picks "Start in the library instead"; Claude gets the same message and asks before using `where: "library"`, the CLI takes `--in-library`. The purpose of an exploration is now optional everywhere: nobody is asked for a brief, and Claude starts one as soon as a designer says they want to explore.
- fedd0c0: A Figma fix with `width: 'fixed'` no longer pins a part to a width that only hugs its text in code. Each story already gave its own width, but a small Button story labelled "Publish tokens" measures 120.84 px because of its words, while the Figma set draws its own label and the code renders that small button at 72 px, so the fixes merged in #598 made every small button about 49 px too wide. Such a width is now skipped and reported story by story (a new `skipped` result with the measured px and the reason), and so is the width of a root that fills its container. A size the code gives the part (a CSS width, or a box wider than its content) is still pinned, each story to its own. The values referee says when a fix laid nothing on, and the fix prompt tells Claude about the rule.
- 54a8c8c: Explorations in a product's own repository, from Claude and the CLI: "Done exploring" links each request to the preview Vercel reported in the product repository (a long branch name gets a shortened alias the template cannot guess, so the requests linked the pull request instead), `bridge explore continue` and `bridge_continue_exploration` give the preview, and their next step stays in the product repository instead of suggesting a token proposal on a branch the design system does not have. The draft body says where the preview link is and no longer mentions a preview prerelease the product repository does not have. New in core: `productPreviewOnGitHub`.
- 6a44454: The values referee of the Figma fix loop finds a variant when the fidelity run names it with fewer axes than the rebuilt set has (the run keeps only the axes that vary between its shots, the Button set also has Loading and Full width). Before, every such variant came back as gone and nothing was measured. A new `matchVariant` takes the exact key first, else the one variant holding every asked axis whose other axes sit at their default, and finds nothing when that still leaves a choice. The gap case uses it too, so its variants carry the set's props and their shot.
- 4ffd06f: "Try it in the product" never opens a canceled deployment. When Vercel's Ignored Build Step skipped a branch's build (an exploration that only has its note file), the branch alias opened "Deployment was cancelled". Core now marks such a preview `skipped` (from the Vercel commit status description or its comment), `productPreview` and `previewLinksOf` leave it out, and `CommitStatusLike` carries the status `description`. In Studio, a product branch with no build of its own opens the product as it is today (its production URL, else its preview pattern on the default branch) with "Same as the product today. Your preview appears after the first change." next to the button; a build in progress says "Preview is building" and a failed one "Preview not available yet", with the details under For developers. While exploring, the page no longer asks the designer to check what is missing from the library: the sentence and the "Missing from the library" zone show once the pieces were checked or after Done exploring.

## 0.20.0

### Minor Changes

- 17f2849: The automatic measure: `measureWorkflowYaml` and `measureWorkflowOptionsFromConfig` (core) generate `.github/workflows/bridge-measure.yml`, which measures a team's Storybook each time it changes (after each deploy of a deployed Storybook, or on pushes that change it with Storybook built in the run, plus a weekly fallback) with `bridge specs --measure --variants --tokens --shots --check` in headless Chrome, and publishes `measured-specs.json` and `measured-shots/` to the `bridge-requests` branch only when the measure changed, with the run's `GITHUB_TOKEN` only. New `bridge measure setup` writes it from `bridge.config.json`, and `bridge init` offers it. Studio, Settings, Claude shows the measure of the components and, for developers, Set up automatic measure (a pull request that adds the workflow, or the file to commit from GitHub when the app cannot write workflows); new docs page /docs/automatic-measure/ and docs/MEASURE.md; templates/bridge-measure.yml for teams.
- acff80f: Fix with Claude: the loop as steps in core (`startFixLoop`, `fixLoopRound`, `fixLoopOutcome`) and the change for review (`figmaFixesProposal`, `figmaFixesBranchStem`, `DEFAULT_MEASURED_SPECS_FILE`, `FIGMA_FIXES_LABEL`), shared by the CLI (`bridge fix --with-claude`), the MCP server (`bridge_propose_figma_fixes`, `figmaFixes.loadFixFiles` now exported) and Bridge's server, which runs the loop with a team's connected Claude one round per request. Same behavior for the CLI and the MCP tools.
- 40b45ea: The measure has one agreed place: `measured-specs.json` (and `measured-shots/`) in the repo, else on the `bridge-requests` branch, where the automatic measure publishes it next to the plugin's `figma-fidelity.json`. Core: `findMeasure`, `MEASURE_BRANCH`, `measureFromWords`, `measureDir`, and the missing-measure words (`MEASURE_MISSING_TEXT`, `measureSetupSteps`, `MeasureMissingError`). The Claude fix tools (`bridge_figma_gaps`, `bridge_get_gap_case`, `bridge_try_figma_fix`, `bridge_propose_figma_fixes`, `bridge gaps`, `bridge fix`) read the measure there too; with none, `bridge_figma_gaps` answers `status: "no-measure"` with the designer sentence and the steps, never a raw error. The Figma plugin's measured spec sources and "Ask Claude to fix it" read it there (shots from the same branch), so a team on static specs gets the Claude button once it is measured; without a measure the row says "Bridge hasn't measured your components yet. A developer turns it on once: Set up automatic measure." and the copied request says how.
- 8a83d88: The owner override covers suggestions. An owner `governance.override` allows, whom nobody else can review, approves their own suggestion as owner with a written reason: core `overrideSuggestionOnGitHub`, `composeSuggestionOverrideComment`, `parseSuggestionOverrideComment`, `suggestionOverrideProblem` and `suggestionOverrideOf`, and `summarizeSuggestionApprovals` counts it as every missing approval on its version (`SuggestionGovernance.override`). `bridge review <n> --override --message "..."` and `bridge_review_suggestion` with event `override` do it; `bridge suggestions show` and `bridge_get_suggestion` say "Approved with the owner override by @login".
- 6842370: Tier 1 publish by leads. New `governance.leadsPublishTier1` in `bridge.config.json` (absent counts as on): team admins and the reviewers of the matching domain publish a Tier 1 change without review, and Bridge merges it once the checks pass. Core adds the `tier1-publish` module (`canPublishTier1`, `tier1Domain`, `tier1PublishOf`, `publishedWithoutReview`, `tier1PublishSentence`) and `branchVerdict` reads `tier1Published` as on its way until a check fails. `bridge settings` and the MCP settings and roles say who may publish small changes; `bridge branch status` and `bridge_branch_status` say "Published by <name> without review (Tier 1)."

### Patch Changes

- 009a5ee: Compare with code: popup examples with HTML elements (a list, a paragraph) are compared instead of skipped, a tooltip is rendered with its trigger instead of failing, a size difference is said first ("height 89 in Figma vs 48 in code") instead of a small pixel score, and the list says "Show all 57 compared" next to a headline that counts every set.
- 579f4a2: The before and after section of a `figma-fixes.json` pull request no longer contradicts itself. When no difference
  could be measured because the differing variants are not in the rebuilt set, the values referee says so ("The values
  referee compared nothing: none of the 32 differing variants is in the rebuilt set") instead of reading as a
  measurement ("0 of 0 differences resolved"), and the normal summary counts those variants too. The layout caveat now
  comes before the evidence it explains, a variant the rebuilt set does not have reads "not in the rebuilt set" rather
  than "gone", and above eight variants the body leads with one line per kind of difference and its values, then folds
  the variant by variant list into a `<details>`.
- 00cdee5: Fix with Claude: a component's gap case no longer hangs. A measure could give a nested `.root` element the root's own id, which made its part tree loop, and pairing parts then never ended; the measure now reserves `root`, pairing stops at a part met twice, and a gap case builds only its own component's set. Files over 1 MB (component-specs.json) are read with the raw media type, so Figma coverage finds them.
- 8cef447: The plugin speaks in designer words, with one count per list:
  - **After connecting:** the plugin lands on Pull, "Get your design system", says "Connected to …" once, and offers "Check for updates".
  - **Components:** one count and one noun ("62 components to add") instead of "47 of 47 … (62 sets …)". Up-to-date lists become counts. Drafted-with-Claude, layout helpers and motion notes go under For developers.
  - **Pull results:** "1 edited token" instead of "1 edited", and one sentence for what a pull built ("1 component updated on the Components page."). The theme layout moves under For developers.
  - **Edits already sent:** Pull lists them as "in review", with "See it in Studio", not "Send them from Push".
  - **Connecting from Pull or Push:** the action reads "Connect your design system" instead of "Open Settings".
  - **Push:** the steps no longer say "synced variables", "build request" or "Token values ship".
  - **Core:** a warning that existed before the edit reads "Already in the design system" instead of "Already on main". Icon library parts ("lucide") read "icon" in gap sentences.

## 0.19.0

### Minor Changes

- 4fb54b4: Marking a Figma change drafted (`bridge_mark_figma_change_drafted`, `bridge figma drafted <n>`) now also marks its pull request ready for review, in the same step, through GitHub's `markPullRequestReadyForReview` mutation. Ready goes first: when GitHub refuses it, the labels and the description stay as they were and the error says why, so a branch is never labelled `drafted-by-claude` while reviewers cannot see it. `markFigmaChangeDraftedOnGitHub` returns `ready: true`.

  The Bridge MCP server (and `bridge mcp`) uses your gh sign-in (`gh auth token`) when `GITHUB_TOKEN` and `BRIDGE_GITHUB_TOKEN` are not set, and says once at start where its token came from, or that it runs without one (read-only, 60 requests an hour) and how to fix that. It never logs the token. The other CLI commands keep their rule: writes use your gh sign-in only with `--use-gh-auth`.

- 7c52639: `remoteRenames(base, head)`: tokens the code renamed between two commits (removed and added with the same type, tier and values and a similar path, never guessed on a tie). The Figma plugin uses it so a pull renames the variable in place instead of orphaning it and adding a new one: everything bound to it keeps its binding.
- 8403d3d: Who asked for a change: `requesterOf(body)` reads the line Bridge writes in a pull request or suggestion body ("Requested by Ann Leroy (@annleroy).", "Requested by Ann Leroy.", "Requested by @ann.", and the request footer "Requested from Figma by @ann with Bridge."), and `requesterLine()` writes it. Studio shows that person, not the account or agent that opened the branch. New optional config key `demo: { "viewer": "Dana", "role": "DS lead" }`: a public demo's persona, honoured by Bridge's own demo repositories only, for visitors without an account. It's in the schema, validated, and carried in `SiteRepo.demo`.
- fe5fb1b: Figma plugin Settings: a token that can read the repository but not write to it is refused before it is saved, naming what is missing ("Contents", "Pull requests", "Issues"), instead of showing "Connected" and failing at Send. New GitHubClient.writeAccess(base) probes the three permissions with requests that are invalid on purpose, so nothing is written.
- 625a692: Try it works without online previews: when nothing reported a deployment for an exploration (explorations and library branches are not deployed on Vercel any more), the Figma plugin says a developer opens it on their computer, the share message gives `git fetch origin && git switch <branch>`, polling stops, and `bridge branch try` / bridge_try_branch return the same local command (`local`). New core helpers: noOnlinePreview, localTryCommand.

### Patch Changes

- fbf7f55: A deleted account's changes keep a neutral author: `FORMER_MEMBER` ("A former member") and `requesterFirstName`, which
  keeps that author whole in sentences. `requesterOf` reads "Requested by A former member through Bridge.".
- 7eb8a27: A hosting platform that refused to run (Vercel "Deployment rate limited") no longer counts as a failed check, and a failed check no longer stops "where is my push" polling: a re-run can still ship it.
- 401cdcc: Measured only: a frame bigger than its children plus its padding on an axis its parent does not size keeps its measured
  size (a 48 px button around a 16 px icon, a 24 px label row around a 16 px label), read from the boxes when the measure
  did not mark it as sized.
- efb3281: The build request issue labels its images "In code now" and "In Figma" (BUILD_IMAGE_LABEL), like Studio.
- 3364ee9: Build requests in the CLI and the MCP server: `bridge build list|show` and `bridge_list_build_requests` /
  `bridge_get_build_request` (read only, status read from GitHub, the brief for Claude). Branch status, merge and
  "what needs me" read a push from the Figma plugin with the shared gate (design approved, token values ship by
  themselves). Core: a spec-only or Claude draft branch from Figma never ships by itself.
- d89f7b7: Pushes from Figma and build requests: a push from the Figma plugin counts as design-approved in the shared gate
  (`figmaPushOf`, `withFigmaPushApprovals`, `branchVerdict` `figmaPush` and `autoShip`), token values ship after the
  checks, renames and removals wait for a developer, structure changes become build requests
  (`composeBuildRequestIssue`, `createBuildRequestOnGitHub`) whose status is read from GitHub (`buildRequestStatus`,
  `listBuildRequestsOnGitHub`). Publish result and `libraryArrival` for the plugin. See docs/BUILD-REQUESTS.md.
- 57b8d89: Component specs treat a button or a select (including the Base UI part that renders one, read from Base UI's docs) as border-box: NumberField steppers are their height token wide again.
- afd9ba2: Measure: a custom property holding color channels (`--primary: 212 100% 47%`) that every use wraps in one color function
  (`hsl(var(--primary))`, through aliases too) is harvested as that color, so it becomes a color variable instead of being
  skipped. A field declared as that function around the variable alone is tied to it, so it binds in Figma.
- 4fd6e15: CLI errors say how to recover: `propose` names `--file` and `--mode` (not the MCP fields) for a token defined in several files, and explains a missing or non-array `--edits` file instead of a JavaScript error; `audit --baseline` with a file that is not an audit report no longer prints "undefined"; `snapshot --activity` without a token says how to read GitHub without a stray write hint; `request show` on another issue points to `bridge request list`; bad JSON for `docs save` and `figma push` says what to pass.
- e52619d: The bridge CLI never writes on GitHub with a credential you did not pass: writes (suggestions, requests, reviews, comments, merges, branches) use `GITHUB_TOKEN`, `BRIDGE_GITHUB_TOKEN` or `--token`, or your gh sign-in only with `--use-gh-auth`. Reads may still use the gh sign-in, say so in one line on stderr, and cannot write. `bridge branch merge --dry-run` needs no write token. A merge the gate blocks exits 1, not 2, and `bridge --help` documents the exit codes. CLI messages name commands and flags (`bridge branch merge 12 --override "why"`), never MCP tools or JSON fields, the rate-limit message says how to pass a token in the CLI, and suggestions, pull requests and docs proposals made from the CLI say "the bridge CLI" and "source: cli". `bridge_get_config`, the server instructions and its start line say what Bridge may write in the same sentence. `bridge docs help`, `bridge brand help` and `-v`/`-h` work, `bridge tokens` says when it shows only the best matches (`--limit`), `bridge diff` explains a bad git ref, `bridge coverage` counts the 53 components once and says what the other numbers are, `bridge audit --fix` keeps what the audit keeps (ignore comments, `--allowlist`, `audit.exclude`) and takes `--json`, and a Figma change drafted by Claude no longer says so twice.
- 48ee872: Designer words: build request images read "In code now" and "In Figma" in Studio (new `BUILD_IMAGE_LABEL`), and exploration name problems and use case hints no longer say branch or main.
- af6e3e9: Designer screens drop git words: a component waiting for code reads "A developer builds it with Claude from its spec", without "the library branch".
- ea27992: Designer words: screens a designer reads say "change" and "library", never branch, merge or main. The share and
  product-branch sentences of `@bridge-ds/core` (`shareDescription`, `SHARE_EXPLAIN`, `libraryPreviewState`,
  `productBranchSentence`) now read "This change was added to the library", "Your feature uses a preview of the library
  change". The MCP fallback share sentence follows. ChoiceCard docs examples say "your change". Gate reasons, status
  labels and developer texts (CLI, MCP, GitHub) keep their git words.
- e65d3ee: A drafted summary that names a token (tag.bg) keeps its sentences: a dot inside a token path is not a sentence end.
- e806350: Tokens from a measure: a variable that resolves to nothing (a font family that names itself) is skipped instead of
  written as an empty `palette.string.` token, so what uses it keeps its computed value. Figma plugin: a system font
  family (system-ui, ui-sans-serif, ui-monospace) draws with the platform font Figma lists before falling back to Inter.
- f5cfbf0: Figma plugin, Try in an exploration: an exact token change on a component is committed on the exploration branch (same contrast gate as for review) instead of becoming a request, so the exploration shows it. The result says what is in it and what waits for code, and Try it points to the Studio screenshots when nothing is deployed.
- 02d38ad: Fidelity: popups drawn open in Figma (dialogs, drawers, popovers, selects, comboboxes, tooltips) get a code image of the popup rendered open, instead of being skipped. A popup drawn from no code example (the menu) and the Card media placeholder stay skipped, each with why.
- 8919183: Figma plugin: a component updated in place no longer turns black. Bound paints are written with the color they resolve to, not a black base Figma kept showing (on the canvas and in exports) until something refreshed it.
- 7b9e2c2: The change line of a token rebinding from Figma names the variants the short way ("in primary sm", not "in Size=sm, Variant=primary"), like its value chips.
- afa59e8: Foundation of the Claude correction loop for the Figma pull. Core: `buildGapCase` (one component's gap case: the
  variants the story shots say differ, each with its story, args, state, shot and the differences in plain words and
  deltas, like "Height 72 in Figma vs 84 in code: 8 px missing below the label") and `figma-fixes.json` (`parseFigmaFixes`,
  `validateFigmaFixes`, `applyFixes`): the team's corrections of four kinds (part patch, axis mapping, story pointer,
  honest status), laid on every fresh measure with a provenance record per fix. CLI: `bridge fixes check`,
  `bridge fixes apply --in --out` and `bridge gap <component>`. See docs/FIGMA-FIXES.md.
- eb4ace6: Figma plugin: a new file points at no design system, the first run asks which one; the open change a push adds to is kept per Figma user, so two designers in one file never share a branch; after a send, "See it in Studio" opens the change for the team, GitHub one step behind. One verb for sending ("Send for review", "Send suggestion"). A component that needs code now says a developer builds it with Claude, with a message to copy for them (the waiting-for-claude label stays). Draft with Claude on your plan: the setup for Claude Code and the Claude app is shown and copied with the saved token, and a token that cannot write contents is named before any wait. Designer words in Pull and Push (no commits, repository slugs or issue numbers; details under "For developers"), friendly errors with details folded, one name for Claude and for Bridge, arrow keys in menus. Core: the Figma push status and route copy say "Waiting for a developer" and "Drafted with Claude".
- 0ed940f: Token pull requests pushed from Figma say "From Figma: design-approved, ships once the checks pass" (or "waits for a
  developer OK" for a rename or removal) instead of the approvals line (`figmaPushTierLabel`, `fromFigma` on
  `composePrBody`, `composeProposalBody` and `planTokenProposal`). Build requests: one item per change when the
  library branch from Figma closes the issue; assignees on that branch count, the sender never reads as the builder.
- 9be32eb: Figma references: one variant that fails to render no longer skips every variant after it. The reference story catches a render error and shows it as that variant's skip reason, and the capture reloads the story if Storybook still lands on its error screen. Parts of a compound component (AccordionItem, Radio, menu items, SidebarNavItem, TableEmpty) render inside their parent (`within` in the render plan) and are captured alone, at the width Figma draws them. Menu parts render the part itself instead of the Menu root, and a capture that comes out invisible is skipped with a reason instead of saved as a blank image.
- e075f3b: Figma plugin: "Request a component change" says before sending when the request goes to the exploration picked for the push (it is built there, not sent for review), and how to send it for review instead.
- fe906a6: Figma plugin: updating a component no longer adds its icon swap property again (Badge showed Icon2 and Icon3 after Update all). The swap Figma renamed next to its BOOLEAN (Icon -> Icon2) is found, unused duplicates from earlier updates are removed, and the property is read under the code's name so Review does not report a prop change.
- a83618b: Figma plugin, Try it: a preview that failed before it had a link (a Vercel build rate limit) now says "This preview did not build" instead of waiting forever, and polling stops. A push to a new exploration with only component changes no longer says "The exploration already had these variable edits".
- 7f6064b: Figma plugin Pull: on a first pull, components are included by default. The choice moves to the footer, next to Apply to Figma ("Include components (62)"), with one count on the screen ("602 variables and 62 components").
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
- 4f3102a: Gap case: when the measured values agree but more than 5% of a variant's pixels differ, it says "Bridge doesn't
  measure what differs here yet" with the share, instead of inviting a comparison by eye: neither Claude nor the designer
  is told it matches.
- e9fd0c7: Gap case and values referee: a wrapper the pull adds around one part (`<part>-wrapper`, for a margin Figma's gap can't
  give) is not a difference, its part stands for it. An icon the build draws as a vector pairs with the measured icon, so
  it is no longer counted as missing and extra at once.
- 0b3aa07: One merge verdict everywhere: `branchVerdict` and `approvedSuggestionOnGitHub` in core compose the review rules once, and Studio, the MCP tools (`bridge_branch_status`, `bridge_merge_branch`, `bridge_what_needs_me`, `bridge_get_settings`) and the CLI (`bridge branch status|merge|list`, `bridge settings`) read them. Tier 1 needs one owner approval, the owner override is for owners only and always needs a reason (20 characters by default), and a pull request that applies an approved suggestion with `Closes #n` carries its approvals.
- dd97e25: Measure: a grid with two or more columns and two or more rows, filled row by row, is a row that wraps at its measured
  width, its column gap as the item spacing and its row gap between lines, each item at its track's width. A radio group
  of radio and label columns was drawn as one column twice as tall.
- 9d0dc16: History names who asked for a change (the requester line Bridge records), not the account that opened it.
- a9cbbab: The team snapshot now carries releases, packages and motion, so a team's hosted Library can show its Changelog, Install and motion sections. `bridge snapshot` reads each workspace package and its CHANGELOG.md, the pending changesets and the release dates (tags, or git history on a full clone), and core adds the motion section of every component from its specs. Schema version stays 1: older snapshots still read. Core also exports the Changelog model (collectReleases, groupReleases) and motionDocs, moved from the docs site.

  For you: nothing to change. Add `fetch-depth: 0` to the checkout in bridge-data.yml if you want release dates without release tags.

- 1635400: A branch updated after a changes request waits on the reviewer who asked: core `lookAgainReviewers`, `Review.commitId` from `listReviews`; Studio says "Your turn: look again" to that reviewer and lists it on their home, the author no longer reads "Your turn: address changes"; `bridge_branch_status` gives `approvals.lookAgain` and the next step, `bridge_what_needs_me` says "Look again: updated after your changes".
- 57f26bf: A branch updated after every changes request reads "Updated, look again" (core reviewStatusLabel, branchVerdict label) in Studio, the MCP server and the CLI, never a stale "Changes requested". The merge gate is unchanged. Studio's approval checklist says who looks again instead of "Failed".
- 30e8c14: GitHubClient.hasBranch: asks whether a branch exists without a 404. Studio reads a team's snapshot only when its bridge-data branch exists, and skips join requests without a Bridge account, so neither leaves an error in the console. Edit mode's Do and Don't titles are h3, as on the read page.
- 4c8a5dc: Measured layout shapes the Figma pull codes against: a decoration rebuilt in auto layout is aligned through its parent's layout (`MeasuredLayout.align[childId] = { primary, counter }`, Figma's terms relative to the parent's direction), with the parent's padding in `values`; the part-level `align` is gone. A full radius is 999 px in `values`, unless it is bound to a token.
- 43b6e31: `withRepoTokenPaths` binds a measured field whose declaration is a variable alone (`var(--cds-button-primary, #0f62fe)`)
  to the written token of its chain, so a design system measured without token files gets its colors and type bound to
  variables. A calc() of a token, or a value that only matches one, stays a literal. Figma plugin: a measured component
  whose root is a text (a link) is a frame that hugs that text.
- d37207a: Measured parts carry what auto layout needs, in general CSS terms: `margins` per part, a `wrap: { padding }` for a child whose margin makes an uneven gap (uniform gaps and edge margins already become the parent's gap and padding), `overlay: true` for out-of-flow parts that overlap their siblings or leave their parent (the root's size never includes them), `align: { x, y }` for a lone out-of-flow decoration rebuilt in auto layout (the parent aligns it start, center or end and its padding carries the offset, instead of a pin), and `fullRadius` when a radius is half the shorter side or more (a percentage, or a 9999px pill).
- db8e449: Measure what Carbon's form fields and controls really lay out. Child margins become auto layout: a first or last child's margin becomes padding, the space between children becomes the gap when uniform, else the smallest gap plus `spacers` per child. Widths and heights the CSS sets are listed in `sized` (kept fixed, not hugged). A percentage radius becomes px from the box (50% of a knob is half its side). An inline element holding blocks, and a row whose children sit stacked, take their direction from their boxes (a wrapping row stays a row). Closed or hidden content (opacity 0, hidden, inert, clipped away, an aria-hidden popover, an empty zero-size shell) is not a part. `--variants` runs once a component's stories are measured and starts each combination from the closest story; it probes an enum by rendering its default and one other value through args and comparing them with popovers and tooltips left out, so an arg that only opens, aligns or moves a popup is not an axis.
- 4dc69ae: Measure args reach the story: when Storybook drops URL args it cannot validate (a story that declares no args, like Carbon's Button), the measure sends them the way the Controls panel does and waits for the re-render. `--variants` probes a boolean with both values, compared with each other, so a story that renders the non-default value (a toggle shown on) keeps its axis.
- e4c34ee: Measure controls drawn in CSS and keep long runs cheap and safe. The measure reads `::before` / `::after` that draw a box as parts (box, fill, border, radius, pin or cover, with their own declarations in the cascade), gives a grid a direction (flow, tracks, or where its children sit), writes inline SVG with every shape's fill and stroke and currentColor resolved (`vectors`, with strokes), keeps BEM element classes (`cds--toggle__switch`) whole, lays out a root that fills its container at 400 px (`fillWidth`) so the measure and the shot agree, flags gallery stories and orders single-instance stories first, and waits for DOM ready plus a short settle with animations paused. `--variants` varies only the args a story declares; without a Figma set it probes each one once and leaves out args with no visual effect (`variantPlan`), with at most 48 renders per component (each value, then pairs). The CLI stays on the story (links do not navigate), opens a fresh tab per component and after any failure, reads `--tokens` first, writes after each component with `--resume`, and runs `--check` only against a Figma side that belongs to the Storybook.
- ce6a8c7: Measure as the referee: `bridge specs --measure` now opens popups (`--open`), measures parts inside a parent or portal (`--within`), reads tokens defined on provider elements, splits stories that render many instances, records the props each story rendered with, measures every variant (`--variants`, `--states`, hover and focus forced in Chrome, disabled as an arg) and gives each component a status (`--check`: Matches, Differs, or Can't check yet with the reason). Core pairs text layers by their words, and exports the measured-specs shapes, `parseMeasuredSpecsFile`, `pairParts`, `compareSpecToMeasured`, `mapPropsToFigma`, `planVariantMeasures` and `componentStatus` from the browser-safe entry.
- fd0191c: `bridge specs --measure --tokens` harvests the library's variables: every CSS custom property its stylesheets define (root, provider and theme selectors), the declaration that applies where the story sits, resolved (colors as rgb, lengths in px), per theme, brand or density mode (Storybook globals, or a theme attribute such as `data-carbon-theme`), in two tiers (literal: primitive, `var()`: semantic, and semantic by value when a compiled theme writes a primitive's value per mode), with Figma variable paths and the properties the measured stories use. Written as `tokens` in measured-specs.json (`MeasuredTokens` in core).

  `--shots` writes a PNG of each measured root at 2x (one per distinct render) to `measured-shots/` with a manifest keyed by Figma variant, and records `shot` on each story; the measured root part carries `fill` when it spans its container. `@bridge-ds/visual`'s `openMeasurePage` takes a `scale`.

- 4d61987: Measure triage on the full library. The measure: forced states apply to the component and everything in it (a field's Hover is its control's hover), logical properties (`padding-block-start`) are read in the cascade, a declaration whose variable does not give the computed value is not taken as the token, visually hidden text is not a layer, and a component that draws nothing itself is not split into instances. Pairing reads every class of a part, prefers the part's own parent, keeps classless decorations and same-word texts in another role unpaired. The status compares a variant with the closest story that renders its props, names an arg a story refuses, checks sets drawn under a folder (Progress/Linear) and names the open popup Figma draws. `--variants` measures every story as written; parts with no story of their own (MenuItem, MenuSubmenu, AccordionItem) are measured inside their component as `<title>/<Set>` entries, and every measured component, popups and parts included, carries the token values its Figma sets name (`resolved`).
- 1c4e347: Measure: utility classes (Tailwind's `px-4`, `hover:bg-x`, `w-[42px]`, CSS-in-JS hashes like `css-1x2y3z`) never name
  or pair a part. A part named only by utilities takes its tag, numbered in order, so the same structure gives the same
  ids in every variant. BEM and semantic classes still name parts: Carbon's ids do not change.
- 44f49ff: `bridge specs --measure`: the set's root class is read from the spec source correctly (it read `module`), so items inside their group are measured alone; a forced Pressed state is also a hover, as a real press is; `--check` gives one status per component name, its own stories and its "Figma variants" stories together.
- 07380d7: `bridge specs --measure` measures the item, not its group: when a story renders a set's component inside its parent (a radio in its fieldset, a menu item in its open menu), the measure reads the element with the Figma set's root class, opening the popup if needed. A Figma `Checked=mixed` value maps to the `indeterminate` prop (`mapPropsToFigma` `also`, `variantCombosFromMapping`), so `--variants` measures it and `--check` compares it.
- b822435: A merged or closed branch reads as done everywhere: the merge gate gives its state as the one reason and lists no missing approval; `bridge branch status` prints "Merged." and who approved, without approvals, tests or blockers.
- c0731d6: The Figma plugin draws measured-only sets with core's `specsFromMeasure` (one copy for the plugin, the CLI and the MCP
  server). Three general rules from the Carbon v3 run: a frame that paints nothing and holds only overlays (a popover's
  container) is out of the flow; a frame that aligns its lone child (a switch and its knob) keeps its measured size; and
  `flex-grow` only fills space its parent has (a growing row in a column that hugs stays one line tall).

  Figma plugin: "Fix with Claude" on a set that differs writes the Check fidelity run (verdicts and the layers read back)
  to figma-fidelity.json on the requests branch, then gives the phrase for the designer's Claude ("Fix TextInput in
  Figma with Bridge") and the CLI line for teams with an API key.

- d54ace8: Fix with Claude: a part fix that sizes, places or lays out a part (width, height, direction, align, overlay) opens for
  review even when the values referee says same. The referee can't judge layout; the pull request body says so and that
  Check fidelity decides. A fix that goes the wrong way is still refused.
- d199eb5: Measured only, for any design system pulled from its Storybook: a part the measure gives as SVG (`MeasuredSpec.vectors`,
  an icon, a check mark) is drawn as vectors instead of an empty frame, and a positioned part (a pseudo-element knob)
  follows its offset in each variant. The first pull names the collections that get variables ("Primitives and
  Semantic"), not a fixed list of six.
- 96acdf2: A component change from Figma with a value set by hand says the value and the variables that hold it: `Rebind.raw` and `PushIssue.raw` (optional). In the plugin, Push shows a swatch and binds the variable in one click, and a token that cannot write reads "Read only" in Settings.
- d157472: A component change from Figma that adds or removes whole variants, every value staying on its axis, reads as such: "Remove the info solid md variant", "New variant info lg".
- eb4d6ce: Figma plugin: a request sent from the form goes for review by default. Sending it into an exploration is an explicit choice in the form ("Where it goes"); the destination of the last push no longer carries over.
- f198e92: `requesterOf` reads the line Bridge's server writes for an email member ("Requested by Ann Leroy (ann@acme.com) through Bridge."), so the person, not the Bridge app, shows as who asked.
- 2b01116: A branch opened from Figma and labelled drafted-by-claude reads as ready for review even while GitHub still calls it a draft (core isDraft, claudeStage), in Studio, the MCP server and the CLI alike; merging it marks it ready first. Studio says where Claude stands: a developer builds it before the draft, the owners review it after.
- 27dff7f: Measure: a part's box-shadow becomes a `shadow` field (drop and inner shadows, transparent rings left out), drawn as
  Figma effects by the plugin; and a part a transform moves or scales (a progress indicator slid left with translateX)
  sits where and as big as it is drawn, out of the flow, instead of where the layout would put it.
- c46846d: Figma plugin: the BOOLEAN of a swappable part is named "Show icon" ("Show icon start"), as Figma kits do, so the swap keeps the plain name "Icon" instead of the "Icon2" Figma gave it. Files built with the old names are renamed in place on the next update (same ids, instances keep their overrides). The hint for an added layer an optional part already draws reads "Icon end already does this: turn on Show icon end".
- efa01d6: Component specs count height and width as the content box (a bordered table cell is its height plus its border), the Figma build draws an empty sized slot at its padding instead of 100px, and stories reach every Figma variant: a disabled control on IconButton, Input, Select, Combobox and Textarea, and Figma variant stories for AccordionItem, MenuItem, MenuCheckboxItem, MenuSubmenu and TableEmpty.
- d8848ff: Component specs for Figma: a content-box min-height or min-width counts its padding and border, as CSS draws it (checkbox, radio, switch, link rows were 3px short in Figma).
- 7f9930c: Component specs for Figma: a defaultValue list opens or checks its items, as Base UI does (an accordion draws only its open panels, a checkbox group checks the boxes it lists).
- 9ec466a: Component specs match the code in two places the generator misread: menu parts drawn alone take the popup's snug line height, and the page header title takes its desktop (h1) size, as width media queries are now read at the 1200 px the code images use.
- d8c7494: Component specs for Figma: inline custom properties set under a computed key or through a Base UI render element reach the CSS, a number held by a custom property and 1lh are read in calc() (a Textarea of 3 rows is 81px in Figma, as in code).
- fb3815b: Measure: colors a page keeps in oklch(), oklab(), lab(), lch() or color() (Tailwind v4 themes, color-mix results) are
  turned into sRGB rgb()/rgba() in the measure and the token harvest, in values, shadows and SVG markup, so they become
  color variables and Figma paints instead of being skipped.
- 306774c: Measured only: a variant's rest and its states come from one story where they can, the one most of its states were
  measured on. Kbd was drawn at rest from a story that shows it in an input group and hovered from one that shows it
  alone; a hover from another story is no longer that variant's hover. A state only another story shows (a Disabled
  story) still comes from it.
- 5309e2e: Component scan: Storybook story ids keep a camel-case title word whole (Forms/ChoiceCard is forms-choicecard), so Library previews of multi-word components open the right story.
- 4aa0cd7: Storybook measure: `bridge specs --measure --storybook <url>` opens each story in Chrome and records what it really draws (layers, boxes, auto layout, fills, borders, radii, text styles, and the token behind each value), in the component specs shape. Works on any React Storybook, whatever the styling. Core adds `measureStory`, `measuredToSpec` and `compareSpecToMeasured` under `@bridge-ds/core/node`; visual exports `openMeasurePage`. The Figma pull does not read it yet.
- 80ee954: Token value changes ship by themselves once the design approval is in (decision TV-1). `branchVerdict` takes
  `autoMerge` (GitHub `auto_merge` set): a design-approved token value change whose merge Bridge armed reads `autoShip`,
  "On its way to the library". `GitHubClient.getPullRequest` returns `autoMerge`, and `bridge_branch_status` says Bridge
  merges it once the automatic checks pass.
- df92fcf: Teams get a display name: `name` in bridge.config.json (1 to 60 characters), kept by loadConfig and siteRepoFromConfig.
- d8e5e84: Token values follow the Figma rule wherever they are made (decision TV-1): a pull request or a suggestion that only
  changes token values (values changed or tokens added, nothing renamed or removed, no code) needs the design approval
  only. Once it is in, the tech approval counts as given and the change ships after the automatic checks
  (`isTokenValueChange`, `mayBeTokenValueChange`, `withTokenValueApprovals`, `branchVerdict` `tokenValues`,
  `suggestionIsTokenValues`, `summarizeSuggestionApprovals` `valuesOnly`, `requiredApprovals(tier, valuesOnly)`).
  Renames and removals still need a developer OK. Studio, the MCP server and the CLI read the same verdict
  (`bridge_branch_status` says "Design approval (token values ship after the checks)").
- 2d89e58: A token harvest from a measure (`tokens` of measured-specs.json) becomes a two-tier DTCG repo Bridge reads (tokenRepoFromMeasure), and the measured values point at it (withRepoTokenPaths). The Figma plugin compares measured-only sets with the screenshots of the stories they were built from.

## 0.18.0

### Minor Changes

- 037b56b: Repo activity (`activity.json`): `collectActivity` reads a team's open branches and their pages, open suggestions with their parsed payload, component requests, recent merges and token history from GitHub, and records the GitHub reads a signed-out Studio visitor makes, trimmed (`trimGitHub`, `activityShaper`). `activityAnswer` serves them back by path, `parseActivity` validates the file, `fitActivity` keeps it under 3 MB. While the default branch has not moved, the token history and every untouched branch page are kept from the last activity. History read without a token now takes file bodies from the raw host, which costs no API request.

## 0.17.0

### Minor Changes

- 5ec4a47: One status per branch, everywhere. `reviewStatusKind` is the single derivation for the Branches list, the branch page, the home cards, `bridge_what_needs_me`, `bridge_branch_status` and `bridge branch status`. A repo with no automated checks is a calm state of its own ("No automated checks", `CI_STATE_LABEL`) and the status comes from the approvals, as for any branch. While GitHub computes whether a branch merges cleanly, a missing approval still shows; "Checking for conflicts" only holds back "Ready to merge". The words live in core (`REVIEW_STATUS_LABEL`), and the branch page header now shows the same pill as its row ("Owner override needed", "Design owner to approve") instead of a plain "In review".
- 5ec4a47: Suggestions, visual checks and titles. A suggestion whose change no longer applies to main (main moved and the value it changes is not the one it was suggested from) reads Outdated in Studio, `bridge_list_suggestions` and `bridge_get_suggestion`, through one core rule (`suggestionStalenessOnGitHub`, over `planSuggestionApply`). An applied and closed suggestion keeps only its final label ("suggestion: applied"; "suggestion: declined" when declined): `bridge_apply_suggestion`, `bridge_link_suggestion`, `bridge apply` and a merge from Bridge (`markSuggestionsAppliedOnGitHub`) remove "needs review" and "applying". The visual-check label and "the visual comparison runs again" are offered only when the repo has the visual impact workflow (`hasVisualWorkflow`, `visualOffer`); otherwise the branch page shows a quiet "Set up visual checks" link. Request and suggestion titles are never prefixed twice ("Select: select: ...") and keep component names as written ("EmptyState"), through `subjectTitle`.

## 0.16.0

### Minor Changes

- da3e4ea: Team pages: History, component change requests and "Start an exploration" now work for the team in the address
  instead of the demo. History reads the team's merged token changes from GitHub (signed in, the 20 latest, with each
  change's token diff read when it opens), and the token drawer's "See the whole history" lands there. A request opens in
  place from the team's request issues. An exploration starts against the team's repository: in direct mode the first
  write asks for Bridge Direct's OK; in suggest mode Studio says why it does not start one, since an exploration is a
  branch.

  Core: the repo model reads the global stylesheets a library ships (new optional `components.styles` globs in
  `bridge.config.json`, default every .css file under `styles/` and `theme/` next to the components folder) and counts
  their `var(--token)` reads as usage, so team Quality and the team token explorer no longer flag tokens only base styles
  read as unused. Snapshots record the globs they read; a snapshot from before reads those files from the repository.

## 0.15.0

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

## 0.14.0

### Minor Changes

- 1a560aa: New `bridge snapshot`: writes the repo model of a checkout for hosted Bridge (`snapshot.json`: the token, contrast and
  component files the model reads, Figma coverage without the 1 MB specs, contrast results, counts) plus
  `audits/<id>.json` (`--audit <folder>[=label]` runs `bridge audit`, `--audit-report` carries existing reports). Core
  gets the snapshot schema: `parseSnapshot`, `buildSnapshot`, `snapshotSource` (a `RepoSource`, so `loadRepoModel`
  reads a snapshot like a repository), `recordingSource`, `snapshotIsFresh`. The `bridge-data` workflow publishes it
  to the orphan `bridge-data` branch; `templates/bridge-data.yml` is the copy for other teams (docs/HOSTED.md).
- a797699: GitHub client: conditional requests (ETag and If-None-Match, sent only with a token since only then is a 304 free) with
  a shared in-memory store or a Web Storage store, `rateLimit` from the response headers, optional stale answers when the
  hourly limit is used up, and no more retries of an exhausted hourly limit. New `getBlobRaw`, `getRawText`,
  `readRawFile`, the App installation endpoints (`listUserInstallations`, `listInstallationRepos`, `findInstallation`,
  `installationFor`), `gitHubSource` (one tree call, bodies by blob sha) and the repo access states
  (`accessState`, `resolveRepoAccess`).
- 4fb3153: Add the repo model: `RepoSource` (`list`, `text`) with `memorySource` and, in `@bridge-ds/core/node`, `fsSource` over a
  local checkout, and `loadRepoModel(source)`, which parses `bridge.config.json` once and computes the token rows,
  contrast results, component scan (props, CSS tokens, stories, docs.json) and Figma coverage from it. The parsers move
  from the docs site into core (`buildTokenRows`, `evaluateContrastPairs`, `scanComponents` and friends), browser-safe,
  with every path taken from the config (defaults: the paths this repo used before). New optional config key
  `tokens.usage` (token group notes, relative to `tokens.root`). `gitHubSource` now implements
  the shared `RepoSource` interface and lists paths sorted; `repo-source-github` and `repo-access` are exported from
  the main entry.
- 0986099: Show how far Bridge has gone reading a design system, and open Branches for teams.

  - Core: `loadRepoModel` takes `onProgress` and reads in three phases (tokens, components, docs) with an exact file
    total from the first report; `readRepoTexts` takes an `onProgress(done, total)` callback; `gitHubSource` takes
    `onProgress` (the tree once read, then each body and whether it came from the blob cache).
  - Team pages (Home, Components, Quality, Tokens) replace the loading skeleton with a calm progress view: "Finding your
    design system", then "Using the saved snapshot" or "Reading N files" with a bar filled from real file counts
    ("Reading tokens 12 of 48", then components, then docs), then "Ready". Unknown totals stay indeterminate, a cache
    hit shows nothing. The Storybook quick start shows "Reading your Storybook" and the component count it found.
  - Team Branches lists the team's open branches (the same list as the demo) and its open suggestions, each reviewed
    in place. Review and New brand keep one calm line and "See it on the demo"; "View on GitHub" is gone.

### Patch Changes

- 440f717: Team pages always sign in with the read-only Bridge app. When a team in direct mode saves code for the first time
  (start a branch, save to it, ship, review), Studio explains why in "Allow Bridge to save to branches" and asks for
  Bridge Direct's OK once, then lands back on the same page. Its token lives in its own slot next to Bridge's;
  suggestions and comments keep going out with Bridge. When Bridge Direct is not on the team's repository, admins get
  "Install Bridge Direct" and everyone else "Ask your lead". New optional `GITHUB_APP_DIRECT_SLUG`. The self-hosted
  Studio is unchanged. Core: a `fetch` that throws its own `GitHubError` keeps it instead of turning into "Could not
  reach GitHub".
- 9d40c77: Harden every HTML sink against repo and GitHub content, and ship a report-only Content-Security-Policy. Markdown links allow only http, https, mailto and relative targets, JSON embedded in pages can no longer close its script element, PR, preview, Figma, Jira and image URLs go through one URL allow-list, token values in inline styles drop `url()` and declaration breakouts, and docs.json example props lose raw HTML, handlers and unsafe URLs. A test lists every file that writes HTML with what makes it safe. `tryInProductUrl` returns an empty string for a preview that is not http or https. The docs site sends `Content-Security-Policy-Report-Only` (inline scripts allowed by hash, checked at build time), `X-Content-Type-Options` and `Referrer-Policy`, and collects violations on `/api/csp-report`.
- 662fb55: The docs site builds from the repo model: `loadRepoModel(fsSource(root))` runs once per build (`lib/model.ts`) and
  the token, component, contrast, explorer, history, Figma coverage, config and sign-in libs read it instead of their
  own parsers and hardcoded paths. `bridge.config.json` is parsed once; the site's settings come from core
  `siteRepoFromConfig`. A model problem (invalid config, unresolved alias, contrast pair on a missing token, docs.json
  that does not parse) fails the build, as before. Core fix: a component's description is the JSDoc right before the
  component, no longer everything from the first JSDoc of the file (a documented props interface leaked into it). The
  `href` option of `loadRepoModel` also receives the token path.

## 0.13.0

### Minor Changes

- b6f1e68: Opt-in `governance.soloOwnerCanApproveBoth` for a design system run by one person. When it is true and the owners
  resolve to exactly one person holding both roles, that person's approval counts as the design and the tech approval,
  so Tier 2 and Tier 3 pull requests and suggestions can reach approved. Default false: one person still never covers
  both approvals alone. The author of a change still never approves it. Core adds `soloApprover`, `soloOwnerOf`,
  `soloOwnerSentence` and an optional rules argument to `summarizeApprovals`; `summarizeSuggestionApprovals` reads the
  flag from its governance. Studio Settings shows an "Only owner" line when the rule is active, the suggestion and pull
  request reviews say "As the only owner, your approval covers design and code." with one Approve, and
  `bridge settings`, `bridge branch status`, `bridge suggestions show` and the MCP tools say the same.

## 0.12.0

### Minor Changes

- 87cfb75: Core reads a Storybook without the repo. `fetchStorybookIndex` tries `index.json` (Storybook 7 and later, v4 and v5)
  then `stories.json` (v3), skips HTML fallbacks, and reports why it failed (`not-found`, `not-json`, `private`, `empty`,
  `http`, `network`). `parseStorybookIndex` groups entries into components by title and keeps test entries out of the
  story list. `normalizeStorybookUrl`, `storybookIframeUrl` and `storybookManagerUrl` build the addresses. The visual
  impact tool now parses `storybook-static/index.json` and builds story URLs through core; its output is unchanged.

## 0.11.0

### Minor Changes

- 76c7938: Suggestions can link Figma nodes: `links.figma.nodes` (optional `{ nodeId, url?, name?, state?: "before" | "after" }[]`, payloads without it are unchanged). The issue lists the node links and says Claude Code reads the design straight from Figma (Figma MCP `get_design_context` or the REST API), so no image hosting is needed. A component spec suggestion from Figma fills it from the pushed component (and `figma.before` when known), turns stored screenshots into previews, and its brief names the Figma MCP call. New helper `figmaNodeUrl`.

## 0.10.0

### Minor Changes

- 22e53c7: Components changed in Figma go back to the library as library branches. The DS Bridge plugin's Push tab reads the diff Pull reads in "Review updates" the other way round and routes each changed component (`planComponentPush`): a token swap on a component token that paints only the changed variants becomes an exact token change, no AI (the shared `planTokenProposal` and `writeTokenProposalOnGitHub`, with the contrast gate run again on the component tokens that alias a checked pair, `componentContrastPairs`, and the other components that share the token named); a new variant, property, layer, swapped instance or component, or a swap a token alone cannot say, opens a draft branch carrying the spec (`.bridge/figma/<name>.json`: variant matrix, properties, bound variables and layers per variant, screenshot) labelled `waiting-for-claude` until Claude AI writes the code there and it becomes `drafted-by-claude`; detached layers, values set by hand, styles and variables the library lacks are listed under "Fix in Figma first" with what to do, never sent. Every branch starts with "From Figma" (`parseFigmaOrigin`) and carries `from-figma`. The set remembers its branch: once it ships or closes, the next Pull rebuilds the set from the reviewed code, so Figma never diverges. MCP: `bridge_figma_changes`, `bridge_get_figma_change`, `bridge_mark_figma_change_drafted`, `bridge_push_figma_component` (61 tools). CLI: `bridge figma`, `bridge figma show <n> [--draft]`, `bridge figma drafted <n>`, `bridge figma push <diff.json>`.
- e59366e: Suggestions, the core model: a change Bridge files as a GitHub issue instead of a branch, so a design system owner needs only Issues write and a developer applies it with their own access. `composeSuggestionIssue` / `parseSuggestionIssue` write and read the issue: readable Markdown, then a collapsed JSON payload (schema `bridge.suggestion/1`) whose canonical sha256 sits in a marker, so an edit by hand is detected. Token changes are stored as edits (paths and values), other files as whole contents with git blob shas before and after; contents too large for GitHub's 65,536-character body move to up to 8 continuation comments and are reassembled (a missing part is refused). Labels (`bridge-suggestion`, `suggestion: <kind>`, `source:`, `tier:`, one state label), the status machine (`suggestionStatus`: needs review, changes requested, approved, applying, applied, declined, outdated) and path safety rules per kind (`suggestionPathProblems`: repo-relative only, inside the kind's folders, never a governance guardrail). Reviews are comments (`suggestion-review.ts`): `summarizeSuggestionApprovals` counts only the configured owners (collaborators when no owner is set) and only on the current payload sha, so an edit makes earlier approvals stale. GitHub calls in `suggestions-github.ts`: create (with parts), list, get, review, link the applying pull request, decline. Config: `changes` (`"suggest"`, the default, or `"direct"`, with `changesMode()`) and `storybook.url` (`storybookUrl()` falls back to `previews.production.storybook`). `listIssueComments` now also returns `createdAt` and `authorAssociation`.
- a99fbb9: Suggestions, mode-aware writes: the four places core writes code take a `mode` (`"suggest"` or `"direct"`, from `changesMode(config)`). Without it they behave exactly as before (direct). In suggest mode they file a suggestion issue (`bridge.suggestion/1`) through `createSuggestionOnGitHub` and never create a branch, a commit or a pull request. `suggestTokenProposalOnGitHub` (next to `writeTokenProposalOnGitHub`) files a planned token change: the exact edits, the changeset, the checks and the same tier labels; `tokenSuggestionPayload` builds its payload, and `TokenProposalPlan` now carries its `edits`. `openLibraryBranchOnGitHub({ mode })`: a token piece becomes a suggestion (its `writeTokens` callback gets `{ mode }` and may return `suggestTokenProposalOnGitHub`'s result), a variant a component request (`libraryBranchPlan(..., { mode })`), the result status is `"suggested"`, and a refused product branch record is a warning instead of an error. `LibraryLink.kind` gains `"suggestion"`, `linkStatus` maps every suggestion status (new `"outdated"` link status), `libraryPreviewState` and `linkedLibraryBranchOnGitHub` read suggestion links. `openComponentPushOnGitHub({ mode })`: an exact token swap goes through `writeTokens` (which now gets `mode` and the Figma link), a code change becomes a component spec suggestion (`componentSpecSuggestionPayload`, spec inline, labelled from Figma and waiting for Claude); the result has status `"suggested"` and `suggestion: { route, number, url }`. `figmaDraftBrief` has a suggestion form. `proposeDocsOnGitHub({ mode })` files a docs suggestion with the cleaned docs and the patch changeset (`docsSuggestionPayload`); its results now carry `status` (`"opened"`, `"continued"` or `"suggested"`).

  The pure suggestion apply planner (`planSuggestionApply`, `suggestionApplyTable`, `suggestionAppliedComment`) is now exported from `@bridge-ds/core`; `@bridge-ds/core/node` keeps `applySuggestionLocally` and the local workspace.

### Patch Changes

- e1f8f0c: Applying a suggestion on the code a developer has now. `planSuggestionApply` (in `@bridge-ds/core/node` for now, pure logic over a small workspace adapter) refuses unsafe paths, guardrails, symlinks and a payload edited by hand before reading anything, checks the approvals of the owners on the current payload sha, then classifies every change against the current tree: token edits re-applied with `applyTokenEdits` on the current tokens (already applied, apply, or a conflict when the value moved since), files by git blob sha with a 3-way merge when both sides moved, docs field by field, component specs with their brief. It re-runs validation, contrast and the tier on the result and stops when the tier went up or a contrast pair that passes today would fail. Re-running on a tree that has the change is a no-op. `applySuggestionLocally` writes the result as one commit on a new local branch (default, nothing pushed, the branch reused when it already has the change), into the working tree (refused over uncommitted changes), or as a `git format-patch` text, 3-way merges with `git merge-file`, and returns the applied record comment for the caller to post. The suggestion issue's "How to apply" now names Claude Code with the Bridge MCP server and its one-time install command (`bridgeMcpInstallCommand`).

## 0.9.0

### Minor Changes

- 5b93962: Product branches bring what they invent back to the library. `missingPieces` (in `@bridge-ds/core/audit`) runs the adoption audit on each product file a product branch changes, at its start and at its head, and keeps what the branch added that the library lacks: a value written on a library component becomes a variant of it ("Badge: overdue tone"), a component from another UI library with no equivalent becomes a new component, any other hardcoded value becomes a token beside the closest one. Values equal to a token and components the library has are fixes, not pieces. `openLibraryBranchOnGitHub` opens the library side of a piece and links both ways: a token change (through the new shared `planTokenProposal` and `writeTokenProposalOnGitHub`, which `bridge_propose_token_change` now uses too), a library exploration for a variant, or a component request for a new component; the library side says "Needed by" the product branch (label `needed-by-product`), the product branch records the link in its description. The product branch takes the library branch's preview (Bridge merges it in, `GitHubClient.mergeIntoBranch`), and `switchToPublishedOnGitHub` brings main in once the library ships. MCP: `bridge_missing_pieces`, `bridge_open_library_branch`, `bridge_product_branch`, `bridge_use_library_preview`, `bridge_switch_to_published` (57 tools). CLI: `bridge pieces <n> [--record]`, `bridge pieces status|open|preview|switch`.

## 0.8.0

### Minor Changes

- 77ba45a: Create branch in Studio is product first. Step 1 asks what you work on: a feature in a product, or a change to the library. A feature asks what you build and in which product (preselected when there is one, or from `?product=`), starts an exploration with the product's `product: <key>` label and gives you the sentence to say to Claude AI. The library keeps its choices (Adjust the look, Add a variant or option, New component), and "Something looks wrong? Report it" stays one click away. core: `productMarks` (the product label and body line, nothing for the default product) moves from the MCP server into `@bridge-ds/core`, and `startExplorationOnGitHub` takes extra `labels`, so Studio, the CLI and the MCP server write the same label. Studio home: "Your branches" gets a one-line subtitle, and the "Published this week" line is gone.
- 7e9f2df: Docs proposals: one open proposal per component. Sending docs for a component that already has an open docs proposal adds a commit to it instead of opening a second pull request (`proposeDocsOnGitHub` returns `continued`, and `unchanged` when it already says the same). New core helpers `findOpenDocsProposal`, `findOpenDocsProposalOnGitHub`, `isDocsProposalBranch`, `continueDocsProposalOnGitHub` and `docsSlug`, shared by the Library editor and the MCP server (`bridge_save_docs` without `pr` continues the open one). The Library editor opens on the open proposal ("Continues the open proposal by ..., waiting for review", with a link to its review), and Send is off with "Nothing changed since the open proposal" when the text is the same.

  Attribution: the pull request's author line now says who wrote the text (`docsAuthorLine`, `withAuthorLine`, `defaultDocsFooter`): "Drafted by Claude AI, reviewed and sent by @person" when Claude's draft goes out as written, "Drafted by Claude AI, edited by @person" with the edited sections, and "No AI involved" only when no Claude draft is in the text. The editor tracks the text Claude wrote per section (`authorship`).

### Patch Changes

- 8cdcb9a: Avatar agent: Bridge now draws its own agent mark (a prompt chevron and cursor line, Deep Harbor on a Harbor rounded square tile) instead of shipping the Claude logo, which is an Anthropic trademark. `brand="claude"` still works and keeps the name "Claude AI". New `AGENT_MARK` export; `CLAUDE_MARK` stays as a deprecated alias of it. New optional `mark` prop for a vendor logo you have the brand owner's approval to use. The agent tile token `color.agent.surface` now follows the Harbor zone in every theme and brand. The Figma UI kit gets a Kind axis (person, agent) drawing the new mark, and the spec generator keeps an SVG line join.

## 0.7.0

### Minor Changes

- 22d186e: Figma components are testable in prototype mode, with the design system's motion. The spec generator reads each set's interaction states (State and Checked axes) and the CSS `transition` of the parts that change, resolves durations and easings from the motion tokens (`motion.duration.*`, `motion.easing.*`), and records them in component-specs.json as `interactions` (trigger, axis, from and to values, transition) plus `motion`, the motion Figma cannot play (looping keyframes, keyboard focus, popups opening). Cubic bezier easings play exactly as Figma's custom bezier; when parts move at several speeds Figma plays the longest and the transition says it was approximated.

  New pure helpers in `@bridge-ds/core`: `componentMotion(spec)` (reactions per variant, triggers with Figma's names, motion tokens, animated properties, approximations, what Figma cannot play, the reduced motion note) and `componentsUsingMotionToken(specs, tokenPath, chainOf?)` (sets whose interactions use a motion token, through aliases). `@bridge-ds/core/node` exports the CSS side (`parseTransitions`, `resolveDuration`, `resolveEasing`, `transitionBetween`, `motionNotes`).

  The Figma plugin wires the variants with prototype reactions: While hovering, While pressing, On click (Mouse enter and Mouse leave on sets with a Checked axis), Change to with Smart animate. Idempotent: a second pull writes no reaction; reactions designers added are kept, and on the same trigger theirs wins. The Pull preview shows "Interactions: N" per set and lists the motion it could not map; set descriptions say "In code, reduced motion turns this off."

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

- 7b53159: Motion is documented and reviewed from the code. The spec generator now records how a part opens and closes: the "Opening and closing" motion note carries the code's `enter` and `exit` transitions (duration, easing and their motion tokens, read per element so a drawer's side class and its popup class count together), and looping animations carry their `durationToken`. `componentMotion` returns them as `opening` and lists their tokens, so `componentsUsingMotionToken(specs, "motion.duration.moderate")` finds Dialog and AlertDialog. component-specs.json is regenerated (popup sets gain their open and close motion).

  Every Library component page has a generated "Motion and interaction" section in its Tokens tab: when it moves (hover, press, check, open, close, loops), what changes, the duration token with its value and the easing token in words, and what reduced motion does, in one sentence. Components without motion say so in one line; motion the specs cannot place is said, never denied.

  For branch reviews, `MotionChanges` (components/ds/studio/MotionChanges.tsx) shows a plain sentence per motion change, two looping previews of the same component at the old and new motion with Replay, and the other components it touches; still frames under reduced motion. `motionChanges` (lib/motion-changes.ts) computes the changes from the token sets and specs at both commits; `mountMotionChanges` (scripts/reviews/motion-changes.ts) mounts the block from a review page.

## 0.6.0

### Minor Changes

- f655919: Figma coverage goes from 26 to 40 of 47 components. Popups are drawn open as their own sets, the way a Figma UI kit draws them ("Select/Popup", "Dialog/Popup", "Menu/Popup", "Tooltip/Popup"...), next to the trigger set when the component styles one. Inline SVG (Spinner, the Progress ring) is drawn as one vector layer with each stroke bound to its token. Layers that only some variants render are hidden in the others, and a prop that moves layers elsewhere splits the component into one set per value ("Progress/Linear", "Progress/Circular", "Pagination/Full", "Pagination/Compact"). New generator capabilities: React context, `useState` defaults, local render functions and list callbacks, `useMemo`, `createElement`, Base UI render props and value indicators, `position: absolute` with token offsets, `width: 100%` as Fill container, single-cell grids, examples of the component sandbox as content. Still not in Figma, with the generator's reason: Checklist (CSS grid columns), Form and Slider and TokenValue (content computed while the page runs), Table, Tabs (decorations drawn with ::after) and Toast (shown from a hook). The fidelity check marks popups drawn open as not compared, since the code image shows them closed.
- ed4b28d: Every visual component is in Figma: 47 of 47, 46 generated from code and 1 drafted with Claude. The generator now draws Checklist, Form, Slider, Table (and TableEmpty), Tabs and TokenValue from their code examples. New generator capabilities: CSS grid rows and subgrid rows as auto layout, `::before` / `::after` decorations as layers, Base UI indicators sized to the selected item (a tab underline) drawn in that item, unselected tab panels hidden, `data-orientation`, sliders (thumb at the value, value render functions), tables as rows of cells, form errors reaching their field, typed values in fields, functions as values, string and list methods, helpers that return elements, plain modules of the package, React's JSX text spacing, screen reader text left out of sentences, example texts shown by default, and absolute layers placed per variant. Side effects on sets already in Figma: Field and Dialog lose an empty error layer, NumberField steppers get their dividers, ChoiceCard text wraps, CodeBlock reads its wrap style.

  Toast, shown from the `useToast` hook and never placed, is drafted with Claude: a spec written from the code in `packages/react/component-spec-overrides/Toast.json` (`"source": "drafted"`), validated against the format and the repo's tokens by `npm run specs`, counted as drafted (never as generated), marked "Drafted, check it" in the Pull preview and in its Figma description, and stale once its code changes. Specs record the code example they were drawn from, so the fidelity check renders the same content (rows, fields, tabs), and the Figma references capture renders hook-shown components (a toast) through their hook.

- bdca820: Honest Figma coverage. `npm run specs` now reads every component folder and records each one in a `coverage` list of component-specs.json: generated, unsupported with the generator's plain reason ("opens a popup", "uses CSS grid", "shows content computed while the page runs"), or a layout helper with nothing to draw. Support is decided by the generator from what it can read, no list to maintain. The plugin Pull tab says "26 of 47 components are in Figma" with the others folded under the count, each with its reason, and the Studio Components page shows a quiet "In Figma" column from the same data.

  Coverage goes from 6 to 26 of 47 visual components. The generator draws 19 more (Accordion, Alert, Avatar, Banner, Breadcrumb, Checkbox, CheckboxGroup, ChoiceCard, CodeBlock, Divider, Field, Kbd, Link, NumberField, RadioGroup and Radio, SegmentedControl, Skeleton, Switch, Textarea), and Icon counts as covered by the icon components of the Icons page. New general capabilities: content props as TEXT and BOOLEAN properties, Base UI checked states as a Checked axis, layers hidden per variant, translateX and row-reverse read as auto layout, flex grow and wrap, lists and selections from the docs preview, the page base stylesheet, em sizes, underlines, opacity, fixed and per-variant icons, images as the media slot, useRender links. Fixes from the fidelity check: a transparent border keeps its room (a transparent stroke counted in layout), link buttons are underlined, inherited typography reaches every text.

- 6b07b05: Check fidelity: the Pull tab compares every generated Figma variant with the same variant rendered from code and says, per component, "Matches the code" or "Differs from the code: 12% of pixels, size 120x40 vs 118x40", with Figma, code and differences side by side. Nothing in the file changes. Core adds the pure comparison (`compareImages`, tolerant of font rasterization and antialiasing), the storable `FidelityReport` and the variant to code mapping (`planReference`); `bridge figma-references` (visual) captures the code images from Storybook, published on main by the Figma references workflow to the `bridge-visual` branch. React adds a hidden Storybook fixture, "Internal/Figma reference", not part of the package.
- 8376732: Studio speaks Figma branching.

  - One vocabulary module (lib/vocabulary.ts) for every Studio screen: Create branch, Request review, Update from main, Review and merge, Merge, Publish for the release; statuses Draft, In review, Approved waiting for code, Merged, Closed. The Changes page is now Branches (same address).
  - No "For developers" fold left in Studio or the Library changelog. Where a design system lead may want the GitHub view, one quiet "Open on GitHub" link sits on the line of the thing it concerns; Settings explains integrations and protection in plain words with a "How it works on GitHub" link.
  - Request triage left the Studio home and the Branches tabs (teams triage in Jira). The code stays behind REQUEST_TRIAGE_IN_STUDIO; "Ask for a component change" still creates a request, and a request link still opens.
  - Create branch takes an optional Jira ticket key (DS-42) in the token editor, the Library edit mode, the new brand flow and Start an exploration. The key goes first in the GitHub title (and in the branch name outside explorations) so the Jira GitHub integration links it, and shows in mono on branch rows.
  - Core: `Exploration` takes an optional `jira` key; the merge-right sentence says "can merge this".
  - Figma plugin: the review flow strings say Request review and branch.

## 0.5.1

### Patch Changes

- a54ac38: `@bridge-ds/react/dom` gains the Dialog for pages without React at runtime: `dialogHtml()` renders the exact markup of `<DialogContent>` (same classes, same look), and `bindDialogs()`, `openDialog()`, `closeDialog()`, `isDialogOpen()` and `dialogReturnValue()` give it the React Dialog behavior: focus moves in and is trapped, the page behind is inert and does not scroll, Escape and the scrim close it, focus returns to the trigger, `aria-modal`, `open`, `cancel` and `close` events, and a `<form method="dialog">` inside closes it with the submit button's value. A parity test compares it with the React Dialog. SegmentedControl: the selected segment uses the raised surface, so it no longer disappears into its track in dark mode (light is unchanged).

  The audit counts a native element only when the design system has a component that replaces it: `<img>` is no longer a miss in a design system without an Image component.

  The docs site has no temporary audit allowlist any more: its prose links are the DS Link or ButtonLink, its icons are the DS Icon (the site's own glyphs, drawn through `createLucideIcon`), the Quality audit table is the DS Table, and the search palette, New token, Send for review, Connect GitHub and Undo planner dialogs are DS Dialogs opened by their scripts. Every Studio header control is the DS sm size.

## 0.5.0

### Minor Changes

- 5bfc7e2: The adoption audit reads Astro, Vue and Svelte files. Template markup counts DS components imported in the frontmatter or `<script>` (Vue kebab case included), native elements a DS component should render (with the DS equivalent), local look-alikes named like a DS component (`Button.astro`), hardcoded values in `style` attributes (`style="..."`, `style={{ ... }}`, Vue `:style`, Svelte `style:prop`), `class` attributes and color attributes, and token references. The frontmatter and `<script>` blocks go through the TS scanner and `<style>` blocks through the CSS audit, with the file's own line numbers. Hidden inputs and elements inside `<noscript>` do not count. New escape hatches, both with a required reason and both kept visible in the report: a `bridge-audit-ignore-next-line: reason` comment on the line above (HTML, JSX, CSS or JS comment; a comment without a reason or above nothing is reported and ignores nothing), and `bridge audit --allowlist file.json` (`allowlist` in `bridge_audit`) for known file:line violations, with stale entries listed. The report gains `files[].ignored`, `files[].ignoreErrors`, `ignored` and the `astro`, `vue` and `svelte` languages (schema updated, still version 1). The docs site's `audit:docs` now sees its raw elements; they sit in a temporary, reasoned allowlist (`apps/docs-site/bridge-audit-allowlist.json`) until the native elements migration removes them.
- f1a8b55: Five new components and a supported path for pages without React. `CodeBlock` (code or a command in Plex Mono with a copy button that says "Copied"), `TokenValue` (a token name and value with a color swatch, for before and after values), `Checklist` and `ChecklistRow` (status icon, title, one line of detail and the action on the same row), `ChoiceCardGroup` and `ChoiceCard` (radio choices shown as cards with a title and a description) and `Banner` (a page-level mode banner, Deep Harbor or neutral, optionally sticky). The new `@bridge-ds/react/dom` entry renders Badge, CodeBlock, TokenValue and Checklist as HTML strings with the exact markup and classes of the React components, and adds `tooltipAttributes()` with `bindTooltips()` and `bindCodeBlocks()` for plain-script pages. `bridge audit` counts these renderers as design system components and now flags homemade look-alikes in script-built markup (`class="pill"`, `data-tip` tooltips). Studio and the Library adopt them in place of their homemade pills, tooltips, command rows, value chips, checklist, radio cards and mode banners.

### Patch Changes

- 9494004: Studio cleanup. Changes: the "In review" tab is now "All changes", its status filter is one Select named after the status model (All open, Draft, Ready for review, Approved waiting for code, Shipped, Closed), and the "try together" checkboxes appear only after "Choose changes", so the first screen holds about half the controls. A change detail keeps one ship control: Ship sits on the title line once the change can ship, and the disabled Ship in the action bar is gone, as is "Reply on GitHub". Tokens: on a phone the type chips get their own line and every brand and theme stacks into labeled lines; the draft bar reserves room so it never covers the last rows; a token changed in one theme only says which. Core and MCP: when GitHub's hourly limit runs out without a token, the error says so and how to fix it (set GITHUB_TOKEN for the MCP server) instead of blaming "this token".

## 0.4.0

### Minor Changes

- 6fe9f88: Bring in the latest library. A change in Studio now says when the library has moved on since it started ("The library has moved on: 12 updates since this change started."), read from GitHub's compare API, with a "Latest library" row in its checklist. When nothing conflicts, "Bring in the latest library" asks GitHub to update the change, then the page refreshes its checks and visual comparison; the row says beforehand what happens next, from the library's rules (checks run again, approvals need renewing when GitHub dismisses them on new commits). When the change and the library changed the same tokens, the designer resolves them in Bridge: one row per token with the library's value, this change's value and the value before both, "Keep mine" by default or "Use the library's", and no default for a token removed on one side and changed on the other. The contrast checks run on the choices before anything is sent, then Bridge commits the resolved token files on top of the latest library. A conflict in code stays with a developer, with the GitHub link under For developers. The Changes list shows "N updates behind" on each change that is behind. Core gains `planTokenMerge` and `applyTokenMerge`, a file-by-file three-way merge of DTCG token files on the same rules as the Figma sync.
- 11f40fd: Change statuses and reopen. Every change in Studio now has one lifecycle, in designer words and from GitHub data only: Draft, Ready for review, Approved waiting for code, Shipped, Closed. A change waits for code when its design approval is in, nobody asked for changes, it is design work, and every failing check is a developer check; it names the tech owners from the config, or "a developer". The change page opens on one status line (a Badge, one sentence, at most one action): Mark as ready on a draft, Reopen this change on a closed one whose work is still there, or "Start again from this change" when its work was removed (its token edits go to the draft, then Tokens sends them for review). Back to draft sits under More. The Changes list gets a status filter (Open, Draft, Ready for review, Waiting for code, Shipped, Closed; a Select on phones) and one chip per row; the opener never points at a change that waits for code. The Overview "For you" rows carry the same badge, and your own drafts show there. Core adds `GitHubClient.convertToDraft`.
- 4c313d7: Try several changes together. On Studio > Changes (Open), each change has a checkbox; checking 2 to 4 token changes combines them in the browser: the latest library plus each change's own token edits (what it changed since it started, so a change that is behind never undoes newer library values). Nothing is written to GitHub. A token two changes set differently gets one row ("Use Darker default background's" or the other change's), and nothing opens until each has a pick; the contrast checks then run on the combination itself ("All 296 contrast checks pass with these changes together."). A change that edits code is left out and says why on its row ("This one changes code, so it can't be combined here."). "Try 3 changes together" opens the demo admin with `?bridge=101,118,120`: the Bridge toolbar applies the combined tokens live on the production admin (no preview holds all of them, and it says so), "These 3 changes" replaces "This change", its Changes sheet lists the changes with a checkbox each to switch one off live, and Before/After (B) and Show what changed (C) work on what is switched on, the tooltips naming the change a value comes from. "View the library with them" opens Studio Tokens, Components and Quality on `?change=101,118` (the #116 address model, with the picks in `use`): the banner names the changes, changed tokens are marked "Changed in #118", and Quality shows no combined numbers. Core gains `changeEdits`, `combineChanges` and `encodePicks`/`decodePicks` (token-combine), and `previewOverrides`/`cssOf` move to core (css-overrides) so Studio and the admin share them.
- 4bfd417: Studio tells design work from developer work, and says who really made it. Work that only touches code (a title that speaks code such as "React" or "props", tests, examples, types, build or tooling only, component code the visual impact run shows no difference for, a "tech" or "developer" label) no longer shows in Needs you, on the board columns or in the Changes badge: the Overview folds it into one quiet line under the board, "Developer work, 1 in progress", that opens its list. Changes keeps every item and tags developer work "Developer", with an All, Design, Developer filter that shows when a list holds some. When nothing says what a change is, it stays with designers. An exploration card says "Claude is building it" when a real marker says an agent made it (the pull request template box, the Claude Code footer or session link, a "Co-Authored-By: Claude" commit, an agent label, an exploration or request started from the MCP server), and "You are trying it" only for what you started from Studio. The exploration block now records where it was started (`source`: studio, figma, cli or mcp) and the agent behind it (`agent`), and the CLI records `agent: "claude"` when Claude Code runs it.

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

- d5bbba9: Exploration install commands that work. On exploration #64 the plugin showed a pkg.pr.new command that returned 404
  (the pkg.pr.new app is not installed); the working one was the prerelease tarball command in the pull request's
  `<!-- bridge-branch-preview -->` comment. Core reads that comment back: `installCommandFromPreviewComment(body)`,
  `readPreviewComment`, `findPreviewComment`, `explorationTryIt` (ready only when the comment's snapshot matches the
  branch head, "building" before, "failed" when the publish failed), `explorationTryItOnGitHub`,
  `explorationShareMessage` and `GitHubClient.listIssueComments`. The draft pull request body no longer guesses a
  command: it points to the comment.

  DS Bridge plugin: the "Sent to <exploration>" screen is for designers. "Try it" lists the previews with the product
  first (the admin demo, by its name in bridge.config.json), then Library and Workbench, one row each with "Open" on the
  same line. "Test build for your product" says whether the build is ready or being prepared (with "Check again"), and
  has one action, "Share with a developer", which copies a ready message with the working command, the previews and the
  pull request. The command itself stays under "Show the command". The bar's primary is "Open in the product" when that
  preview exists, otherwise "Open on GitHub". The Push form drops the "Commit title" disclosure for explorations (the
  title is still generated) and says "Owners review it only if the exploration is promoted."; other Push and Pull
  sentences say "the design system" instead of "main" and drop "commit".

  Studio explorations: the detail reads the install command from the preview comment (or says the test build is being
  prepared); the list no longer shows a guessed pkg.pr.new command.

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

- 537abd7: Push names structure changes. Each variant keeps a layer outline, so a layer added, removed or moved becomes a
  "Structure change" request (new request kind `structure`) with a line like `New instance layer "Icon" (Icon/Pencil)
after "Label" in primary sm` and the title "Add a layer after Label", instead of a vague visual change. Renames,
  wrappers and hidden layers bound to nothing still send nothing. When an optional part already draws the added layer
  (an icon after the label while "Icon end" exists), the row says "Icon end already does this: show it with the Icon end
  property" and the item starts unchecked; "Keep it as a request" sends it anyway.
- fb40ae8: Claude writes each change line. Draft sessions carry one change line per component change (`DraftItem.lines`, images labeled by line), results may answer `lines: [{ id, line }]` (one sentence, at most 120 characters, no em dash, unknown ids refused; results without lines still work), and `draftChangeLine` gives the deterministic default ("Looks different in Size=sm, State=Default, Variant=primary; no variable explains it"). Requests carry the line (`ComponentChangeRequest.line`, "**What changes:**" in the issue, the brief and Jira). `bridge_pending_drafts` and `bridge_write_drafts` describe and accept lines; the plugin's API-key path asks for and parses them too.

  Push hierarchy in the Figma plugin: "Draft with Claude" is a ghost action on the Description (and request Title) label line, one "Drafted by Claude" status line under the field, each component change row reads name and kind, then one sentence, with the table behind "Details" in one font size, no group checkbox for a single item, the bar alone sums up what is sent ("1 request"), and a shorter Components intro.

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

- fe29bed: Studio requests nobody is on now end in a decision, not a dead end. The Overview row says "Open request" (no more
  "Triage") and what is expected: "Nobody is on it yet: explore it, assign someone or decline it." On the request, a
  design system owner who is connected gets one row: Start an exploration (opens the Explorations form filled from the
  request, then links the request to it and puts them on it), Assign someone (a DS Combobox of the people who can edit
  the repository, in place) and Decline (a DS Dialog that asks for a reason, says who reads it, posts it and closes the
  request as not planned). Once someone is on it, the row gives way to one sentence ("@ana is on it", "@ana is exploring
  it"); everyone else reads who decides. A request linked to an exploration now counts its draft as the work on it.

  Core: `linkRequestToExplorationOnGitHub`, `assignRequestOnGitHub`, `declineRequestOnGitHub`, the pure
  `withRequestExploration`, `declineComment` and `declineReasonProblems`, `GitHubClient.updateIssue`, `addAssignees` and
  `listCollaborators`, and `requests` in the exploration settings (listed in its draft pull request body).

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

- 7cb1733: Say clearly when the GitHub token stopped working (revoked, regenerated or expired), instead of scattered errors.

  Core: `GitHubError` gains `auth` (`'rejected'` for a 401, `'missing-permission'` for a 403 "Resource not accessible
  by personal access token" or a permission GitHub names in `X-Accepted-GitHub-Permissions`) and `permission`
  (`issues`, `pull_requests`, `contents`...: from the header, else from the endpoint). Rate limits stay rate limits.
  New exports: `classifyAuth`, `requiredPermission`, `isTokenRejected`, `isMissingPermission`,
  `missingPermissionMessage`, `permissionLabel`, `TOKEN_REJECTED_MESSAGE`, `TOKEN_SETTINGS_URL`. A refused token now
  stops an exploration promotion instead of becoming a warning.

  Studio: one session state. Any 401 marks the saved token as stopped working (it is kept, not deleted): the sidebar
  account block shows "Your GitHub token stopped working" with Reconnect (the connect dialog, field focused, saving
  replaces the token), Settings says the same, write actions show that one message, and reads fall back to anonymous.
  A missing permission is named on the action that needs it ("This token cannot create issues. Add Issues: Read and
  write on GitHub.") with a link to the token settings. The token is checked once on load when the last check is older
  than an hour (GET /user, cached with its result).

  DS Bridge plugin: the Settings token row shows "Stopped working" with "Replace token" after a 401; Pull, Push and the
  other GitHub flows show one callout, "Your GitHub token stopped working. Replace it in Settings.", with a button that
  goes there. Access is checked once when the plugin starts. A missing permission is named, with the GitHub link.

### Patch Changes

- a6914d7: Studio Tokens and Components, designer first.

  Tokens: the list says "Semantic and foundation tokens" (the base collection reads Foundation in Studio), collections
  and usage filters move under Advanced in Options, swatches are 24px and values read at the UI size, and long names
  wrap at their dots instead of truncating next to the details panel. The details say "Where the value comes from".
  The value popover shows the real components that use the token, light and dark, repainted on every pick. The review
  opens on its visual preview: light and dark side by side, before above after, several components scaled to fill
  their frames; Export JSON moves under "For developers". "Send for review" replaces "Propose change": the dialog says
  who approves from the configured rights ("The design owner and a developer will approve it; nothing ships before
  both."), drafts the title from the edit ("Darker primary action fill") and keeps the branch sentence under "For
  developers".

  Components: each row starts with a thumbnail of the real component, "Stories" reads "Examples", and two columns join:
  open requests per component and "Used in products" (from the committed audit reports). The drawer opens on the
  component live in light and dark; Code, Workbench, props and stories move under "For developers". A request carries
  a Figma link and one image (pasted or picked, committed to the requests branch like the Figma plugin does), Kind
  starts on Visual change, and the button reads "Send request".

  Core: the request kind "Prop change" reads "Option change (prop)" everywhere requests are shown.

## 0.2.0

### Minor Changes

- e31bac2: bridge audit counts every visible UI instance: router links outside a DS component's `render` prop (react-router,
  ra-core `LinkBase`, next/link), anchors with `href`, images and chart libraries (recharts, Nivo, Chart.js...,
  foreign with no DS equivalent). Providers and other non-visual parts no longer count as DS instances.
- e54d2a1: Packages are publishable under the `@bridge-ds` npm scope (renamed from `@demo-ds` and `@bridge`). Each ships built ES modules, type declarations and, for React, one `styles.css`; the monorepo keeps resolving TypeScript sources through the `source` export condition. `@bridge-ds/core` adds branch preview helpers (`previewUrl`, `snapshotUrl`, `previewComment`) and a `previews` section in `bridge.config.json`. `@bridge-ds/react` adds an opt-in staging token override: `ThemeProvider` `tokenOverride` loads an allowlisted `tokens.css` from `?bridge-tokens=`, off by default and refused in production builds unless enabled.
- bac1cb2: Measure design system adoption in product code. `@bridge-ds/core/audit` finds hardcoded colors, lengths, radii, shadows, durations, z-index and fonts in CSS, SCSS, style/sx/styled/theme objects, CSS-in-JS and Tailwind classes, suggests the closest token (deltaE in OKLab across every mode, nearest scale step), and counts DS components against foreign UI libraries, native elements and re-created components. `bridge audit <path>` reports token and component adoption as JSON (versioned schema) and Markdown, compares with a baseline, fails CI under a threshold, and `--fix --write` replaces exact CSS matches with `var(--token)`. The MCP server adds `bridge_audit` and the `migrate-file-to-ds` prompt. New `@bridge-ds/stylelint-plugin` (`bridge/use-tokens`) and `@bridge-ds/eslint-plugin` (`no-hardcoded-style-values`, `prefer-ds-components`).
- One `bridge.config.json` and one schema (`packages/core/bridge.config.schema.json`) for the Figma plugin, the docs site, the CLI and the MCP server: tiers, ordered layers with mode placeholders, modes with parity, contrast, components, docs, changesets and governance (protected branches, branch prefix, labels, guardrails, design and tech owners). The MCP server now runs on `@bridge-ds/core` (layered token sets, minimal-diff edits, contrast, diff, PR body, GitHub client, local git writer) and every surface shares one risk classifier: a token added, changed, renamed or removed is Tier 3 (renames and removals major), a description-only edit is Tier 1 patch.
- f103729: Owner override for solo maintainers and small teams. `governance.override` in `bridge.config.json` (`allowed`, `requireReason`, `minReasonLength`; absent by default) lets listed logins merge from Reviews when the only thing missing is approvals. It is never offered while CI fails or runs, when changes are requested, or on a draft. Bridge checks the token has write access, asks for a reason in a confirmation dialog, posts a `**Bridge owner override**` comment with the login, reason and missing approvals, then merges with the method the repo allows. If GitHub refuses, its message is shown and the comment is marked not merged.
- cd5565e: Visual impact analysis for design system changes. `@bridge-ds/core` gains a usage index (CSS variables each component reads, components it renders). New `@bridge-ds/visual` builds Storybook and the admin app at two refs, screenshots the impacted stories (every brand and theme) and the admin screens (every tenant and theme) deterministically, and pixel-diffs them into before, after, diff and composite images plus a JSON manifest. `bridge impact` and the `bridge_visual_impact` MCP tool run it; a workflow posts the result on pull requests.
- 95db484: Change drafts: `draftRequestText(component, kind, changes)` and `draftPushDescription(entries, components)` write a sentence-case title and a 1 or 2 sentence summary from detected changes only (no reason, no invented number, no em dash), with `pushChangeRows` for a change table of variable edits and `cleanDraftText` to strip em dashes.
- cf3f5bb: Component specs: `ComponentSpec` types and helpers in the main entry, and a generator in `@bridge-ds/core/node` (`generateRepoComponentSpecs`) that derives variant axes, properties, parts and per-variant token bindings from a component's TSX and CSS modules, with a small CSS cascade. New optional `components.specs` config key (default `packages/react/component-specs.json`).
- abe4395: Draft exchange (`draft-exchange.ts`): the pending drafts file the Figma plugin and the MCP server share on the `bridge-requests` branch (`.bridge/drafts/<sessionId>.json`), with compose, parse, validate, sanitize (no em dash, title at most 70 characters, summary at most 3 sentences) and merge helpers, the Bridge voice rules and output contract, and GitHub helpers that read and write sessions with the file sha and retry on 409. `GitHubClient` gains `getFile` (text and sha), `getFileBase64`, `listDirectory` and `deleteFile`.
- 7261f47: Component specs describe swappable parts: `swap` on icon parts (default icon from the docs preview or the AllStates
  story) and on full-bleed compound content (Card body: text or media slot), `slots` per variant, and file-level
  `icons` (normalized Lucide SVGs read from `lucide-react`), `iconStyle` and `slots` sections.
- a6a3a46: Add `tokenUsage()`: one definition of a token in use. A token is in use when a component stylesheet or a global
  stylesheet (base styles, app shell) reads its variable, or when a token in use aliases it. Bridge uses it for the
  Overview counts and the token explorer's Unused flag.
- d5d263b: Docs drafts. `@bridge-ds/core` computes what code can tell about a component's docs (props table, tokens, anatomy from the CSS module classes, contrast notes, a changelog line) and keeps the review state of AI-drafted prose (`draftedBy`, `needsReview`). The MCP server adds `bridge_draft_docs`, which returns that pre-fill and a prompt for your own Claude to write the prose; the CLI adds `bridge docs draft <Component>` (`--json` for CI).
- 525217f: Explorations: `explorations.ts` (branch naming `explore/<slug>`, the `exploration` label, the draft pull request body with purpose, snapshot install command, previews and promote or close, status running, promoted or closed, and the promotion plan with tier labels from the shared classifier) and `explorations-github.ts` (start, list, promote, close). `GitHubClient` gains `withBranchPrefix`, `commitToBranch` and `markReadyForReview` (GraphQL `markPullRequestReadyForReview`, since REST cannot unset draft). Component change requests take an optional `exploration` branch: the issue gets the `exploration` label and the brief says to work on that branch, never in a pull request to main. The branch preview comment says "Try this exploration in your product" for explorations and installs them as `name@url`.
- 5c40693: New brands, from every surface. `planNewBrand` in `@bridge-ds/core` builds a brand file (primary and neutral ramps from the shared ramp engine, the starting brand's radius, fonts and theme overrides), adds the slug to `modes.brand` in `bridge.config.json`, and runs the contrast gate for the new brand in light and dark. The CLI gets `bridge brand create` and `bridge brand list`, the MCP server `bridge_list_brands`, `bridge_plan_brand` and `bridge_propose_brand`, the Figma plugin offers a new Brand mode as a new brand on Push, and the Studio has a four-step New brand flow with a live preview. The token build reads its brands from `bridge.config.json`, and `scripts/ramps.mjs` runs the same ramp engine (primitives unchanged).
- 019a220: Pulled components: Badge md gets its padding and min height (a `calc()` of tokens is resolved and set, reported as "set,
  not bound"; a `calc()` of one token is bound). Card is drawn at the `size.80` width, its header, body and footer fill it,
  body text wraps instead of collapsing to 0px, and it clips its content so the footer stays inside the rounded corners.
  Tag loses its extra "label" wrapper frame (a re-pull moves the layers and removes it). Variant grids keep the same gap
  between rows and columns of different sizes. Specs gain `clip` and `fill` on parts and calc() expressions of token paths.
- a0142d2: Branch previews: `previews.production` in `bridge.config.json` holds the production URL of each app (docs, Storybook,
  admin demo), and `appUrl()` picks the branch preview on a feature branch and the production URL on the default branch
  or in a local build. The docs site links its Storybook through it.
- 36cb504: Component change requests: `composeRequestIssue`, `parseRequestIssue`, `requestStatus`, `requestBrief`, Jira field mapping, GitHub issue methods, and an `integrations` block in bridge.config.json.

### Patch Changes

- 5b9d677: `bridge audit` no longer counts a native element passed as a component's render element (`<Button render={<a href="/tokens" />}>`) as a separate native UI instance, as it already did for router links: the DS component is the UI.
- 3e59115: `bridge audit` and `bridge/use-tokens` no longer report a ring built only from tokens (`inset 0 0 0 var(--border-width-default) var(--color-border-default)`) as a hardcoded shadow: bare zero offsets carry no value. Stylelint already allowed this form.
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

- c66908c: `patchDocsJson` writes edited docs.json as a minimal diff of the file it replaces, and `acceptDocsText` now changes only the needsReview line.
- 2c79d5d: Component change requests for developers: MCP tools `bridge_list_requests`, `bridge_get_request` (with a brief to implement the request) and `bridge_create_request`; CLI `bridge request list|show|implement [--claude]|create`; and `bridge request jira-sync` for the optional bridge-jira GitHub Action. Pull request summaries from the core GitHub client now carry the body, so requests link the pull requests that close them.
