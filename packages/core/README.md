# @bridge-ds/core

Pure design-token logic for Bridge: load DTCG 2025.10 tokens across tiers, resolve aliases per brand,
theme and density, check WCAG contrast, diff three versions of a token set, edit `*.tokens.json` files
without reformatting them, build the pull request (body, risk tier, changeset) and talk to GitHub.

No Figma API, no DOM, no Node-only API in the main entry (Node helpers live in `@bridge-ds/core/node`): it runs in a Figma plugin sandbox, a browser, Node or an MCP
server. The DS Bridge Figma plugin (`apps/figma-plugin`) is built on it; a CLI and an MCP server can be
too. Nothing here hardcodes a repository: callers pass a `BridgeConfig` (usually `bridge.config.json`).

```ts
import { loadConfig, buildTokenSet, layoutOptions, validateSet, parseContrastChecks } from '@bridge-ds/core';
```

Published builds ship ES modules and type declarations from `dist/` (`npm run build:packages`). Inside this
monorepo the `source` export condition resolves to the TypeScript sources instead, so nothing needs building
first. Tests: `npx vitest run --project core` (part of the root `npm test`).
Typecheck: `npx tsc --noEmit -p packages/core`.

## Tiers

| Tier | Files (under `tokens.root`) | Modes | May alias |
| --- | --- | --- | --- |
| `primitive` | `primitives/*.tokens.json` | single (`"value"`) | primitives |
| `brand` | `brands/<brand>.tokens.json` | one per brand | primitives |
| `base` | `semantic/base.tokens.json` | single | primitives (literals allowed) |
| `semantic` | `semantic/<theme>.tokens.json` | one per theme | colors: `palette.*` (or `color.alpha.*`); others: brand roles or primitives |
| `density` | `density/<density>.tokens.json` | one per density | primitives |
| `component` | `components/*.tokens.json` | single | semantic, base, density, brand roles, primitive scale steps; never a palette role or a raw color |
| overrides | `brands/<brand>.<theme>.tokens.json` | brand x theme | same as semantic; must override an existing semantic token |

## config

`bridge.config.json` at the repository root: one file and one schema (`packages/core/bridge.config.schema.json`,
also exported as `@bridge-ds/core/bridge.config.schema.json`) for the plugin, the docs site, the CLI and the MCP
server. Canonical form: `repo`, `tokens` (`root`, `include`, `exclude`, `tiers`, ordered `layers` with `{mode}`
placeholders and `optional`), `modes` (name -> `{ values, default, parity }`), `contrast` (`path`, `modes`),
`components`, `docs`, `changesets`, `cssVar`, `governance` (`protectedBranches`, `branchPrefix`, `labels`,
`guardrails`, `owners: { design, tech }`). The older flat form (`tokens.primitives`, `modes.brands`...) still loads.

```ts
const CONFIG_FILE = 'bridge.config.json';
interface BridgeConfig {
  repo: { owner; name; defaultBranch } | undefined;
  tokens: TokenPaths & { include; exclude; tiers: Record<string, string[]>; layers: { files; optional }[] };
  axes: Record<string, { values; default; parity }>;     // canonical modes
  modes: { brands; themes; densities; defaults };         // brand/theme/density view for the tier model
  contrast: { path; modes? } | undefined;
  components?: { dir; docsSuffix; styleSuffix; reference?; index? };
  docs; changesets: { dir; package } | undefined; changeset?: { package };
  cssVar: { prefix; separator };
  governance: { protectedBranches; branchPrefix; labels; guardrails; owners: { design: string[]; tech: string[] } };
}
function defineConfig(input): BridgeConfig;   function loadConfig(source): BridgeConfig;   // ConfigError { problems }
function toConfigJson(config): object;        // canonical JSON (what `bridge init` writes)
function protectedBranchesOf(config); function baseBranchOf(config); function tokensPath(config, rel?);
```

## governance

```ts
function assertSafeBranch(branch, { protectedBranches?, base?, branchPrefix? }): void;  // ProtectedBranchError
const DEFAULT_PROTECTED_BRANCHES = ['main', 'master'];
```

The GitHub client and the local git writer both call it: no Bridge surface writes to a protected branch.

## layered sets (CLI and MCP)

```ts
new LayeredTokenSet(config, files: Map<relPath, text>);  // combos(), view(combo), resolve(path, combo), tierOf(path), cssVarName(path)
function validateLayered(set): LayerIssue[];              // DTCG shapes, names, aliases per combo, missing layers, mode parity
function runLayeredContrast(set, pairs, modes?); function contrastDelta(before, after);
function applyTokenEdits(set, edits: TokenEdit[]): { files; touched; notes };   // set, add, remove, rename; minimal diffs
function coerceValue(input, type?, existing?);            // "#ff5500", "12px", "150ms" -> the repo's DTCG form
function diffLayered(before, after); function layeredImpact(before, after, changes);
function classifyLayered(changes, otherFiles?, config?);  // classifyRisk underneath
function composeProposalBody(input); function changeTable(changes); function contrastDeltaTable(deltas);
```

`@bridge-ds/core/node` (Node only): `git`, `isGitRepo`, `currentBranch`, `branchExists`, `showFile`, `listFilesAt`,
`originRepo`, `commitToNewLocalBranch` (plumbing commit on a new branch; working tree, index and checkout untouched).

## types

```ts
type Tier = 'primitive' | 'brand' | 'base' | 'semantic' | 'density' | 'component';
const TIER_ORDER: Tier[];                       // dependency order
const TIER_AXIS: Record<Tier, 'brand' | 'theme' | 'density' | undefined>;
const TIER_NAMES: Record<Tier, string>;         // "Primitives", "Brand", "Base", "Semantic", "Density", "Component"
const SINGLE_MODE = 'value';                    // mode key of single-mode tiers (alias PRIMITIVE_MODE)
interface LogicalToken { id; path; type; tier; values: Record<mode, unknown>; description; scopes; files: Record<mode, file> }
interface ThemeOverride { brand; theme; path; type; value; file }
interface RepoLayout { primitiveFiles; brands; baseFiles; themes; overrides; densities; componentFiles }
function isMultiMode(tier: Tier): boolean;
function modeDisplayName(mode: string): string; // "light" -> "Light"
```

## json-ast and dtcg-codec (minimal-diff edits)

A format-preserving JSON parser: an untouched file serializes byte for byte; an edited token keeps key
order, indentation, inline or multi-line layout and number spelling.

```ts
function parseJson(text: string): JsonDocument;
function serializeJson(doc: JsonDocument): string;
function parseTokenFile(file: string, text: string): TokenDocument;
function serializeTokenFile(doc: TokenDocument): string;
function flattenTokens(doc: TokenDocument): FlatToken[];              // $type inherited from groups
function readTokenAt(doc, path): FlatToken | undefined;
function upsertToken(doc, path, fields: { type; value; description; extensions? }, template?): boolean; // false when nothing changed
function removeToken(doc, path): boolean;                             // prunes empty groups
function moveToken(doc, from, to): boolean;                           // keeps every field
function emptyTokenFile(file): TokenDocument;
```

## values and scopes

```ts
function isAlias(v): v is string;  function aliasTarget(v: string): string;  function toAlias(path): string;
function parseColor(v): Rgba | undefined;  function rgbaToDtcg(c: Rgba): object;  function rgbaToHex(c): string;
function parseDimension(v): { value: number; unit: string } | undefined;
function valuesEqual(type, a, b): boolean;    // colors by 8-bit hex + alpha, numbers to 1e-4
function formatValue(type, v): string;        // "palette.primary.600", "#4b5562", "16px"
function defaultScopes(path, type, tier): string[];   // Figma scopes inferred from path and type
function effectiveScopes(t): string[];
```

## token-set (load)

```ts
function buildTokenSet(files: Record<relPath, text>, options?: LayoutOptions): TokenSet;
function layoutOptions(config: BridgeConfig): LayoutOptions;           // tier folders + mode order from the config
function detectLayout(files: string[], options?: LayoutOptions): RepoLayout;
function modesOf(layout, tier): string[];        // ["bridge", "ocean"], ["light", "dark"], ["value"]...
function modeFile(layout, tier, mode): string | undefined;
function defaultFile(tier, path, dirs?): string; // where a new single-mode token goes
function defaultContext(set): ResolveContext;    // first brand, theme, density, with overrides
function contextFor(set, tier, mode): ResolveContext;
interface TokenSet { tokens; byPath; docs; layout; options; overrides: ThemeOverride[]; overrideIndex; problems: string[] }
```

## resolver (aliases across tiers)

```ts
interface ResolveContext { brand?; theme?; density?; overrides?: Map<string, unknown> }
function resolve(index: Map<path, LogicalToken>, path, ctx): { value?; chain: string[]; via: ('token' | 'override')[]; error?: 'cycle' | 'broken' | 'missing-mode'; at? };
function valueIn(t: LogicalToken, ctx): { value; via };
function findReferenceProblems(index, axes: { brand?: string[]; theme?: string[]; density?: string[] }): ReferenceProblem[];
```

Semantic tokens take a brand override when the context's brand x theme has one.

## wcag (contrast)

```ts
const CONTRAST_CHECKS_FILE = 'contrast.checks.json';
function parseContrastChecks(text): ContrastPair[];   // { pairs: [[fg, bg, min], ...] }; kind = min >= 4.5 ? 'text' : 'ui'
function contrastScope(set): ContrastScope;           // every brand x theme, default density, overrides
function evaluatePairs(index, pairs, scope): ContrastResult[];  // { pair, brand, theme, ratio, level, error?, steps }
function contrastRatio(fg, bg): number;  function contrastLevel(ratio, kind, min?): 'AAA' | 'AA' | 'fail';
function renderedColor(v): Rgba | undefined;           // hex wins over components, like tokens.css
function contextLabel(r): string;                       // "Ocean dark"
function pairKey(r): string;
```

`steps` lists every token both colors resolve through, which is how a change finds the pairs it
affects (see `affectedContrast`).

## validators (guardrails)

```ts
function validateSet(set, pairs): { issues: Issue[]; contrast: ContrastResult[] };
function validateProposal(proposed, head, pairs, typeChanges?): { blocking; warnings; contrastBefore; contrastAfter };
function shadowedEdits(set, edits: { path; tier; modes }[]): Issue[];  // semantic edits a brand override hides
type IssueCode = 'file-problem' | 'raw-value' | 'alias-tier' | 'broken-reference' | 'alias-cycle' | 'all-scopes'
  | 'missing-mode' | 'override-orphan' | 'override-shadowed' | 'contrast' | 'contrast-unresolved' | 'type-change';
```

Problems already on the base branch come back as warnings, so only what a change introduces blocks.

## id-map and diff-engine (three-way diff)

```ts
function threeWayDiff(base?: Map<id, LogicalToken>, edited: Map, head: Map): { local; remote; conflicts; unchanged };
function toMap(tokens): Map<id, LogicalToken>;
function fieldChanges(a, b): FieldChange[];
function reconcileIds(edited: LogicalToken[], git: LogicalToken[]): { tokens; adoptedByName; suggestions: RenameSuggestion[] };
function applyConfirmedRenames(tokens, confirmed): LogicalToken[];
function idExtensionFor(t): string | undefined;   // "com.dsbridge.id" only after a rename
```

## compose (write changes back)

```ts
interface AcceptedChange { target?: LogicalToken; current?: LogicalToken }   // target undefined = remove
function composeFiles(head: TokenSet, originals: Record<relPath, text>, changes): { files; allFiles };
```

Each value goes to the file of its tier and mode; only changed files are returned.

## risk

```ts
type RiskTier = 1 | 2 | 3;
function classifyRisk(input: { tokenChanges?; files?: { path; status? }[]; config? }): { tier; label; reasons: string[]; bump?: 'patch' | 'minor' | 'major' };
function tokenBump(changes); function isGuardrail(path, config?);
const RISK_LABELS: Record<RiskTier, string>;
```

The one classifier for the plugin, the docs site, the CLI and the MCP server. Rules (from
`docs/GOVERNANCE.md`, highest wins): Tier 3 for any token added, changed (value, type, scopes), renamed or
removed in any tier or override, `*.tokens.json` files when their token changes are unknown, and guardrail
files (`governance.guardrails`, the contrast checks, `bridge.config.json`, `.github/**`). Tier 2 for component
sources under `components.dir` and unknown source files. Tier 1 for a description-only token edit, docs,
`*.md`, stories, `*.docs.json`, tests and changesets. Bumps: removals and renames `major`, other token
changes `minor`, description-only `patch`. Token changes can be `AcceptedChange`s or `{ kind, path,
descriptionOnly? }` summaries.

## pr-composer and changeset

```ts
function composePrBody(input: { changes; head; proposed; validation; baseBranch; headSha; baseSha; origin: PrOrigin; title; notes; upstreamPaths; resolvedConflicts }): string;
interface PrOrigin { tool: string; surface: string; location?: string; authoredBy: string }
function affectedContrast(change, before: ContrastResult[], after: ContrastResult[]): { before?; after? }[];
function changedModes(change): Set<string> | undefined;
function defaultTitle(changes): string;  function branchName(slug, date): string;  function slugify(text, max?): string;
function commitMessage(title, changes, footer?): string;
function changesetBump(changes): 'minor' | 'major';
function composeChangeset(changes, { title, branch, packageName, source? }): { path; content };
```

The body has a Changes table (token, tier, old -> new per mode, contrast before -> after), a Contrast
impact table, the guardrail checklist and the risk tier. A pair is listed under a changed token when its
foreground or background resolves through that token, directly or through aliases, in a brand x theme
where the changed mode is used (PR #4 regression: changing `color.bg.default` lists every pair on it).

## github-client

```ts
new GitHubClient(repo: 'owner/name', token: string, fetchImpl?: FetchLike, retry?: RetryPolicy);
// refs and git data
getRepo(); getBranchSha(branch); getCommitTree(sha); getTree(treeSha, recursive?); getBlobText(sha);
createBlob(text); createTree(baseTree, files); createCommit(message, tree, parents); createBranch(name, sha); updateBranch(name, sha);
compare(base, head);
// contents API
getFileText(path, ref?): Promise<string | undefined>;  putFile({ path, content, branch, message, sha? }): Promise<commitSha>;
// pull requests, reviews, checks, labels
createPullRequest({ title, head, base, body, draft }); getPullRequest(n); findOpenPullRequest(branch); updatePullRequest(n, patch);
listPullRequestFiles(n); listReviews(n); createReview(n, { event, body });
listCheckRuns(ref); createCheckRun({ name, headSha, status?, conclusion?, output? });   // check runs need a GitHub App token
addLabels(n, labels); removeLabel(n, label); addComment(n, body);
// whole token set at a commit, honoring bridge.config.json in the repo
loadRepoFiles(client, commitSha, fallbackTokensPath): Promise<{ files; contrastChecks; config?; tokensPath; warnings }>;
```

Reads and content-addressed writes retry on network errors, 5xx and secondary rate limits; errors
become `GitHubError { status, message, detail }` with plain-language messages.

## history (history.ts, history-github.ts, history-demo.ts)

What changed in the tokens, when, who changed it and why, and how to undo it safely.

```ts
// model
interface HistoryEntry { id; sha; baseSha?; date; author; title; why; pr?; changes: LayeredChange[]; counts; tier; bump; breaking; reasons; changesets; version?; bulk?; demo? }
function buildHistoryEntry({ config, commit, before, after, changesets? }): HistoryEntry | null;
function collectHistory(config, backend: HistoryBackend, { ref, limit }): Promise<HistoryEntry[]>;
// backends: GitHub REST (browser or Node) and local git (Node, @bridge-ds/core/node)
function gitHubHistoryBackend(client, config); function loadGitHubHistory(client, config, { ref?, limit? }): Promise<HistoryReport>;
function localGitHistoryBackend(root, config); function loadLocalHistory(root, config, { ref?, limit? }): Promise<HistoryReport>;
// versions: CHANGELOG sections and tags; the timeline of design system versions
function parseChangelog(text); function releasesFromTags(tags, pkg?); function assignVersions(entries, releases); function versionTimeline(entries, releases?);
// reading
function filterHistory(entries, { token?, author?, tier?, version?, breaking?, since?, until?, query? });
function tokenHistory(entries, path, config?): TokenHistoryItem[];   // every change of one token, renames followed
function fileModes(config, file); function modeLabel(modes);            // semantic/dark.tokens.json -> { theme: "dark" } -> "Dark"
// planning (never writes)
function planRevert({ current, entry, later?, pairs?, resolutions? }): ChangePlan;
function planRestore({ current, path, file?, value, label?, item?, pairs? }): ChangePlan;
function planToJson(plan);                                             // a patch-like JSON for people without a token
function demoHistory(config, currentFiles): HistoryReport;             // fixture entries, flagged demo, never real
```

Local history follows the first parent of the ref, so a merged branch is one entry (the merge commit against
the base it merged into); GitHub history asks each commit for its pull request and diffs the PR's merge commit.
Bulk entries (more than 60 token changes: an import or a restructure) are flagged.

A revert is not a blind `git revert`. `planRevert` computes the inverse token edits against the current base
branch: a token that changed again later (`changed-later`), was removed (`removed-later`), came back
(`recreated-later`), moved (`renamed-later`) or that other tokens now alias (`still-referenced`) is a conflict,
listed with the later changes that explain it and kept as it is unless `resolutions[key]` is `"use-before"`.
Changes already undone are skipped. The rest goes through `applyTokenEdits` (minimal diffs), validation, the
contrast gate, `classifyRisk` and a changeset, like any proposal: `status` is `ready`, `blocked` (new
validation errors or a failing contrast pair) or `nothing-to-do`. The PR body starts with "Reverts #n" and the
conflicts table.
## audit (`@bridge-ds/core/audit`)

Design system adoption and drift in a product codebase that consumes the DS. Pure (file texts in, report
out); it reads TSX/JSX with the TypeScript compiler API (syntax only), which is why it is its own entry and the
Figma plugin never loads it. `@bridge-ds/core/node` adds the disk side.

```ts
import { DesignSystemIndex, buildAuditReport, compareWithBaseline, auditMarkdown, planCssFixes, auditFile } from '@bridge-ds/core/audit';
import { loadDesignSystem, runAudit, collectAuditFiles, fixCss, findDesignSystemRoot } from '@bridge-ds/core/node';

const ds = loadDesignSystem('/path/to/ds-repo');               // bridge.config.json: tokens in every mode, components, packages
const report = runAudit('apps/admin/src', { ds: ds.root, label: 'admin', baseline });  // AuditReport, schemaVersion 1
```

- **Scanned**: CSS, SCSS, Less, CSS modules; `style`, MUI `sx`, `styled()`, `makeStyles`, `createTheme` and theme
  objects, styled-components / emotion templates; Tailwind class strings (`className`, `cn()`, `clsx()`, `cva()`,
  `@apply`); any color literal in code.
- **Hardcoded values**: colors (hex, rgb, hsl, named, bare HSL channels), spacing, sizes, radii, border widths,
  shadows, durations, easings, z-index, font family, size, weight and line height. Each gets the closest token:
  colors by deltaE in OKLab across every mode (semantic tokens and tokens that fit the property win near-ties),
  lengths by nearest scale step, with a confidence (`exact`, `high`, `medium`, `low`).
- **Token references**: `var(--x)` of a DS token (also in Tailwind arbitrary values). Other variables, MUI palette
  paths, `theme.spacing()` and Tailwind scale classes count as references to another theme, not as hardcoded.
- **Components**: JSX instances imported from the DS packages (`audit.packages`, default: the package that holds
  `components.dir`, plus `@bridge-ds/react`) versus foreign UI libraries (MUI, react-admin, antd, Chakra, Radix,
  Headless UI, Mantine, shadcn/ui local components...), native elements that should be DS components
  (`button`, `input`, `select`, `textarea`, `dialog`, `table`) and local components named like a DS component.
- **Metrics**: token adoption = token references / (token references + hardcoded values); component adoption =
  DS instances / all UI instances. By category, top files, top fixes, per-file findings with line numbers.
- **Baseline**: `compareWithBaseline(report, previous)` adds deltas per metric, category and file, and carries the
  history. `auditMarkdown(report)` renders the summary. `planCssFixes(text, lang, ds)` is the safe autofix: only
  CSS values equal to a token become `var(--token)`.

The report schema is `packages/core/audit-report.schema.json` (also exported as
`@bridge-ds/core/audit-report.schema.json`). `bridge.config.json` takes an optional `audit` section:
`packages`, `foreignLibraries`, `nativeElements`, `exclude`.
