# @bridge-ds/docs-site

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
