# DS Bridge (Figma plugin)

DS Bridge lets designers edit design tokens as Figma Variables and send those edits back to this repo
as a pull request. **Git stays the source of truth; Figma is the editing surface.** A designer's change
reaches `main` the same way an AI-authored change does: through a PR, the CI guardrails and
CODEOWNERS review (`docs/GOVERNANCE.md`, Tier 3).

```
GitHub main  --Pull-->  Figma Variables  --edit-->  Push  --PR-->  CI + design/tech review  -->  main
```

The plugin has three tabs: **Pull** (code to Figma, "Bring the latest tokens from main into Figma"),
**Push** (Figma to code, "Send your Figma edits to the repo as a pull request for review") and
**Settings**. The token logic is `@bridge-ds/core` (`packages/core`); this package is the Figma glue.

It works on the free Figma plan: it only uses the Plugin API (`figma.variables`) and the GitHub REST
API. Nothing is synced live and nothing is written to `main` directly.

See it with real data on the live Bridge site: the [token explorer](https://bridge.floriangouloubi.com/studio/tokens/)
shows what a Pull brings into Figma, and [Reviews](https://bridge.floriangouloubi.com/studio/reviews/?pr=4) shows
the pull request a Push opened (PR #4). Components are in [Storybook](https://bridge-storybook.floriangouloubi.com).

## Install (Figma desktop)

1. From the repo root: `npm install`, then `npm run plugin:build` (writes `apps/figma-plugin/dist/`).
2. In the Figma desktop app: **Plugins > Development > Import plugin from manifest...** and pick
   `apps/figma-plugin/manifest.json`.
3. Run it from **Plugins > Development > DS Bridge**.

The `id` in `manifest.json` (`ds-bridge-dev`) is a placeholder for local development. Figma issues the
real id when the plugin is first published; commit it then. The Community listing (copy, icon, cover,
gallery) and the publishing steps are in [`community/`](community/listing.md).

## GitHub token

DS Bridge needs a fine-grained personal access token limited to this repository:

1. GitHub **Settings > Developer settings > Personal access tokens > Fine-grained tokens > Generate new token**.
2. **Repository access**: "Only select repositories", pick this repository.
3. **Repository permissions**: **Contents: Read and write**, **Pull requests: Read and write**.
   Metadata (read-only) is added automatically.
4. Paste it in the plugin's **Settings** tab and save.

Repository, branch and tokens path are prefilled from `bridge.config.json` at the root of this repo.
At scan time the plugin also reads `bridge.config.json` from the configured repository; when it exists,
its `tokens.root`, tier folders, contrast checks file, mode order and changeset package win over the
tokens path in Settings. Without one, the plugin uses the Settings path with the default folder names
and writes no changeset.

On save the plugin checks the token with `GET /repos/{owner}/{repo}` and refuses it if it cannot write
to the repository. The token is stored with `figma.clientStorage`, which is local to this computer and
this plugin; it is not stored in the Figma file and is never displayed again (the field stays empty,
showing only that a token is saved). Repository, base branch (`main`) and tokens path
(`packages/tokens/src`) are stored in the file's shared plugin data so the whole team uses the same ones.

The manifest only allows `https://api.github.com`. File contents are read through the git trees and
blobs endpoints, never from `raw.githubusercontent.com`.

## How it works

### Figma layout: one collection per tier

| Git (under the tokens root) | Figma collection | Modes | Values alias |
| --- | --- | --- | --- |
| `primitives/*.tokens.json` | **Primitives** | Value | literals (or another primitive) |
| `brands/<brand>.tokens.json` (palette, radius and font roles) | **Brand** | Bridge, Ocean (one per brand file) | Primitives |
| `semantic/base.tokens.json` (motion, layers, icon sizes, border widths) | **Base** | Value | Primitives, or a literal |
| `semantic/light.tokens.json`, `semantic/dark.tokens.json` | **Semantic** | Light, Dark | Brand palette roles (`palette.*`) |
| `density/comfortable.tokens.json`, `density/compact.tokens.json` | **Density** | Comfortable, Compact | Primitives |
| `components/*.tokens.json` | **Component** | Value | Semantic (and Brand radius roles, Base, Density) |
| `brands/<brand>.<theme>.tokens.json` (brand theme overrides) | none | | code-only, see below |

Aliases cross collections, as in code: a Semantic variable points to a Brand variable, which points to
a Primitive. In Figma, a frame picks one mode per collection, so setting Brand to Ocean and Semantic to
Dark shows exactly what `data-brand="ocean" data-theme="dark"` shows in code (minus the overrides).

**Base** has its own single-mode collection instead of being copied into both Semantic modes: a
theme-independent token edited in one mode only would otherwise be ambiguous, and a single value reads
back losslessly.

**Brand theme overrides** stay code-only. A Figma variable has one value per mode of its own
collection, while an override depends on brand and theme together (ocean x light). Mapping them would
need a fake brand x theme mode or duplicated variables that break aliasing. So the plugin never writes
or reads them, lists them as a warning after each scan, still uses them for contrast, and warns when
you edit a semantic token that a brand overrides ("this edit does not change Ocean light").

**Free plan.** The plugin tries to add the modes of each multi-mode tier (Brand, Semantic, Density).
If Figma refuses (plans limited to one mode per collection), it creates one collection per mode
(`Brand/Bridge`, `Brand/Ocean`, `Semantic/Light`, ...) with identical variable names. Both layouts read
back the same way. In the split layout, aliases target the first mode's collection (the default brand).

Variable names use `/` where token paths use `.`: `color.action.primary.bg` is `color/action/primary/bg`.

| DTCG `$type` | Figma variable | Notes |
| --- | --- | --- |
| `color` (sRGB object or hex) | COLOR | Written back as the 2025.10 object form (components rounded to 3 decimals, `hex`, `alpha` when below 1) |
| `dimension` (`px`, `rem`) | FLOAT | Unit kept in plugin data and restored on export |
| `number`, `fontWeight` | FLOAT | Original DTCG type kept in plugin data |
| `fontFamily` (list) | STRING | Joined with `", "` and split back into a list |
| `string`, `boolean` | STRING, BOOLEAN | |
| `shadow`, `duration`, `cubicBezier` and other composites | none | Code-only: never created in Figma, never touched by a push |

### Pull (Git to Figma)

1. Reads `main` (`bridge.config.json`, the token files of every tier and `contrast.checks.json`) through the GitHub API.
2. Builds a plan: variables to create, update, rename, and orphans. You see it before anything is written.
3. Applies it in batches: collections and modes, then literal values, then aliases in a second pass
   (so every alias target exists), then orphan flags.
4. Stores the pulled commit as the file's **base** (`baseSha`).

A pull never overwrites a local edit silently: tokens you changed in Figma since the last pull are
kept, and tokens changed on both sides are shown as conflicts for you to decide. Tokens removed on
`main` are **not deleted** in Figma: the variable gets plugin data `orphan=true` and an `[orphan] `
prefix in its description, so you can rebind layers before deleting it yourself.

### Push (Figma to Git)

1. Snapshot of the variables, converted back to DTCG.
2. **Three-way diff per token**: base (the file at `baseSha`), Figma (now), `main` (now).
   - Changed only in Figma: goes into the PR (added, changed, renamed, removed).
   - Changed only on `main`: kept as it is on `main` (listed for information).
   - Changed on both sides: **conflict**, shown side by side; you pick Figma or `main` for each one.
     Nothing is overwritten silently. Without a base (first sync), every difference is a conflict.
3. Push screen: color swatches (old and new), contrast badges per brand and theme (AAA, AA, fail),
   plain-language guardrail messages. Blocking problems disable the **Push and open pull request**
   button (**Push to pull request #N** when adding to your open PR).
4. Opens the PR: one branch `tokens/<slug>-<yyyymmdd-hhmm>`, **one atomic commit** containing only
   the changed token files plus a changeset (`minor`, or `major` when a token is renamed or removed),
   a **draft** PR labelled `tokens` with a change table (token, tier, old -> new per mode of its tier,
   contrast before -> after), the guardrail checklist and the risk tier
   ("Tier 3: token change, needs design + tech approval"). If the PR from your last push is still
   open, you can add the commit to it instead of opening a new one.

Each changed value is written back to the file of its tier and mode: a palette edit in the Ocean mode
of Brand goes to `brands/ocean.tokens.json`, a Dark edit in Semantic to `semantic/dark.tokens.json`, a
Compact edit in Density to `density/compact.tokens.json`, a new Component variable to
`components/<first path segment>.tokens.json` (or next to its closest sibling).

### Contrast: which pairs a change affects

Pairs come from `contrast.checks.json` (`{ "pairs": [[foreground, background, min], ...] }`), the same
file the token build gates on. A pair is a text pair when `min` is 4.5 or more, a UI pair otherwise.
Every pair is resolved for every brand x theme, with brand overrides applied, so the plugin's ratios
match `dist/resolved.json` (a test checks all of them).

The alias-resolution rule for the PR's "Contrast (before -> after)" column: a pair is listed under a
changed token when the foreground or the background resolves through that token in that brand x theme,
directly or through any alias in between, and the mode that changed is the one used there. Examples:

- `color.bg.default` changed in Light: every pair with `color.bg.default` as foreground or background,
  in Bridge light and Ocean light. Dark is not listed.
- `palette.neutral.50` changed in the Bridge mode of Brand: every pair whose colors resolve through
  `palette.neutral.50` in Bridge light and Bridge dark (for example `color.text.default` on
  `color.bg.default`, which aliases it). Ocean is not listed.
- `color.steel.50` (a primitive) changed: every pair that reaches it through a palette role and a
  semantic token, in the brands whose palette uses it.
- A semantic token that Ocean overrides for light: Ocean light is not listed, since the override wins
  there.

Before this rule, the column was empty when `color.bg.default` changed (PR #4): the plugin read pairs
from a file in another format and only matched pairs naming the token directly.

### Stable ids and renames

Every variable the plugin writes carries a token id in its plugin data. The id is
`$extensions["com.dsbridge.id"]` when the token declares one, otherwise `path:<path>`. Matching is by
id first, then by name, so renaming a variable in Figma becomes a rename in Git, not a delete plus an
add. The extension is only written into the JSON when the id no longer matches the default
`path:<current path>` (after a rename), which keeps the files lean.

Variables created in Figma have no id yet. When one looks like a renamed token (same type, same values,
similar path), the plugin suggests the rename; it only counts as a rename after you confirm it.

### Lossless round trip

Native exports lose information; DS Bridge edits the JSON in place instead of regenerating it:

- A format-preserving JSON parser keeps each node's original text. A file nobody changed is
  byte-identical after parse and serialize (tested on every token file in the repo).
- An edited token keeps its key order and its file's layout (inline or multi-line objects, indent,
  number spelling). `$description`, `$type` (group inheritance included), `$extensions` from other
  tools (`com.figma.scopes`, `com.dsbridge.id`, anything else) are preserved.
- Float noise from Figma is ignored: colors compare by 8-bit hex plus alpha, numbers to 1e-4. A value
  that did not really change keeps main's exact spelling.

### Guardrails (checked before the push button is enabled)

- Tier order, matching `docs/ARCHITECTURE.md` "Token tiers":
  - Brand and Density tokens alias primitives.
  - Semantic colors alias a Brand palette role (`palette.*`); translucent primitives (`color.alpha.*`)
    are the only raw colors allowed. Other semantic tokens alias a primitive or a Brand role.
  - Component tokens alias semantic tokens (or Base, Density, Brand radius roles, primitive scale
    steps), never a palette role, a raw color or another component token.
  - Base tokens and primitives may hold literals.
- No raw values where an alias is required (Brand, Semantic, Density, Component).
- No broken references and no alias cycles, in every mode.
- Every Brand, Semantic and Density token exists in every mode of its tier.
- Brand theme overrides follow the semantic rule and override an existing semantic token.
- No variable scoped to `ALL_SCOPES` ("All supported properties").
- Type changes are not allowed (create a new token instead).
- Contrast: every pair in `contrast.checks.json` meets its own minimum in every brand x theme.

Problems that already exist on `main` are shown as warnings, not blockers, so an unrelated issue does
not stop a designer's change. Everything the change introduces blocks. CI and the code owners remain
the authority; the plugin only gives the answer earlier.

### Scopes

Figma's default scope (`ALL_SCOPES`) shows every variable in every picker. When a token does not declare
`$extensions["com.figma.scopes"]`, the plugin sets sensible defaults from its path and type: primitive
colors and Brand palette roles are hidden from pickers (use semantic tokens), `text` colors get `TEXT_FILL`, `border` gets
`STROKE_COLOR`, `bg`/`surface` get frame and shape fills, `radius` gets `CORNER_RADIUS`, `space` gets
`GAP` and `WIDTH_HEIGHT`, and so on. Scopes are written to the JSON only when you change them away from
these defaults.

### Reliability

- Reads (and content-addressed writes: blobs, trees, commits) are retried with backoff on network
  errors, 5xx and secondary rate limits. Branch and PR creation are never retried blindly.
- An exhausted hourly rate limit says when it resets. 401, 403 and 404 errors explain what to fix
  (expired token, missing permission, wrong repository or branch). Every failed action offers "Try again".
- Branch updates never force-push: if the branch moved, the push fails instead of losing work.
- Large token sets: files are fetched with limited concurrency, Figma writes are batched with yields
  and report progress, and long change lists render in pages.

## Limitations

- **Modes on the free plan**: one mode per collection, hence the `Semantic/Light` + `Semantic/Dark`
  (and `Brand/*`, `Density/*`) fallback. Aliases then follow the default brand only.
- **Brand theme overrides** are code-only (see Figma layout).
- **Type changes are not allowed** (for example COLOR to FLOAT). Create a new token instead.
- **No live sync**: you pull and push explicitly. Main can move between your pull and your push; the
  three-way diff handles it.
- **Line height**: DTCG `number` line heights are unitless multipliers (1.5); Figma's line-height
  variables are in pixels. The value round-trips but means something different when applied in Figma.
- **Library variables**: aliases to variables from another library cannot be exported.
- **No deletion in Figma**: tokens removed on `main` are flagged as orphans, never deleted.
- **GitHub only**: no GitLab or Bitbucket.
- Shadows, durations, easings and other composite tokens stay code-only.

## Why not Tokens Studio or the native export

- Tokens Studio works well, but its multi-file and branch sync features are part of the paid Pro plan;
  this repo needs branch plus PR per change for every designer.
- Figma's native export of variables to DTCG JSON has been reported by users on the Figma community
  forum (2025 to 2026) to drop descriptions and to flatten aliases into resolved values. This repo's
  semantic layer is aliases, so a lossy export would turn every push into a regression.
- The Variables REST API (read and write) is only available on Enterprise plans. On other plans, only
  the Plugin API can read and write variables, which is what DS Bridge uses.

## Development

```sh
npm run build -w @bridge-ds/figma-plugin       # dist/code.js + dist/ui.html (JS and CSS inlined)
npm run watch -w @bridge-ds/figma-plugin       # rebuild on change
npm run test -w @bridge-ds/figma-plugin        # node:test, compiled with esbuild
npm run typecheck -w @bridge-ds/figma-plugin   # tsc, strict, against @figma/plugin-typings
npm run plugin:build                         # same build, from the repo root
```

```
apps/figma-plugin/
  manifest.json          name, editorType, dynamic-page access, network allowlist (api.github.com only)
  scripts/               esbuild build and test runner (both bundle @bridge-ds/core from source)
  src/main/              main thread: figma.variables, clientStorage, plugin data (no network)
  src/ui/                UI iframe: Pull, Push and Settings tabs, rendering, GitHub calls
  src/shared/messages.ts typed message protocol between the two, collection names, default settings
  src/sync/              Figma glue on top of @bridge-ds/core:
    mapping.ts           tiers <-> Figma collections and modes, pull plan, snapshot back to tokens
    flows.ts             pull and push orchestration (analyze, buildPull, buildPush, openPullRequest)
  test/                  end-to-end pull/edit/push flows against an in-memory GitHub and a simulated
                         Figma (single and split layouts), including the PR #4 contrast regressions
```

Everything else (DTCG codec, tiers, resolver, contrast, validators, diff, PR body, risk tier,
changesets, GitHub client) is in `packages/core`, tested with Vitest from the root `npm test`. See
[`packages/core/README.md`](../../packages/core/README.md).
