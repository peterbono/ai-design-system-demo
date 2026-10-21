# @bridge-ds/figma-plugin

## 0.6.0

### Minor Changes

- 22e53c7: Components changed in Figma go back to the library as library branches. The DS Bridge plugin's Push tab reads the diff Pull reads in "Review updates" the other way round and routes each changed component (`planComponentPush`): a token swap on a component token that paints only the changed variants becomes an exact token change, no AI (the shared `planTokenProposal` and `writeTokenProposalOnGitHub`, with the contrast gate run again on the component tokens that alias a checked pair, `componentContrastPairs`, and the other components that share the token named); a new variant, property, layer, swapped instance or component, or a swap a token alone cannot say, opens a draft branch carrying the spec (`.bridge/figma/<name>.json`: variant matrix, properties, bound variables and layers per variant, screenshot) labelled `waiting-for-claude` until Claude AI writes the code there and it becomes `drafted-by-claude`; detached layers, values set by hand, styles and variables the library lacks are listed under "Fix in Figma first" with what to do, never sent. Every branch starts with "From Figma" (`parseFigmaOrigin`) and carries `from-figma`. The set remembers its branch: once it ships or closes, the next Pull rebuilds the set from the reviewed code, so Figma never diverges. MCP: `bridge_figma_changes`, `bridge_get_figma_change`, `bridge_mark_figma_change_drafted`, `bridge_push_figma_component` (61 tools). CLI: `bridge figma`, `bridge figma show <n> [--draft]`, `bridge figma drafted <n>`, `bridge figma push <diff.json>`.

### Patch Changes

- Updated dependencies [22e53c7]
- Updated dependencies [e1f8f0c]
- Updated dependencies [e59366e]
- Updated dependencies [a99fbb9]
  - @bridge-ds/core@0.10.0

## 0.5.1

### Patch Changes

- 8cdcb9a: Avatar agent: Bridge now draws its own agent mark (a prompt chevron and cursor line, Deep Harbor on a Harbor rounded square tile) instead of shipping the Claude logo, which is an Anthropic trademark. `brand="claude"` still works and keeps the name "Claude AI". New `AGENT_MARK` export; `CLAUDE_MARK` stays as a deprecated alias of it. New optional `mark` prop for a vendor logo you have the brand owner's approval to use. The agent tile token `color.agent.surface` now follows the Harbor zone in every theme and brand. The Figma UI kit gets a Kind axis (person, agent) drawing the new mark, and the spec generator keeps an SVG line join.
- 5302e57: Pull no longer hides every component when one value in component-specs.json has a shape the plugin does not read: that field is listed with the others that cannot be bound ("update DS Bridge") and the rest pull as usual. Reactions stored by an older DS Bridge in an unexpected shape are read as none. When components cannot be read, the callout now says what happened and what to do ("Check again, and if it keeps failing, update DS Bridge and report it with the details below"), with the technical error folded under Details instead of shown as the message.
- Updated dependencies [8cdcb9a]
- Updated dependencies [77ba45a]
- Updated dependencies [7e9f2df]
  - @bridge-ds/core@0.8.0

## 0.5.0

### Minor Changes

- 22d186e: Figma components are testable in prototype mode, with the design system's motion. The spec generator reads each set's interaction states (State and Checked axes) and the CSS `transition` of the parts that change, resolves durations and easings from the motion tokens (`motion.duration.*`, `motion.easing.*`), and records them in component-specs.json as `interactions` (trigger, axis, from and to values, transition) plus `motion`, the motion Figma cannot play (looping keyframes, keyboard focus, popups opening). Cubic bezier easings play exactly as Figma's custom bezier; when parts move at several speeds Figma plays the longest and the transition says it was approximated.

  New pure helpers in `@bridge-ds/core`: `componentMotion(spec)` (reactions per variant, triggers with Figma's names, motion tokens, animated properties, approximations, what Figma cannot play, the reduced motion note) and `componentsUsingMotionToken(specs, tokenPath, chainOf?)` (sets whose interactions use a motion token, through aliases). `@bridge-ds/core/node` exports the CSS side (`parseTransitions`, `resolveDuration`, `resolveEasing`, `transitionBetween`, `motionNotes`).

  The Figma plugin wires the variants with prototype reactions: While hovering, While pressing, On click (Mouse enter and Mouse leave on sets with a Checked axis), Change to with Smart animate. Idempotent: a second pull writes no reaction; reactions designers added are kept, and on the same trigger theirs wins. The Pull preview shows "Interactions: N" per set and lists the motion it could not map; set descriptions say "In code, reduced motion turns this off."

### Patch Changes

- Updated dependencies [22d186e]
- Updated dependencies [51e743c]
- Updated dependencies [7b53159]
  - @bridge-ds/core@0.7.0

## 0.4.0

### Minor Changes

- f655919: Figma coverage goes from 26 to 40 of 47 components. Popups are drawn open as their own sets, the way a Figma UI kit draws them ("Select/Popup", "Dialog/Popup", "Menu/Popup", "Tooltip/Popup"...), next to the trigger set when the component styles one. Inline SVG (Spinner, the Progress ring) is drawn as one vector layer with each stroke bound to its token. Layers that only some variants render are hidden in the others, and a prop that moves layers elsewhere splits the component into one set per value ("Progress/Linear", "Progress/Circular", "Pagination/Full", "Pagination/Compact"). New generator capabilities: React context, `useState` defaults, local render functions and list callbacks, `useMemo`, `createElement`, Base UI render props and value indicators, `position: absolute` with token offsets, `width: 100%` as Fill container, single-cell grids, examples of the component sandbox as content. Still not in Figma, with the generator's reason: Checklist (CSS grid columns), Form and Slider and TokenValue (content computed while the page runs), Table, Tabs (decorations drawn with ::after) and Toast (shown from a hook). The fidelity check marks popups drawn open as not compared, since the code image shows them closed.
- ed4b28d: Every visual component is in Figma: 47 of 47, 46 generated from code and 1 drafted with Claude. The generator now draws Checklist, Form, Slider, Table (and TableEmpty), Tabs and TokenValue from their code examples. New generator capabilities: CSS grid rows and subgrid rows as auto layout, `::before` / `::after` decorations as layers, Base UI indicators sized to the selected item (a tab underline) drawn in that item, unselected tab panels hidden, `data-orientation`, sliders (thumb at the value, value render functions), tables as rows of cells, form errors reaching their field, typed values in fields, functions as values, string and list methods, helpers that return elements, plain modules of the package, React's JSX text spacing, screen reader text left out of sentences, example texts shown by default, and absolute layers placed per variant. Side effects on sets already in Figma: Field and Dialog lose an empty error layer, NumberField steppers get their dividers, ChoiceCard text wraps, CodeBlock reads its wrap style.

  Toast, shown from the `useToast` hook and never placed, is drafted with Claude: a spec written from the code in `packages/react/component-spec-overrides/Toast.json` (`"source": "drafted"`), validated against the format and the repo's tokens by `npm run specs`, counted as drafted (never as generated), marked "Drafted, check it" in the Pull preview and in its Figma description, and stale once its code changes. Specs record the code example they were drawn from, so the fidelity check renders the same content (rows, fields, tabs), and the Figma references capture renders hook-shown components (a toast) through their hook.

- bdca820: Honest Figma coverage. `npm run specs` now reads every component folder and records each one in a `coverage` list of component-specs.json: generated, unsupported with the generator's plain reason ("opens a popup", "uses CSS grid", "shows content computed while the page runs"), or a layout helper with nothing to draw. Support is decided by the generator from what it can read, no list to maintain. The plugin Pull tab says "26 of 47 components are in Figma" with the others folded under the count, each with its reason, and the Studio Components page shows a quiet "In Figma" column from the same data.

  Coverage goes from 6 to 26 of 47 visual components. The generator draws 19 more (Accordion, Alert, Avatar, Banner, Breadcrumb, Checkbox, CheckboxGroup, ChoiceCard, CodeBlock, Divider, Field, Kbd, Link, NumberField, RadioGroup and Radio, SegmentedControl, Skeleton, Switch, Textarea), and Icon counts as covered by the icon components of the Icons page. New general capabilities: content props as TEXT and BOOLEAN properties, Base UI checked states as a Checked axis, layers hidden per variant, translateX and row-reverse read as auto layout, flex grow and wrap, lists and selections from the docs preview, the page base stylesheet, em sizes, underlines, opacity, fixed and per-variant icons, images as the media slot, useRender links. Fixes from the fidelity check: a transparent border keeps its room (a transparent stroke counted in layout), link buttons are underlined, inherited typography reaches every text.

- 6b07b05: Check fidelity: the Pull tab compares every generated Figma variant with the same variant rendered from code and says, per component, "Matches the code" or "Differs from the code: 12% of pixels, size 120x40 vs 118x40", with Figma, code and differences side by side. Nothing in the file changes. Core adds the pure comparison (`compareImages`, tolerant of font rasterization and antialiasing), the storable `FidelityReport` and the variant to code mapping (`planReference`); `bridge figma-references` (visual) captures the code images from Storybook, published on main by the Figma references workflow to the `bridge-visual` branch. React adds a hidden Storybook fixture, "Internal/Figma reference", not part of the package.

### Patch Changes

- 8376732: Studio speaks Figma branching.

  - One vocabulary module (lib/vocabulary.ts) for every Studio screen: Create branch, Request review, Update from main, Review and merge, Merge, Publish for the release; statuses Draft, In review, Approved waiting for code, Merged, Closed. The Changes page is now Branches (same address).
  - No "For developers" fold left in Studio or the Library changelog. Where a design system lead may want the GitHub view, one quiet "Open on GitHub" link sits on the line of the thing it concerns; Settings explains integrations and protection in plain words with a "How it works on GitHub" link.
  - Request triage left the Studio home and the Branches tabs (teams triage in Jira). The code stays behind REQUEST_TRIAGE_IN_STUDIO; "Ask for a component change" still creates a request, and a request link still opens.
  - Create branch takes an optional Jira ticket key (DS-42) in the token editor, the Library edit mode, the new brand flow and Start an exploration. The key goes first in the GitHub title (and in the branch name outside explorations) so the Jira GitHub integration links it, and shows in mono on branch rows.
  - Core: `Exploration` takes an optional `jira` key; the merge-right sentence says "can merge this".
  - Figma plugin: the review flow strings say Request review and branch.

- Updated dependencies [f655919]
- Updated dependencies [ed4b28d]
- Updated dependencies [bdca820]
- Updated dependencies [6b07b05]
- Updated dependencies [8376732]
  - @bridge-ds/core@0.6.0

## 0.3.1

### Patch Changes

- 4bfd417: Studio tells design work from developer work, and says who really made it. Work that only touches code (a title that speaks code such as "React" or "props", tests, examples, types, build or tooling only, component code the visual impact run shows no difference for, a "tech" or "developer" label) no longer shows in Needs you, on the board columns or in the Changes badge: the Overview folds it into one quiet line under the board, "Developer work, 1 in progress", that opens its list. Changes keeps every item and tags developer work "Developer", with an All, Design, Developer filter that shows when a list holds some. When nothing says what a change is, it stays with designers. An exploration card says "Claude is building it" when a real marker says an agent made it (the pull request template box, the Claude Code footer or session link, a "Co-Authored-By: Claude" commit, an agent label, an exploration or request started from the MCP server), and "You are trying it" only for what you started from Studio. The exploration block now records where it was started (`source`: studio, figma, cli or mcp) and the agent behind it (`agent`), and the CLI records `agent: "claude"` when Claude Code runs it.
- c499852: The docs now treat npm as the main install path. The Install page leads with `npm install @bridge-ds/react @bridge-ds/tokens` and `npx @bridge-ds/cli check`, lists every package with a link to its npmjs.com page and the version read from its package.json, and keeps the clone install in a "For contributors" disclosure at the bottom. The Agents page connects Claude to a GitHub repository with `npx -y @bridge-ds/mcp --repo owner/name` first (read-only, a token to open pull requests), with a local folder as the alternative. README, docs/AI.md and the package READMEs no longer say the packages are unpublished. `bridge init` now writes `npx -y @bridge-ds/mcp` into `.mcp.json` and the Claude Desktop snippet outside the Bridge repo (it wrote a path into the npx cache), and `bridge --help` exits 0.
- Updated dependencies [6fe9f88]
- Updated dependencies [11f40fd]
- Updated dependencies [4c313d7]
- Updated dependencies [4bfd417]
  - @bridge-ds/core@0.4.0

## 0.3.0

### Minor Changes

- 80228c0: Claude titles each component request. Change lines in a draft session carry the deterministic request title
  (`DraftLine.title`), and results may answer `lines: [{ id, line, title }]` (`DraftResultLine`; the title is cleaned to
  the title contract by `sanitizeDraftTitle`: one line, sentence case, at most 70 characters, no trailing period, no em
  dash). Older sessions and answers without titles still work. `bridge_pending_drafts` and `bridge_write_drafts` ask for
  the title, the plugin's API-key path asks for and parses it too, and Push uses it for that component's request instead
  of the generic deterministic title ("Add an icon after the label" rather than "Update the look to match Figma").
- f867733: Push to an exploration, and a calmer Push screen. The destination is the main decision at the top of the Changes: a
  segmented control "Send for review" | "Try in an exploration". An exploration is picked among the running ones (or
  started with a name and a purpose); its variable edits become one commit on `explore/<slug>` (no new pull request to
  main, earlier exploration commits kept) and component changes become requests labeled `exploration`. Items marked
  "Exploration only" (the experimental mark, renamed in the row menu with a line that says what it does) start checked
  for an exploration and unchecked for review. The result screen shows the exploration's previews and the snapshot
  install command. The bar's primary action follows the choice ("Send for review" / "Send to exploration") and steps
  aside while a request form is open. Component rows read once: the sentence, then value chips for concrete changes
  only (the Details table is gone). "Description" becomes "Message to the team", its own section. The Requests section
  is replaced by one quiet line at the bottom, also on the idle screen: "Something the scan cannot see? Request a
  component change".
- 537abd7: Push names structure changes. Each variant keeps a layer outline, so a layer added, removed or moved becomes a
  "Structure change" request (new request kind `structure`) with a line like `New instance layer "Icon" (Icon/Pencil)
after "Label" in primary sm` and the title "Add a layer after Label", instead of a vague visual change. Renames,
  wrappers and hidden layers bound to nothing still send nothing. When an optional part already draws the added layer
  (an icon after the label while "Icon end" exists), the row says "Icon end already does this: show it with the Icon end
  property" and the item starts unchecked; "Keep it as a request" sends it anyway.
- fb40ae8: Claude writes each change line. Draft sessions carry one change line per component change (`DraftItem.lines`, images labeled by line), results may answer `lines: [{ id, line }]` (one sentence, at most 120 characters, no em dash, unknown ids refused; results without lines still work), and `draftChangeLine` gives the deterministic default ("Looks different in Size=sm, State=Default, Variant=primary; no variable explains it"). Requests carry the line (`ComponentChangeRequest.line`, "**What changes:**" in the issue, the brief and Jira). `bridge_pending_drafts` and `bridge_write_drafts` describe and accept lines; the plugin's API-key path asks for and parses them too.

  Push hierarchy in the Figma plugin: "Draft with Claude" is a ghost action on the Description (and request Title) label line, one "Drafted by Claude" status line under the field, each component change row reads name and kind, then one sentence, with the table behind "Details" in one font size, no group checkbox for a single item, the bar alone sums up what is sent ("1 request"), and a shorter Components intro.

### Patch Changes

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

## 0.2.0

### Minor Changes

- 5c40693: New brands, from every surface. `planNewBrand` in `@bridge-ds/core` builds a brand file (primary and neutral ramps from the shared ramp engine, the starting brand's radius, fonts and theme overrides), adds the slug to `modes.brand` in `bridge.config.json`, and runs the contrast gate for the new brand in light and dark. The CLI gets `bridge brand create` and `bridge brand list`, the MCP server `bridge_list_brands`, `bridge_plan_brand` and `bridge_propose_brand`, the Figma plugin offers a new Brand mode as a new brand on Push, and the Studio has a four-step New brand flow with a live preview. The token build reads its brands from `bridge.config.json`, and `scripts/ramps.mjs` runs the same ramp engine (primitives unchanged).
- 95db484: Writing help for requests and the Push description. The request form (title and summary) and the Push Description now prefill a draft written from the detected changes, never rewritten once you type. "Copy for Claude" copies a ready prompt for Claude.ai or Claude Desktop (your own Claude plan, no key) and "Paste Claude's answer" fills the fields from the reply. Optionally, with your own Anthropic API key in Settings (Claude (optional), stored in client storage on this computer, billed to your Anthropic account), "Draft with Claude" writes the text from the change table and the before and after images. The manifest now also allows https://api.anthropic.com.
- 1d8204a: Push tab: component change requests. Component changes (new or removed variant, prop change, another variable bound to a part, a visual change no variable explains, a new component) become GitHub issues from a Components group under the variables. Variable edits stay the pull request flow, and a Figma-only restructure triggers nothing. The token now needs Issues: Read and write.
- abe4395: "Draft with my Claude": your own Claude (Claude Desktop or Claude Code on your plan, no API key) writes request and Push texts through the Bridge MCP server. The plugin writes the changes and the before and after images to the `bridge-requests` branch, shows "Waiting for your Claude" with the sentence to say, checks every 5 seconds for up to 10 minutes, fills the fields you did not edit and offers Claude's text for the ones you did, then deletes the file once you send or cancel. Settings, Claude (optional), now lists three ways: MCP (recommended, with the Claude Desktop config and the Claude Code command), Copy for Claude, and an API key ("Draft with Claude (API key)").
- 7261f47: Pulled components get real icons and content slots, swappable like a Figma library. An Icons page holds one
  component per Lucide icon (`Icon/Plus`, drawn from its SVG, bound to the icon tokens) and a Slots page holds
  `Slot/Card body text` and `Slot/Media`. Icon parts of Button, IconButton, Badge and Tag, and Card's body, are instances
  of their code default with an INSTANCE_SWAP property (`Icon`, `Icon start`, `Icon end`, `Body`); Card `Padding=none`
  shows Media. Swapping in a variant is a visual change only when it differs from the code default; a fresh pull still
  sends nothing. Placeholders from earlier pulls are replaced in place.
- cf3f5bb: Pull tab: pull components. The coded components (Button, IconButton, Badge, Tag, Input, Card) become component sets on a Components page, with variant properties from their props, a State axis, text and boolean properties, and every fill, stroke, radius, padding, gap, size and text property bound to the pulled variables. Opt-in from the Pull preview ("Also pull components"), which lists new, updated and unchanged sets and what cannot be bound. Re-pulls update sets in place, flag variants removed in code as orphans and store the signature baseline, so Push shows no request after a pull.
- fa17ca1: Pull reviews component updates like Figma: each generated set that changed in code shows a before thumbnail, then
  the after thumbnail once updated, and what the update changes (variants, props, bound variables). "Update" updates
  one set; "Update all" updates the rest with the variables. Variables stay all-or-nothing; new sets stay opt-in.
- f9c63d7: Push works like publishing a library in Figma: a Changes list grouped Variables and Components with a checkbox per
  item (all checked by default, select all per group), a Description that opens the pull request and every request, and
  one "Push for review". Unchecked variable edits stay in Figma; unchecked component changes are not sent. "Mark as
  experimental" (row menu) stores a durable mark on the variable or component set: experimental items show a tag and
  start unchecked on every push.

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

- 5432de0: Community art in the Field Guide direction (Fraunces, Harbor zone, Deep Harbor), with fresh screenshots of the plugin (595 variables) and Bridge Studio.
- c0c60e9: Community gallery shows the plugin in the Bridge brand.
- 0e51ec2: Published Figma Community id in the manifest, and a Community listing that matches the submitted description.
- 019a220: Pulled components: Badge md gets its padding and min height (a `calc()` of tokens is resolved and set, reported as "set,
  not bound"; a `calc()` of one token is bound). Card is drawn at the `size.80` width, its header, body and footer fill it,
  body text wraps instead of collapsing to 0px, and it clips its content so the footer stays inside the rounded corners.
  Tag loses its extra "label" wrapper frame (a re-pull moves the layers and removes it). Variant grids keep the same gap
  between rows and columns of different sizes. Specs gain `clip` and `fill` on parts and calc() expressions of token paths.
- 427154e: Plugin: "Copy a prompt" removed; Draft with Claude starts your own Claude directly when no API key is saved; the Claude settings card shows two options as rows with their state; code-only details are no longer listed on Pull and Push.
- 0c21140: Action bar buttons are 36px tall, a lone action fills the bar, and a mouse click no longer leaves a focus ring on the tab after re-render.
- 51da15c: Idle Pull and Push screens explain the flow in three steps instead of a Source card with a Change link.
- 73a5142: Pull: "Replace with main" lets main win over Figma edits (Figma-only variables stay), and Apply shows when the only work is recreating variables.
- 7881c5a: Pull recreates variables deleted in Figma that other tokens still alias, does not read an alias it could not set as a Figma edit, and treats a file whose synced collections were deleted as a first pull.
- c6421c0: One verb for the push flow: "Push your edits for review", step "Push for review", button "Push for review".
- f8d80da: Settings: a connected repository shows as one row (repo, branch, folder, Connected) with Edit; the save bar only shows while setting up or editing.
- f949c6f: Settings: a saved GitHub token shows as a Connected state row with Replace and Remove; the field appears only to replace it.
- 1325d8b: Plugin UI in the Bridge brand (Deep Harbor, Instrument Sans, Plex Mono, Fraunces summary in a Harbor zone, light and dark), and a summary-first Pull screen: one status line, then groups whose title, count and action share one line.
- 6d36730: Plugin screens in the Field Guide layout: a Harbor intro with a line drawing on every idle, connect and result screen, a Source card, Settings as cards with a link to create a token, Deep Harbor tab indicator.
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
- Updated dependencies [36cb504]
- Updated dependencies [2c79d5d]
  - @bridge-ds/core@0.2.0
