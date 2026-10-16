# @bridge-ds/core

Pure design-token logic for Bridge: load DTCG 2025.10 tokens across tiers, resolve aliases per brand,
theme and density, check WCAG contrast, diff three versions of a token set, edit `*.tokens.json` files
without reformatting them, build the pull request (body, risk tier, changeset) and talk to GitHub.

No Figma API, no DOM, no Node-only API: it runs in a Figma plugin sandbox, a browser, Node or an MCP
server. The DS Bridge Figma plugin (`apps/figma-plugin`) is built on it; a CLI and an MCP server can be
too. Nothing here hardcodes a repository: callers pass a `BridgeConfig` (usually `bridge.config.json`).

```ts
import { loadConfig, buildTokenSet, layoutOptions, validateSet, parseContrastChecks } from '@bridge-ds/core';
```

The package ships TypeScript sources (`exports: "./src/index.ts"`), like `@bridge-ds/react`; bundlers
(esbuild, Vite) compile it. Tests: `npx vitest run --project core` (part of the root `npm test`).
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

`bridge.config.json` at the repository root. Schema: `packages/core/bridge.config.schema.json`
(also exported as `@bridge-ds/core/bridge.config.schema.json`).

```ts
const CONFIG_FILE = 'bridge.config.json';
interface BridgeConfig {
  repo: { owner: string; name: string; defaultBranch: string };
  tokens: { root; primitives; brands; semantic; base; density; components; contrastChecks: string };
  components?: { dir: string };          // code components, repo-relative
  modes: { brands: string[]; themes: string[]; densities: string[]; defaults: { brand?; theme?; density? } };
  changeset?: { package: string };       // no changeset is written without it
}
function defineConfig(input: BridgeConfigInput): BridgeConfig;   // fills defaults
function loadConfig(source: string | unknown): BridgeConfig;       // parse + validate, throws ConfigError { problems: string[] }
function tokensPath(config: BridgeConfig, rel?: string): string;   // "<tokens.root>/<rel>"
const DEFAULT_TOKEN_PATHS: TokenPaths;                               // root "tokens", folders as in the table above
```

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
function classifyRisk(input: { tokenChanges?; files?: { path; status? }[]; config? }): { tier; label; reasons: string[]; bump?: 'minor' | 'major' };
const RISK_LABELS: Record<RiskTier, string>;
```

Rules (from `docs/GOVERNANCE.md`, highest wins): Tier 3 for any token added, changed, renamed or
removed in any tier or override, any `*.tokens.json`, and guardrail files (contrast checks,
`bridge.config.json`, `AGENTS.md`, `CLAUDE.md`, `docs/GOVERNANCE.md`, `.stylelintrc.json`, `.github/**`).
Tier 2 for component sources under `components.dir` and unknown source files. Tier 1 for docs, `*.md`,
stories, `*.docs.json`, tests and changesets. Removals and renames bump `major`, other token changes
`minor`.

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
