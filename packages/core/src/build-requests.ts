// Pushes from the Figma plugin to the library, and build requests (docs/BUILD-REQUESTS.md).
//
// The rule: a push from the Figma plugin counts as design-approved. Keeping unvalidated work out of Figma main is the
// team's own discipline, not Bridge's. So:
// - token VALUE changes (and additions) ship after the automatic checks, with no person in the loop;
// - token RENAMES or REMOVALS wait for a developer OK (the tech approval): they can break product code;
// - structure changes (a new variant, option, layout, a new component) become a BUILD REQUEST for developers: a GitHub
//   issue (labels component-change and bridge-build) carrying the Figma link, before and after images, the props
//   needed and a brief ready for Claude. Developers split and track the work in GitHub or Jira; Bridge only reads it.
// Explorations keep their own flow (docs/EXPLORATIONS.md): nothing here applies to them.
//
// Pure and browser safe: the Figma plugin, Studio, the MCP server and the CLI share these rules. The GitHub reads and
// writes are in build-requests-github.ts; the gate rule (design and tech approval credited to a Figma push) is
// withFigmaPushApprovals in review-gate.ts, applied by branchVerdict.

import { type BridgeConfig } from './config';
import { EXPLORATION_LABEL } from './explorations';
import { DRAFTED_BY_CLAUDE_LABEL, FROM_FIGMA_LABEL, WAITING_FOR_CLAUDE_LABEL, parseFigmaOrigin } from './figma-push';
import { closingIssueNumbers, composeRequestIssue, parseRequestIssue, REQUEST_KINDS, REQUEST_LABEL, requestIssueTitle, type ComponentChangeRequest, type RequestIssue, type RequestKind } from './requests';
import { isGuardrail, type ChangedFile, type TokenChangeKind, type TokenChangeSummary } from './risk';
import { pullState, type CiSummary } from './review-gate';

/** Every build request issue carries this label (with component-change, which the Jira Action mirrors). */
export const BUILD_REQUEST_LABEL = 'bridge-build';
/** The label the plugin puts on what it pushes (token pull requests, suggestions and requests). */
export const SOURCE_FIGMA_LABEL = 'source: figma';
/** A build request waits this many days before it reads as stale. */
export const BUILD_STALE_DAYS = 7;

// ---------------------------------------------------------------------------------------------------------------
// What a push from Figma is, and what it changes

const names = (labels: readonly ({ name?: string } | string)[] | null | undefined) => (labels ?? []).map((l) => (typeof l === 'string' ? l : (l.name ?? '')).toLowerCase());

/**
 * Whether a pull request (or issue) was pushed from the Figma plugin: the `source: figma` or `from-figma` label, or the
 * hidden "From Figma" origin block of a component branch.
 */
export function isFigmaPush(p: { labels?: readonly ({ name?: string } | string)[] | null | undefined; body?: string | null | undefined }): boolean {
  const l = names(p.labels);
  return l.includes(SOURCE_FIGMA_LABEL) || l.includes(FROM_FIGMA_LABEL) || Boolean(parseFigmaOrigin(p.body));
}

/**
 * What a push from Figma changes, from the pull request's real files and token changes (never from what its body says):
 * - `token-values`: token files only (values changed or tokens added), plus changesets, docs and Bridge's own files;
 * - `token-structure`: a token renamed or removed;
 * - `token-unknown`: token files changed but the token changes were not read (counts like token-structure);
 * - `component`: component or other source code (a Claude draft branch, the pull request of a build request);
 * - `outside`: a guardrail file (CI, AGENTS.md, bridge.config.json, contrast checks): no Figma credit at all.
 */
export type FigmaPushScope = 'token-values' | 'token-structure' | 'token-unknown' | 'component' | 'outside';

const VALUE_SIDE = [/^\.changeset\//, /^\.bridge\//, /\.md$/, /^docs\//];

export function figmaPushScope(input: { files: readonly ChangedFile[]; tokenChanges: readonly { kind: TokenChangeKind | string }[] | null | undefined; config?: BridgeConfig | undefined }): FigmaPushScope {
  const tokenDir = input.config?.tokens?.root?.replace(/\/+$/, '');
  let code = false;
  let tokenFiles = false;
  for (const f of input.files) {
    const p = f.path.replace(/^\/+/, '');
    const isToken = p.endsWith('.tokens.json') || (tokenDir ? p.startsWith(`${tokenDir}/`) && p.endsWith('.json') : false);
    if (isGuardrail(p, input.config)) return 'outside';
    if (isToken) tokenFiles = true;
    else if (!VALUE_SIDE.some((r) => r.test(p))) code = true;
  }
  if (code) return 'component';
  const changes = input.tokenChanges;
  if (changes?.some((c) => c.kind === 'renamed' || c.kind === 'removed')) return 'token-structure';
  if (tokenFiles && !changes) return 'token-unknown';
  // Nothing but a spec, docs or a changeset: no token value to ship, so nothing ships by itself.
  if (!tokenFiles || !changes?.length) return 'component';
  return 'token-values';
}

/**
 * The token changes between two versions of token files, by kind, from their text alone (DTCG: a node with `$value` is a
 * token, its path the keys joined by "."). For callers that only have the files of a pull request (the server arming a
 * merge, Studio's branch page): a path gone is `removed` (a rename reads as removed plus added, which gates the same),
 * a new path `added`, a different `$value`, `$type` or extension `changed`, a different `$description` only
 * `changed` with descriptionOnly. Unreadable JSON throws, so the caller treats the changes as unknown.
 */
export function tokenFileChanges(files: readonly { before: string | null | undefined; after: string | null | undefined }[]): TokenChangeSummary[] {
  const flat = (text: string | null | undefined) => {
    const out = new Map<string, Record<string, unknown>>();
    if (!text) return out;
    const walk = (node: unknown, path: string[]) => {
      if (!node || typeof node !== 'object' || Array.isArray(node)) return;
      const o = node as Record<string, unknown>;
      if ('$value' in o) {
        out.set(path.join('.'), o);
        return;
      }
      for (const [k, v] of Object.entries(o)) if (!k.startsWith('$')) walk(v, [...path, k]);
    };
    walk(JSON.parse(text), []);
    return out;
  };
  const changes: TokenChangeSummary[] = [];
  for (const f of files) {
    const before = flat(f.before);
    const after = flat(f.after);
    for (const [path, b] of before) {
      const a = after.get(path);
      if (!a) {
        changes.push({ kind: 'removed', path });
        continue;
      }
      const { $description: bd, ...bRest } = b;
      const { $description: ad, ...aRest } = a;
      const same = JSON.stringify(bRest) === JSON.stringify(aRest);
      if (!same) changes.push({ kind: 'changed', path });
      else if (bd !== ad) changes.push({ kind: 'changed', path, descriptionOnly: true });
    }
    for (const path of after.keys()) if (!before.has(path)) changes.push({ kind: 'added', path });
  }
  return changes;
}

/** The Figma push facts the gate reads (branchVerdict `figmaPush`). Null when the pull request is not one. */
export interface FigmaPush {
  scope: FigmaPushScope;
}

/**
 * The Figma push facts of a pull request: pushed from the plugin (isFigmaPush), or the pull request of a build request
 * sent from Figma (`closesFigmaBuildRequest`: its body closes one). Null otherwise, and for a running exploration.
 */
export function figmaPushOf(
  pr: { labels?: readonly ({ name?: string } | string)[] | null | undefined; body?: string | null | undefined },
  facts: { files: readonly ChangedFile[]; tokenChanges: readonly { kind: TokenChangeKind | string }[] | null | undefined; config?: BridgeConfig | undefined; closesFigmaBuildRequest?: boolean | undefined },
): FigmaPush | null {
  if (names(pr.labels).includes(EXPLORATION_LABEL)) return null;
  if (!isFigmaPush(pr) && !facts.closesFigmaBuildRequest) return null;
  const scope = figmaPushScope(facts);
  // A library branch that carries a component spec (Claude draft, a build request's branch) is code work: it never ships
  // by itself, even while it only holds the spec.
  const l = names(pr.labels);
  const draft = l.includes(WAITING_FOR_CLAUDE_LABEL) || l.includes(DRAFTED_BY_CLAUDE_LABEL) || parseFigmaOrigin(pr.body)?.route === 'claude-draft' || facts.closesFigmaBuildRequest;
  return { scope: draft && scope.startsWith('token-') ? 'component' : scope };
}

/** Whether a scope ships with no person in the loop: design approved by the push, tech approved by being values only. */
export const shipsByItself = (scope: FigmaPushScope | null | undefined): boolean => scope === 'token-values';

// ---------------------------------------------------------------------------------------------------------------
// The publish result the plugin shows, per component or token

/**
 * Where one published thing went:
 * - `shipped`: a token pull request with values only. Bridge merges it once the automatic checks pass (auto-merge
 *   armed); poll libraryArrival until it reads "In the library".
 * - `waiting-for-developer`: a pull request a developer approves first (a token renamed or removed).
 * - `build-request`: an issue developers build from (a structure change).
 */
export type PublishRoute = 'shipped' | 'waiting-for-developer' | 'build-request';

export interface PublishOutcome {
  /** What was published: a token path, or a component name. */
  subject: { type: 'token' | 'component'; name: string };
  route: PublishRoute;
  /** The pull request (shipped, waiting-for-developer) or the issue (build-request). */
  ref: { kind: 'pull' | 'issue'; number: number; url: string };
  /**
   * `shipped` only: whether Bridge armed the merge (auto-merge on GitHub, or the Bridge app merging on green checks).
   * False when it could not (no Bridge app on the repository, auto-merge off): the route is then reported as
   * `waiting-for-developer` instead, so this is true on every `shipped` outcome.
   */
  armed?: boolean | undefined;
}

export interface PublishResult {
  outcomes: PublishOutcome[];
}

export const PUBLISH_ROUTE_COPY: Record<PublishRoute, { label: string; sentence: string }> = {
  shipped: { label: 'On its way to the library', sentence: 'It ships by itself once the automatic checks pass.' },
  'waiting-for-developer': { label: 'Waiting for a developer', sentence: 'A renamed or removed token can break product code, so a developer OKs it first.' },
  'build-request': { label: 'Build request sent', sentence: 'Developers build it from what you sent. Follow it in Being built.' },
};

/**
 * The route of a token push, from its token changes: values changed or tokens added ship; a rename or a removal waits
 * for a developer. `armed` false (Bridge could not arm the merge) also waits for a developer.
 */
export function tokenPublishRoute(changes: readonly { kind: TokenChangeKind | string }[], armed = true): Exclude<PublishRoute, 'build-request'> {
  if (changes.some((c) => c.kind === 'renamed' || c.kind === 'removed')) return 'waiting-for-developer';
  return armed ? 'shipped' : 'waiting-for-developer';
}

/** One sentence for the end of a publish: "2 on their way to the library, 1 waiting for a developer, 1 build request sent." */
export function publishSummary(r: PublishResult): string {
  const n = (route: PublishRoute) => r.outcomes.filter((o) => o.route === route).length;
  const parts: string[] = [];
  const s = n('shipped');
  const w = n('waiting-for-developer');
  const b = n('build-request');
  if (s) parts.push(`${s} on ${s === 1 ? 'its' : 'their'} way to the library`);
  if (w) parts.push(`${w} waiting for a developer`);
  if (b) parts.push(`${b} build request${b === 1 ? '' : 's'} sent`);
  return parts.length ? `${parts.join(', ')}.`.replace(/^./, (c) => c.toUpperCase()) : 'Nothing was published.';
}

// ---------------------------------------------------------------------------------------------------------------
// After publish: is it in the library yet

export type LibraryArrivalKey = 'on-its-way' | 'in-the-library' | 'held' | 'not-shipped';

export interface LibraryArrival {
  key: LibraryArrivalKey;
  label: string;
  sentence: string;
  /** Stop polling: it is in the library, or it will not get there by itself. */
  final: boolean;
}

/**
 * Where a published pull request stands, for the plugin to poll after `shipped` (every 20 to 30 seconds is plenty)
 * and for Studio. Never names a technical blocker: a failing check, a conflict or a change request all read "Held for a
 * developer". `held` is final for polling: a person picks it up from there.
 */
export function libraryArrival(p: {
  state: string;
  merged_at?: string | null | undefined;
  merged?: boolean | undefined;
  mergeable?: boolean | null | undefined;
  ci?: CiSummary | null | undefined;
  changesRequested?: number | undefined;
}): LibraryArrival {
  const lifecycle = pullState({ state: p.state, merged_at: p.merged_at ?? null, merged: p.merged ?? p.state === 'merged' });
  if (lifecycle === 'merged') return { key: 'in-the-library', label: 'In the library', sentence: 'It is in the library. Storybook shows it after the next deploy.', final: true };
  if (lifecycle === 'closed') return { key: 'not-shipped', label: 'Not shipped', sentence: 'A developer closed it without shipping. Pull in the plugin to bring Figma back in line with the library.', final: true };
  if (p.ci?.state === 'fail' || p.mergeable === false || (p.changesRequested ?? 0) > 0)
    return { key: 'held', label: 'Held for a developer', sentence: 'Something needs a developer before it ships. They are told on GitHub; nothing to do on your side.', final: true };
  return { key: 'on-its-way', label: 'On its way to the library', sentence: PUBLISH_ROUTE_COPY.shipped.sentence, final: false };
}

/** The review Bridge's app leaves on a token push it ships (the merge rule's record on GitHub). */
export const FIGMA_SHIP_HEADING = '**Bridge: shipped from Figma**';

export function figmaShipReviewBody(by?: string | null): string {
  const who = by ? ` by ${by.startsWith('@') || by.includes(' ') ? by : `@${by}`}` : '';
  return `${FIGMA_SHIP_HEADING}\n\nPushed from Figma${who}: token values only, so it ships once the automatic checks pass (docs/BUILD-REQUESTS.md). Undo it from History in Bridge Studio.`;
}

// ---------------------------------------------------------------------------------------------------------------
// The build request issue

/** A prop (option) the build needs. */
export interface BuildProp {
  name: string;
  /** "variant", "boolean", "text", "instance swap", or a TypeScript type. */
  type?: string | undefined;
  values?: string[] | undefined;
  default?: string | undefined;
  /** "new", "changed" or "removed"; default new. */
  change?: 'new' | 'changed' | 'removed' | undefined;
  note?: string | undefined;
}

/** What a build request adds to a component change request (kept in the request's hidden block, under `build`). */
export interface BuildRequestExtra {
  v: 1;
  /** Image URLs of the design before and after the change. */
  before?: string[] | undefined;
  after?: string[] | undefined;
  props?: BuildProp[] | undefined;
  /** Where the full spec lives, when it is not in the issue (too large): a path on a branch, or a URL. */
  specPath?: string | undefined;
}

/** The input of the build request issue builder (the Figma plugin, Studio, the CLI and the MCP server). */
export interface BuildRequestInput {
  /** Coded name ("Button"), or the proposed name of a new component. */
  component: string;
  kind: RequestKind;
  /** One line, sentence case: "Add a lg size". */
  title: string;
  /** What and why, in the designer's words. */
  summary: string;
  /** What changes for developers in one sentence. */
  line?: string | undefined;
  changes?: ComponentChangeRequest['changes'] | undefined;
  figma: { fileKey?: string | undefined; nodeId?: string | undefined; nodeName?: string | undefined; url?: string | undefined };
  images?: { before?: string[] | undefined; after?: string[] | undefined } | undefined;
  props?: BuildProp[] | undefined;
  /** The structured spec (the plugin's ComponentPushDiff, with its token edits), shown collapsed. Omitted when too large. */
  spec?: unknown;
  specPath?: string | undefined;
  /** A brief for Claude written by the caller; default buildRequestBrief. */
  brief?: string | undefined;
  source: ComponentChangeRequest['source'];
  /** GitHub login of who pushed, when known (the "Requested by" record). */
  requestedBy?: string | undefined;
}

/** Kinds that are structure changes, so a push from Figma becomes a build request. */
export const BUILD_KINDS: readonly RequestKind[] = ['new-component', 'new-variant', 'prop-change', 'structure', 'visual'];

/** The largest spec JSON kept in the issue body (GitHub caps a body at 65,536 characters). */
export const BUILD_SPEC_MAX = 30_000;
const SPEC_MARK = '<!-- bridge-build-spec -->';

const kindLabel = (k: RequestKind) => REQUEST_KINDS.find((x) => x.value === k)?.label ?? 'Change';

/** The request a build request input stands for (what parseRequestIssue reads back, with `build`). */
export function buildRequestOf(input: BuildRequestInput): ComponentChangeRequest & { build: BuildRequestExtra } {
  const before = input.images?.before?.filter(Boolean) ?? [];
  const after = input.images?.after?.filter(Boolean) ?? [];
  const build: BuildRequestExtra = {
    v: 1,
    ...(before.length ? { before } : {}),
    ...(after.length ? { after } : {}),
    ...(input.props?.length ? { props: input.props } : {}),
    ...(input.specPath ? { specPath: input.specPath } : {}),
  };
  return {
    component: input.component,
    kind: input.kind,
    title: input.title,
    summary: input.summary,
    ...(input.line ? { line: input.line } : {}),
    changes: input.changes ?? [],
    figma: input.figma,
    ...(after.length ? { images: after } : {}),
    source: input.source,
    ...(input.requestedBy ? { requestedBy: input.requestedBy } : {}),
    build,
  };
}

const propLine = (p: BuildProp) => {
  const what = p.change === 'removed' ? 'remove' : p.change === 'changed' ? 'change' : 'add';
  const values = p.values?.length ? `: ${p.values.join(', ')}` : '';
  const def = p.default ? ` (default ${p.default})` : '';
  return `${what} \`${p.name}\`${p.type ? ` ${p.type}` : ''}${values}${def}${p.note ? `. ${p.note}` : ''}`;
};

/**
 * The brief Claude gets to build it ("Copy brief for Claude" in Studio, `bridge build show` in the CLI,
 * `bridge_get_build_request` in the MCP server). Without an issue number (inside the issue body), it says "this issue".
 */
export function buildRequestBrief(
  r: ComponentChangeRequest & { build?: BuildRequestExtra | undefined },
  ctx: { issue?: number | undefined; issueUrl?: string | undefined; componentsDir?: string | undefined; agentsFile?: string | undefined; files?: string[] | undefined } = {},
): string {
  const ref = ctx.issue ? `#${ctx.issue}` : 'this issue';
  const dir = `${(ctx.componentsDir ?? 'packages/react/src/components').replace(/\/+$/, '')}/${r.component}`;
  const b = r.build;
  const before = b?.before ?? [];
  const after = b?.after ?? r.images ?? [];
  return [
    `Build Bridge build request ${ref}${ctx.issueUrl ? ` (${ctx.issueUrl})` : ''}: a component change designed and validated in Figma.`,
    '',
    r.kind === 'new-component' ? `New component: ${r.component} (create ${dir})` : `Component: ${r.component} (${dir})`,
    `Kind: ${kindLabel(r.kind)}`,
    `Change: ${r.title}`,
    ...(r.line?.trim() ? [`What changes: ${r.line.trim()}`] : []),
    '',
    r.summary.trim(),
    '',
    ...(r.changes.length ? ['Changes in Figma:', ...r.changes.map((c) => `- ${c.field}: ${c.before ?? '(none)'} -> ${c.after ?? '(removed)'}`), ''] : []),
    ...(b?.props?.length ? ['Props needed:', ...b.props.map((p) => `- ${propLine(p)}`), ''] : []),
    ...(r.figma?.url ? [`Design: ${r.figma.url}`] : []),
    ...(r.figma?.fileKey && r.figma.nodeId ? [`Read it from Figma: Figma MCP get_design_context { fileKey: "${r.figma.fileKey}", nodeId: "${r.figma.nodeId}" }.`] : []),
    ...(before.length ? ['Before:', ...before.map((u) => `- ${u}`)] : []),
    ...(after.length ? ['After:', ...after.map((u) => `- ${u}`)] : []),
    b?.specPath ? `Spec: ${b.specPath}` : `Spec: the collapsed "Spec" section of ${ref}, when there is one (variant matrix, properties, bound variables as token paths).`,
    ...(ctx.files?.length ? ['', 'Files of this component:', ...ctx.files.map((f) => `- ${f}`)] : []),
    '',
    'Rules:',
    `- Follow ${ctx.agentsFile ?? 'AGENTS.md'}: Base UI for behavior, tokens only in component CSS, states, stories, docs.json, tests, changeset.`,
    '- The design is already approved in Figma: build what it shows. Never invent a token or a value: use the variables the design binds. A value the library lacks is a token change, said in the pull request.',
    '- Keep every existing variant and prop unchanged unless the request changes it.',
    `- Work on a branch named agent/build-${ctx.issue ?? '<issue number>'}. The pull request body must contain "Closes ${ctx.issue ? `#${ctx.issue}` : '#<issue number>'}", so the request reads Shipped when it merges.`,
    `- If something is unclear, comment on ${ref} instead of guessing.`,
  ].join('\n');
}

/**
 * The GitHub issue of a build request: a component change request issue (component-change, so the bridge-jira Action
 * mirrors it to Jira) with the bridge-build label, before and after images side by side, the props needed, the spec
 * collapsed and the brief for Claude collapsed. parseBuildRequestIssue reads it back.
 */
export function composeBuildRequestIssue(input: BuildRequestInput, opts: { labels?: string[] | undefined; assignees?: string[] | undefined; componentUrl?: string | undefined } = {}): RequestIssue {
  const r = buildRequestOf(input);
  const base = composeRequestIssue(r, { labels: [BUILD_REQUEST_LABEL, ...(opts.labels ?? [])], ...(opts.assignees ? { assignees: opts.assignees } : {}), ...(opts.componentUrl ? { componentUrl: opts.componentUrl } : {}) });
  const before = r.build.before ?? [];
  const after = r.build.after ?? [];
  const img = (u: string, i: number, what: string) => `![${r.component} ${what}${i ? ` ${i + 1}` : ''}](${u})`;
  // composeRequestIssue already shows the after images inline; the before and after table replaces them when both exist.
  let body = base.body;
  if (before.length && after.length) {
    for (const [i, u] of after.entries()) body = body.replace(`![${r.component} design ${i + 1}](${u})\n`, '');
    const rows = Math.max(before.length, after.length);
    const table = ['| Before | After |', '| --- | --- |', ...Array.from({ length: rows }, (_, i) => `| ${before[i] ? img(before[i]!, i, 'before') : ''} | ${after[i] ? img(after[i]!, i, 'after') : ''} |`)];
    body = insertBefore(body, '## How to implement', [...table, ''].join('\n'));
  } else if (before.length) {
    body = insertBefore(body, '## How to implement', [...before.map((u, i) => img(u, i, 'before')), ''].join('\n'));
  }
  if (r.build.props?.length) body = insertBefore(body, '## How to implement', ['**Props needed:**', ...r.build.props.map((p) => `- ${propLine(p)}`), ''].join('\n'));
  const brief = input.brief?.trim() || buildRequestBrief(r);
  const specJson = input.spec === undefined ? '' : JSON.stringify(input.spec, null, 2);
  const spec = specJson && specJson.length <= BUILD_SPEC_MAX ? ['<details><summary>Spec</summary>', '', SPEC_MARK, '', '```json', specJson.replace(/```/g, '`​``'), '```', '', '</details>', ''] : [];
  const tail = ['<details><summary>Brief for Claude</summary>', '', '```text', brief.replace(/```/g, '`​``'), '```', '', '</details>', '', ...spec].join('\n');
  body = insertBefore(body, '<sub>Requested from', `${tail}\n`);
  body = body.replace('\n## How to implement\n', '\n## How to build it\n');
  return { ...base, body };
}

function insertBefore(body: string, marker: string, block: string): string {
  const at = body.indexOf(`\n${marker}`);
  return at < 0 ? `${body}\n\n${block}` : `${body.slice(0, at + 1)}${block}\n${body.slice(at + 1)}`;
}

/** The build request in an issue body, or undefined when it has no Bridge request block. `build` is empty for a plain request. */
export function parseBuildRequestIssue(body: string | null | undefined): (ComponentChangeRequest & { build: BuildRequestExtra }) | undefined {
  const r = parseRequestIssue(body) as (ComponentChangeRequest & { build?: BuildRequestExtra }) | undefined;
  if (!r) return undefined;
  return { ...r, build: r.build && r.build.v === 1 ? r.build : { v: 1 } };
}

/** The spec kept collapsed in a build request issue, or undefined. */
export function parseBuildSpec(body: string | null | undefined): unknown {
  const at = (body ?? '').indexOf(SPEC_MARK);
  if (at < 0) return undefined;
  const m = /```json\n([\s\S]*?)\n```/.exec(body!.slice(at));
  if (!m) return undefined;
  try {
    return JSON.parse(m[1]!.replace(/`​``/g, '```'));
  } catch {
    return undefined;
  }
}

/** Whether an issue is a build request: every component change request is one (bridge-build marks the new ones). Explorations are not. */
export function isBuildRequestIssue(labels: readonly ({ name?: string } | string)[] | null | undefined): boolean {
  const l = names(labels);
  return (l.includes(BUILD_REQUEST_LABEL) || l.includes(REQUEST_LABEL)) && !l.includes(EXPLORATION_LABEL);
}

// ---------------------------------------------------------------------------------------------------------------
// Where a build request stands, read from GitHub only

/**
 * Requested (nobody assigned) -> Picked up (assigned: "Ana is on it") -> In progress (a linked draft pull request, or a
 * linked branch with commits) -> In review (a linked pull request ready for review) -> Shipped (merged, or the issue
 * closed as completed). `not-planned`: closed as not planned.
 */
export type BuildStatus = 'requested' | 'picked-up' | 'in-progress' | 'in-review' | 'shipped' | 'not-planned';

export const BUILD_STATUS_LABEL: Record<BuildStatus, string> = {
  requested: 'Requested',
  'picked-up': 'Picked up',
  'in-progress': 'In progress',
  'in-review': 'In review',
  shipped: 'Shipped',
  'not-planned': 'Not planned',
};

/** Steps of the status timeline, in order (not-planned is off the line). */
export const BUILD_STEPS: readonly BuildStatus[] = ['requested', 'picked-up', 'in-progress', 'in-review', 'shipped'];

/** A pull request linked to a build request (closes it, or the build request is that branch). */
export interface BuildPullLike {
  number: number;
  url?: string | undefined;
  /** "open", "closed" or "merged" (PullRequestSummary), or GitHub's open/closed with merged_at. */
  state: string;
  draft?: boolean | undefined;
  mergedAt?: string | null | undefined;
  merged_at?: string | null | undefined;
  labels?: readonly ({ name?: string } | string)[] | undefined;
  author?: string | undefined;
  assignees?: string[] | undefined;
  createdAt?: string | undefined;
  updatedAt?: string | undefined;
  body?: string | undefined;
  /** Commits on the branch, when known (a branch with only the spec commit is not work in progress). */
  commits?: number | null | undefined;
  headRef?: string | undefined;
  title?: string | undefined;
}

export interface BuildIssueLike {
  number: number;
  url: string;
  title: string;
  body: string;
  state: 'open' | 'closed';
  stateReason?: string | null | undefined;
  labels: readonly ({ name?: string } | string)[];
  author?: string | undefined;
  assignees?: string[] | undefined;
  createdAt: string;
  closedAt?: string | null | undefined;
}

export interface BuildStatusEvent {
  status: BuildStatus;
  /** ISO date, when GitHub says. */
  at?: string | undefined;
  /** Who, when it is a person ("ana"). */
  who?: string | undefined;
}

export interface BuildRequestView {
  /** "issue-12" or "pull-34". */
  id: string;
  /** Where it lives: an issue, or (direct mode, no issue) the library branch from Figma waiting for a developer. */
  kind: 'issue' | 'pull';
  number: number;
  url: string;
  component: string;
  /** "Add a lg size": the request's title, without the component prefix. */
  title: string;
  requestKind: RequestKind | null;
  status: BuildStatus;
  label: string;
  /** One designer sentence: "Ana is on it.", "Waiting for a developer for 9 days." */
  sentence: string;
  /** Who works on it: the assignees, else the author of the linked pull request in progress. */
  builders: string[];
  requestedBy: string | null;
  createdAt: string;
  ageDays: number;
  /** Requested for more than BUILD_STALE_DAYS days. */
  stale: boolean;
  shippedAt: string | null;
  /** The linked pull request that moves it furthest. */
  pull: { number: number; url?: string | undefined; state: string } | null;
  /** Jira key from the bridge-jira Action's `jira: DS-12` label. */
  jira: string | null;
  figmaUrl: string | null;
  /** The status timeline: each step reached, with when and who when GitHub says. */
  timeline: BuildStatusEvent[];
}

const DAY = 86_400_000;
const mergedAtOf = (p: BuildPullLike) => p.mergedAt ?? p.merged_at ?? null;
const isMerged = (p: BuildPullLike) => Boolean(mergedAtOf(p)) || p.state === 'merged';
const isOpen = (p: BuildPullLike) => p.state === 'open';
const pullNames = (p: BuildPullLike) => names(p.labels);
/** A Figma library branch that still carries the spec only: not work in progress. */
const specOnly = (p: BuildPullLike) => pullNames(p).includes(WAITING_FOR_CLAUDE_LABEL) && !(p.commits != null && p.commits > 1);
/** Ready for review: open, not a draft (a drafted-by-claude branch is ready even while GitHub calls it a draft). */
const ready = (p: BuildPullLike) => isOpen(p) && (!p.draft || pullNames(p).includes(DRAFTED_BY_CLAUDE_LABEL)) && !specOnly(p);

/** The issue numbers a pull request links: "Closes #n" in its body, plus GitHub's linked issues when the caller read them. */
export function linkedIssueNumbers(p: Pick<BuildPullLike, 'body'>, extra: readonly number[] = []): number[] {
  return [...new Set([...closingIssueNumbers(p.body), ...extra])];
}

/** The Jira key the bridge-jira Action labelled an issue with ("jira: DS-12"), or null. */
export function jiraKeyOfLabels(labels: readonly ({ name?: string } | string)[] | null | undefined): string | null {
  for (const l of labels ?? []) {
    const n = typeof l === 'string' ? l : (l.name ?? '');
    const m = /^jira:\s*([A-Z][A-Z0-9_]*-\d+)$/i.exec(n.trim());
    if (m) return m[1]!.toUpperCase();
  }
  return null;
}

const first = (xs: readonly string[]) => xs[0];
const listNames = (xs: string[]) => (xs.length <= 1 ? (xs[0] ?? '') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);

/**
 * The status of one build request, from GitHub only: the issue (state, reason, assignees) and the pull requests linked
 * to it. `nameOf` turns a login into the name a designer knows (team members), default the login.
 */
export function buildRequestStatus(
  x: { issue?: BuildIssueLike | null | undefined; pull?: BuildPullLike | null | undefined; linked?: readonly BuildPullLike[] | undefined },
  now: Date | number = Date.now(),
  nameOf: (login: string) => string = (l) => l,
): Pick<BuildRequestView, 'status' | 'label' | 'sentence' | 'builders' | 'ageDays' | 'stale' | 'shippedAt' | 'pull' | 'timeline' | 'createdAt'> {
  const nowMs = typeof now === 'number' ? now : now.getTime();
  const own = x.pull ?? null;
  const linked = [...(own ? [own] : []), ...(x.linked ?? [])];
  const createdAt = x.issue?.createdAt ?? own?.createdAt ?? own?.updatedAt ?? new Date(nowMs).toISOString();
  // Who picked it up: the issue's assignees, else the assignees of a linked pull request (a developer may assign
  // themselves on the library branch from Figma that carries the spec and closes the issue).
  const linkedAssignees = linked.filter((p) => isOpen(p) || isMerged(p)).flatMap((p) => p.assignees ?? []);
  const assignees = x.issue?.assignees?.length ? x.issue.assignees : [...new Set(linkedAssignees)];
  // The person who sent it never reads as its builder (the branch from Figma is opened in their name).
  const requester = (x.issue?.author ?? own?.author ?? '').toLowerCase();
  const merged = linked.filter(isMerged).sort((a, b) => String(mergedAtOf(b)).localeCompare(String(mergedAtOf(a))))[0];
  const inReview = linked.find(ready);
  const building = linked.find((p) => isOpen(p) && !specOnly(p));
  // The issue's own state decides first when it is closed: completed reads shipped even without a merged pull request.
  const issueClosed = x.issue?.state === 'closed';
  const ownClosed = !x.issue && own && !isOpen(own) && !isMerged(own);
  let status: BuildStatus;
  if (merged || (issueClosed && x.issue?.stateReason !== 'not_planned')) status = 'shipped';
  else if (issueClosed || ownClosed) status = 'not-planned';
  else if (inReview) status = 'in-review';
  else if (building) status = 'in-progress';
  else if (assignees.length) status = 'picked-up';
  else status = 'requested';
  const workPull = merged ?? inReview ?? building ?? null;
  const builders = assignees.length ? [...assignees] : workPull?.author && (status === 'in-progress' || status === 'in-review' || status === 'shipped') && workPull !== own && workPull.author.toLowerCase() !== requester ? [workPull.author] : [];
  const ageDays = Math.max(0, Math.floor((nowMs - Date.parse(createdAt)) / DAY));
  const stale = status === 'requested' && ageDays > BUILD_STALE_DAYS;
  const shippedAt = status === 'shipped' ? (merged ? mergedAtOf(merged) : null) ?? x.issue?.closedAt ?? null : null;
  const who = listNames(builders.map(nameOf));
  const sentence: Record<BuildStatus, string> = {
    requested: stale ? `Waiting for a developer to pick it up for ${ageDays} days.` : 'Waiting for a developer to pick it up.',
    'picked-up': `${who} ${builders.length > 1 ? 'are' : 'is'} on it.`,
    'in-progress': who ? `${who} ${builders.length > 1 ? 'are' : 'is'} building it.` : 'A developer is building it.',
    'in-review': 'Built. A developer reviews the code before it ships.',
    shipped: 'In the library. Storybook shows it after the next deploy.',
    'not-planned': 'Developers closed it without building it.',
  };
  const reached = status === 'not-planned' ? ['requested'] : BUILD_STEPS.slice(0, BUILD_STEPS.indexOf(status) + 1);
  const timeline: BuildStatusEvent[] = reached.map((s) => {
    if (s === 'requested') return { status: s, at: createdAt, ...(x.issue?.author ? { who: x.issue.author } : own?.author ? { who: own.author } : {}) };
    if (s === 'picked-up') return { status: s, ...(first(builders) ? { who: first(builders) } : {}) };
    if (s === 'in-progress') {
      // The branch from Figma was opened by the sender when they pushed: its date and author are not when work started.
      const theirs = building && building !== own && building.author && building.author.toLowerCase() !== requester;
      return { status: s, ...(theirs && building.createdAt ? { at: building.createdAt } : {}), ...(theirs ? { who: building.author } : first(builders) ? { who: first(builders) } : {}) };
    }
    if (s === 'shipped') return { status: s, ...(shippedAt ? { at: shippedAt } : {}) };
    return { status: s as BuildStatus };
  });
  if (status === 'not-planned') timeline.push({ status: 'not-planned', ...(x.issue?.closedAt ? { at: x.issue.closedAt } : {}) });
  return {
    status,
    label: status === 'requested' && stale ? `Requested ${ageDays} days ago` : BUILD_STATUS_LABEL[status],
    sentence: sentence[status],
    builders,
    ageDays,
    stale,
    shippedAt,
    pull: workPull ? { number: workPull.number, url: workPull.url, state: isMerged(workPull) ? 'merged' : workPull.state } : null,
    timeline,
    createdAt,
  };
}

const stripSubject = (title: string, component: string) => {
  const t = title.trim();
  const p = `${component}:`;
  return t.toLowerCase().startsWith(p.toLowerCase()) ? t.slice(p.length).trim().replace(/^./, (c) => c.toUpperCase()) : t;
};

/** Order of the list: what waits longest first, then work in flight, then shipped, newest first within each. */
const STATUS_ORDER: Record<BuildStatus, number> = { requested: 0, 'picked-up': 1, 'in-progress': 2, 'in-review': 3, shipped: 4, 'not-planned': 5 };

/**
 * Every build request, from the issues and pull requests read on GitHub: issues that are build requests
 * (isBuildRequestIssue) with the pull requests that close them, plus library branches from Figma waiting for a
 * developer that no issue covers (direct mode). `linkedByIssue`: GitHub's linked pull requests per issue number, when the
 * caller read the timeline (Development links), on top of "Closes #n".
 */
export function assembleBuildRequests(input: {
  issues: readonly BuildIssueLike[];
  pulls: readonly BuildPullLike[];
  now?: Date | number | undefined;
  nameOf?: ((login: string) => string) | undefined;
  linkedByIssue?: ReadonlyMap<number, readonly number[]> | undefined;
}): BuildRequestView[] {
  const now = input.now ?? Date.now();
  const out: BuildRequestView[] = [];
  const claimed = new Set<number>();
  for (const issue of input.issues) {
    if (!isBuildRequestIssue(issue.labels)) continue;
    const extra = input.linkedByIssue?.get(issue.number) ?? [];
    const linked = input.pulls.filter((p) => closingIssueNumbers(p.body).includes(issue.number) || extra.includes(p.number));
    for (const p of linked) claimed.add(p.number);
    const r = parseBuildRequestIssue(issue.body);
    const component = r?.component ?? (issue.title.split(':')[0] ?? '').trim();
    const s = buildRequestStatus({ issue, linked }, now, input.nameOf);
    out.push({
      id: `issue-${issue.number}`,
      kind: 'issue',
      number: issue.number,
      url: issue.url,
      component,
      title: r?.title ?? stripSubject(issue.title, component),
      requestKind: r?.kind ?? null,
      ...s,
      requestedBy: r?.requestedBy ?? issue.author ?? null,
      jira: jiraKeyOfLabels(issue.labels),
      figmaUrl: r?.figma?.url ?? null,
    });
  }
  for (const p of input.pulls) {
    if (claimed.has(p.number)) continue;
    const l = pullNames(p);
    if (l.includes(EXPLORATION_LABEL)) continue;
    const o = parseFigmaOrigin(p.body);
    const fromFigmaDraft = l.includes(WAITING_FOR_CLAUDE_LABEL) || l.includes(DRAFTED_BY_CLAUDE_LABEL) || o?.route === 'claude-draft';
    if (!fromFigmaDraft || !(l.includes(FROM_FIGMA_LABEL) || o)) continue;
    const title = p.title ?? '';
    const component = o?.component ?? (title.includes(':') ? title.split(':')[0]!.trim() : ((p.headRef ?? '').split('/').pop() ?? ''));
    const s = buildRequestStatus({ pull: p }, now, input.nameOf);
    out.push({
      id: `pull-${p.number}`,
      kind: 'pull',
      number: p.number,
      url: p.url ?? '',
      component,
      title: stripSubject(title, component),
      requestKind: o?.kind ?? null,
      ...s,
      requestedBy: o?.requestedBy ?? p.author ?? null,
      jira: jiraKeyOfLabels(p.labels),
      figmaUrl: o?.url ?? null,
    });
  }
  return out.sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || (a.status === 'shipped' ? String(b.shippedAt).localeCompare(String(a.shippedAt)) : a.createdAt.localeCompare(b.createdAt)));
}

/** The filters of the Being built page. */
export type BuildFilter = 'all' | 'waiting' | 'in-progress' | 'shipped-this-week';

export const BUILD_FILTER_LABEL: Record<BuildFilter, string> = {
  all: 'All',
  waiting: 'Waiting to be picked up',
  'in-progress': 'In progress',
  'shipped-this-week': 'Shipped this week',
};

/** Whether a build request shows under a filter. "All" leaves out what was closed as not planned more than a week ago. */
export function matchesBuildFilter(v: Pick<BuildRequestView, 'status' | 'shippedAt' | 'timeline'>, f: BuildFilter, now: Date | number = Date.now()): boolean {
  const nowMs = typeof now === 'number' ? now : now.getTime();
  const recent = (iso: string | null | undefined) => Boolean(iso) && nowMs - Date.parse(iso!) <= 7 * DAY;
  switch (f) {
    case 'waiting':
      return v.status === 'requested';
    case 'in-progress':
      return v.status === 'picked-up' || v.status === 'in-progress' || v.status === 'in-review';
    case 'shipped-this-week':
      return v.status === 'shipped' && recent(v.shippedAt);
    default:
      return v.status === 'not-planned' ? recent(v.timeline.find((e) => e.status === 'not-planned')?.at) : true;
  }
}

/** Build requests still open (not shipped, not closed). */
export const openBuildRequests = <V extends Pick<BuildRequestView, 'status'>>(views: readonly V[]): V[] => views.filter((v) => v.status !== 'shipped' && v.status !== 'not-planned');

/** The calm summary line of the home: "3 being built, 1 waiting to be picked up." Null when nothing is open. */
export function buildSummaryLine(views: readonly Pick<BuildRequestView, 'status' | 'stale'>[]): string | null {
  const open = openBuildRequests(views);
  if (!open.length) return null;
  const waiting = open.filter((v) => v.status === 'requested').length;
  const building = open.length - waiting;
  const parts = [...(building ? [`${building} being built`] : []), ...(waiting ? [`${waiting} waiting to be picked up`] : [])];
  return `${parts.join(', ')}.`.replace(/^./, (c) => c.toUpperCase());
}

/**
 * The Library component page line while build requests for a component are open: "Figma is ahead: 2 changes being
 * built (Ana)." Null when none is open (it disappears once shipped).
 */
export function figmaAheadLine(views: readonly Pick<BuildRequestView, 'component' | 'status' | 'builders'>[], component: string, nameOf: (login: string) => string = (l) => l): { count: number; builders: string[]; sentence: string } | null {
  const open = openBuildRequests(views).filter((v) => v.component.toLowerCase() === component.toLowerCase());
  if (!open.length) return null;
  const builders = [...new Set(open.flatMap((v) => v.builders))].map(nameOf);
  const n = open.length;
  return { count: n, builders, sentence: `Figma is ahead: ${n} change${n === 1 ? '' : 's'} being built${builders.length ? ` (${listNames(builders)})` : ''}.` };
}

/** "Button: add a lg size", the issue title of a build request (same rule as every request). */
export const buildRequestTitle = (r: Pick<BuildRequestInput, 'component' | 'title'>) => requestIssueTitle(r);
