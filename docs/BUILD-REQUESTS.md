# Pushes from Figma and build requests

What happens when a designer pushes from the Bridge Figma plugin to the library. Code in
`packages/core/src/build-requests.ts` (pure rules), `build-requests-github.ts` (GitHub reads and writes) and
`withFigmaPushApprovals` in `review-gate.ts` (the gate). Studio, the plugin, the CLI and the MCP server share them.

## The rule

A push from the Figma plugin counts as design-approved. Keeping unvalidated work out of Figma main is the team's
own discipline, not Bridge's: there is no declaration and no approver to name. Who pushed is recorded as usual (the
pull request or issue author, the "Requested by" line), and History keeps **Undo this change** for anything that
shipped.

| What the push changes | Where it goes | Who acts |
| --- | --- | --- |
| Token values (and new tokens) | A pull request that ships after the automatic checks (contrast gate, visual before/after, CI) | Nobody: Bridge merges it on green |
| A token renamed or removed | A pull request waiting for a developer OK (the tech approval) | A tech owner, because it can break product code |
| Structure: a new variant, option (prop), layout, a new component | A **build request**: a GitHub issue developers build from | Developers, in GitHub or Jira |

### Token values from Studio (decision TV-1)

The same rule holds for a token change made anywhere else: in Studio, from the CLI, the MCP server or an agent. A pull
request (or a suggestion) that only changes token values ships after the automatic checks **once the design approval
is given**, with no developer code OK. Only the design approval is asked, since nothing in Figma vouched for the look.

| What the change does | Approvals |
| --- | --- |
| Token values changed, tokens added (`isTokenValueChange`, `suggestionIsTokenValues`) | Design approval only: the tech approval counts as given once it is in |
| A token renamed or removed, or token changes not read | Design and tech approval, as before |
| Structure (a variant, a prop, a new component) | A build request or a component branch, as before |

`branchVerdict` takes `tokenValues` (Studio, the MCP server and the CLI read the token files of the pull request at the
base and the head, only when its files could be a value change: `mayBeTokenValueChange`) and credits it with
`withTokenValueApprovals`: `approvals.valuesOnly` is set, `tech` follows `design`, and `mergeGate`, `pendingApprovals`
and `requiredApprovals` never ask a developer for it. Suggestions count it the same way (`summarizeSuggestionApprovals`
`valuesOnly`), so the pull request that applies an approved value suggestion carries both approvals. Studio shows the
design approval row only and Settings > Review rules says so ("Token values"). The gate parity test covers it.

**Who merges it.** Once the design approval is in, Studio asks Bridge to arm the merge with `POST /api/ship`, the same
server code as a push from Figma: right after Approve in Studio, and the first time someone opens the change in Studio
when the approval was given elsewhere (the CLI, the MCP server, GitHub). Bridge re-reads the pull request with its own
app: values only (token files at the merge base and the head), a design approver's approval on the head commit (the
approver lists of `bridge.config.json` on the default branch, a team counting the members the app can read), and no
changes requested. Then it approves with the "Bridge: token values, design approved" review and turns auto-merge on, and
the change reads "On its way to the library" (`branchVerdict` `autoShip` with `autoMerge`). When Bridge cannot (auto-merge
off on the repository, the app missing, a branch rule asking for more approvals), nothing is written: the designer reads
"Ready to add to the library" with its button, and developers read the cause under "For developers".

Explorations keep their own flow ([EXPLORATIONS.md](EXPLORATIONS.md)): a pull request or issue labelled
`exploration` gets none of this.

## The gate

`branchVerdict` takes `figmaPush` (from `figmaPushOf(pr, { files, tokenChanges, config })`; `tokenFileChanges` reads the token changes from the token files of the pull request) and credits approvals
with `withFigmaPushApprovals`:

- A push is known by the `source: figma` or `from-figma` label, or the hidden "From Figma" block of a component
  branch. The pull request of a build request (its body says `Closes #n` on one sent from Figma) counts too
  (`closesFigmaBuildRequest`).
- The scope comes from the pull request's real files and token changes, never from its body (`figmaPushScope`):
  `token-values` (token files, changesets, docs and `.bridge/` only; at least one token changed or added, none
  renamed or removed), `token-structure`
  (a rename or removal), `token-unknown` (token changes not read), `component` (code), `outside` (a guardrail file).
- A library branch carrying a component spec (`waiting-for-claude`, `drafted-by-claude`, a Claude draft origin) and
  the pull request of a build request are code work: never `token-values`, so they never ship by themselves.
- Design approval: every scope but `outside`. Tech approval: `token-values` only. Everything else still gates as in
  [GOVERNANCE.md](GOVERNANCE.md): CI, changes requested, conflicts, the ship right.
- `verdict.autoShip` is true on an open `token-values` push: review queues and "Needs you" leave it out.

## Publishing from the plugin

The plugin reports one `PublishOutcome` per token or component (`PublishResult.outcomes`):

```ts
{ subject: { type: 'token' | 'component', name }, route: 'shipped' | 'waiting-for-developer' | 'build-request',
  ref: { kind: 'pull' | 'issue', number, url }, armed?: boolean }
```

- **Token pushes.** `tokenPublishRoute(changes, armed)` picks the route from the token changes the plugin planned:
  a rename or removal is `waiting-for-developer`. Otherwise the plugin opens the pull request ready for review
  (`writeTokenProposalOnGitHub(..., { draft: false })`), then asks Bridge to arm the merge (the server part:
  auto-merge on GitHub, or the Bridge app merging on green). Armed: `shipped`. Not armed (no Bridge app on the
  repository, auto-merge off): `waiting-for-developer`.
- **What `shipped` means when publish returns:** the merge is armed, it is **not merged yet**. The plugin shows
  "On its way to the library" and polls `libraryArrivalOnGitHub(gh, n)` (every 20 to 30 seconds) until `final`:
  `in-the-library` ("In the library"), `held` ("Held for a developer": a check failed, a conflict or a change
  request, never named to the designer) or `not-shipped` (closed).
- **Component pushes.** An exact token swap is a token push (above). Anything that needs code becomes a build
  request: `createBuildRequestOnGitHub(gh, input)` (or `composeBuildRequestIssue` to write it yourself), route
  `build-request`. `publishSummary(result)` says it in one sentence.

The pull request body of a token push says so instead of the approvals line: the tier checkbox reads
"Tier 3: token change. From Figma: design-approved, ships once the checks pass" (or "waits for a developer OK" for a
rename or removal), from `figmaPushTierLabel`, the same rule as `autoShip`. `composePrBody`, `planTokenProposal` / `composeProposalBody` take `fromFigma: true` (the plugin passes it).

When Bridge ships a push it leaves a review whose body starts with `**Bridge: shipped from Figma**`
(`figmaShipReviewBody`).

### Arming the merge (server)

Right after it opens the push, the plugin asks Bridge to record it: `POST <site>/api/ship` with `{ "repo", "pr",
"mark": "figma" }` and the same token. Bridge checks that the caller is the author with write access and that the
change holds token values only, then signs the head commit into the body; only a recorded push, at that head, ships
by itself (HOSTED.md, "A push from Figma, verified"). Then `POST <site>/api/ship` with `{ "repo": "<owner/repo>",
"pr": <number> }` and `Authorization: Bearer <the GitHub token the plugin already uses>` (JSON, any origin). Answer `200 { armed, route, merged?, code?, reason?, retryAfter? }`:
`armed: true` means `route: "shipped"`; otherwise `route: "waiting-for-developer"` with a designer `reason`. Bridge
re-checks the rule on GitHub with its own app (the plugin's word is never enough), marks the pull request ready,
approves it with the review above and turns on GitHub auto-merge; GitHub merges when the required checks pass. On
`checks_pending` ask again after `retryAfter` seconds. Details, codes and setup: [HOSTED.md](HOSTED.md), "Ship from
Figma".

## Build requests

A build request is a component change request ([REQUESTS.md](REQUESTS.md)) with more for developers: one GitHub
issue labelled `component-change` (so the `bridge-jira` Action mirrors it to Jira when set up, no workflow change),
`bridge-build`, `request: <kind>` and `source: figma`. `composeBuildRequestIssue(input)` takes:

```ts
{ component, kind, title, summary, line?, changes?, figma: { fileKey, nodeId, nodeName, url },
  images?: { before?: string[], after?: string[] }, props?: BuildProp[], spec?, specPath?, brief?, source, requestedBy? }
```

The body: the request (summary, change table, Figma link), before and after side by side, the props needed, a
collapsed **Brief for Claude** and a collapsed **Spec** (JSON, left out above 30,000 characters: give `specPath`
then). The hidden `bridge-request` block keeps `build: { v: 1, before, after, props, specPath }`;
`parseBuildRequestIssue` and `parseBuildSpec` read it back, `buildRequestBrief(r, { issue })` writes the brief
again with the issue number. Every component change request reads as a build request; `bridge-build` marks the new
ones.

**One item per change.** A change that needs code always files the build request issue (Jira mirrors it, developers
assign it, Being built reads it). The plugin may also keep the library branch with the spec (`bridge_get_figma_change`
reads it); its pull request says `Closes #<issue>` and the issue links it. Being built then shows the issue only, with
that branch as its evidence: spec only (`waiting-for-claude`) is not work yet, an assignee on the issue or on the branch
reads Picked up, commits beyond the spec or a draft read In progress, `drafted-by-claude` or ready for review reads In
review. The person who pushed is never shown as the builder. A library branch from Figma waiting for a developer (direct mode, labels `from-figma` and
`waiting-for-claude`) reads as one too.

### Status, read from GitHub only

Developers split and track the work in GitHub or Jira. Bridge never writes to a build request after filing it.

| Status | From GitHub |
| --- | --- |
| Requested | Open, nobody assigned. Stale after 7 days |
| Picked up | Someone assigned: "Ana is on it." |
| In progress | A linked pull request (`Closes #n`) still a draft, with work on it |
| In review | A linked pull request ready for review |
| Shipped | A linked pull request merged, or the issue closed as completed |
| Not planned | Closed as not planned |

`buildRequestStatus`, `assembleBuildRequests` and `listBuildRequestsOnGitHub` give each request its status,
builders, age, stale flag, timeline, Jira key (`jira: DS-12` label) and Figma link. `matchesBuildFilter` gives the
Studio filters (All, Waiting to be picked up, In progress, Shipped this week), `buildSummaryLine` the home line and
`figmaAheadLine` the Library line "Figma is ahead: 2 changes being built (Ana)."

## For developers

Read only, from the terminal or Claude Code with the Bridge MCP server:

```sh
bridge build list                                   # every build request: status, who builds it, age, PR, Jira
bridge build list --filter waiting                  # waiting to be picked up (also in-progress, shipped-this-week)
bridge build list --component Button --json
bridge build show 42                                # what was sent, the status timeline, the links
bridge build show 42 --brief                        # only the brief: claude "$(bridge build show 42 --brief)"
```

MCP tools: `bridge_list_build_requests` (filter, component) and `bridge_get_build_request` (number: the request,
before and after, props, the spec, the timeline and `brief`). Assign yourself on GitHub to read as "Picked up", and
open the pull request with `Closes #<n>` on a branch named `agent/build-<n>`.

`bridge branch status` and `bridge_branch_status` read the same verdict as Studio for a push from Figma
(`fromFigma`: its scope and whether it ships by itself), and `bridge branch list` / `bridge_what_needs_me` leave
out a token push that ships by itself until something holds it (a failing check, a conflict, changes requested).

## In Studio

- **Being built** (`/studio/building/`, and `/studio/<owner>/<repo>/building/` for a team): one sentence, the
  filters (All, Waiting to be picked up, In progress, Shipped this week) and one row per build request with who
  builds it, when it was sent and one status tag (a request nobody picked up for a week is highlighted). A row opens
  the detail in place (`?request=N`, `?pull=N`): what was sent, where it stands, and a "For developers" fold with
  the GitHub and Jira links and **Copy brief for Claude**. Read only.
- **Home:** a calm line under the zone ("Build requests: 3 being built, 1 waiting to be picked up."), never a Needs you
  row. A token push that ships by itself (`autoShip`) waits on nobody until something holds it (a failing check, a
  conflict, changes requested), like `bridge_what_needs_me`.
- **Components, Change this component (a team):** the drawer of a team's component asks what she wants to change,
  the same three paths as Bridge's own drawer: **Adjust the look** opens the team's token editor on that component's
  tokens; **Add a variant or option** (a variant or size, an option, a layout) and **Something looks wrong** each file
  one build request (`createBuildRequestOnGitHub`, source `studio`, kind `new-variant`, `prop-change`, `structure` or
  `bug`, with the Figma link, required for a structure change), then say "Follow it in Being built". A GitHub member
  writes it with their own token, an email member through `/api/contribute` (`POST issues` is allowed and adds the
  "Requested by" line); signed out, the action opens the sign-in dialog; on the sample team, the sample-team dialog.
  Code: `components/ds/studio/ChangeComponent.tsx`, `scripts/build-request-send.ts`, words in `lib/change-intent.ts`.
- **Library:** a component page says "Figma is ahead: 2 changes being built (Ana)." by the preview while build
  requests for it are open.
- The sample team of the demo shows sample build requests (`apps/docs-site/src/lib/building-sample.ts`) and never
  reads GitHub for them; `npm run dev:scenario S19` serves the same ones for a local fixture team.
