# Figma fixes and gap cases

How Bridge keeps its Figma pull true for any design system. The general measure (`bridge specs --measure`) draws most
components right. For the rest, the team's own Claude writes a correction, Bridge re-checks it against the story's
screenshot, and a person approves it. A component that will not converge keeps an honest status (Differs, or Can't
check with the reason). Code: `packages/core/src/gap-case.ts` and `packages/core/src/figma-fixes.ts` (pure, browser
safe), `packages/cli/src/fixes.ts` (the commands).

```
pull -> Compare with code (story shot vs Figma render, per variant)
     -> gap case per differing component (bridge gap)
     -> Claude proposes a fix (figma-fixes.json, in a pull request)
     -> pull again with the fix, Compare with code again
     -> a person approves the pull request
```

**The shot decides.** The story's screenshot is the referee. A gap case explains a difference the shot comparison
found; a fix is kept only when the next Compare with code shows the variant closer to its shot. Nothing in this loop can
mark a component as matching: a fix of kind `status` can say Differs or Can't check, never Matches.

## Gap case

`bridge gap <component>` (or `buildGapCase` in the plugin) builds one component's gap case from:

- `measured-specs.json`: what each story renders (with `figma-fixes.json` already applied);
- the plugin's Compare with code result: which variants differ, by how many pixels, and both sizes;
- the component spec the pull drew the set from, and optionally what the plugin reads back from the layers (values,
  hidden parts, boxes);
- the story shots (`measured-shots/manifest.json`).

For each variant that differs it gives the story (id, props, args Bridge passed, state), the shot, the Figma render
when the plugin passes one, and the differences. `expected` is always the code (the measure), `actual` is Figma:

| Property | Example text |
| --- | --- |
| `height`, `width` (root) | Height 72 in Figma vs 84 in code: 8 px missing below the label, 4 px missing below the text input field wrapper |
| `presence` | The toggle switch before is missing in Figma / is hidden in Figma, shown in code / is in Figma, not in the code render |
| `sizing` | Width fixed at 48 in code, hugs its content in Figma (btn) |
| `direction` | Children side by side in Figma, stacked in code (appearance) |
| any field | Corner radius 0 in Figma vs full in code (toggle switch) |

Where the space goes needs the layer boxes (`built[variant].boxes`); without them the gap gives the size only. A
variant whose shot differs while every measured value agrees says so ("compare the shot with the Figma render"), and a
variant no story renders says how to fix that (measure it, or a `story` fix).

The case carries `summary` (one sentence for a designer) and `detail` (lines for a developer or Claude), plus
`differences[]` with `part`, `property`, `expected`, `actual` and `delta` (px) for a fix to be written from.

## figma-fixes.json

A versioned file at the repo root, next to `bridge.config.json` and `measured-specs.json`. Every pull applies it to a
fresh measure, so fixes survive pulls. Commands:

```sh
bridge fixes check [--in measured-specs.json]          # validate; with --in, list fixes that find nothing
bridge fixes apply --in measured-specs.json --out measured-specs.fixed.json
bridge gap Toggle --fidelity fidelity.json --specs specs.json
```

```json
{
  "version": 1,
  "fixes": [
    {
      "id": "toggle-switch-pill",
      "kind": "part",
      "component": "Toggle",
      "part": ".cds--toggle__switch",
      "set": { "cornerRadius": "full" },
      "reason": "Carbon toggles are pills in every size; Figma drew square corners.",
      "by": "claude"
    }
  ]
}
```

Every fix has:

| Key | Required | What |
| --- | --- | --- |
| `id` | yes | Lower case, digits and dashes, unique in the file. Provenance and reviews name it. |
| `kind` | yes | `part`, `axis`, `story` or `status`. |
| `component` | yes | The Figma set: the last segment of the stories' title (`Components/Toggle` is `Toggle`), case ignored. |
| `reason` | yes | Why, in a sentence. Shown in review and in the pull report. No em dash. |
| `by` | no | `claude` or a GitHub login. |
| `where` | no | Which variants: `{ "args": { "size": "sm" }, "state": "hover" }`. A story is in when its props (args over defaults, plus the args Bridge passed) have every listed value, in that state (`rest`, `hover`, `active`, `focus-visible`, `disabled`). Absent: every story of the component. |

Unknown keys are refused, so a typo never passes silently.

### `part`: a spec patch on one part

`part` is a part id from the measure (`cds--toggle-switch`, `root`), or a CSS class with a dot (`.cds--toggle__switch`)
for every part that has it. Give at least one change:

| Key | Values | Effect on the measure the pull reads |
| --- | --- | --- |
| `set` | field -> token path, px number, `null` (no paint, colors only), `"full"` (cornerRadius only) | The part's field values. `"full"` is half the part's shortest side. Fields: fill, stroke, strokeWeight and its sides, cornerRadius, paddings, itemSpacing, counterAxisSpacing, width, height, minWidth, minHeight, opacity, textFill, fontFamily, fontSize, fontWeight, lineHeight, letterSpacing, textDecoration. |
| `width`, `height` | `fixed`, a number (px), `hug`, `fill` | fixed: the measured size (or the number), kept even around content. hug: sized by its content. fill: fills its container (grow along the parent's direction, stretch across it, a root fills its frame). |
| `direction` | `HORIZONTAL`, `VERTICAL` | The part's auto layout direction. |
| `align` | `{ "primary": MIN, CENTER, MAX, SPACE_BETWEEN, "counter": MIN, CENTER, MAX, STRETCH }` | Auto layout alignment. |
| `overlay` | `true`, `false`, `{ "top": 3, "left": 3 }` | true: over its parent, filling it, out of the auto layout. Offsets: pinned there. false: back in the flow. |
| `hide` | `true` | Not drawn, with everything inside it. Goes alone. The root cannot be hidden. |

```json
{ "id": "iconbutton-48", "kind": "part", "component": "IconButton", "part": "cds--btn",
  "width": "fixed", "height": "fixed", "reason": "Carbon's icon button is 48 px square; Figma hugged the 16 px icon." }
{ "id": "toggle-knob-pin", "kind": "part", "component": "Toggle", "part": "cds--toggle-switch-before",
  "overlay": { "top": 3, "left": 3 }, "where": { "args": { "toggled": false } },
  "reason": "The knob sits on the track at the start when off." }
```

### `axis`: how a story arg becomes a Figma property

| `action` | Keys | Effect |
| --- | --- | --- |
| `map` | `arg`, `property` and/or `values` (code value -> Figma value) | The pull names the property and its values that way. Two code values cannot share a Figma value (prune one instead). |
| `ignore` | `arg` | The arg is not a Figma property: it leaves the component's arg list, and stories at another value than its default are left out. |
| `prune` | `where` | The variants `where` names are dropped (a combination the code allows and the library never shows). |

```json
{ "id": "button-kind", "kind": "axis", "action": "map", "component": "Button", "arg": "kind",
  "property": "Kind", "values": { "primary": "Primary", "danger--ghost": "Danger ghost" },
  "reason": "Designers know Carbon's kinds by these names." }
{ "id": "iconbutton-align", "kind": "axis", "action": "ignore", "component": "IconButton", "arg": "align",
  "reason": "Tooltip placement, not a look of the button." }
{ "id": "textinput-no-readonly-hover", "kind": "axis", "action": "prune", "component": "TextInput",
  "where": { "args": { "readOnly": true }, "state": "hover" },
  "reason": "A read-only field has no hover style in Carbon." }
```

### `story`: which story a variant is drawn from

`where` names the variant, `use` the measured render: `{ "story": "<id>", "args": {...}, "state": "..." }` (args and
state pick among several renders of the same story). The render stands for the variant in place of the stories that
matched it; its picture is the story's, its args are the variant's.

```json
{ "id": "toggle-on-story", "kind": "story", "component": "Toggle",
  "where": { "args": { "toggled": true }, "state": "rest" }, "use": { "story": "components-toggle--small-toggle" },
  "reason": "The default story ignores toggled; this one renders it on." }
```

### `status`: an honest status, or a note

With `status` (`differs` or `cant-check`), the component (or the variants in `where`) shows that status with
`reason` as its sentence; without `where` it also replaces the component's entry in `statuses`. Without `status`, the
reason is a note shown with the set. `matches` is refused.

```json
{ "id": "iconbutton-tooltip", "kind": "status", "component": "IconButton", "status": "cant-check",
  "reason": "The tooltip opens on hover in code; Figma draws the button alone." }
```

## What applyFixes returns

`applyFixes(measured, fixes)` returns `{ file, applied }` and never changes its input:

- `file`: the measure with the fixes laid on (the pull's input). Stories a fix changed list it in `fixes`; component
  entries get `figma` hints (`properties`, `values`, `ignored`, `pruned`, `status`, `notes`, `fixes`); `figmaFixes.applied`
  keeps the run.
- `applied`: one record per fix: `applied`, `not-found` (its component, part or story is not in this measure: the code
  or the measure moved, re-check it) or `already` (the file already carried it). Fixes run in file order.

## Fix with Claude

**For designers:** when a component you pulled into Figma does not look like its story, your team's own Claude
proposes a correction, Bridge checks that it brings the component closer to the code, and a person approves it
like any other change; a component that will not come closer keeps an honest Differs or Can't check status.

Bridge holds no API key. The reasoning is done by the team's Claude: Claude Code or Claude Desktop through the Bridge
MCP server (on the person's own plan), or the CLI with the team's own `ANTHROPIC_API_KEY`. Bridge gives the tools and
is the referee. Code: `packages/core/src/figma-fix-loop.ts` (pure: gaps, gap case, the values referee, the prompt),
`packages/core/src/figma-fix-run.ts` (the loop as steps and the change for review, shared by the CLI and the MCP
tools), `packages/mcp/src/figma-fixes.ts` (the tools), `packages/cli/src/fix.ts` (the commands and the loop runner).

### Where the files are

| File | Where | Written by |
| --- | --- | --- |
| `measured-specs.json`, `measured-shots/` | repo root, else the `bridge-requests` branch | the automatic measure (`.github/workflows/bridge-measure.yml`, docs/MEASURE.md) publishes to `bridge-requests`; `bridge specs --measure --variants --shots` by hand, committed at the root, wins |
| `figma-fixes.json` | repo root | the fixes, through reviewed pull requests |
| `figma-fidelity.json` | repo root, else the `bridge-requests` branch | the plugin's Compare with code run (`FigmaFidelityRun`: the report, plus per set the layers read back and the Figma renders). The plugin's "Copy the report" output works too, passed inline or as a file. |

Without a fidelity run, the gaps come from the measure's own check (`bridge specs --measure --check`), and the gap
case compares the rebuilt set with the measure only.

Without a measure in either place, the tools never fail with a raw error: `bridge_figma_gaps` (and `bridge gaps`) answer
`status: "no-measure"` with the sentence the plugin and Studio show, "Bridge hasn't measured your components yet. A
developer turns it on once: Set up automatic measure.", and the steps (`measureSetupSteps` in
`packages/core/src/measure-location.ts`); the other tools say the same first. In the plugin, a set that differs gets
"Ask Claude to fix it" whenever a measure is found (whatever the Spec source), else that sentence and Copy for your
developer.

### The two referees

- **Values (offline, here).** `bridge_try_figma_fix` validates the fixes (the strict validator above), lays them on
  the measure (`applyFixes`), rebuilds the set the way the plugin pulls it (`specsFromMeasure`, now in core), and
  compares each differing variant with what the code renders, before and after. Each difference is `resolved`,
  `closer`, `same`, `worse` or `unknown`; a difference the fixes add where the set agreed with the code is a
  regression. A variant's height or width after the fixes is exact when the root gets a fixed size, else worked out
  from the layer boxes and the changed paddings, gaps and fixed sizes along that axis (`estimated`). The verdict is
  `closer` when more moved closer than got worse, `worse` the other way, else `same`.
- **Pixels (later, in the plugin).** The story shot against the real Figma render, in Compare with code, after the next
  pull of the fix branch. Only this one can say a variant matches.

### MCP flow (Claude Code, Claude Desktop)

1. `bridge_figma_gaps`: the components that differ (Differs) or cannot be checked (Can't check, with the reason).
2. `bridge_get_gap_case { component }`: the gap case (`GapCase`), the fix schema, the ids already in the file.
3. `bridge_try_figma_fix { component, fixes }`: the values referee. At most 3 rounds per component: keep what moved
   closer, revise the rest with the deltas. Nothing is written.
4. `bridge_propose_figma_fixes { component, fixes, summary }`: figma-fixes.json with the fixes (a fix with the id of
   one already there replaces it) on a new `bridge/figma-fixes-<component>` branch, and a draft pull request labelled
   `drafted-by-claude`, `figma-fixes`, `source: mcp` and its tier (classifyRisk: Tier 2, a source file). Locally, a new
   local branch, never pushed. The body has the gap, each fix with its reason and the before and after deltas. It runs
   the values referee again and refuses fixes that move the component further from the code, and part or story fixes
   that move nothing. A part fix that sizes, places or lays out a part (`width`, `height`, `direction`, `align`,
   `overlay`) opens even when the referee says same: it can't judge layout, so the body says Compare with code decides.
   When no round came closer, propose a `status` fix instead.

The MCP server may use the person's `gh` sign-in as its token (as for every write from MCP); the CLI writes only with
a token passed on purpose (`GITHUB_TOKEN`, `--token`, or `--use-gh-auth`), and without one opens a local branch.

### CLI flow

```sh
bridge gaps                                    # what differs
bridge fix TextInput --case                    # the gap case and the schema
bridge fix TextInput --try fixes.json          # the values referee (exit 0 when closer)
bridge fix TextInput --propose fixes.json --summary "TextInput keeps its label row height." [--dry-run]
bridge fix TextInput --with-claude [--model claude-sonnet-5-5] [--dry-run]
```

`--with-claude` runs the loop with the team's `ANTHROPIC_API_KEY`: the prompt is the gap case plus the schema
(`fixPrompt`), the reply is parsed into fix objects (`parseFixReply`), Bridge tries them, and the next round gets the
problems or the deltas, up to 3 rounds. The closest fixes are proposed; when none came closer, a `status` fix
(Differs, with the gap's summary as the reason). Without a key, the command says how to run the same loop from
Claude Code with the MCP server.

### What the plugin's "Ask Claude to fix it" button calls

After Compare with code, for a set whose result is Differs: write the run (`FigmaFidelityRun`: `report`, `built` per
set and variant from the `read-built` read-back the plugin already does for its gap cases, with `boxes` and `hidden`,
and `figmaRenders`) to `figma-fidelity.json` on the `bridge-requests` branch (the branch "Draft with my Claude" already
writes to), then show one sentence and **Copy for your developer**. The copied request holds both ways to run the
fix (the MCP phrase "Fix <component> in Figma with Bridge" and `npx @bridge-ds/cli fix <component> --with-claude`);
the plugin never displays a command, an API key or MCP to the designer. The developer's Claude reads the run through
`bridge_figma_gaps` and `bridge_get_gap_case`. When the team uses Bridge inside its Claude (the hosted connector below),
the plugin opens Claude with the request prefilled instead, and shows the fix session while Claude works. Before
building, the pull already applies
figma-fixes.json. The plugin can import `specsFromMeasure` from core and drop its own copy (a core test keeps both
identical until then).

### Bridge inside your team's Claude (the hosted connector)

The team adds Bridge to its own Claude (claude.ai, Claude Desktop, Claude mobile, Claude Code; Pro, Max, Team or
Enterprise) as a custom connector, and that Claude does the fix through Bridge's MCP tools, on the team's own Claude
plan. Bridge runs no model and holds no Anthropic key. Anthropic does not let third-party apps use a Claude
subscription for their own calls, so it goes this way round: Claude calls Bridge.

- **URL:** `https://bridge.floriangouloubi.com/mcp` (any Bridge site: `<site>/mcp`). In Claude: Settings, Connectors,
  Add custom connector, name it Bridge, paste the URL, then Connect and sign in with Bridge. On Team and Enterprise an
  Owner adds it for the organization first; each person then connects with their own Bridge sign-in. Claude Code:
  `claude mcp add --transport http bridge https://bridge.floriangouloubi.com/mcp`, then `/mcp` to sign in.
- **What it is:** every tool of the Bridge MCP server (`packages/mcp`, the same as `npx @bridge-ds/mcp`) over Streamable
  HTTP, stateless, JSON answers (`apps/docs-site/api/mcp`, `handleHttp` in `packages/mcp/src/lib.ts`). It works on the
  repository of the team picked at sign-in, with that person's GitHub App user token, so every write is theirs and
  goes through the usual paths: the fix is a draft pull request on `bridge/figma-fixes-<component>`, labelled
  `drafted-by-claude` and `figma-fixes`, Tier 2. Never the default branch. Agents never merge here: the merge tool
  (`bridge_merge_branch`, with its owner override) is neither listed nor run by the hosted connector; a person merges
  from Studio or GitHub. The local CLI and MCP server keep it.
- **Sign-in (MCP authorization, spec 2026-07-28):** the MCP endpoint answers `401` with
  `WWW-Authenticate: Bearer resource_metadata="<site>/.well-known/oauth-protected-resource/mcp", scope="bridge"`.
  Protected resource metadata (RFC 9728) names the site as the authorization server; its metadata (RFC 8414) is at
  `<site>/.well-known/oauth-authorization-server`. Clients register with a Client ID Metadata Document (an https
  `client_id` URL Bridge fetches and checks; Claude Code uses one) or Dynamic Client Registration (RFC 7591,
  `/oauth/register`), as public clients (`token_endpoint_auth_method: none`). The authorization code flow requires
  PKCE S256, checks `resource` (RFC 8707) and returns `iss` (RFC 9207). Redirect URIs match exactly, except loopback
  ones (Claude Code), matched on any port. Code: `apps/docs-site/api/_lib/oauth.ts`.
- **Who:** `/oauth/authorize` sends the person to `/studio/connect-claude/`: signed in to Bridge, they pick the team and
  press Allow; GitHub (the Bridge GitHub App) confirms who they are, Bridge checks that account can push to the team's
  repository, then they go back to Claude. The page names the app and the address it returns to.
- **Tokens:** Bridge's own, opaque: access 1 hour, refresh 30 days and rotated on every use. Only their SHA-256 is
  stored. The person's GitHub token stays on the server, sealed (AES-256-GCM, key derived from
  `LIBRARY_SESSION_SECRET`), renewed there, never sent to any client. No secret goes in a URL. Each connection (one
  person, one team, one app) shows in Studio Settings, Claude, and its owner or a team admin removes it: its tokens
  stop at once.

### Work in progress: fix sessions

While Claude fixes a component through the connector, Bridge records each Bridge tool call as a step, in designer
words, with who triggered it (the person signed in to the connector) and when. One session per team and component,
kept 7 days after its last step (`apps/docs-site/api/_lib/fix-sessions.ts`):

| Tool call | Step |
| --- | --- |
| `bridge_get_gap_case` (starts the session) | Claude read the differences (N) |
| `bridge_try_figma_fix` | Claude tried a fix (round n): closer, no change, or further away |
| `bridge_propose_figma_fixes`, a fix | Claude opened its fix for review (the pull request and its review in Studio): ready |
| `bridge_propose_figma_fixes`, a status fix | Claude stopped: the reason Claude gave: stopped |
| `bridge_propose_figma_fixes`, refused by the referee | Bridge did not open it: the reason (still working) |
| nothing for 10 minutes while working | Claude went quiet (`quiet: true`, the state stays working: a new step resumes it) |

There is no percentage: rounds vary, so a session is its steps and the time since it started. In Studio, each session
is one row of the Being built list (one queue, no section of its own), with the list's tags and filters: the component,
then "Claude's fix from Figma, asked by <name>" and where it stands. Where it stands comes from its pull request when the
list read it (open: In review; merged: Shipped, counted in Shipped this week by its merge date; closed without merging:
Not planned), else from the session (working: In progress with the last step, or Claude went quiet; stopped: Not
planned with Claude's reason). The row opens Claude's fix in Studio, never GitHub. The page reads the sessions again
every 10 seconds while one works. Settings, Claude gives the connector address, says who
connected Bridge in Claude and when it was last used, and lets the person who connected it (or a team admin) remove it.
Deleting a Bridge account ends its connections too, with the GitHub tokens Bridge kept sealed for them.

#### Contract (for the plugin)

Auth: `Authorization: Bearer <the Bridge sign-in token>` (the GitHub token the plugin gets from "Sign in with Bridge");
the account must be able to read the repository. CORS is open. Studio sends its session instead. Errors are
`{ "error", "message" }`, the message to show as is.

```http
GET https://bridge.floriangouloubi.com/api/fix-sessions?repo=acme/design&component=TextInput   // the plugin's path
GET https://bridge.floriangouloubi.com/api/mcp?view=session&repo=acme/design&component=TextInput  // the same answer
200 { "session": SessionView }
GET https://bridge.floriangouloubi.com/api/mcp?view=sessions&repo=acme/design
200 { "sessions": SessionView[] }      // the last 7 days, newest first, at most 20
401 signin, 403 forbidden (not on this team), 400 bad_request
```

```ts
interface SessionView {
  component: string;
  state: 'waiting' | 'working' | 'ready' | 'stopped'; // waiting: no session yet for this component
  startedAt: string | null;  // ISO
  updatedAt: string | null;  // the last real step
  elapsed: number;           // seconds since it started (to the last step once ready, stopped or quiet)
  quiet: boolean;            // working, but no step for 10 minutes: show "Claude went quiet"
  reason?: string;           // stopped: Claude's reason, without "Claude stopped: "
  pr?: { number: number; url: string };  // ready (or a stopped status fix): the draft pull request
  round?: number;            // the rounds tried so far
  maxRounds: number;         // 3
  steps: {
    label: string;           // the sentence to show as is (same as text)
    status: 'done' | 'current' | 'failed';  // current: the last step while working; failed: refused, stopped, quiet
    text: string;
    kind: 'read' | 'try' | 'proposed' | 'refused' | 'stopped' | 'quiet';
    at: string;              // ISO
    by: string;              // who triggered it, a name
    round?: number;          // try
    verdict?: 'closer' | 'same' | 'worse' | 'invalid';
    differences?: number;    // read
    pr?: { number: number; url: string };
    review?: string;         // the Studio path of its review: "changes/?pr=91" under the team's Studio
  }[];
}
```

The plugin opens Claude with the prompt prefilled: `https://claude.ai/new?q=Fix%20TextInput%20in%20Figma%20with%20Bridge`
fills the message box without sending it (checked 2026-10-25; claude.ai shows a "be careful before running this prompt"
notice above it and the person presses send). Then it reads the session every few seconds while the state is `waiting`
or `working`.

## Review

A fix is a change like any other: it lands through a pull request on `figma-fixes.json`, drafted by Claude (`by:
"claude"`), reviewed by a person. `bridge fixes check` can run in CI next to `bridge check`. The reviewer reads the
reason and the next Compare with code: the fix stays when the variant moved closer to its shot, and goes back to Claude
with the new gap case when it did not (three attempts, then a `status` fix with the honest reason). The pull
request says which fixes Claude drafted (`drafted-by-claude`) and the values referee's before and after.
