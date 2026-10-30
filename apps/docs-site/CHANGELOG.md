# @bridge-ds/docs-site

## 0.22.3

### Patch Changes

- a367cfe: Being built: a request closed as not planned stays in All for 7 days after it was closed (`BUILD_DECLINED_DAYS`), then leaves the list, its counts, the page sentence and the empty state; a library branch from Figma closed without building is dated by its close. Each row's thumbnail shows the request's own In code now and In Figma pictures, labelled with its component (the component placeholder otherwise), and each of Claude's fixes is its own row, hovered as "Button: Claude's fix from Figma".
- 1a147ba: Exploration page: one "Open the preview" button (it opens the preview with the Bridge toolbar, Before and After, when the product supports it) beside "Continue in Claude", as one row on desktop and stacked on phones. "Try it in the product" is gone from this page.
- f8a1085: Every way into an exploration opens its exploration page. A link that names it as a change (Home, notifications, search, an old `?pr=` address) now lands on the exploration page instead of the change review, so designers never see the review footer or developer checks there. A running exploration whose `exploration` label is missing (an open draft on `explore/*` or with the Bridge block) still counts as running everywhere (core `isUnlabeledExploration`, used by `explorationStatus` and `isHeldExploration`), and Studio puts the label back when someone who can write opens it. Starting one labels it more reliably: `exploration` goes on by itself with retries, a product label GitHub refuses no longer takes it down too, and what is still missing is reported (`labelsMissing`). The feature sentence is no longer copied into the purpose when it is the name.
- 7af0bfc: The Bridge toolbar reads GitHub through Bridge's read proxy (new `proxy` prop, default production Bridge) instead of anonymous browser calls, so Before and After keep working past GitHub's 60 reads an hour per visitor. It reads GitHub directly when Bridge refuses or cannot be reached. Bridge's read proxy answers GET reads of public demo teams to the product origins their bridge.config.json names (CORS, no credentials).
- Updated dependencies [a367cfe]
- Updated dependencies [f8a1085]
  - @bridge-ds/core@0.23.0

## 0.22.2

### Patch Changes

- 0b4bba9: The exploration page puts "Try it in the product" back next to "Open the preview": it opens the exploration's preview
  with the Bridge toolbar, so Live product and This change flip on the same screen. It shows for a product whose
  production Bridge knows (`products[].production`, or `previews.production` for the Admin demo), in the design system
  repository or in the product's own. "Open the preview" now opens the preview as it is, without the toolbar. "See the
  product today" uses the product's own `production` URL when it has one.
- Updated dependencies [8f73c2d]
  - @bridge-ds/core@0.22.0

## 0.22.1

### Patch Changes

- 2dbb61f: Being built: Claude's fixes are rows of the one list, with the same tags and filters, asked by a name, and where each one stands comes from its pull request (a merged fix reads Shipped). The separate "Claude's fixes" section is gone.
- dc3fec0: Exploration fixes from dogfooding. The draft pull request title keeps the name as typed and never doubles the prefix ("Exploration: Exploration page, pick up where you left off"). Branch slugs go up to 60 characters, cut on a word boundary, so a valid name is kept whole. A person's commit with Claude's co-author trailer is credited to the person ("Florian with Claude"); Claude alone only when no person authored it (`isClaudeAssisted`, `humanAuthorOf`, `actorName`). The pull request body lists every configured preview app and points to the Vercel comment when the branch is too long for a predictable link, instead of saying previews are not set up. In Studio, signed-out visitors read display names from the commits and the author's public profile, and visitors without write access no longer see the Done exploring card; while the preview builds, the button reads "Preview is building" with a spinner at full contrast. `npm run build -w @bridge-ds/cli` builds @bridge-ds/mcp first when its dist is missing or stale, so the CLI no longer crashes in a fresh worktree.
- 949b731: "Done exploring" replaces "Promote to review" for explorations: the pieces the designer ticks go to the DS lead as requests with a link to the preview, the `exploration` label gives way to `ready-for-devs`, and developers take the branch as a starting point (`git fetch origin`, `git checkout explore/<name>`). Nothing is closed or merged, so the preview link stays alive; statuses read Waiting for code, Being built, Shipped. "Archive" (the `archived` label) hides an exploration from the lists without closing it, with an Archived filter in Changes. New: `doneExploringOnGitHub`, `archiveExplorationOnGitHub`, `proposePiecesOnGitHub`, `pieceRequest`, `bridge explore done|archive|unarchive`, `bridge_archive_exploration`; `bridge_promote_exploration` and `bridge explore promote` keep their names and now do Done exploring.
- 1df6116: The line Studio gives to say to Claude AI after starting an exploration now only opens the exploration with the Bridge library and hands control back ("I'll tell you what to explore."). It no longer asks what the library is missing up front: that report stays with bridge_missing_pieces when the designer finishes.
- dc3fec0: The exploration page picks up where you left off. While an exploration runs, Studio shows one of two states. Not started (nothing on the branch beyond the Bridge note): "Not started", who started it, "Nothing built yet" with the line to paste in Claude (Claude app or Terminal), "Continue in Claude" that copies it, "See the product today" and an empty "Your preview" frame. Exploring: who changed what and when in words (files mapped to screens and components, else the commit subject), the preview with "Open the preview" and "Continue in Claude", the "Happy with it?" card with Done exploring, and the last 3 events. The breadcrumb items sit on one baseline. Core adds the shared words (`explorationStage`, `continueLines`, `explorationActivity`, `lastActivity`, `whereItStands`) and `GitHubClient.listPullRequestCommits`. Claude resolves "Continue Bridge exploration #12" (or shop#12) with the new `bridge_continue_exploration` tool (`bridge explore continue` in the CLI): it switches a clean checkout to the branch and starts by saying where it stands. At the start of a session the server instructions have Claude offer, once, to continue the person's running explorations (`bridge_list_explorations` takes `mine`).
- 32948b0: Explorations created in a product's own repository (`products[].repo`) are no longer invisible after creation. Studio (Changes, home, Being built), `bridge explore list` and `bridge_list_explorations` read each product repository once (through the GitHub sign-in or Bridge's read proxy) and list its explorations under their product; a repository Bridge cannot read is skipped silently in lists and shown as not connected in Settings, `bridge products` and `bridge_list_products`. They open at `changes/?exploration=<n>&product=<key>` and are named `shop#12` by the CLI and Claude. Missing pieces, Done exploring, Archive and the developer section run against the product pull request; the requests from ticked pieces are filed in the design system repository with a link back (`owner/name#12`) and the product preview. Status follows the product pull request. New in core: `listProductExplorationsOnGitHub`, `parseExplorationRef`, `explorationRefLabel`, `productRepos`, `productOfRepo`, and a `library` client option on `doneExploringOnGitHub`, `proposePiecesOnGitHub`, `openLibraryBranchOnGitHub` and `productBranchViewOnGitHub`.
- 51da8b4: Explorations for a product with its own repository (`products[].repo`) are now created in that product repository by default: the `explore/<name>` branch and its draft pull request live where developers already work, and the library arrives as the npm package. Studio's "Create branch", `bridge_start_exploration` and `bridge explore start` share the rule (`productRepoOf`, `productRepoAccess`). When Bridge cannot reach the product repository, Studio says so in one line with "Ask an admin to connect <product>" and starts it in the library only if the person picks "Start in the library instead"; Claude gets the same message and asks before using `where: "library"`, the CLI takes `--in-library`. The purpose of an exploration is now optional everywhere: nobody is asked for a brief, and Claude starts one as soon as a designer says they want to explore.
- d91b46a: Publishing Claude's usage guidance from the docs editor now counts as its review: the drafts still pending go out kept (credited to Claude, `needsReview` false) instead of marked for a review nobody is asked for, and the send step says so. On the Studio home, a guidance draft someone already sent no longer waits on you: published, it reads "On its way to the library"; sent for review, "In review", and it opens the change. VisuallyHidden's guidance, published in #610, is marked reviewed.
- 2fb731d: Studio: an exploration of a product with its own repository that cannot be read links to its pull request in that repository, and tells a signed-out visitor to sign in (Bridge shows explorations of private products only to people who are signed in), instead of only "it cannot be read right now".
- 4ffd06f: "Try it in the product" never opens a canceled deployment. When Vercel's Ignored Build Step skipped a branch's build (an exploration that only has its note file), the branch alias opened "Deployment was cancelled". Core now marks such a preview `skipped` (from the Vercel commit status description or its comment), `productPreview` and `previewLinksOf` leave it out, and `CommitStatusLike` carries the status `description`. In Studio, a product branch with no build of its own opens the product as it is today (its production URL, else its preview pattern on the default branch) with "Same as the product today. Your preview appears after the first change." next to the button; a build in progress says "Preview is building" and a failed one "Preview not available yet", with the details under For developers. While exploring, the page no longer asks the designer to check what is missing from the library: the sentence and the "Missing from the library" zone show once the pieces were checked or after Done exploring.
- Updated dependencies [c8ebeda]
- Updated dependencies [dc3fec0]
- Updated dependencies [949b731]
- Updated dependencies [dc3fec0]
- Updated dependencies [32948b0]
- Updated dependencies [51da8b4]
- Updated dependencies [fedd0c0]
- Updated dependencies [d91b46a]
- Updated dependencies [54a8c8c]
- Updated dependencies [6a44454]
- Updated dependencies [e8a6e7b]
- Updated dependencies [4ffd06f]
  - @bridge-ds/react@1.8.2
  - @bridge-ds/core@0.21.0

## 0.22.0

### Minor Changes

- d13ef5d: Sign in with Bridge in the Figma plugin. Designers connect with the Bridge account they already use: the plugin opens Studio with a one-time code (`/studio/connect-figma/`), they pick their team, and the plugin receives the team's repository and the GitHub sign-in Studio holds, with no token to paste and no secret on screen. The new `POST /api/plugin-link` keeps codes in Redis for 5 minutes, single use, and checks with GitHub that the sign-in can open the chosen team's repository. When the sign-in expires, the plugin says "Sign in again". A pasted token stays available under "For developers: connect with a token".

### Patch Changes

- 537952e: Explain the one 400 that opens every Claude session on the hosted connector: Claude probes the stateless MCP 2026-07-28 revision first and falls back to initialize when Bridge (2025-11-25 and earlier) answers 400 without a modern error, as the spec's era detection says. A test replays the handshake (probe 400, initialize 200, initialized 202, tools/list 200).
- b447dc4: The Bridge connector shows as Bridge with the Bridge mark: the MCP server's initialize answer carries `title: "Bridge"`, `websiteUrl` and `icons` (MCP 2025-11-25 Implementation, PNG 192 and 512 plus the SVG), and the site serves `favicon.ico` (16, 32, 48), `apple-touch-icon.png`, `icon-192.png`, `icon-512.png` and a `site.webmanifest` named Bridge, linked from every page head.
- 163315e: Hardening: deleting a Bridge account ends its connections in Claude and deletes the GitHub tokens Bridge kept sealed for them; the Figma plugin hand-off keeps the GitHub token sealed while it waits, bound to its own link; the hosted connector never merges (`bridge_merge_branch` is neither listed nor run there, a person merges from Studio or GitHub). `createServer` and `handleHttp` take `{ exclude }` to leave tools out; the local CLI and MCP server keep every tool.
- ff3aea1: Ship: Bridge checks who asks and where a change comes from before it ships a push from Figma by itself. The author, with write access, records the push right after the plugin opens it (`POST /api/ship` with `mark: "figma"`), and Bridge ships it only while the head is the one it recorded, from a branch of the repository itself, with no change requested. Anything else follows the design approval rule. The plugin records each push before it asks Bridge to ship it.
- Updated dependencies [17f2849]
- Updated dependencies [acff80f]
- Updated dependencies [009a5ee]
- Updated dependencies [579f4a2]
- Updated dependencies [00cdee5]
- Updated dependencies [40b45ea]
- Updated dependencies [8a83d88]
- Updated dependencies [8cef447]
- Updated dependencies [6842370]
  - @bridge-ds/core@0.20.0
  - @bridge-ds/react@1.8.1

## 0.21.0

### Minor Changes

- b372de6: The demo for visitors, as the approved boards show it (D1, D1b, D2). A "Demo workspace" banner over every Studio page says the data is read-only sample data, with "See it on GitHub" and "Use your own repo" (it opens "Create a new team"). Studio home is the signed-in home from the DS lead's seat: "Good evening, Dana.", "8 changes need your review. Ann and Claude AI are waiting on Dana, who leads this design system.", the Needs you rows with their Review buttons, the grouped row with "Review all (N)", the library health line and "Explorations and branches". A three-step tour runs on the first visit. Every action that would change the demo (Create branch, New brand, Send suggestion, Approve, Start an exploration...) opens "Sign in with GitHub to do this for real." The demo is one list (lib/demo.ts DEMO_REPOS), and its activity is read through one function (scripts/demo-home.ts readDemoActivity) so a published activity snapshot can replace the GitHub reads. Owners with write access keep the normal Studio. The Studio side nav's ground now runs the full height of long pages.
- 080008c: Invite collaborators: a dialog from the team menu and Settings that takes several work emails, a role picker (Can view, Can edit, Reviewer as Designer or Developer, Admin) and lists who has access with Resend. Settings > Members lists the team with a role and a More menu per person for admins (Make admin, Remove from team with a confirm step), and as read only text for everyone else. The sample team shows its sample people and opens the demo dialog on every change; a site without invites set up says so and sends nothing. New page /studio/invite/ where the invitation email leads.
- c399625: Invites, hardened. Only the invited person can accept: the GitHub account must have the invited email, verified (the GitHub Apps need the account permission "Email addresses: Read-only"; people signed in before sign in again). Otherwise nothing is granted, the invite stays valid, and the invite page says which address it was sent to, masked ("m•••@acme.design"), and how to fix it. Daily caps per admin (20), per team (40) and for the whole site (80), overridable with INVITES_MAX_PER_ADMIN_DAY, INVITES_MAX_PER_TEAM_DAY and INVITES_MAX_SITE_DAY, plus a 10 minute pause and 3 resends a day per invite: over a cap the server answers 429 and Studio says "You reached today's invite limit. Try again tomorrow." Each invite record now expires in Redis with the invite and is deleted on accept and cancel.
- 81ef880: Invites by email, the server side: `/api/invites` keeps pending invites (email, role, team, who invited, expiry, only a hash of the link token) in an Upstash Redis store, emails a one-time link through Resend, and once the invitee signs in with GitHub gives their account access with the role's permission (Can view: read, Can edit: write, Reviewer: write plus a pull request listing them as design or tech owner, Admin: admin) using the Bridge Direct app's installation token. Admins change roles, remove people, resend and cancel invites; every call re-checks the caller on GitHub. Without storage, email or the app configured, it answers "Invites are not available yet on this site." Setup in docs/HOSTED.md.
- 0d1d8bb: Library access, server: /api/library-access stores who reads each team's Library (Anyone with the link, Anyone with a work email at listed domains, Only the team; admins only, checked on GitHub), emails readers a one-time sign-in link (15 minutes, only its hash kept, exact domain match, consumer domains refused), and opens a signed httpOnly session cookie for that team's Library (30 days, ended at once when the setting changes). Private Libraries are served from their published snapshot with a read-only app token after the session check; public ones keep 0 GitHub API calls. Daily caps per email, network, team and site. New env: LIBRARY_SESSION_SECRET (docs/HOSTED.md). Invites now offer contributor roles only: the server refuses Can view for new invites and role changes; existing ones keep it.
- 92f35f8: Library access, Studio and Library: Settings has a Library access band (who reads the library: Anyone with the link, Anyone with a work email at your domains, Only the team; admins change it, everyone else reads it) with Copy library link to share it with the company. A team Library that asks for a work email shows a calm gate: enter your email, Check your inbox, a wrong domain said on the field ("This library is open to @acme.design emails. Ask your design system team for access."), an expired link, or not available yet on this site; Only the team asks to sign in from Studio. Private Libraries open from the snapshot this site serves after the check. The sample team shows "Anyone with a work email at acme.design" and Save opens the demo dialog, with no call. Invites and Members offer contributor roles only (Can edit, Reviewer, Admin); someone who already has Can view still shows it and can be moved to a contributor role.

### Patch Changes

- 3bf221d: How Bridge compares: three marks (does it, does part of it, does not) instead of two, with the reason for each half mark in a tooltip and on /compare/. Cells re-checked against public docs (October 2026): Figma Make, Figma branch review, Tokens Studio branch reviews and more now get the credit they are due. The homepage table and /compare/ share one data source.
- 0b415fd: MCP server: the README lists every tool, generated from the server (`npm run readme:tools -w @bridge-ds/mcp`), and a test fails when they disagree. `bridge_plan_revert` lists 50 edits, conflicts and changes at a time with the totals (`limit`, `offset`) and cuts a very long PR body; `bridge_draft_docs` returns its prompt in pages (`page`) with a summary first. The docs draft lists only the contrast pairs the component takes part in (both sides among the tokens it reads, aliases followed), not every pair that shares a surface with it. `/llms.txt` no longer links the missing `/foundations/` page and links `/tokens.css` and each component's `/docs-ai/<component>.json`.
- Updated dependencies [fbf7f55]
- Updated dependencies [7eb8a27]
- Updated dependencies [aaac948]
- Updated dependencies [29162d9]
- Updated dependencies [401cdcc]
- Updated dependencies [efb3281]
- Updated dependencies [3364ee9]
- Updated dependencies [d89f7b7]
- Updated dependencies [57b8d89]
- Updated dependencies [3ed1ee5]
- Updated dependencies [afd9ba2]
- Updated dependencies [4fd6e15]
- Updated dependencies [e52619d]
- Updated dependencies [64d3e8b]
- Updated dependencies [9044d1a]
- Updated dependencies [48ee872]
- Updated dependencies [af6e3e9]
- Updated dependencies [ea27992]
- Updated dependencies [e65d3ee]
- Updated dependencies [4fb54b4]
- Updated dependencies [e1d05e0]
- Updated dependencies [e806350]
- Updated dependencies [f5cfbf0]
- Updated dependencies [02d38ad]
- Updated dependencies [8919183]
- Updated dependencies [7b9e2c2]
- Updated dependencies [7c52639]
- Updated dependencies [afa59e8]
- Updated dependencies [eb4ace6]
- Updated dependencies [0ed940f]
- Updated dependencies [9be32eb]
- Updated dependencies [e075f3b]
- Updated dependencies [fe906a6]
- Updated dependencies [a83618b]
- Updated dependencies [788b3f8]
- Updated dependencies [7f6064b]
- Updated dependencies [f7751a1]
- Updated dependencies [60388db]
- Updated dependencies [4f3102a]
- Updated dependencies [e9fd0c7]
- Updated dependencies [0b3aa07]
- Updated dependencies [dd97e25]
- Updated dependencies [9d0dc16]
- Updated dependencies [a9cbbab]
- Updated dependencies [1635400]
- Updated dependencies [57f26bf]
- Updated dependencies [30e8c14]
- Updated dependencies [4c8a5dc]
- Updated dependencies [43b6e31]
- Updated dependencies [d37207a]
- Updated dependencies [db8e449]
- Updated dependencies [4dc69ae]
- Updated dependencies [e4c34ee]
- Updated dependencies [ce6a8c7]
- Updated dependencies [fd0191c]
- Updated dependencies [4d61987]
- Updated dependencies [1c4e347]
- Updated dependencies [44f49ff]
- Updated dependencies [07380d7]
- Updated dependencies [ff50cd9]
- Updated dependencies [1c5563b]
- Updated dependencies [b822435]
- Updated dependencies [c0731d6]
- Updated dependencies [8fa49c7]
- Updated dependencies [d54ace8]
- Updated dependencies [d199eb5]
- Updated dependencies [96acdf2]
- Updated dependencies [d157472]
- Updated dependencies [eb4d6ce]
- Updated dependencies [8403d3d]
- Updated dependencies [f198e92]
- Updated dependencies [2b01116]
- Updated dependencies [27dff7f]
- Updated dependencies [c46846d]
- Updated dependencies [efa01d6]
- Updated dependencies [d8848ff]
- Updated dependencies [7f9930c]
- Updated dependencies [9ec466a]
- Updated dependencies [d8c7494]
- Updated dependencies [fb3815b]
- Updated dependencies [306774c]
- Updated dependencies [5309e2e]
- Updated dependencies [4aa0cd7]
- Updated dependencies [80ee954]
- Updated dependencies [df92fcf]
- Updated dependencies [d8e5e84]
- Updated dependencies [fe5fb1b]
- Updated dependencies [2d89e58]
- Updated dependencies [625a692]
  - @bridge-ds/core@0.19.0
  - @bridge-ds/react@1.8.0

## 0.20.1

### Patch Changes

- 037b56b: Hosted Studio for guests: signed out, a team's pages read its published `activity.json` (no GitHub API request), with "Updated 5 min ago" in the guest banner. History works for guests. What the activity did not record is read live, and a read GitHub refuses for the hourly limit falls back to it. Without it, identical anonymous reads go out once and are reused for two minutes in the tab. Every Branches row gets its status when the activity covers it, and the list never ends on an older paint.
- Updated dependencies [037b56b]
  - @bridge-ds/core@0.18.0

## 0.20.0

### Minor Changes

- 782dc75: Library and Studio headers: one switch replaces the "Open Studio" and "Library" buttons. A white pill names the space you are in, on a Deep Harbor track, with the other space as a drawn icon (pen and notes, open book). It carries the page's item across (Button in the Library opens Button in Studio, and back), keeps the team on team shells and team Libraries, and stays in the header on phones.

### Patch Changes

- 9dc3421: Homepage closing: the profile card the walkers carry is now a DS Card with a DS Avatar and a full-width "Connect on LinkedIn" button. Real padding and rhythm, about 20% larger, and the whole card is one link with the Card's hover lift and focus ring.
- be7d93d: Homepage, design system lead section: Dana's avatar stroke is Deep Harbor.
- 8bc361a: Homepage, design system lead section: Dana's avatar has a white stroke instead of a drop shadow.
- 9f111af: Studio team chip: it now describes the design system you are looking at, never your account. On the demo it shows the Bridge mark and "Bridge demo" (the repository in the tooltip) with "Explore freely" for visitors without an account, and its menu offers "Create a new team" and "Sign in with GitHub". On a team page a visitor without an account reads "Guest". Signed in, the chip keeps Admin, Can edit, Can suggest and Read only. Being signed out is said once, in the account block at the bottom of the nav.
- 3cf7e57: Homepage hero: back to Explore with AI. / Keep what works / in your design system., with an 80px protection space between the headline and the drawing.
- 4774fa4: Homepage hero: "design system." sits on its own line (Explore with AI. / Keep what works in your / design system.).
- 4b86d9e: Homepage: the step illustration panels lose their border and shadow, so the drawings sit straight on the page.
- 12e363f: Homepage: the step sections' drawing panels sit on a white card (the raised surface, neutral 800 in dark) with the emphasis hairline and the card elevation, instead of a grey fill.
- 5ec4a47: One status per branch, everywhere. `reviewStatusKind` is the single derivation for the Branches list, the branch page, the home cards, `bridge_what_needs_me`, `bridge_branch_status` and `bridge branch status`. A repo with no automated checks is a calm state of its own ("No automated checks", `CI_STATE_LABEL`) and the status comes from the approvals, as for any branch. While GitHub computes whether a branch merges cleanly, a missing approval still shows; "Checking for conflicts" only holds back "Ready to merge". The words live in core (`REVIEW_STATUS_LABEL`), and the branch page header now shows the same pill as its row ("Owner override needed", "Design owner to approve") instead of a plain "In review".
- e849e5c: Studio team chip, Recent teams: a team joins the list only after its page read the repository (public, read, write, admin or outside contributor), never because someone typed it in the launcher or the Create a new team dialog, and a team GitHub answers 404 for leaves it. Placeholders such as owner/repo or owner/design and invalid names are cleaned out of the stored list when it is read. Each entry now has a "Remove from recent teams" action, a sibling menu item on the same row, reachable with the arrow keys, that updates the list in place.
- 5ec4a47: Suggestions, visual checks and titles. A suggestion whose change no longer applies to main (main moved and the value it changes is not the one it was suggested from) reads Outdated in Studio, `bridge_list_suggestions` and `bridge_get_suggestion`, through one core rule (`suggestionStalenessOnGitHub`, over `planSuggestionApply`). An applied and closed suggestion keeps only its final label ("suggestion: applied"; "suggestion: declined" when declined): `bridge_apply_suggestion`, `bridge_link_suggestion`, `bridge apply` and a merge from Bridge (`markSuggestionsAppliedOnGitHub`) remove "needs review" and "applying". The visual-check label and "the visual comparison runs again" are offered only when the repo has the visual impact workflow (`hasVisualWorkflow`, `visualOffer`); otherwise the branch page shows a quiet "Set up visual checks" link. Request and suggestion titles are never prefixed twice ("Select: select: ...") and keep component names as written ("EmptyState"), through `subjectTitle`.
- Updated dependencies [5ec4a47]
- Updated dependencies [5ec4a47]
  - @bridge-ds/core@0.17.0

## 0.19.0

### Minor Changes

- 66374cd: Studio: "Create a new team" in the team chip menu now opens a dialog over the page instead of leaving for the launcher on Studio home, so you keep your place. Paste owner/repo or a GitHub address; after a short pause a calm line says what you will find there (Ready, Read only, Bridge is not installed yet with "Install Bridge" for admins, Not found or private, or Sign in to check). The dialog and the Studio home launcher share one parser, the same error words and the same team address (lib/team-open.ts).

### Patch Changes

- a1825f7: Homepage hero: one call to action. Get started stands alone, with "Or explore the demo, no account needed." under it.
- 09f9912: Homepage hero: the drag slider is replaced by the approved illustration. Dana unpins the Profile header sketch from her AI exploration board and drops it in the Bridge machine; the known pieces go back to their twins in the design system, the new one is clipped into it, then code and the Figma kit follow (a 9.6 s loop, the final frame under reduced motion). The drawing column is wider (up to 680 px) and the headline stays about 57 px at 1440.

## 0.18.0

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

### Patch Changes

- Updated dependencies [da3e4ea]
  - @bridge-ds/core@0.16.0

## 0.17.0

### Minor Changes

- a448574: Review and New brand are real on team pages. Review lists what waits on you in the team's repository (its branches, suggestions, guidance drafts and contrast failures) and opens each one in place, with the same queue as the self-hosted Studio. New brand runs the four-step flow on the team's own tokens, brands and contrast pairs, and sends the brand the way the team's `changes` mode says: a suggestion, or a draft branch. In direct mode the first branch asks for Bridge Direct's OK before anything is sent. Drafts are kept per team in the browser.

## 0.16.1

### Patch Changes

- 6ca43c0: The Content-Security-Policy is enforced (`Content-Security-Policy` instead of `Content-Security-Policy-Report-Only`). Violations are still reported to `/api/csp-report`. The site has its own not-found page, replacing Vercel's platform 404 page, whose inline scripts the policy blocks.
- 4c76db7: Team Libraries are noindex on the server: every `/library/<owner>/<repo>/` address answers `X-Robots-Tag: noindex`, except the teams in the committed allow-list `hosted/public-libraries.json`. The build fails when `vercel.json` falls behind the list and prints the rules to paste.
- ff21200: The bridge-data workflow template pins @bridge-ds/cli ^0.11.0, the first published version with bridge snapshot.

## 0.16.0

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

- Updated dependencies [9b0b653]
  - @bridge-ds/core@0.15.0

## 0.15.0

### Minor Changes

- 440f717: Team pages always sign in with the read-only Bridge app. When a team in direct mode saves code for the first time
  (start a branch, save to it, ship, review), Studio explains why in "Allow Bridge to save to branches" and asks for
  Bridge Direct's OK once, then lands back on the same page. Its token lives in its own slot next to Bridge's;
  suggestions and comments keep going out with Bridge. When Bridge Direct is not on the team's repository, admins get
  "Install Bridge Direct" and everyone else "Ask your lead". New optional `GITHUB_APP_DIRECT_SLUG`. The self-hosted
  Studio is unchanged. Core: a `fetch` that throws its own `GitHubError` keeps it instead of turning into "Could not
  reach GitHub".
- 79650d3: A team's Bridge says who gets in: one screen per GitHub access state (sign in first, no access with "Ask your lead for access", Bridge not set up with the install link for admins only, read only outside the team), a team chip at the top of the Studio side nav with your access, and "Invite your team" (the team link, "Who can do what", Manage access on GitHub for admins) as an onboarding step and in Settings. Onboarding is remembered per repository, and step 2 shows the hosted states.
- bad4f0a: Studio team context in the browser (multi-team PR 2b). `scripts/repo-context.ts` names the repository a page works on
  (the team address `/studio/<owner>/<repo>/` on a team shell, else `#bridge-repo` as before) and its settings
  (`siteConfig`), and loads a team's repo model from GitHub with core `loadRepoModel` and `gitHubSource`, cached in
  IndexedDB by repository and head sha (`scripts/repo-cache.ts`). Access is now read per repository with core
  `resolveRepoAccess` and its eight states (`resolveAccess`, `lib/access.ts`); a read-only outside contributor is no
  longer told that Bridge is not installed. Sign-out removes cached private repositories. Signing in with one GitHub App
  no longer removes the other App's sign-in, and `pickSignInApp` signs in for identity with the read-only app first,
  with Bridge Direct only to write in direct mode. The self-hosted site behaves as before.
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

- 55a0992: Team pages for the hosted Studio (multi-team PR 3b). Home, Components, Quality and Tokens on
  /studio/<owner>/<repo>/ now render in the browser from the team's repository: this browser's cache for the default
  branch head first, then the team's Bridge snapshot when it was computed from that head, else a live read from GitHub.
  Components lists the team's components with one Storybook preview in the drawer, or token specimens without a
  Storybook. Quality shows the contrast gate, token findings, docs completeness and adoption audits from the snapshot
  (or how to publish them). Tokens starts the same explorer and token editor from the team's files, with history read
  through GitHub when signed in. Loading skeletons, calm empty states and errors with Try again (rate limit, repository
  not found, too large to read).
- 6b95bfb: Team addresses for the hosted Studio (multi-team PR 3a). Every Studio page is also built as an empty team shell at
  `/team-shell/...` (`<html data-hosted data-shell>`, `noindex`), and `vercel.json` rewrites `/studio/<owner>/<repo>/...`
  and the escape form `/studio/~/<owner>/<repo>/...` to it, two rules per form with the trailing slash one first. Static
  files still win, so every existing `/studio/` page and deep link is unchanged. On a shell, the build-time Studio links
  follow the team (`scripts/team-links.ts`), and the page says team pages open there soon, with the same page on the
  demo. The build writes the paths a team can never take, read from the built Studio folder, to
  `/team-shell/reserved.json`, and fails on a missing or malformed shell or on a link to a Studio path no file serves.
  Team addresses and shells answer `X-Robots-Tag: noindex`. With `BRIDGE_HOSTED=1`, Studio home shows "Open your team's
  Bridge": a field that takes `owner/repo` or a GitHub address. `scripts/hosted-smoke.mjs` checks a deployment.

### Patch Changes

- 1c7c87d: The Install Bridge Direct link on team pages points to the real app, bridge-design-studio, by default.
- 9d40c77: Harden every HTML sink against repo and GitHub content, and ship a report-only Content-Security-Policy. Markdown links allow only http, https, mailto and relative targets, JSON embedded in pages can no longer close its script element, PR, preview, Figma, Jira and image URLs go through one URL allow-list, token values in inline styles drop `url()` and declaration breakouts, and docs.json example props lose raw HTML, handlers and unsafe URLs. A test lists every file that writes HTML with what makes it safe. `tryInProductUrl` returns an empty string for a preview that is not http or https. The docs site sends `Content-Security-Policy-Report-Only` (inline scripts allowed by hash, checked at build time), `X-Content-Type-Options` and `Referrer-Policy`, and collects violations on `/api/csp-report`.
- 662fb55: The docs site builds from the repo model: `loadRepoModel(fsSource(root))` runs once per build (`lib/model.ts`) and
  the token, component, contrast, explorer, history, Figma coverage, config and sign-in libs read it instead of their
  own parsers and hardcoded paths. `bridge.config.json` is parsed once; the site's settings come from core
  `siteRepoFromConfig`. A model problem (invalid config, unresolved alias, contrast pair on a missing token, docs.json
  that does not parse) fails the build, as before. Core fix: a component's description is the JSDoc right before the
  component, no longer everything from the first JSDoc of the file (a documented props interface leaked into it). The
  `href` option of `loadRepoModel` also receives the token path.
- 24b0db5: Every Studio link, redirect and Studio file fetch goes through `studioHref(path)` (`lib/team-path.ts`, also exported
  from `lib/nav.ts`), multi-team PR 2d. In self-hosted mode and at build time it returns `/studio/<path>` unchanged; on a
  team shell (`<html data-hosted>`) it keeps the team, `/studio/<owner>/<repo>/<path>` (or the `/studio/~/` escape form).
  The address parsing (`repoFromPath`, `isHosted`) moved there from `scripts/repo-context.ts`, which re-exports it. The
  explorer's token link helper is now `tokenFocusHref`. A new test, `no-studio-literals`, fails on any new literal
  `/studio/` path outside `team-path.ts`, `nav.ts` and `redirects.ts`; the three fixed exceptions (the OAuth callback in
  the sign-in lib and the token API, and an inline script on the Library tokens page) are listed with their reason. The
  built site is unchanged apart from chunk hashes and one new shared chunk.
- Updated dependencies [1a560aa]
- Updated dependencies [440f717]
- Updated dependencies [a797699]
- Updated dependencies [9d40c77]
- Updated dependencies [4fb3153]
- Updated dependencies [662fb55]
- Updated dependencies [0986099]
  - @bridge-ds/core@0.14.0

## 0.14.0

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

## 0.13.0

### Minor Changes

- 832ef94: Studio reads a published Storybook without the repository. Onboarding step 2 takes a Storybook URL: "Add Storybook"
  reads its index, keeps the address in this browser and says how many components it found. Studio > Components from
  Storybook (`/studio/components/storybook/`) lists them by family, with search, and opens a drawer per component with a
  live preview of each story or docs page, or a link to Storybook when the host does not allow embedding. Tokens,
  contrast checks and suggestions say in one line that they need the repository connected. A new `/api/storybook`
  function reads the index server side when the host sends no CORS header and reports whether previews may be framed,
  behind SSRF guards: https only, public addresses only after DNS, fixed paths, 3 redirects, 5 s, 5 MB.

### Patch Changes

- Updated dependencies [87cfb75]
  - @bridge-ds/core@0.12.0

## 0.12.0

### Minor Changes

- 7d5c34c: Studio reviews suggestions. A suggestion that waits on you shows on Home and in the review queue next to branches, and counts in the Branches badge (one list for all three). It opens on its own card, in the queue or from Branches (`?suggestion=N`, and from a product branch's missing pieces): who suggests it, Before and After, three proof chips (design system checks, contrast in light and dark, where it is used, re-run on today's main), a big Approve with Suggest changes next to it, Decline in More actions, and the next items stacked behind. A suggestion approved for an older version, or one main moved under, says so first. Approve and Suggest changes show only to owners; everyone else reads why. Once approved, the card shows how a developer applies it. How review works has a Suggestions section.

## 0.11.0

### Minor Changes

- d278a6c: A new homepage at "/", ported from the validated test page: drag the bridge to keep what your exploration added; "Start it in Bridge", "Ship it everywhere at once" and "One system everyone can trust", each step drawn as an animated Field Guide illustration; "Decide in seconds" for the design system lead; "How Bridge compares" (a short table, every feature on demand); the questions teams ask; and the Horizon closing. A new site header (Product, Resources, About, Sign in; one sheet on phones) and footer on every product page, an About page, and first versions of the docs at /docs/ (Getting started with Bridge) and /docs/figma-plugin/ (DS Bridge Figma plugin). Light and dark themes; under reduced motion the drawings rest.
- 5f370ba: Studio: how changes reach your code, and the setup steps. Settings has a new band, How changes reach your code: the mode in force (suggestions your developers apply, or pull requests Bridge opens, from `changes` in `bridge.config.json`, suggestions when the key is absent), what Bridge's GitHub App may do on the repo when you signed in with it, and Change, which sends the switch for review as a pull request on `bridge.config.json` like the other settings. In suggest mode it says plainly that Bridge's GitHub App can still write code on the repo: suggest mode is a Bridge rule until the read-only app ships. "See what your developers get" shows how a developer applies a suggestion: `bridge apply <issue number>`, or "Apply Bridge suggestion" in Claude Code with the Bridge MCP, with the one-time install command for this repo.

  The Studio home has the setup steps: sign in, your design system, products, how changes reach your code, the Figma plugin and Claude AI. While `bridge.config.json` does not say how changes reach the code, a signed-in viewer lands on that step first, with every other step a click away and "Do this later" back to the home. After that, "4 of 6 connected" by the greeting opens what is left (Finish connecting), until the viewer hides it. The Storybook quick start shows as coming soon: this Studio reads the repository it is built for.

- 77710b5: Studio sends follow how changes reach the code (`"changes"` in bridge.config.json). In suggest mode (the default when the key is absent) the token editor, the docs editor, the new brand flow, the undo and restore planner and a product branch's missing pieces send a suggestion through @bridge-ds/core: "Send suggestion", "Suggest docs change", "Suggest to the library", then "Suggestion #42 sent to your DS lead. A developer applies it once it is approved." with one link to it. The token editor turns its draft into core token edits, so a developer re-applies the exact edits on the tokens of the day. Until the read-only GitHub App ships, suggest mode is enforced in Studio: adding to an open branch, saving docs to a branch, switching a product branch or using a preview, sending it for review and closing it refuse with a plain sentence before any GitHub call. Direct mode keeps today's branches and pull requests (this repo sets `"changes": "direct"`), and Studio's token, brand and revert pull requests now use the `tier: N` label like the rest of Bridge.
- 877b928: Studio signs in through two GitHub Apps: "Bridge" (read only on code, Issues write) by default, and "Bridge Direct"
  when bridge.config.json has `"changes": "direct"`. The token function picks the app from an allow-list of the two
  configured client IDs, tokens are stored per app, and a sign-in made with the other app is removed with a prompt to
  sign in again. Sites with one app keep signing in as before.

### Patch Changes

- c96cdc2: Page filter bars use one control size, md, like the Library tokens page. Studio Components (search and family
  Select), the Show filter of change requests and explorations, the History filters and the branch filter on Studio
  home moved from sm to md, so the search, Select and SegmentedControl in a bar share one height. The Input, Select and
  SegmentedControl guidance now says md for a page's filter bar and keeps sm for dense toolbars, menus and panels.
- 8b2ff82: Homepage, "One system everyone can trust", third tab: a new drawing for adoption quality. A magnifier sweeps a page of the Docs site and flags three off-system pieces (a one-off card, a raw hex colour, an odd button); each snaps into its Harbor system version and the components and tokens in use go from 81.7%, before the audit, to 100%. It replaces the jar drawing. Light and dark from tokens; under reduced motion it rests on the audited page.
- a265dbd: Settings, How changes reach your code: the interim sentence "Bridge's GitHub App can still write code on this repo..."
  now shows only when suggest mode runs on the Direct app (the only one configured). With both apps, suggest mode says
  Studio signs in with Bridge's read-only GitHub App instead. The mode switch pull request body follows the same rule.
- 9e6c14e: Homepage: "Decide in seconds." shows Ann and Dana with the design system's own illustrated avatars again (Notionists faces, seeds `ann` and `dana`, drawn at build time on the Harbor circle), and the Before and After panes stay still while the stack and the Approve pulse keep moving. "How Bridge compares." reads "What each tool covers, from their public pages." on one line, and its table matches the validated test page: one card holding the short table, the legend and "Compare every feature" centred, with the test page's type sizes, row heights and column widths. Copy for designers: "Your DS lead approves just the change" (tokens, components and docs, before they reach the library), "A change that breaks contrast cannot go in", "Tokens in the W3C standard format", "Two-way sync between Figma variables and code", "Works with AI agents, through MCP", and the FAQ setup answer no longer says DTCG or repo.
- Updated dependencies [d1e0bc5]
- Updated dependencies [c96cdc2]
  - @bridge-ds/react@1.7.0

## 0.10.0

### Minor Changes

- e89cf36: A product landing at "/": explore with AI, keep what works in your design system. The trip of one change down a line, from an exploration to the library branch you open in one click, the review in the product, and the design system, all built with real Bridge components. A comparison page at /compare/ (as of October 2026, from public pages, with what Figma Code Connect does and does not do). The Library home moves to /library/; every other link keeps working. The Bridge agent account (bridge-agent) is named Claude AI on reviews, like everywhere else.

### Patch Changes

- Updated dependencies [22e53c7]
- Updated dependencies [e1f8f0c]
- Updated dependencies [e59366e]
- Updated dependencies [a99fbb9]
  - @bridge-ds/core@0.10.0

## 0.9.0

### Minor Changes

- adf195b: Studio shows product branches with the library pieces they need. A branch started for a product opens its product branch page: "Try it in the product", one sentence ("Built with the library. 1 piece was missing, and Claude AI opened a library branch for it."), the screen (the before and after, when the visual impact ran) next to the Harbor zone "Missing from the library", one row per piece with its library branch, status and reviewer, and the row's one action (Open a library branch, Use its preview in my branch, Get the latest preview, Switch to the published version). "Why it already shows in your screen" and "For developers" are folded. The review of a library branch a product branch needs starts with "Why it exists" (who needs it, for which product branch, the product preview) and, when the library has a close value, "Suggest danger". Branches lists the library branch under the product branch that needs it. Titles named after a component ("Badge: overdue tone") keep it.

### Patch Changes

- Updated dependencies [5b93962]
  - @bridge-ds/core@0.9.0

## 0.8.0

### Minor Changes

- 77ba45a: Create branch in Studio is product first. Step 1 asks what you work on: a feature in a product, or a change to the library. A feature asks what you build and in which product (preselected when there is one, or from `?product=`), starts an exploration with the product's `product: <key>` label and gives you the sentence to say to Claude AI. The library keeps its choices (Adjust the look, Add a variant or option, New component), and "Something looks wrong? Report it" stays one click away. core: `productMarks` (the product label and body line, nothing for the default product) moves from the MCP server into `@bridge-ds/core`, and `startExplorationOnGitHub` takes extra `labels`, so Studio, the CLI and the MCP server write the same label. Studio home: "Your branches" gets a one-line subtitle, and the "Published this week" line is gone.

### Patch Changes

- 7e9f2df: Docs proposals: one open proposal per component. Sending docs for a component that already has an open docs proposal adds a commit to it instead of opening a second pull request (`proposeDocsOnGitHub` returns `continued`, and `unchanged` when it already says the same). New core helpers `findOpenDocsProposal`, `findOpenDocsProposalOnGitHub`, `isDocsProposalBranch`, `continueDocsProposalOnGitHub` and `docsSlug`, shared by the Library editor and the MCP server (`bridge_save_docs` without `pr` continues the open one). The Library editor opens on the open proposal ("Continues the open proposal by ..., waiting for review", with a link to its review), and Send is off with "Nothing changed since the open proposal" when the text is the same.

  Attribution: the pull request's author line now says who wrote the text (`docsAuthorLine`, `withAuthorLine`, `defaultDocsFooter`): "Drafted by Claude AI, reviewed and sent by @person" when Claude's draft goes out as written, "Drafted by Claude AI, edited by @person" with the edited sections, and "No AI involved" only when no Claude draft is in the text. The editor tracks the text Claude wrote per section (`authorship`).

- 2da5cfd: Studio Components: the Open requests column leaves the table (teams triage requests in Jira); the component drawer still counts them with a link to GitHub.
- 74fe95a: Studio: screens no longer end with the "Updated" date and "View source" line (they show live data; Library pages keep it), and the Components table drops its note under the table.
- Updated dependencies [8cdcb9a]
- Updated dependencies [77ba45a]
- Updated dependencies [7e9f2df]
  - @bridge-ds/react@1.6.0
  - @bridge-ds/tokens@1.6.0
  - @bridge-ds/core@0.8.0

## 0.7.0

### Minor Changes

- b4edf85: Avatar: illustrated faces and Claude's identity.

  - `Avatar fallback="illustrated"`: without a photo (or when it fails), a drawn face that is always the same for the same `seed` (a login), on the Harbor zone color. The drawings are the DiceBear "Notionists" style (design CC0 1.0 by Zoish, code MIT), generated locally with no network. They weigh about 120 kB gzipped, so they live in a separate entry: import `Avatar` from `@bridge-ds/react/avatar-illustrated`. The main entry keeps initials as the default and stays light; `illustration` takes a ready image if you draw faces yourself.
  - `Avatar kind="agent" brand="claude"`: the Claude mark on a cream tile, same round shape as people, named "Claude AI", to attribute work Claude did. The Claude mark is an Anthropic trademark: check the Anthropic brand guidelines before shipping it in a product.
  - `avatarHtml()` in `@bridge-ds/react/dom`, the same markup for rows built in plain scripts.
  - Tokens: `color.illustration.surface` (the Harbor zone color, a lighter step in dark so line drawings stay readable) and `avatar.illustrated-bg`; `color.agent.surface` (cream, the same in both themes), `avatar.agent-bg` and `avatar.agent-border`.
  - Studio: change rows, the change and history details and explorations show a face and the person's display name instead of "@login"; work Claude made, and Claude's guidance drafts, show Claude's identity.
  - Studio Quality: the library health cards (contrast checks, adoption, guidance) open the page, with their detail below, and Share copies a short summary for Slack or a slide or downloads the header as an image.

- 7b53159: Motion is documented and reviewed from the code. The spec generator now records how a part opens and closes: the "Opening and closing" motion note carries the code's `enter` and `exit` transitions (duration, easing and their motion tokens, read per element so a drawer's side class and its popup class count together), and looping animations carry their `durationToken`. `componentMotion` returns them as `opening` and lists their tokens, so `componentsUsingMotionToken(specs, "motion.duration.moderate")` finds Dialog and AlertDialog. component-specs.json is regenerated (popup sets gain their open and close motion).

  Every Library component page has a generated "Motion and interaction" section in its Tokens tab: when it moves (hover, press, check, open, close, loops), what changes, the duration token with its value and the easing token in words, and what reduced motion does, in one sentence. Components without motion say so in one line; motion the specs cannot place is said, never denied.

  For branch reviews, `MotionChanges` (components/ds/studio/MotionChanges.tsx) shows a plain sentence per motion change, two looping previews of the same component at the old and new motion with Replay, and the other components it touches; still frames under reduced motion. `motionChanges` (lib/motion-changes.ts) computes the changes from the token sets and specs at both commits; `mountMotionChanges` (scripts/reviews/motion-changes.ts) mounts the block from a review page.

- eb66bd7: Studio branch review, redesigned: a breadcrumb (Branches, its product group, the title), the title with its status, and one line saying who asks and why. The change itself comes first, by type: guidance reads as it will in the Library with new text highlighted and click-to-edit (Save goes to the branch), tokens show before and after with the themes they change in, components show before and after screens with "Try it in the product". Below: the conversation (people only, latest comment inline, earlier ones on demand) and one line about checks with its details. One sticky decision bar: comment, "Suggest changes", "Approve" or "Approve and merge", and "More actions" (owner override only when it is the only way, share with a product team, copy a link to the review or for a developer, back to draft, close branch). Approving accepts a Claude guidance draft. A branch with several changes gets an outline with a "looked at" reading aid. The review queue uses the same view with its own bar (comment, Suggest changes, Approve, More actions with "Ask someone else to review"), outcome marks in its list, a toast with Undo after Approve, and A, S, J, K keys. "Open on GitHub" links leave this view.

### Patch Changes

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

- Updated dependencies [b4edf85]
- Updated dependencies [22d186e]
- Updated dependencies [51e743c]
- Updated dependencies [7b53159]
  - @bridge-ds/react@1.5.0
  - @bridge-ds/tokens@1.5.0
  - @bridge-ds/core@0.7.0

## 0.6.0

### Minor Changes

- a58ba2c: Studio Branches is all the work: the summary banner, the tabs and the status menu are gone. The header holds "History" (now a link, same view at ?view=history) and "Create branch" (the Home menu). One segmented control picks Mine, Waiting on me or All; rows are the Home row (before/after, who, title, Jira key, status pill, "N updates on main · Update from main" when behind), grouped by product (Admin demo, Library); explorations are rows with an Exploration status; merged and closed branches sit behind "N merged this month. Show merged". Token branches carry a checkbox to preview up to 4 together from a floating bar: one checked offers "Try it alone", two to four "Preview together" (a dialog asks for picks when they set a token differently). Old ?status=, ?tier=, ?view= and ?pr= links keep working. Also fixes the History token filter, whose field lost its id inside the DS Field.
- 022d79b: The Studio home answers "what do I do now". A time-of-day greeting says who waits on you and since when, at most
  three Needs you rows show a before and after of each branch, and the rest wait behind "Review all", a new review
  queue with "Approve and next". Your branches are cards with their status, and an empty library offers three ways to
  start.
- 8376732: Studio speaks Figma branching.

  - One vocabulary module (lib/vocabulary.ts) for every Studio screen: Create branch, Request review, Update from main, Review and merge, Merge, Publish for the release; statuses Draft, In review, Approved waiting for code, Merged, Closed. The Changes page is now Branches (same address).
  - No "For developers" fold left in Studio or the Library changelog. Where a design system lead may want the GitHub view, one quiet "Open on GitHub" link sits on the line of the thing it concerns; Settings explains integrations and protection in plain words with a "How it works on GitHub" link.
  - Request triage left the Studio home and the Branches tabs (teams triage in Jira). The code stays behind REQUEST_TRIAGE_IN_STUDIO; "Ask for a component change" still creates a request, and a request link still opens.
  - Create branch takes an optional Jira ticket key (DS-42) in the token editor, the Library edit mode, the new brand flow and Start an exploration. The key goes first in the GitHub title (and in the branch name outside explorations) so the Jira GitHub integration links it, and shows in mono on branch rows.
  - Core: `Exploration` takes an optional `jira` key; the merge-right sentence says "can merge this".
  - Figma plugin: the review flow strings say Request review and branch.

### Patch Changes

- ed4b28d: Every visual component is in Figma: 47 of 47, 46 generated from code and 1 drafted with Claude. The generator now draws Checklist, Form, Slider, Table (and TableEmpty), Tabs and TokenValue from their code examples. New generator capabilities: CSS grid rows and subgrid rows as auto layout, `::before` / `::after` decorations as layers, Base UI indicators sized to the selected item (a tab underline) drawn in that item, unselected tab panels hidden, `data-orientation`, sliders (thumb at the value, value render functions), tables as rows of cells, form errors reaching their field, typed values in fields, functions as values, string and list methods, helpers that return elements, plain modules of the package, React's JSX text spacing, screen reader text left out of sentences, example texts shown by default, and absolute layers placed per variant. Side effects on sets already in Figma: Field and Dialog lose an empty error layer, NumberField steppers get their dividers, ChoiceCard text wraps, CodeBlock reads its wrap style.

  Toast, shown from the `useToast` hook and never placed, is drafted with Claude: a spec written from the code in `packages/react/component-spec-overrides/Toast.json` (`"source": "drafted"`), validated against the format and the repo's tokens by `npm run specs`, counted as drafted (never as generated), marked "Drafted, check it" in the Pull preview and in its Figma description, and stale once its code changes. Specs record the code example they were drawn from, so the fidelity check renders the same content (rows, fields, tabs), and the Figma references capture renders hook-shown components (a toast) through their hook.

- bdca820: Honest Figma coverage. `npm run specs` now reads every component folder and records each one in a `coverage` list of component-specs.json: generated, unsupported with the generator's plain reason ("opens a popup", "uses CSS grid", "shows content computed while the page runs"), or a layout helper with nothing to draw. Support is decided by the generator from what it can read, no list to maintain. The plugin Pull tab says "26 of 47 components are in Figma" with the others folded under the count, each with its reason, and the Studio Components page shows a quiet "In Figma" column from the same data.

  Coverage goes from 6 to 26 of 47 visual components. The generator draws 19 more (Accordion, Alert, Avatar, Banner, Breadcrumb, Checkbox, CheckboxGroup, ChoiceCard, CodeBlock, Divider, Field, Kbd, Link, NumberField, RadioGroup and Radio, SegmentedControl, Skeleton, Switch, Textarea), and Icon counts as covered by the icon components of the Icons page. New general capabilities: content props as TEXT and BOOLEAN properties, Base UI checked states as a Checked axis, layers hidden per variant, translateX and row-reverse read as auto layout, flex grow and wrap, lists and selections from the docs preview, the page base stylesheet, em sizes, underlines, opacity, fixed and per-variant icons, images as the media slot, useRender links. Fixes from the fidelity check: a transparent border keeps its room (a transparent stroke counted in layout), link buttons are underlined, inherited typography reaches every text.

- 439dbad: Studio home: the greeting drawing is cropped to its scene (no empty sky), so it no longer makes the greeting taller than its text; its ground line rests on the task list.
- f301f84: Studio home: the greeting drawing keeps a gap above the task list instead of touching it, and the row button sits at the far right (the DS Button margin reset was overriding it).
- 429314c: Studio home: the Create branch card comes first in Your branches.
- fadf8ce: Studio home: the status pill on a Needs you row sits right after the row's text; the button keeps the far edge.
- 0502ea2: Studio home: Needs you rows get a verb button by count. One item: its button is the primary ("Review", "Fix", "Open"). Two or three: secondary buttons. More than three: no row buttons, the grouped "Review all" acts. "Waiting since today" now reads "New today".
- d4240cd: Studio nav: Branches comes right after the home, which is now called Home (was Overview), and Components comes before Tokens.
- 84a9143: Studio status polish.

  - Changes: the summary line and its button point at the most urgent change where it is your turn. With none, they name the most urgent change; when only a developer can move it, the line says it waits on a developer and shows no button.
  - A change: "Ready for review" keeps one tone whatever its checks say (status colour for the status only); failing checks show in the checklist and the "Blocked by tests" chip. The Overview and the change selector use the same tone.
  - Quality audits: share bars, legend keys and trend lines use the Harbor data hue and neutrals, never the success, warning or info hues.
  - Tokens: the type chips, the filter field, Options and New token sit at the DS control height (44px), up from 32px.

- 03a76fa: Studio: when only developer tests fail and the viewer can still approve the design or tech side, the list, the Overview and the opener say "Your turn: approve design" with "A developer fixes the failing checks meanwhile", instead of "Blocked by tests". Both go on in parallel.
- Updated dependencies [f655919]
- Updated dependencies [ed4b28d]
- Updated dependencies [bdca820]
- Updated dependencies [6b07b05]
- Updated dependencies [8376732]
  - @bridge-ds/core@0.6.0
  - @bridge-ds/react@1.4.1

## 0.5.2

### Patch Changes

- 837d215: Dark mode polish and leftovers from the critiques.

  - Tokens: `color.surface.strong` (Deep Harbor in both themes, for a strong mode surface) and `color.feedback.neutral.bg` (the fill of a status with no tone, one step off every surface in both themes), each checked by a new contrast pair. `popup.border` steps up to `color.border.emphasis` so a list opened inside a Dialog keeps an edge in dark.
  - SegmentedControl: the selected segment takes the checked control color as its edge, like a pressed Button toggle; it had no edge in dark.
  - Banner `appearance="strong"`: `color.surface.strong` with `color.text.on-solid` and a matching focus ring. In dark it was the light primary action color and read like a Harbor zone.
  - Badge neutral (subtle): `color.feedback.neutral.bg`, so grey status chips keep their fill on dark cards.
  - Docs site: the owner override confirmation is the DS Dialog for plain scripts (Textarea, Alert, SegmentedControl, ButtonGroup) instead of a native dialog; All tokens filter controls share one size; Quality audit tables stack on phones; the Changes tabs fit a phone; Changes rows say "Library moved on: N updates"; failing developer tests are never "Your turn" for the designer who made the change; the search palette shows the nav icons; Tokens type chips use the selected look; rows of a viewed change say "Changed" or "New"; "Bring in the latest library" uses the standard control height.

- Updated dependencies [837d215]
  - @bridge-ds/tokens@1.4.0
  - @bridge-ds/react@1.4.0

## 0.5.1

### Patch Changes

- a54ac38: `@bridge-ds/react/dom` gains the Dialog for pages without React at runtime: `dialogHtml()` renders the exact markup of `<DialogContent>` (same classes, same look), and `bindDialogs()`, `openDialog()`, `closeDialog()`, `isDialogOpen()` and `dialogReturnValue()` give it the React Dialog behavior: focus moves in and is trapped, the page behind is inert and does not scroll, Escape and the scrim close it, focus returns to the trigger, `aria-modal`, `open`, `cancel` and `close` events, and a `<form method="dialog">` inside closes it with the submit button's value. A parity test compares it with the React Dialog. SegmentedControl: the selected segment uses the raised surface, so it no longer disappears into its track in dark mode (light is unchanged).

  The audit counts a native element only when the design system has a component that replaces it: `<img>` is no longer a miss in a design system without an Image component.

  The docs site has no temporary audit allowlist any more: its prose links are the DS Link or ButtonLink, its icons are the DS Icon (the site's own glyphs, drawn through `createLucideIcon`), the Quality audit table is the DS Table, and the search palette, New token, Send for review, Connect GitHub and Undo planner dialogs are DS Dialogs opened by their scripts. Every Studio header control is the DS sm size.

- Updated dependencies [a54ac38]
  - @bridge-ds/react@1.3.0
  - @bridge-ds/core@0.5.1

## 0.5.0

### Minor Changes

- 67ae8f7: Variants and props for the gaps Studio and the admin worked around.

  - Button and IconButton: `pressed` makes a toggle (`aria-pressed`, a selected fill and a Deep Harbor edge; the look follows the attribute, so a script can drive a static toggle). Button `variant="link"` looks like a text link and stays a button, with the DS focus ring. `variant="inverse"` is the action on a strong surface (Deep Harbor, `color.surface.inverse`).
  - SegmentedControl: `appearance="strong"` fills the selected segment with Deep Harbor. Any number of segments: when they do not fit (a phone), the track scrolls sideways and fades the edge that hides segments instead of widening the page, and the selected segment scrolls into view. The focus ring now sits inside the segment so the track never clips it.
  - Select: `badge` on an option (a status or a count), shown on the item and in the trigger once selected. `portalContainer` on Select and Combobox.
  - Combobox, Select and Menu popups sit on the popover layer, above a Dialog or Drawer, so a list opened inside a dialog is never covered.
  - Menu: `icon` also takes an element (a brand mark); leading icons and indicators show reliably and keep labels aligned.
  - Table: `width` (token length, percentage or a fraction like `0.35`) and `minWidth` on TableHead and TableCell, `layout="fixed"`, and `narrowLayout="stack"`: under about 480px each row becomes a card, every value beside its column name (`label` on a cell, or the header text).
  - Alert: `actionsPlacement="inline"` puts the action at the end of a short message and under it on a phone.

  Adopted in Studio (Changes status filter on phones, the Viewing select's status badges, view and edit banners, Components "need guidance" filter, Settings approvals on phones, Start a change menu icons and families), on the Library site (terminal Copy buttons, Accessibility Compare) and in the admin Bridge toolbar (Before/After and Show what changed toggles). Homemade CSS for these is removed.

### Patch Changes

- 5bfc7e2: The adoption audit reads Astro, Vue and Svelte files. Template markup counts DS components imported in the frontmatter or `<script>` (Vue kebab case included), native elements a DS component should render (with the DS equivalent), local look-alikes named like a DS component (`Button.astro`), hardcoded values in `style` attributes (`style="..."`, `style={{ ... }}`, Vue `:style`, Svelte `style:prop`), `class` attributes and color attributes, and token references. The frontmatter and `<script>` blocks go through the TS scanner and `<style>` blocks through the CSS audit, with the file's own line numbers. Hidden inputs and elements inside `<noscript>` do not count. New escape hatches, both with a required reason and both kept visible in the report: a `bridge-audit-ignore-next-line: reason` comment on the line above (HTML, JSX, CSS or JS comment; a comment without a reason or above nothing is reported and ignores nothing), and `bridge audit --allowlist file.json` (`allowlist` in `bridge_audit`) for known file:line violations, with stale entries listed. The report gains `files[].ignored`, `files[].ignoreErrors`, `ignored` and the `astro`, `vue` and `svelte` languages (schema updated, still version 1). The docs site's `audit:docs` now sees its raw elements; they sit in a temporary, reasoned allowlist (`apps/docs-site/bridge-audit-allowlist.json`) until the native elements migration removes them.
- f1a8b55: Five new components and a supported path for pages without React. `CodeBlock` (code or a command in Plex Mono with a copy button that says "Copied"), `TokenValue` (a token name and value with a color swatch, for before and after values), `Checklist` and `ChecklistRow` (status icon, title, one line of detail and the action on the same row), `ChoiceCardGroup` and `ChoiceCard` (radio choices shown as cards with a title and a description) and `Banner` (a page-level mode banner, Deep Harbor or neutral, optionally sticky). The new `@bridge-ds/react/dom` entry renders Badge, CodeBlock, TokenValue and Checklist as HTML strings with the exact markup and classes of the React components, and adds `tooltipAttributes()` with `bindTooltips()` and `bindCodeBlocks()` for plain-script pages. `bridge audit` counts these renderers as design system components and now flags homemade look-alikes in script-built markup (`class="pill"`, `data-tip` tooltips). Studio and the Library adopt them in place of their homemade pills, tooltips, command rows, value chips, checklist, radio cards and mode banners.
- 9494004: Studio cleanup. Changes: the "In review" tab is now "All changes", its status filter is one Select named after the status model (All open, Draft, Ready for review, Approved waiting for code, Shipped, Closed), and the "try together" checkboxes appear only after "Choose changes", so the first screen holds about half the controls. A change detail keeps one ship control: Ship sits on the title line once the change can ship, and the disabled Ship in the action bar is gone, as is "Reply on GitHub". Tokens: on a phone the type chips get their own line and every brand and theme stacks into labeled lines; the draft bar reserves room so it never covers the last rows; a token changed in one theme only says which. Core and MCP: when GitHub's hourly limit runs out without a token, the error says so and how to fix it (set GITHUB_TOKEN for the MCP server) instead of blaming "this token".
- a833202: The docs site uses its own components for every form control. The Studio Components "All families" filter is a DS Select with each family's count as a badge (it was a native select with its arrow stuck to the edge). Token explorer search, switches, filter checkboxes and radios, code syntax menu and draft bar Review; Changes exploration form and history filters; Settings integration fields; Library token type filter, scope switches, copy buttons and the header links are DS Input, Textarea, Select, Switch, Checkbox, RadioGroup, SegmentedControl, Button, IconButton and ButtonLink, and the homemade CSS that styled the native ones is gone. Plain scripts drive them through two small contracts: `lib/select-bridge` (a DS Select island that talks to a script by events, `BridgedSelect`) and `scripts/vanilla-controls` (static Switch, Checkbox and RadioGroup marked `data-vanilla`). The raw controls left are marked with a `bridge-audit-ignore-next-line` reason (script-driven dialogs, the search palette field, a hidden file picker and four whole-row buttons), and their entries are gone from the temporary audit allowlist.
- Updated dependencies [5bfc7e2]
- Updated dependencies [f1a8b55]
- Updated dependencies [67ae8f7]
- Updated dependencies [0cfc3ff]
- Updated dependencies [9494004]
  - @bridge-ds/core@0.5.0
  - @bridge-ds/react@1.2.0

## 0.4.0

### Minor Changes

- 6fe9f88: Bring in the latest library. A change in Studio now says when the library has moved on since it started ("The library has moved on: 12 updates since this change started."), read from GitHub's compare API, with a "Latest library" row in its checklist. When nothing conflicts, "Bring in the latest library" asks GitHub to update the change, then the page refreshes its checks and visual comparison; the row says beforehand what happens next, from the library's rules (checks run again, approvals need renewing when GitHub dismisses them on new commits). When the change and the library changed the same tokens, the designer resolves them in Bridge: one row per token with the library's value, this change's value and the value before both, "Keep mine" by default or "Use the library's", and no default for a token removed on one side and changed on the other. The contrast checks run on the choices before anything is sent, then Bridge commits the resolved token files on top of the latest library. A conflict in code stays with a developer, with the GitHub link under For developers. The Changes list shows "N updates behind" on each change that is behind. Core gains `planTokenMerge` and `applyTokenMerge`, a file-by-file three-way merge of DTCG token files on the same rules as the Figma sync.
- 11f40fd: Change statuses and reopen. Every change in Studio now has one lifecycle, in designer words and from GitHub data only: Draft, Ready for review, Approved waiting for code, Shipped, Closed. A change waits for code when its design approval is in, nobody asked for changes, it is design work, and every failing check is a developer check; it names the tech owners from the config, or "a developer". The change page opens on one status line (a Badge, one sentence, at most one action): Mark as ready on a draft, Reopen this change on a closed one whose work is still there, or "Start again from this change" when its work was removed (its token edits go to the draft, then Tokens sends them for review). Back to draft sits under More. The Changes list gets a status filter (Open, Draft, Ready for review, Waiting for code, Shipped, Closed; a Select on phones) and one chip per row; the opener never points at a change that waits for code. The Overview "For you" rows carry the same badge, and your own drafts show there. Core adds `GitHubClient.convertToDraft`.
- 4c313d7: Try several changes together. On Studio > Changes (Open), each change has a checkbox; checking 2 to 4 token changes combines them in the browser: the latest library plus each change's own token edits (what it changed since it started, so a change that is behind never undoes newer library values). Nothing is written to GitHub. A token two changes set differently gets one row ("Use Darker default background's" or the other change's), and nothing opens until each has a pick; the contrast checks then run on the combination itself ("All 296 contrast checks pass with these changes together."). A change that edits code is left out and says why on its row ("This one changes code, so it can't be combined here."). "Try 3 changes together" opens the demo admin with `?bridge=101,118,120`: the Bridge toolbar applies the combined tokens live on the production admin (no preview holds all of them, and it says so), "These 3 changes" replaces "This change", its Changes sheet lists the changes with a checkbox each to switch one off live, and Before/After (B) and Show what changed (C) work on what is switched on, the tooltips naming the change a value comes from. "View the library with them" opens Studio Tokens, Components and Quality on `?change=101,118` (the #116 address model, with the picks in `use`): the banner names the changes, changed tokens are marked "Changed in #118", and Quality shows no combined numbers. Core gains `changeEdits`, `combineChanges` and `encodePicks`/`decodePicks` (token-combine), and `previewOverrides`/`cssOf` move to core (css-overrides) so Studio and the admin share them.
- 1a54198: Continue a change. In Studio Tokens, a designer adds more token edits to a change already in review instead of opening a new one, like "Add to open pull request" in the Figma plugin. The send dialog asks where the edits go (a DS RadioGroup): their own most recent token change is the default, "Start a new change" the alternative, and changes someone else opened are offered to people with write access but never picked for them. A change page has "Edit tokens in this change": it opens the token editor scoped to that change, with its values and a persistent banner ("Editing: Darker default background. Your edits are added to this change.") and a way back; that draft is kept apart from the local draft. Saving rereads the change and runs the same 3-way token diff as the plugin: tokens only the change moved stay as they are, and a token edited in both stops the save with a plain message and a link to the conflict flow, so nothing is overwritten. The commit goes on top of the change's current head as a fast-forward only update, the changeset keeps listing every token, and a comment lists what was added. Only open token changes (not explorations, brands or docs) take edits, and only from their author or someone with write access. The Changes draft strip says where the draft goes, and a change page says when GitHub dismissed an approval.
- 4bfd417: Studio tells design work from developer work, and says who really made it. Work that only touches code (a title that speaks code such as "React" or "props", tests, examples, types, build or tooling only, component code the visual impact run shows no difference for, a "tech" or "developer" label) no longer shows in Needs you, on the board columns or in the Changes badge: the Overview folds it into one quiet line under the board, "Developer work, 1 in progress", that opens its list. Changes keeps every item and tags developer work "Developer", with an All, Design, Developer filter that shows when a list holds some. When nothing says what a change is, it stays with designers. An exploration card says "Claude is building it" when a real marker says an agent made it (the pull request template box, the Claude Code footer or session link, a "Co-Authored-By: Claude" commit, an agent label, an exploration or request started from the MCP server), and "You are trying it" only for what you started from Studio. The exploration block now records where it was started (`source`: studio, figma, cli or mcp) and the agent behind it (`agent`), and the CLI records `agent: "claude"` when Claude Code runs it.
- df17495: Studio Overview redesign. One line ("Hello, Florian. 1 thing needs you." or "You're all caught up.") with one primary action: the first decision that needs you, else "Start a change" (Adjust the look, Add a variant or option, New component, Something looks wrong, each with one line; the component picker opens in place). Signed out, the page asks for one thing: "Connect GitHub to start working on the library." The Harbor zone opens only when something needs you and holds every designer decision in one list, usage guidance to review included. Library health shows three figures right under it (contrast failures, component adoption with its split per product, reviewed guidance), each opening Quality. In flight is a board in four stages (Exploring, In review, Ready to ship, Next release) with at most two cards each, the blocker written on the card with one status pattern, and on phones one row per stage that opens on tap. Bridge app updates no longer show on the Overview. The Changes badge in the side nav now counts only the changes in review that wait on your decision, with the same rule as the Overview, and hides at 0.
- 8a13b25: Studio change detail, designer first. The header says why the change is blocked and who acts, in plain words: one checklist with the design rules ("296 contrast checks still pass", or the failing pair and the token to change), the developer tests ("3 developer tests expect the old color. A developer needs to update them."), then each approval. Developer failures never read "Your turn: fix checks" to a designer: a design owner can approve the design while they fail, and only shipping waits. When the author waits on approvals, the checklist says why ("GitHub does not let authors approve their own"), with Ask for review (copies a ready message) and the owner override when the viewer holds it, instead of a menu. The before and after sits right under it with "What changes on screen", how to use the slider and what is compared; the slider starts at 25% so both sides show content. Open on GitHub, How review works, the failing checks with the tests they name, and Open failing test move into For developers. Contrast pairs that moved and still pass are one click away.
- 3210f75: Share with a product team. A change in Studio gets a secondary action next to "Try it in the product" that opens a dialog with a ready-to-paste message for a developer of a product team: the change title, the preview install command the Preview packages workflow posted for the latest update (read from its comment, never guessed), the "Try it in the product" link when there is one, how long the preview lasts and how to go back to the stable version. Copy message, or Open in email (a mailto link, nothing is sent). While the preview of the latest update is being prepared, when it failed, or when the change touches no library package, the dialog says so instead of showing a command. After the change ships or closes it says whether the preview still installs: the prerelease tarballs this repository uses are removed then, pkg.pr.new snapshots stay.
- fa28131: Try it in the product. The change detail in Studio links to the demo admin preview Vercel reported for the change, on the admin screen that changes most. Opened that way, the admin shows a Bridge toolbar: flip between the live product and this change (B), see each changed token as a before and after swatch, and jump to every screen the change alters. Token changes swap the live tokens in place; code changes move between the live admin and the preview on the same screen. Production shows nothing unless it is the live side of a code change.
- a03541a: View the library as a change. On Studio Tokens, Components and Quality, a "Viewing: Latest library" Select in the top bar lists the open changes with their status; picking one shows the page as it would be with that change applied, read only, with a persistent banner ("Viewing the library as Brighter primary action. Nothing is saved.") and the ways out: back to the latest library, open the change, and on Tokens "Edit tokens in this change". Tokens reads the change's token files and lists the tokens it changes first, marked "Changed in this change" with their latest library value on hover. Components paints its previews with the change's tokens and marks the components that look different or whose guidance the change edits. Quality never shows the latest library's numbers for a change: it says the change's quality is in its checks and links there. The address holds the view (`?change=N`); editing a change is `?change=N&edit=1`, so the two share one model, and links between these pages keep the view. Reads stay anonymous-safe: one GitHub read of the change's file list, then only the files it changed, kept in the browser per version. This replaces the branch picker StudioHeader carried but never showed.

### Patch Changes

- 6bb63a1: Library Changelog shows the real releases. Published versions come from each package's CHANGELOG.md, grouped into one release per publish with its date from the release tags (v1.1.0 on Oct 18, 2026, v1.0.0 on Oct 17, 2026) and the package versions it shipped; the pending entries show as "Coming in the next release". The page said "no release tagged yet" because the release tags sit on merge commits, which the commit list skipped. Each row puts the kind badge on the left and the title at full width, with one line under it and a small meta line (bump, then package tags or "5 packages" that opens the list). Long releases show their first changes and fold the rest; internal changes are folded; sources, GitHub releases, npm links and the pending files sit in For developers.
- ce8efd7: Library edit mode reads as a mode. A sticky edit bar opens the page on the Harbor zone, full page width, with "Editing <name>" and its state (No changes yet, Draft saved, not sent, Unsaved changes, Sent for review) on the left and the actions on the right: Draft with Claude, Cancel and Send for review as the one primary. "Keep all N Claude drafts" shows only when two drafts or more wait. While editing, the page sits on a tinted desk and only editable regions are white paper, with a dashed edge and an Edit hint on hover and the focus color on focus; the live preview and the Tokens, Code and Changelog tabs say "From the code". Escape leaves a field, then asks to leave editing: Cancel confirms before discarding. On phones the bar keeps the label, Send for review and a More menu.
- c499852: The docs now treat npm as the main install path. The Install page leads with `npm install @bridge-ds/react @bridge-ds/tokens` and `npx @bridge-ds/cli check`, lists every package with a link to its npmjs.com page and the version read from its package.json, and keeps the clone install in a "For contributors" disclosure at the bottom. The Agents page connects Claude to a GitHub repository with `npx -y @bridge-ds/mcp --repo owner/name` first (read-only, a token to open pull requests), with a local folder as the alternative. README, docs/AI.md and the package READMEs no longer say the packages are unpublished. `bridge init` now writes `npx -y @bridge-ds/mcp` into `.mcp.json` and the Claude Desktop snippet outside the Bridge repo (it wrote a path into the npx cache), and `bridge --help` exits 0.
- e143916: Studio sign-in. With Sign in with GitHub set up on the site, the designer UI has no token paste any more: the sign-in dialog, Settings and the account menu offer Sign in with GitHub only (a site without it keeps the token paste as its one way in). Signed out, every Studio page, Overview included, shows the same side nav foot: a full-width "Sign in with GitHub" button with "Read only until you sign in" under it.
- 6f0a5dd: Studio says "Sign in" everywhere when the site has Sign in with GitHub: "Sign in to send", "Sign in to start", "Sign in to propose", "Sign in to review", the rate limit and expired sign-in messages, and the token editor note. A site without a GitHub App keeps "Connect GitHub", since pasting a token is the way in there. The wording comes from one helper, `lib/gh-wording.ts`.
- Updated dependencies [6fe9f88]
- Updated dependencies [11f40fd]
- Updated dependencies [4c313d7]
- Updated dependencies [4bfd417]
  - @bridge-ds/core@0.4.0

## 0.3.0

### Minor Changes

- de895e9: Studio Components: "Change this component" replaces "Request a change". The drawer asks what the designer wants to
  change, in place: adjust the look (her component's tokens), add a variant or option (Claude builds it from her Figma
  frame in an exploration linked to a request, or "Ask a developer instead"), or something looks wrong ("Report a
  mismatch"). Signed out, the choice still shows and the last step connects GitHub. Requests and the Overview now say
  "@ana wants to change Button" instead of reading like tickets.
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

- 0426262: Edit a component's guidance in place on its Library page (`?edit=1`): same layout and live preview, every prose
  section editable with the read typography, Claude drafts shown per section with Keep and Discard (or "Still accurate"),
  a review rail, and "Send for review" through the existing docs save path. The separate Studio docs editor redirects to it.
- 4caee7a: Sign in with GitHub in Studio. When the site has a GitHub App (GITHUB_APP_CLIENT_ID and GITHUB_APP_CLIENT_SECRET on the host, docs/SIGN-IN.md), the side nav, Settings Account and the Connect dialog lead with "Sign in with GitHub" and keep "Use a token instead" as a quiet second way for developers. The sign-in uses state and PKCE, goes through one Vercel function (api/github/token.ts) that swaps the code for a user access token and renews it when it expires, and stores nothing on the server. Expired sign-ins, cancelled consent, the wrong account, a repository the app does not reach and missing app permissions each get a sentence that says how to fix them. Without the env vars Studio keeps the token paste exactly as before.
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

### Patch Changes

- 4d85720: Studio adoption in plain words. Quality rows lead with the current value, big, and the value before the move to Bridge as a quiet "Before Bridge" label, with one sentence that says what adoption means. Each adoption report page is redesigned: the product name, one summary sentence, the two metrics in the same block as on Quality with a plain sentence each, the trend only when there are two runs or more, a component bar with its legend and counts, one success line when no hard-coded value is left, then "How adoption is measured" and one "For developers" fold that holds the other runs, file tables and commands.
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

- 4311efd: Library page headers: "Edit in Studio" becomes a quiet ghost button in the top right corner of the header zone instead of a button next to the title.
- 64fd190: Library: the GitHub link moves from the top bar to the foot of the side nav, where Studio keeps the GitHub account.
- f4ccf4a: Library token drawer: the token name is a plain heading, one summary comes first (a large specimen next to the value
  with copy, where the value comes from on one line with each token clickable, one plain sentence such as "Primitive. 9
  brand tokens point to it, used by 36 components."), then Aliased by, Used by, Contrast and History as collapsed rows
  that share one row component (first 5, then "Show all"), and one "For developers" fold at the bottom (code names, the
  developer note, the files). "Edit in Studio" is the one action, in the footer. Works for every token type.
- 04b0b97: Studio Overview: the greeting drawing grows with the space beside the to-do list and sits on its vertical middle, so the card stays balanced from 1100 px to wide monitors.
- 66cd629: Studio Overview sorts the to-do list by kind of work. "For you" lists only the decisions a designer or design system owner makes in the Studio, ordered by what unblocks the most: review the design of a change (it says when before and after are ready), ship an approved change, decide on a request, review usage guidance. Each button names the task ("Review design", "Ship", "Decide", "Review guidance") and the line under the title says what happens once it is done. Failing tests, a clash with the latest library, a missing release note, drafts, requested changes and the tech review fold into a quiet "Waiting on a developer" line that names the blocker and who is expected, with a link to the change only. The headline counts only what is for you ("2 decisions wait for you.", "Nothing needs you right now.").
- 4f92a1c: Studio Overview greeting is now your to-do list: one row per change or component request that waits for you, with why in plain words and the button for the task on the same row. What waits on someone else folds into one line that opens to name who. Library health moves to a Quality card, open changes are no longer repeated under the greeting, and on wide screens the suggestions stand next to the greeting.
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

- 1a4e2c5: Studio review, designer first. A pull request now answers three things at first glance: who acts now ("Waiting for
  the design owner (@x) to approve.", "Your turn: approve the design."), who approved on the design and tech side (one
  row per approval the tier needs, with a check or an empty circle and the action on the row of the role you hold),
  and what it looks like (the biggest before/after from the visual impact, "N screens changed" with a link to all, a
  quiet line while it is prepared or "No visual change", then the token diff). Files, checks, changeset and previews
  move under one collapsed "For developers". In review rows and the Overview Activity rows say who acts now, and the
  Overview greeting lists the changes waiting for you. One pure, tested rule set (`whoActs`, `approvalRows` in
  lib/changes.ts) drives all three.
- 1d16b31: Studio review and history in designer words, with one source for every count. The review queue
  (`reviewQueue` in lib/review-queue.ts) leaves out running explorations and release automation (the changesets
  "Version packages" pull request on changeset-release/\*, opened by github-actions[bot]); the Overview hero, the
  nav badge and the In review tab all count it. In review rows say what approval a change needs in plain words
  ("Design + tech", "One approval", no color), with the same rule as the detail (label or computed from the changed
  files, highest wins, read with the status), and a conflict now blocks before approvals in the list as in the
  detail, with "Checking" until GitHub knows whether a change merges cleanly. "Other branches" becomes a link to
  GitHub inside one "For developers" fold. The change detail says Ship instead of Merge; the owner override and
  Close move into a More menu (DS Menu) with the override rule in one sentence; Conversation shows the count, the
  last word and "Open on GitHub". The Overview hero reads "3 changes wait for design approval. 1 is blocked on the
  developer side." with one GitHub link instead of an "Unblock" card, Activity folds Bridge app updates into one
  labelled row, and an Adoption tile links to Quality (from the audit reports). History opens on a "Next release"
  card built from the release pull request (changes counted, version bumps in plain words, the action for whoever
  holds the ship right), rows read human summaries, and the demo history switch is development only.
- 3f0266a: Studio Settings is redesigned as a settings page: each section is a band with its title and one sentence on the left and its rows in a card on the right, values next to their labels, and the page stops at 1200px. Sections are grouped by meaning: Account (a compact connected row, or the one Harbor zone with a Field Guide drawing while Studio is read only), Review rules (who approves and ships with Edit in the card header, what each change needs as one small table, the owner override as a fold), Safety (protection and the visual before and after, each with its action), Figma and Claude, Integrations, then For developers. The roles summary sentence that repeated the rows is gone, and editing sends the change for review.
- 12ac419: Studio Components, calmer list and drawer.

  List: each thumbnail renders one calm sample of the component (the secondary or neutral look, never the destructive
  one) at one size, and the columns say their facts in words: "Admin demo and Bridge itself", "1 request", "4
  examples", "40 tokens". The token split ("1 own · 39 from Button") leaves the row for the drawer's "For developers".

  Drawer, top to bottom: the family as an eyebrow on the name, one sentence with a link to the Library page, one live
  preview with a Light/Dark switch (it starts on the page theme), the facts in one line ("Used in Admin demo (4
  places). 40 tokens. Usage guidance written. No open request."), a pill only when guidance is missing or waits for a
  review, then one row of actions with a single primary (the guidance while it is missing or in review, else Edit
  tokens) and "Request a change" as the last secondary. Token origins, props, stories, the files folder, Code and the
  component sandbox sit in one "For developers" fold at the bottom.

- d2623a7: Studio Quality and Settings, designer first.

  Quality: a trend sparkline per product from the committed audit history, "102 unused tokens" counted from the
  data instead of "Clean up (2)", and file paths plus the commands CI runs in one "For developers" disclosure. Audit
  pages lead with the gauges, the trend chart and where component instances come from; what was scanned, the file
  tables and the CLI fold under "For developers". The trend chart keeps its axis labels inside the frame.

  Settings: Connection, Roles and Protection, Approvals as plain rules without tier numbers (read from
  docs/GOVERNANCE.md), Figma and Claude (the one `claude mcp add` command with a copy button), Integrations (Jira
  status and setup), then one collapsed "For developers" section with the repository sources, tiers and modes,
  previews, the tier table, MCP details and the Jira workflow. The GitHub dialog says "Change GitHub token" when
  opened while connected.

  Studio shell: the theme toggle moves into the account menu once GitHub is connected (side nav foot until then),
  one less control on every Studio page.

- 1975219: Studio Requests and Explorations, designer first. Requests: a new intro ("Token changes you can make yourself in
  Tokens. Component changes are built by a developer: ask here and follow progress."), a thumbnail per row (the
  request's image, else the component preview) and who is on it (the assignee, or the author of the change that closes
  it, else "Not started"). A request says "Waiting for a developer to pick it up", "In progress by @x" or "Done", shows
  a before and after side by side when it carries a baseline and a Figma image, and keeps the Claude commands under
  "For developers". Explorations: a new intro, no branch names in the list, a start form without branch or pull request
  help (it moves under "For developers"). An exploration opens on its previews (Library, Component sandbox, Admin demo)
  and the before and after against the official library, then the requests built on it; branch, install command and
  CLI move under "For developers". "Promote to review" now confirms in a DS Dialog that says who will be asked to
  approve and what happens next, then says where the change went with a link to it in In review.
- 5647108: Studio shows the theme switch in the top bar again, in the same place as the Library, instead of hiding it in the account menu.
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

- dfa95ed: Textarea gets `appearance="inline"` for editing existing text in place: no border, no resize handle, the surrounding
  font, size and line height, a height that fits the content (`field-sizing: content`, measured without moving the page
  where it is not supported), a fill and hairline on hover and the DS focus ring on focus. Never use it in forms.
  The Library edit mode now uses it instead of restyling Textarea internals.
- ed31d29: Studio follows docs/GOVERNANCE.md for Tier 2: a new component, variant or prop needs a design owner and a tech owner approval, not one approval. The ship gate, In review labels, the promote dialog and the send sentence now say so.
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

- 37dd883: Studio Components: the "Used in" column shows one tag per product instead of a sentence.
- d6c0889: Studio and the admin demo fill wide monitors: pages no longer stop at about 1000 to 1260 px with an empty column on the right. Past about 1800 px of content the page stops growing and sits centred beside the side nav.
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
- Updated dependencies [dfa95ed]
- Updated dependencies [7cb1733]
  - @bridge-ds/core@0.3.0
  - @bridge-ds/react@1.1.0

## 0.2.0

### Minor Changes

- f103729: Owner override for solo maintainers and small teams. `governance.override` in `bridge.config.json` (`allowed`, `requireReason`, `minReasonLength`; absent by default) lets listed logins merge from Reviews when the only thing missing is approvals. It is never offered while CI fails or runs, when changes are requested, or on a draft. Bridge checks the token has write access, asks for a reason in a confirmation dialog, posts a `**Bridge owner override**` comment with the login, reason and missing approvals, then merges with the method the repo allows. If GitHub refuses, its message is shown and the comment is marked not merged.
- ef596ce: Library foundation pages (Color, Typography, Spacing, Radius and borders, Elevation) open each token group with a
  specimen of the real tokens in context, light and dark side by side, then a light list: dual swatch, the token name
  once, a one-line role, a muted alias line and a neutral usage chip. A page-level "Copy as" switch (CSS, JS, Figma)
  sets what a click on a name copies, and a row opens the token explorer's detail panel in read mode. Usage comes from
  the shared `tokenUsage()` definition, so the page background no longer reads as unused. Links in the app chrome are
  ink with a quiet underline; orange stays the signal for focus and the current place.
- 5c40693: New brands, from every surface. `planNewBrand` in `@bridge-ds/core` builds a brand file (primary and neutral ramps from the shared ramp engine, the starting brand's radius, fonts and theme overrides), adds the slug to `modes.brand` in `bridge.config.json`, and runs the contrast gate for the new brand in light and dark. The CLI gets `bridge brand create` and `bridge brand list`, the MCP server `bridge_list_brands`, `bridge_plan_brand` and `bridge_propose_brand`, the Figma plugin offers a new Brand mode as a new brand on Push, and the Studio has a four-step New brand flow with a live preview. The token build reads its brands from `bridge.config.json`, and `scripts/ramps.mjs` runs the same ramp engine (primitives unchanged).
- fdd4fc3: Studio reads as one app: compact page headers with no hero or lede, GitHub status only in the global header (connect button, or your login with repository, access and disconnect), a Drafts counter in the header that opens the draft as a side sheet, and the token explorer full bleed with one toolbar row (search, Filters, Modes, View, New token) and compact 40px rows. Overview starts with a KPI strip and a "Needs you" list whose status chips come from real CI, reviews and the merge gate, so a pull request with failing CI never reads "Ready". The Library is unchanged. Change titles read as text, with inline code rendered as code instead of raw backticks. Without a GitHub token, Overview and Reviews read the open list once and the live status of the 3 most recent pull requests, cached for 10 minutes per commit; other rows say "Status unknown" until you connect. New token and cell edits work without GitHub as drafts in this browser; only Propose, approve, merge and revert need a connection.
- 8c08d95: Studio Changes: one page with two views. In review lists the open pull requests most urgent first (blocked, then waiting for approval, then ready) under a Harbor opener with one status sentence and one action, the local draft as a strip, and branches without a pull request collapsed at the bottom. When GitHub cannot be read, the last list stays on screen "as of" its time, and the nav count keeps the last known number. A pull request opens in place with one sentence on its state, one primary action (open the failing run, connect GitHub, approve or merge) and collapsed sections with counts; the merge, approval and owner override rules are unchanged. History groups merged token changes by release, folds imports into one line, keeps filters behind a Filter button, and undo opens a side panel with one sentence and one primary. Color now means status only: red blocked, violet waiting for approval, green ready, grey otherwise; risk tiers are grey labels. Drafts, Branches, Reviews, Versions and Visual impact redirect to the right view. The Studio header switches to the Library, and the GitHub account moves to the bottom of the Studio nav.
- fb8a737: Component change requests in Studio: a Requests view in Changes (status, linked pull request, Jira key, a detail with "Implement with Claude"), "Request a change" in the Components drawer, an Integrations section in Settings that proposes Jira settings as a pull request, a line on the Overview when requests wait, and a "Component change requests" section in How review works.
- 525217f: Studio Changes gets an Explorations view: draft pull requests labeled `exploration` on `explore/<slug>` branches, summary first ("2 explorations running."), each with its purpose, author, previews, the snapshot install command to copy for a product staging branch and the requests filed on it. "Start an exploration" creates the branch from main with an exploration note and the draft pull request (or shows the `bridge explore start` command without GitHub). The detail opens in place (?exploration=N) with Promote to review (tier labels from the shared classifier, label removed, ready for review) and Close. Running explorations leave the In review list, show "Exploration (not mergeable)" in place of a tier, and never pass the merge gate, owner override included. How review works explains explorations.
- d66a923: Studio Settings is one page with three sections: Connection, Repository, Approvals. Connection opens with one sentence and one action for the GitHub state (Connect GitHub, or Change token once connected), then the Figma plugin and the MCP server as two plain rows. Repository says in one sentence which repository, branch and build it reads, shows Source at rest and folds tiers, modes, owners and previews behind counts; values share one mono style and the default mode reads "(default)" in plain text. Approvals is a compact "Who approves what" table, one row per tier with a grey label that opens Changes filtered to that tier (new ?tier= filter on In review), plus the owner override in one line. The governance prose moved to a new Library page under Use, How review works, with collapsible sections, linked from Approvals and from each pull request. The old Repository, Governance and Integrations URLs redirect to the matching section.

### Patch Changes

- 34b8e1d: Accessibility page, summary first: one status sentence from the contrast gate ("All 296 contrast checks pass across 2 brands and 2 themes", or how many fail and the first failing pair), then the gated pairs grouped by use (text, buttons and controls, UI and borders, focus, feedback, charts) for one brand and theme at a time. Each row shows a live sample, the pair, the ratio and one status (AAA, AA or "Fails, needs 4.5") and opens the token details. "Compare all 4" shows every brand and theme side by side, one at a time on phones. The method moves under "How we check". The wide "All pairs" table is gone.
- 53a02c4: All tokens fills the page, the side panel follows the filter, one Value column when light and dark match, dimension rows show a bar at their real size; wider gutter before the On this page rail.
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

- 061deb5: Studio Components, "Edit tokens" now opens Studio Tokens on `?component=<slug>`: exactly the tokens that component's CSS module reads, across every collection, with a removable "Used by IconButton" chip in the chip row. The Tokens column, the Library component cards and the component page count the same set, so the link never lands on "No token matches". Components that read no token get no link.
- a914c38: Component pages: the On this page rail sits on the right from the top of the page (from 1320px) instead of inside the reading column, and the Skeleton preview shows an avatar, two lines and a block.
- f7e861c: Studio Components: one family menu instead of nine chips (17 interactive elements on the first screen).
- e2c7742: Click targets: token rows (name, copy, menu, uses chip), the Studio row menu, the logo link, changelog refs and Quality actions are at least 32px tall; standalone links at least 24px. The Preview brand switch hides when the repo has a single brand.
- 7f8972e: Library: home "What changed" lists short headlines with their kind on the full content width, the footer spans wide pages, reading pages get the "On this page" rail again from 1320px, and the Preview brand and density switches use the DS control height (44px).
- 558c78d: The Library is the site, the Studio is a space. No more Library | Studio switch: the Library header keeps logo, centered search, theme, GitHub and a quiet "Open Studio" (with the avatar in one pill when signed in); the Studio has its own "Bridge Studio" header on a soft ground and a "Library, view published library" box at the bottom of its nav. The Library nav is Home, Foundations (with All tokens), Components and Use; the one nav count is the reviews waiting, on Changes. "Edit in Studio" and "View source" show only for a GitHub token with write access. New page meta line and site footer.

  All tokens (`/tokens/`) becomes a read-only reference: filter, type chips with counts, light and dark values, copy on hover and a side panel per token. `?t=` deep links still work.

  Studio Tokens edits through one anchored popover per cell (palette families, a swatch ramp, one contrast line, more options folded), a slim "N changes · Review" bar, and a review sheet with before and after per mode, contrast, usage and a preview of real components. The full editor modal is removed; the detail drawer is read-only with one Edit. The explorer keeps to four font sizes.

  Home "What changed" and Studio activity show one-line titles.

- 75a6174: Studio Tokens: a page header and one toolbar row (filter field "Filter N tokens", type chips with counts, one Options menu for collections, usage, brand and modes, columns and exact match, then New token), and the table at full width with Name, Light and Dark. The collections tree and the Filters, Modes and View menus are gone; Semantic and Base are the default scope. The swatch name in the value editor shows under the ramp, never over the family tabs. "Used by" counts global stylesheets apart from components ("1 global style (base.css)") in the details and the review sheet. All tokens: "Copy variable" copies `var(--name)`. Library foundation pages: no page toolbar; each row has a copy button (CSS variable by default, JS or Figma name from its menu, last choice remembered) and the brand or density switch sits in the header of the specimens it changes.
- 1b1a272: AGENTS.md: a UI quality bar every screen and feature is checked against.
- Updated dependencies [e31bac2]
- Updated dependencies [5b9d677]
- Updated dependencies [3e59115]
- Updated dependencies [e54d2a1]
- Updated dependencies [bac1cb2]
- Updated dependencies
- Updated dependencies [a55525d]
- Updated dependencies [f103729]
- Updated dependencies [b6cb68a]
- Updated dependencies [8180108]
- Updated dependencies [8ec801a]
- Updated dependencies [e8fd4a8]
- Updated dependencies [b6cb68a]
- Updated dependencies [7d3f7cd]
- Updated dependencies [acd1273]
- Updated dependencies [b0da5ed]
- Updated dependencies [b6cb68a]
- Updated dependencies [cd5565e]
- Updated dependencies [95db484]
- Updated dependencies [cf3f5bb]
- Updated dependencies [abe4395]
- Updated dependencies [7261f47]
- Updated dependencies [a6a3a46]
- Updated dependencies [d5d263b]
- Updated dependencies [c66908c]
- Updated dependencies [73b1a6f]
- Updated dependencies [84e1383]
- Updated dependencies [6cd9c3a]
- Updated dependencies [525217f]
- Updated dependencies [e47f4a6]
- Updated dependencies [1f29f63]
- Updated dependencies [5c40693]
- Updated dependencies [fd83606]
- Updated dependencies [019a220]
- Updated dependencies [a0142d2]
- Updated dependencies [cf3f5bb]
- Updated dependencies [7261f47]
- Updated dependencies [36cb504]
- Updated dependencies [2c79d5d]
- Updated dependencies [fd83606]
- Updated dependencies [937bd43]
- Updated dependencies [a914c38]
- Updated dependencies [0cab1bb]
  - @bridge-ds/core@0.2.0
  - @bridge-ds/tokens@1.0.0
  - @bridge-ds/react@1.0.0
