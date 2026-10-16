# DS Bridge (Figma plugin)

DS Bridge lets designers edit design tokens as Figma Variables and send those edits back to this repo
as a pull request. **Git stays the source of truth; Figma is the editing surface.** A designer's change
reaches `main` the same way an AI-authored change does: through a PR, the CI guardrails and
CODEOWNERS review (`docs/GOVERNANCE.md`, Tier 3).

```
GitHub main  --Pull-->  Figma Variables  --edit-->  Review changes  --PR-->  CI + design/tech review  -->  main
```

It works on the free Figma plan: it only uses the Plugin API (`figma.variables`) and the GitHub REST
API. Nothing is synced live and nothing is written to `main` directly.

## Install (Figma desktop)

1. From the repo root: `npm install`, then `npm run plugin:build` (writes `apps/figma-plugin/dist/`).
2. In the Figma desktop app: **Plugins > Development > Import plugin from manifest...** and pick
   `apps/figma-plugin/manifest.json`.
3. Run it from **Plugins > Development > DS Bridge**.

The `id` in `manifest.json` (`ds-bridge-dev`) is a placeholder for local development. Publishing the
plugin would need an id issued by Figma.

## GitHub token

DS Bridge needs a fine-grained personal access token limited to this repository:

1. GitHub **Settings > Developer settings > Personal access tokens > Fine-grained tokens > Generate new token**.
2. **Repository access**: "Only select repositories", pick this repository.
3. **Repository permissions**: **Contents: Read and write**, **Pull requests: Read and write**.
   Metadata (read-only) is added automatically.
4. Paste it in the plugin's **Settings** tab and save.

On save the plugin checks the token with `GET /repos/{owner}/{repo}` and refuses it if it cannot write
to the repository. The token is stored with `figma.clientStorage`, which is local to this computer and
this plugin; it is not stored in the Figma file and is never displayed again (the field stays empty,
showing only that a token is saved). Repository, base branch (`main`) and tokens path
(`packages/tokens/src`) are stored in the file's shared plugin data so the whole team uses the same ones.

The manifest only allows `https://api.github.com`. File contents are read through the git trees and
blobs endpoints, never from `raw.githubusercontent.com`.

## How it works

### Figma layout

| Git | Figma |
| --- | --- |
| `primitives/*.tokens.json` | Collection **Primitives**, one mode ("Value") |
| `semantic/light.tokens.json`, `semantic/dark.tokens.json` | Collection **Semantic** with modes **Light** and **Dark** |
| same, when the file allows only one mode per collection | Collections **Semantic/Light** and **Semantic/Dark**, identical variable names |

The plugin detects the layout at runtime: it tries to add a second mode and, if Figma refuses (free
plans limit collections to one mode), it falls back to one collection per theme. Both layouts are read
back the same way. Variable names use `/` where token paths use `.`: `color.action.primary.bg` is
`color/action/primary/bg`. Semantic values are Figma aliases to the primitive variables.

| DTCG `$type` | Figma variable | Notes |
| --- | --- | --- |
| `color` (sRGB object or hex) | COLOR | Written back as the 2025.10 object form (components rounded to 3 decimals, `hex`, `alpha` when below 1) |
| `dimension` (`px`, `rem`) | FLOAT | Unit kept in plugin data and restored on export |
| `number`, `fontWeight` | FLOAT | Original DTCG type kept in plugin data |
| `fontFamily` (list) | STRING | Joined with `", "` and split back into a list |
| `string`, `boolean` | STRING, BOOLEAN | |
| `shadow` and other composites | none | Code-only: never created in Figma, never touched by a push |

### Pull (Git to Figma)

1. Reads `main` (tokens files and `contrast-pairs.json`) through the GitHub API.
2. Builds a plan: variables to create, update, rename, and orphans. You see it before anything is written.
3. Applies it in batches: collections and modes, then literal values, then aliases in a second pass
   (so every alias target exists), then orphan flags.
4. Stores the pulled commit as the file's **base** (`baseSha`).

A pull never overwrites a local edit silently: tokens you changed in Figma since the last pull are
kept, and tokens changed on both sides are shown as conflicts for you to decide. Tokens removed on
`main` are **not deleted** in Figma: the variable gets plugin data `orphan=true` and an `[orphan] `
prefix in its description, so you can rebind layers before deleting it yourself.

### Review changes and push (Figma to Git)

1. Snapshot of the variables, converted back to DTCG.
2. **Three-way diff per token**: base (the file at `baseSha`), Figma (now), `main` (now).
   - Changed only in Figma: goes into the PR (added, changed, renamed, removed).
   - Changed only on `main`: kept as it is on `main` (listed for information).
   - Changed on both sides: **conflict**, shown side by side; you pick Figma or `main` for each one.
     Nothing is overwritten silently. Without a base (first sync), every difference is a conflict.
3. Review screen: color swatches (old and new), contrast badges (AAA, AA, fail), plain-language
   guardrail messages. Blocking problems disable the PR button.
4. Opens the PR: one branch `tokens/<slug>-<yyyymmdd-hhmm>`, **one atomic commit** containing only
   the changed token files plus a changeset (`minor`, or `major` when a token is renamed or removed),
   a **draft** PR labelled `tokens` with a change table (token, light old -> new, dark old -> new,
   contrast before -> after), the guardrail checklist and the risk tier
   ("Tier 3: token change, needs design + tech approval"). If the PR from your last push is still
   open, you can add the commit to it instead of opening a new one.

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

### Guardrails (checked before the PR button is enabled)

- Semantic tokens must alias a primitive (no alias to another semantic token).
- No raw values in semantic tokens.
- No broken references and no alias cycles.
- Every semantic token exists in every theme.
- No variable scoped to `ALL_SCOPES` ("All supported properties").
- Type changes are not allowed (create a new token instead).
- Contrast: every pair in `packages/tokens/src/contrast-pairs.json` meets WCAG AA in every theme
  (4.5:1 for `text`, 3:1 for `large-text` and `ui`).

Problems that already exist on `main` are shown as warnings, not blockers, so an unrelated issue does
not stop a designer's change. Everything the change introduces blocks. CI and the code owners remain
the authority; the plugin only gives the answer earlier.

### Scopes

Figma's default scope (`ALL_SCOPES`) shows every variable in every picker. When a token does not declare
`$extensions["com.figma.scopes"]`, the plugin sets sensible defaults from its path and type: primitive
colors are hidden from pickers (use semantic tokens), `text` colors get `TEXT_FILL`, `border` gets
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

- **Modes on the free plan**: one mode per collection, hence the `Semantic/Light` + `Semantic/Dark` fallback.
- **Type changes are not allowed** (for example COLOR to FLOAT). Create a new token instead.
- **No live sync**: you pull and push explicitly. Main can move between your pull and your push; the
  three-way diff handles it.
- **Line height**: DTCG `number` line heights are unitless multipliers (1.5); Figma's line-height
  variables are in pixels. The value round-trips but means something different when applied in Figma.
- **Library variables**: aliases to variables from another library cannot be exported.
- **No deletion in Figma**: tokens removed on `main` are flagged as orphans, never deleted.
- **GitHub only**: no GitLab or Bitbucket.
- Shadows and other composite tokens stay code-only.

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
npm run build -w @demo-ds/figma-plugin       # dist/code.js + dist/ui.html (JS and CSS inlined)
npm run watch -w @demo-ds/figma-plugin       # rebuild on change
npm run test -w @demo-ds/figma-plugin        # node:test, compiled with esbuild
npm run typecheck -w @demo-ds/figma-plugin   # tsc, strict, against @figma/plugin-typings
npm run plugin:build                         # same build, from the repo root
```

```
apps/figma-plugin/
  manifest.json          name, editorType, dynamic-page access, network allowlist (api.github.com only)
  scripts/               esbuild build and test runner
  src/main/              main thread: figma.variables, clientStorage, plugin data (no network)
  src/ui/                UI iframe: tabs, rendering, GitHub calls
  src/shared/messages.ts typed message protocol between the two
  src/core/              pure logic, tested in Node:
    json-ast.ts          format-preserving JSON parser and serializer
    dtcg-codec.ts        read and edit DTCG files in place
    token-set.ts         logical tokens (one value per theme) from the repo files
    resolver.ts          alias chains, cycles, broken references
    mapping.ts           tokens <-> Figma variables, pull plan
    id-map.ts            stable ids, rename suggestions
    diff-engine.ts       three-way diff per token
    compose.ts           apply accepted changes to main's files
    wcag.ts, validators.ts  contrast and guardrails
    github-client.ts     fetch-based REST client (refs, trees, blobs, commits, PRs)
    pr-composer.ts       branch name, PR body, changeset, commit message
    flows.ts             pull and push orchestration
  test/                  unit tests, including round trips on the real token files and an end-to-end
                         pull/edit/push flow against an in-memory GitHub and a simulated Figma
```
