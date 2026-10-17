// DS Bridge UI: three tabs (Pull: code -> Figma, Push: Figma -> code, Settings). Plain TypeScript and DOM, no framework.
// The UI owns network calls and logic; figma.* access goes through request() to the main thread.
// Layout: tabs on top, scrolling content, and an action bar pinned to the bottom that always shows
// what the primary button will do (or why it is disabled).

import type { ConflictChoice, DiffEntry } from '@bridge-ds/core';
import { type Analysis, type PullProposal, type PushBrand, type PushProposal, analyze, buildPull, buildPush } from '../sync/flows';
import { GitHubClient, type PullRequest, parseRepo } from '@bridge-ds/core';
import type { RenameSuggestion } from '@bridge-ds/core';
import { affectedContrast, defaultTitle } from '@bridge-ds/core';
import { type PathIndex, type ResolveContext, resolve } from '@bridge-ds/core';
import { contextFor, modesOf } from '@bridge-ds/core';
import { type LogicalToken, SINGLE_MODE } from '@bridge-ds/core';
import type { Issue } from '@bridge-ds/core';
import { formatValue, isAlias, parseColor, rgbaToHex } from '@bridge-ds/core';
import { type ContrastResult, contextLabel, pairKey } from '@bridge-ds/core';
import { type ApplyReport, type FigmaSnapshot, type InitPayload, type RepoSettings, modeDisplayName } from '../shared/messages';
import { REQUEST_KINDS, type RequestKind } from '@bridge-ds/core';
import { type ComponentChangeItem, type ComponentScan, type RequestDraft, classifyComponents, pullBaselines, suggestTitle, toRequest } from '../sync/components';
import { loadCodedComponents, sendComponentRequest } from '../sync/requests';
import { type ComponentApplyReport, type ComponentPullPlan, type PlannedComponent, buildComponentPlan, loadComponentSpecs } from '../sync/component-pull';
import { type ComponentReview, onlyComponent, reviewUpdates } from '../sync/component-review';
import type { ComponentSignature } from '../sync/components';
import { type PublishItem, type PublishResult, componentKey, defaultUnchecked, experimentalTokenIds, groupState, heldTokenIds, isChecked, publish, publishItems, setGroup, variableIdsOf, variableKey } from '../sync/publish';
import { type Selection, onProgress, onSelection, request } from './bridge';
import { type Child, h } from './dom';
import { icon } from './icons';
import { ILLUSTRATIONS, type IllustrationName } from './illustrations';

type Tab = 'pull' | 'push' | 'settings';
const TABS: { id: Tab; label: string }[] = [
  { id: 'pull', label: 'Pull' },
  { id: 'push', label: 'Push' },
  { id: 'settings', label: 'Settings' },
];
/** Rows rendered per list before "Show all": keeps large token sets responsive. */
const PAGE = 60;

interface PullState {
  analysis: Analysis;
  choices: Map<string, ConflictChoice>;
  /** "Replace with main": main wins over the Figma edits of tokens that exist on main. */
  overwrite: boolean;
  proposal: PullProposal;
  report?: ApplyReport | undefined;
  /** Component sets from component-specs.json on the branch; undefined when the repo has none. */
  components?: ComponentPullPlan | undefined;
  componentsError?: string | undefined;
  /** Opt-in: also build the component sets code added ("Also pull new components"). Updates are always offered. */
  includeComponents: boolean;
  componentsReport?: ComponentApplyReport | undefined;
  /** "Review updates": what an update changes in each generated set that changed in code. */
  reviews: ComponentReview[];
  /** Thumbnails (base64 PNG) per set node id, before and after its update. */
  before: Record<string, string>;
  after: Record<string, string>;
  /** Component ids updated one by one (or by "Update all"), with their review, kept across re-checks. */
  done: Map<string, ComponentReview>;
}

/** Thumbnail width in the review, CSS pixels (two side by side in the 480px plugin). */
const THUMB_W = 196;

interface PushState {
  analysis: Analysis;
  snapshot: FigmaSnapshot;
  choices: Map<string, ConflictChoice>;
  confirmed: RenameSuggestion[];
  dismissed: Set<string>;
  proposal: PushProposal;
  title: string;
  /** "Description": the pull request's "What changed and why" and every request's summary. */
  description: string;
  openPr: PullRequest | undefined;
  appendToOpen: boolean;
  /** Slugs of new brand candidates the designer chose to create in this pull request (opt-in, see planBrands). */
  includeBrands: Set<string>;
  /** Changes list: every variable edit and component change, and the keys the designer unchecked. */
  items: PublishItem[];
  unchecked: Set<string>;
  /** Token ids marked "Experimental" in this file. */
  experimental: Set<string>;
  result?: PublishResult | undefined;
  /** Component changes: requests (GitHub issues), separate from the variables pull request. */
  components?: ComponentScan | undefined;
  componentsError?: string | undefined;
  fileKey?: string | undefined;
  form?: RequestForm | undefined;
  sent: { component: string; number: number; url: string }[];
}

/** The inline request form: one detected change, a new component candidate, or a manual request ("manual"). */
interface RequestForm {
  key: string;
  item?: ComponentChangeItem | undefined;
  draft: RequestDraft;
  attach: boolean;
  error?: string | undefined;
}

interface State {
  tab: Tab;
  init?: InitPayload | undefined;
  busy?: string | undefined;
  error?: { message: string; retry?: (() => void) | undefined } | undefined;
  pull?: PullState | undefined;
  push?: PushState | undefined;
  settingsDraft: RepoSettings;
  tokenDraft: string;
  settingsMessage?: { kind: 'ok' | 'error'; text: string } | undefined;
  expanded: Set<string>;
  /** Current Figma selection, for "Attach the current selection". */
  selection: Selection;
}

interface ActionBar {
  label: string;
  onClick: () => void;
  disabled?: boolean | undefined;
  hint?: string | undefined;
  secondary?: { label: string; onClick: () => void } | undefined;
}

const state: State = { tab: 'pull', settingsDraft: { repo: '', branch: '', tokensPath: '' }, tokenDraft: '', expanded: new Set(), selection: null };
let client: GitHubClient | undefined;
const app = document.getElementById('app')!;

onSelection((selection) => {
  state.selection = selection;
  // Only the request form shows the selection: re-render it, never the whole screen while typing.
  const el = document.getElementById('attach-hint');
  if (el) el.textContent = attachHint();
  const box = document.getElementById('attach-box') as HTMLInputElement | null;
  if (box && state.push?.form?.key === 'manual') box.disabled = !selection;
});

onProgress((message) => {
  if (!state.busy) return;
  state.busy = message;
  const el = document.getElementById('busy-text');
  if (el) el.textContent = message;
});

// ---------------------------------------------------------------------------------------------
// Helpers

function getClient(): GitHubClient {
  const init = state.init!;
  if (!init.token) throw new Error('Add a GitHub token in Settings to connect.');
  client ??= new GitHubClient(init.settings.repo, init.token);
  return client;
}

async function run(label: string, task: () => Promise<void>, retry?: () => void): Promise<void> {
  if (state.busy) return;
  state.busy = label;
  state.error = undefined;
  render();
  try {
    await task();
  } catch (err) {
    state.error = { message: err instanceof Error ? err.message : String(err), retry };
  } finally {
    state.busy = undefined;
    render();
  }
}

const short = (sha: string | undefined) => (sha ? sha.slice(0, 7) : '');
const when = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
};
const plural = (n: number, word: string, many = `${word}s`) => `${n} ${n === 1 ? word : many}`;
const modeLabel = (mode: string) => (mode === SINGLE_MODE ? 'Value' : modeDisplayName(mode));

/** Context to resolve a token's value in one mode of its tier (other axes at their default). */
function ctxFor(t: LogicalToken, mode: string): ResolveContext {
  const head = (state.push?.analysis ?? state.pull?.analysis)?.head;
  return head ? contextFor(head, t.tier, mode) : { brand: mode, theme: mode, density: mode };
}

/** Index used to resolve aliases of Figma-side tokens: Git tokens overlaid with Figma's. */
function figmaIndex(a: Analysis): PathIndex {
  const idx = new Map(a.head.byPath);
  for (const t of a.figmaTokens) idx.set(t.path, t);
  return idx;
}

function swatch(index: PathIndex, t: LogicalToken | undefined, mode: string): Child {
  if (!t || t.type !== 'color') return null;
  const r = resolve(index, t.path, ctxFor(t, mode));
  const c = r.value === undefined ? undefined : parseColor(r.value);
  if (!c) return h('span', { class: 'swatch missing', title: 'This alias does not resolve' });
  const css = `rgba(${Math.round(c.r * 255)}, ${Math.round(c.g * 255)}, ${Math.round(c.b * 255)}, ${c.a})`;
  return h('span', { class: 'swatch', title: rgbaToHex(c) }, h('span', { style: { background: css } }));
}

function valueParts(index: PathIndex, t: LogicalToken | undefined, mode: string): { name: string; resolved?: string | undefined } {
  if (!t) return { name: 'none' };
  const v = t.values[mode];
  if (v === undefined) return { name: 'none' };
  if (!isAlias(v)) return { name: formatValue(t.type, v) };
  const r = resolve(index, t.path, ctxFor(t, mode));
  return { name: formatValue(t.type, v), resolved: r.value === undefined ? 'does not resolve' : formatValue(t.type, r.value) };
}

/** Token paths break after dots, never inside a segment. */
function breakable(text: string): Child[] {
  const parts = text.split('.');
  return parts.flatMap((part, i) => (i < parts.length - 1 ? [`${part}.`, h('wbr')] : [part]));
}

function valueChip(index: PathIndex, t: LogicalToken | undefined, mode: string, dim = false): HTMLElement {
  const p = valueParts(index, t, mode);
  // Colors show their swatch (hex on hover); other aliases show what they resolve to.
  const showResolved = p.resolved && (t?.type !== 'color' || p.resolved === 'does not resolve');
  return h(
    'span',
    { class: `value${dim ? ' before' : ''}` },
    swatch(index, t, mode),
    h('span', { class: 'value-name' }, breakable(p.name)),
    showResolved ? h('span', { class: 'value-resolved' }, p.resolved) : null,
  );
}

function modesFor(a: Analysis, t: LogicalToken): string[] {
  return modesOf(a.head.layout, t.tier);
}

const PILLS_MAX = 8;

/** Contrast pairs a change moves, directly or through aliases, in every brand x theme. */
function contrastPills(current: LogicalToken | undefined, target: LogicalToken | undefined, after: ContrastResult[] | undefined, before: ContrastResult[] = []): Child {
  if (!after) return null;
  const rows = affectedContrast({ current, target }, before, after).filter((x) => x.after?.ratio !== undefined);
  if (!rows.length) return null;
  rows.sort((x, y) => Number(y.after!.level === 'fail') - Number(x.after!.level === 'fail') || x.after!.ratio! - y.after!.ratio!);
  return h(
    'div',
    { class: 'pills' },
    rows.slice(0, PILLS_MAX).map(({ before: b, after: r }) => {
      const was = b?.ratio;
      const level = r!.level === 'fail' ? 'Fails' : r!.level;
      return h(
        'span',
        {
          class: `pill ${r!.level}`,
          title: `${r!.pair.foreground} on ${r!.pair.background}, ${contextLabel(r!)}, needs ${r!.pair.min}:1${was !== undefined && was !== r!.ratio ? `. Was ${was}:1` : ''}`,
        },
        h('strong', null, level ?? ''),
        ` ${r!.ratio}:1 ${contextLabel(r!)}, ${r!.pair.foreground.replace(/^color\./, '')} on ${r!.pair.background.replace(/^color\./, '')}`,
      );
    }),
    rows.length > PILLS_MAX ? h('span', { class: 'pill' }, `${rows.length - PILLS_MAX} more pairs in Contrast below`) : null,
  );
}

interface RowSides {
  before: LogicalToken | undefined;
  after: LogicalToken | undefined;
  beforeIndex: PathIndex;
  afterIndex: PathIndex;
}

const KIND_LABEL: Record<string, string> = { added: 'New', changed: 'Edited', renamed: 'Renamed', removed: 'Deleted', restored: 'Recreated', replaced: 'From main' };

function diffRow(a: Analysis, kind: string, sides: RowSides, extra?: Child, edge?: { lead?: Child; tail?: Child }): HTMLElement {
  const t = (sides.after ?? sides.before)!;
  const renamed = !!sides.before && !!sides.after && sides.before.path !== sides.after.path;
  const lines: Child[] = [];
  for (const mode of modesFor(a, t)) {
    const b = valueParts(sides.beforeIndex, sides.before, mode);
    const n = valueParts(sides.afterIndex, sides.after, mode);
    const same = b.name === n.name && b.resolved === n.resolved;
    if (same && kind === 'renamed') continue;
    if (same && kind === 'changed') continue;
    lines.push(
      h(
        'div',
        { class: 'mode-line' },
        h('span', { class: 'mode-name' }, modeLabel(mode)),
        h(
          'span',
          { class: 'change' },
          sides.before ? valueChip(sides.beforeIndex, sides.before, mode, !!sides.after) : null,
          sides.before && sides.after ? icon('arrow') : null,
          sides.after ? valueChip(sides.afterIndex, sides.after, mode) : null,
        ),
      ),
    );
  }
  if (sides.before && sides.after && (sides.before.description ?? '') !== (sides.after.description ?? '')) {
    lines.push(
      h('div', { class: 'mode-line' }, h('span', { class: 'mode-name' }, 'Note'), h('span', { class: 'note' }, sides.after.description || 'Description removed')),
    );
  }
  return h(
    'li',
    { class: 'row' },
    h(
      'div',
      { class: 'row-head' },
      edge?.lead,
      h('span', { class: `kind ${kind}` }, KIND_LABEL[kind] ?? kind),
      renamed
        ? h('span', { class: 'path' }, h('span', { class: 'path-old' }, breakable(sides.before!.path)), icon('arrow'), h('span', null, breakable(sides.after!.path)))
        : h('span', { class: 'path' }, breakable(t.path)),
      edge?.tail,
    ),
    lines,
    extra,
  );
}

function rowList(key: string, rows: HTMLElement[], limit = PAGE): HTMLElement {
  const all = state.expanded.has(key);
  const shown = all ? rows : rows.slice(0, limit);
  return h(
    'div',
    null,
    h('ul', { class: 'rows' }, shown),
    rows.length > shown.length
      ? h('button', { class: 'btn ghost more', onClick: () => { state.expanded.add(key); render(); } }, `Show all ${rows.length}`)
      : null,
  );
}

/** One group of the Pull screen: title and count with its action on the same line, one sentence, then its rows. */
function group(title: string, count: number, action: Child, lede: string, content: Child): HTMLElement {
  return h(
    'section',
    { class: 'group' },
    h('div', { class: 'group-head' }, h('h2', null, title, h('span', { class: 'group-n' }, String(count))), action),
    h('p', { class: 'lede' }, lede),
    content,
  );
}

function issueList(kind: 'error' | 'warn', title: string, issues: Issue[]): Child {
  if (!issues.length) return null;
  return h(
    'div',
    { class: `callout ${kind}`, role: kind === 'error' ? 'alert' : undefined },
    h('div', { class: 'callout-title' }, icon('alert'), title),
    h('ul', null, issues.slice(0, 40).map((i) => h('li', null, i.message))),
    issues.length > 40 ? h('p', null, `And ${issues.length - 40} more.`) : null,
  );
}

function conflictBlock(a: Analysis, e: DiffEntry, choices: Map<string, ConflictChoice>, edge?: { lead?: Child; tail?: Child }): HTMLElement {
  const choice = choices.get(e.id);
  const fi = figmaIndex(a);
  const side = (which: ConflictChoice, label: string, t: LogicalToken | undefined, index: PathIndex) =>
    h(
      'label',
      { class: `choice${choice === which ? ' selected' : ''}` },
      h(
        'span',
        { class: 'choice-head' },
        h('input', {
          type: 'radio',
          name: `c-${e.id}`,
          checked: choice === which,
          onChange: () => {
            choices.set(e.id, which);
            refreshProposals();
          },
        }),
        label,
      ),
      t
        ? modesFor(a, t).map((m) => h('span', { class: 'choice-line' }, h('span', { class: 'mode-name' }, modeLabel(m)), valueChip(index, t, m)))
        : h('span', { class: 'muted' }, 'Deleted'),
      t && t.path !== e.path ? h('span', { class: 'muted' }, `Named ${t.path}`) : null,
    );
  return h(
    'li',
    { class: 'conflict' },
    h('div', { class: 'row-head' }, edge?.lead, h('span', { class: 'kind conflict' }, 'Conflict'), h('span', { class: 'path' }, e.path), edge?.tail),
    h('div', { class: 'choices', role: 'radiogroup', 'aria-label': `Version to keep for ${e.path}` }, side('figma', 'Keep Figma', e.figma, fi), side('main', 'Use main', e.head, a.head.byPath)),
  );
}

function conflictSection(a: Analysis, choices: Map<string, ConflictChoice>, edge?: (e: DiffEntry) => { lead?: Child; tail?: Child }): Child {
  const list = a.diff.conflicts;
  if (!list.length) return null;
  const open = list.filter((c) => !choices.has(c.id)).length;
  return h(
    'section',
    null,
    h('h2', null, `Conflicts (${list.length})`),
    h('p', { class: 'lede' }, 'Edited in Figma and on main since your last pull. Pick the version to keep. Nothing is overwritten until you choose.'),
    list.length > 1
      ? h(
          'div',
          { class: 'inline-actions' },
          h('button', { class: 'btn ghost', onClick: () => { list.forEach((e) => choices.set(e.id, 'figma')); refreshProposals(); } }, 'Keep Figma for all'),
          h('button', { class: 'btn ghost', onClick: () => { list.forEach((e) => choices.set(e.id, 'main')); refreshProposals(); } }, 'Use main for all'),
          open ? h('span', { class: 'muted' }, `${open} left to decide`) : null,
        )
      : null,
    h('ul', { class: 'rows' }, list.map((e) => conflictBlock(a, e, choices, edge?.(e)))),
  );
}

function refreshProposals(): void {
  if (state.pull) state.pull.proposal = buildPull(state.pull.analysis, state.pull.choices, { overwrite: state.pull.overwrite });
  if (state.push) state.push.proposal = buildPush(state.push.analysis, state.push.choices, state.push.includeBrands, heldTokenIds(state.push.items, state.push.unchecked));
  render();
}

function notes(a: Analysis): Child {
  if (!a.warnings.length && !a.codeOnly.length) return null;
  return h(
    'details',
    { class: 'notes' },
    h('summary', null, a.warnings.length ? plural(a.warnings.length, 'note') : 'Details'),
    a.warnings.length ? h('ul', null, a.warnings.map((w) => h('li', null, w))) : null,
    a.codeOnly.length
      ? h('p', { class: 'muted' }, `${plural(a.codeOnly.length, 'token')} stay in code only because Figma variables cannot hold them: ${a.codeOnly.map((u) => u.path).join(', ')}.`)
      : null,
  );
}

// ---------------------------------------------------------------------------------------------
// Actions

async function loadInit(): Promise<void> {
  state.init = await request('init', {});
  state.settingsDraft = { ...state.init.settings };
  client = undefined;
}

/** Reads main and the file into a pull preview. `prev` carries what the designer already did on this screen. */
async function loadPull(prev?: PullState): Promise<PullState> {
  const snapshot = await request('snapshot', {});
  const analysis = await analyze(getClient(), state.init!.settings, state.init!.sync, snapshot);
  const choices = new Map<string, ConflictChoice>();
  // Components are a separate step: a problem reading them never blocks the variables.
  let components: ComponentPullPlan | undefined;
  let componentsError: string | undefined;
  let reviews: ComponentReview[] = [];
  const before: Record<string, string> = { ...(prev?.before ?? {}) };
  try {
    const loaded = await loadComponentSpecs(getClient(), analysis.headFiles.treeSha, analysis.headFiles.config);
    if (loaded) components = buildComponentPlan(loaded.specs, loaded.path, await request('scan-generated', {}), analysis.head);
    const updated = components?.components.filter((c) => c.status === 'updated' && c.nodeId) ?? [];
    if (components && updated.length) {
      // Review updates: the sets as they are now, compared with what the update builds, and their thumbnails.
      const scanned = await request('scan-components', {});
      reviews = reviewUpdates(components, new Map<string, ComponentSignature>(scanned.components.map((c) => [c.nodeId, c.signature])));
      const missing = updated.map((c) => c.nodeId!).filter((id) => !before[id]);
      if (missing.length) Object.assign(before, await request('thumbnails', { nodeIds: missing, width: THUMB_W }).catch(() => ({})));
    }
  } catch (err) {
    componentsError = err instanceof Error ? err.message : String(err);
  }
  return {
    analysis,
    choices,
    overwrite: false,
    proposal: buildPull(analysis, choices),
    components,
    componentsError,
    includeComponents: prev?.includeComponents ?? false,
    reviews,
    before,
    after: prev?.after ?? {},
    done: prev?.done ?? new Map(),
  };
}

function checkPull(): void {
  void run(
    'Reading main and your variables',
    async () => {
      state.pull = await loadPull();
      state.expanded.clear();
    },
    checkPull,
  );
}

/** Component sets "Update all" builds: every updated set not updated yet, and new ones when opted in. */
function componentsToBuild(p: PullState): PlannedComponent[] {
  return (p.components?.components ?? []).filter((c) => (c.status === 'updated' && !p.done.has(c.componentId)) || (c.status === 'new' && p.includeComponents));
}

/** After a pull: components now render with main's values, so refresh their baselines (pending changes are kept). */
async function refreshBaselines(p: PullState): Promise<void> {
  try {
    const scanned = await request('scan-components', {});
    const coded = await loadCodedComponents(getClient(), p.analysis.headFiles.treeSha, p.analysis.headFiles.config);
    const items = pullBaselines(scanned.components, coded);
    if (items.length) await request('save-signatures', { items: items.map((x) => ({ nodeId: x.nodeId, signature: JSON.stringify(x.signature) })) });
  } catch {
    /* the pull itself succeeded; baselines are taken again on the next scan */
  }
}

/** Builds components, then takes the "after" thumbnails of the updated ones and moves their review to `done`. */
async function buildComponents(p: PullState, list: PlannedComponent[]): Promise<ComponentApplyReport> {
  const report = await request('apply-components', { plan: { ...p.components!, components: list } });
  const updated = list.filter((c) => c.status === 'updated' && c.nodeId);
  if (updated.length) Object.assign(p.after, await request('thumbnails', { nodeIds: updated.map((c) => c.nodeId!), width: THUMB_W }).catch(() => ({})));
  for (const c of updated) {
    const review = p.reviews.find((r) => r.componentId === c.componentId);
    if (review) p.done.set(c.componentId, review);
  }
  return report;
}

/**
 * "Update" on one component (Figma lets you take updates one by one). Variables stay all-or-nothing: when main has
 * variable changes, they are applied first, so the component binds to the variables it expects.
 */
function updateComponent(componentId: string): void {
  const p = state.pull;
  if (!p?.components) return;
  const comp = p.components.components.find((c) => c.componentId === componentId);
  if (!comp) return;
  void run(
    `Updating ${comp.name}`,
    async () => {
      const withVariables = !variablesUpToDate(p);
      if (withVariables) {
        const report = await request('apply-pull', { plan: p.proposal.plan });
        if (report.errors.length) throw new Error(`Variables were written with problems, so ${comp.name} was not updated: ${report.errors[0]}`);
      }
      const report = await buildComponents(p, onlyComponent(p.components!, componentId).components);
      await refreshBaselines(p);
      if (withVariables) await loadInit();
      // Re-read main and the file: the updated set is now up to date; what is left stays to review.
      const next = await loadPull(p);
      if (report.problems.length) next.componentsReport = undefined;
      state.pull = next;
      if (report.problems.length) state.error = { message: `${comp.name} updated, with problems: ${report.problems.slice(0, 3).join('; ')}` };
      void request('notify', { message: `${comp.name} updated${withVariables ? ', with the variables from main' : ''}` });
    },
    () => updateComponent(componentId),
  );
}

/** Variables match main: nothing to write for them (components may still be pending). */
function variablesUpToDate(p: PullState): boolean {
  const a = p.analysis;
  return !a.diff.remote.length && !a.diff.conflicts.length && !p.proposal.restored.length && !!a.baseSha;
}

function applyPull(): void {
  const p = state.pull;
  if (!p) return;
  const build = componentsToBuild(p);
  void run(
    variablesUpToDate(p) && build.length ? 'Building components' : 'Writing variables',
    async () => {
      if (!variablesUpToDate(p) || !build.length) p.report = await request('apply-pull', { plan: p.proposal.plan });
      // Components after the variables, so every binding finds its variable.
      if (build.length) p.componentsReport = await buildComponents(p, build);
      const report = p.report;
      await refreshBaselines(p);
      await loadInit();
      state.push = undefined;
      const cr = p.componentsReport;
      const parts = [report ? `${report.created} variables created, ${report.updated} updated` : '', cr ? `${plural(cr.created + cr.updated, 'component')} built` : ''].filter(Boolean);
      void request('notify', { message: `Pulled ${state.init!.settings.branch}: ${parts.join(', ')}.` });
    },
    applyPull,
  );
}

function scanPush(keep?: PushState): void {
  void run(
    'Comparing your variables with main',
    async () => {
      const snapshot = await request('snapshot', {});
      const c = getClient();
      const confirmed = keep?.confirmed ?? [];
      const analysis = await analyze(c, state.init!.settings, state.init!.sync, snapshot, confirmed);
      const choices = keep?.choices ?? new Map<string, ConflictChoice>();
      const lastBranch = state.init!.sync.lastPrBranch;
      const openPr = lastBranch ? await c.findOpenPullRequest(lastBranch).catch(() => undefined) : undefined;
      const includeBrands = keep?.includeBrands ?? new Set<string>();
      const experimental = experimentalTokenIds(analysis, snapshot);
      let components: ComponentScan | undefined;
      let componentsError: string | undefined;
      let fileKey: string | undefined;
      try {
        const scanned = await request('scan-components', {});
        fileKey = scanned.fileKey;
        components = classifyComponents(scanned.components, await loadCodedComponents(c, analysis.headFiles.treeSha, analysis.headFiles.config));
        // Coded components seen for the first time: take their baseline silently (nothing to send).
        if (components.adopt.length) await request('save-signatures', { items: components.adopt.map((x) => ({ nodeId: x.nodeId, signature: JSON.stringify(x.signature) })) });
      } catch (err) {
        componentsError = err instanceof Error ? err.message : String(err);
      }
      const items = publishItems(analysis, experimental, components?.changed ?? []);
      // A new scan starts like Figma's publish dialog: everything checked but experimental items. A re-scan from this
      // screen (a confirmed rename, a new mark) keeps what the designer unchecked.
      const unchecked = keep ? new Set([...keep.unchecked].filter((k) => items.some((i) => i.key === k))) : defaultUnchecked(items);
      if (keep) for (const i of items) if (i.experimental && !keep.items.some((x) => x.key === i.key && x.experimental)) unchecked.add(i.key);
      state.push = {
        analysis,
        snapshot,
        choices,
        confirmed,
        dismissed: keep?.dismissed ?? new Set(),
        proposal: buildPush(analysis, choices, includeBrands, heldTokenIds(items, unchecked)),
        includeBrands,
        items,
        unchecked,
        experimental,
        title: keep?.title ?? '',
        description: keep?.description ?? '',
        openPr,
        appendToOpen: keep?.appendToOpen ?? !!openPr,
        components,
        componentsError,
        fileKey,
        sent: keep?.sent ?? [],
      };
      state.expanded.clear();
    },
    () => scanPush(keep),
  );
}

/** "Push for review": the pull request for the checked variables, then one request per checked component change. */
function submitPush(): void {
  const r = state.push;
  if (!r) return;
  const withPr = Object.keys(r.proposal.files).length + r.proposal.brandFiles.length > 0;
  void run(
    withPr ? (r.appendToOpen && r.openPr ? 'Adding a commit to the pull request' : 'Opening the pull request') : 'Sending the requests',
    async () => {
      const result = await publish(getClient(), {
        analysis: r.analysis,
        proposal: r.proposal,
        components: r.components?.changed ?? [],
        unchecked: r.unchecked,
        description: r.description,
        title: r.title,
        fileName: state.init!.fileName,
        fileKey: r.fileKey,
        appendTo: r.appendToOpen ? r.openPr : undefined,
        coded: r.components?.coded ?? [],
        image: async (nodeId) => (await request('export-image', { nodeId }).catch(() => null))?.base64,
      });
      r.result = result;
      // What was sent exists now; local bookkeeping failures must not hide that.
      try {
        if (result.pr?.tags.length) await request('tag-variables', { tags: result.pr.tags });
        if (result.pr) await request('save-sync', { sync: { lastPrBranch: result.pr.branch, lastPrUrl: result.pr.pr.url } });
        // A request is the new reference for its component: the next scan compares against what was asked for.
        for (const x of result.requests) await request('rebaseline', { nodeId: x.nodeId }).catch(() => undefined);
        for (const x of result.requests) r.sent.unshift({ component: x.component, number: x.number, url: x.url });
        await loadInit();
      } catch (err) {
        state.error = { message: `Sent, but saving the links in this file failed: ${err instanceof Error ? err.message : String(err)}` };
      }
      const parts = [result.pr ? `Pull request #${result.pr.pr.number} ${result.pr.appended ? 'updated' : 'opened'}` : '', result.requests.length ? `${plural(result.requests.length, 'request')} opened` : ''].filter(Boolean);
      void request('notify', { message: parts.join(', ') });
    },
    submitPush,
  );
}

/** Marks items "Experimental" (or clears the mark) on the variables or component sets, then re-scans keeping choices. */
function markExperimental(r: PushState, item: PublishItem, value: boolean): void {
  void run(
    value ? 'Marking as experimental' : 'Removing the experimental mark',
    async () => {
      const targets = item.kind === 'variable' ? variableIdsOf(r.analysis, item.id).map((id) => ({ kind: 'variable' as const, id })) : [{ kind: 'component' as const, id: item.id }];
      await request('set-experimental', { targets, value });
      // Marking unchecks it, like Figma's "Hide when publishing"; removing the mark leaves the choice to the designer.
      if (value) r.unchecked.add(item.key);
      if (item.kind === 'variable') (value ? r.experimental.add(item.id) : r.experimental.delete(item.id));
      item.experimental = value;
      const comp = r.components?.changed.find((c) => c.nodeId === item.id);
      if (comp) comp.experimental = value || undefined;
      r.proposal = buildPush(r.analysis, r.choices, r.includeBrands, heldTokenIds(r.items, r.unchecked));
    },
    () => markExperimental(r, item, value),
  );
}

function saveSettings(): void {
  const draft = state.settingsDraft;
  state.settingsMessage = undefined;
  void run('Checking access to the repository', async () => {
    try {
      parseRepo(draft.repo);
      if (!draft.branch.trim()) throw new Error('Enter a base branch, for example main.');
      if (!draft.tokensPath.trim()) throw new Error('Enter the folder that holds the *.tokens.json files, for example packages/tokens/src.');
      const newToken = state.tokenDraft.trim();
      const token = newToken || state.init?.token;
      let message = 'Settings saved. Add a token to connect.';
      if (token) {
        const gh = new GitHubClient(draft.repo, token);
        const info = await gh.getRepo();
        if (info.permissions && info.permissions.push === false) {
          throw new Error(`This token can read ${info.fullName} but cannot write to it. Give it "Contents", "Pull requests" and "Issues" set to "Read and write".`);
        }
        if (!(await gh.getBranchSha(draft.branch.trim()))) throw new Error(`Branch "${draft.branch.trim()}" does not exist in ${info.fullName}.`);
        if (newToken) await request('save-token', { token: newToken });
        message = `Connected to ${info.fullName}.${newToken ? ' The token is saved on this computer only.' : ''}`;
      }
      state.tokenDraft = '';
      await request('save-settings', { settings: draft });
      await loadInit();
      state.pull = undefined;
      state.push = undefined;
      state.settingsMessage = { kind: 'ok', text: message };
    } catch (err) {
      state.settingsMessage = { kind: 'error', text: err instanceof Error ? err.message : String(err) };
    }
  });
}

function removeToken(): void {
  void run('Removing the token', async () => {
    await request('clear-token', {});
    await loadInit();
    state.pull = undefined;
    state.push = undefined;
    state.settingsMessage = { kind: 'ok', text: 'Token removed from this computer.' };
  });
}

// ---------------------------------------------------------------------------------------------
// Views

interface View {
  body: Child;
  bar?: ActionBar | undefined;
}

/** A Field Guide line drawing (static markup from illustrations.ts). Decorative. */
function ill(name: IllustrationName): HTMLElement {
  const art = ILLUSTRATIONS[name];
  const el = h('span', { class: 'ill', 'aria-hidden': 'true' });
  el.innerHTML = `<svg viewBox="${art.viewBox}" fill="none" focusable="false">${art.svg}</svg>`;
  return el;
}

/** The screen's one Harbor zone: a Fraunces headline, one sentence, an optional meta line, a drawing. */
function intro(o: { title: string; text?: string; meta?: Child; art?: IllustrationName }): HTMLElement {
  return h(
    'section',
    { class: `zone intro${o.art ? ' with-art' : ''}` },
    h('div', { class: 'intro-text' }, h('h2', { class: 'headline' }, o.title), o.text ? h('p', null, o.text) : null, o.meta ? h('p', { class: 'muted' }, o.meta) : null),
    o.art ? ill(o.art) : null,
  );
}

/** What happens next, as numbered steps under the intro of an idle screen. Explains; asks for nothing. */
function steps(items: [string, string][]): HTMLElement {
  return h(
    'section',
    { class: 'card' },
    h('h2', null, 'How it works'),
    h('ol', { class: 'steps' }, items.map(([t, d], i) => h('li', null, h('span', { class: 'step-n', 'aria-hidden': 'true' }, String(i + 1)), h('div', null, h('b', null, t), h('p', { class: 'muted' }, d))))),
  );
}

function needToken(): View {
  return {
    body: intro({ title: 'Connect your repository', text: 'DS Bridge reads the tokens on main and opens pull requests with your edits. It needs a GitHub token for one repository.', art: 'guide' }),
    bar: { label: 'Open Settings', onClick: () => { state.tab = 'settings'; render(); } },
  };
}

function viewPull(): View {
  const init = state.init!;
  if (!init.hasToken) return needToken();
  const p = state.pull;
  if (!p) {
    return {
      body: [intro({
        title: `Bring ${init.settings.branch} into Figma`,
        text: 'See every change before anything is written. Your own edits are kept, nothing is deleted.',
        meta: init.sync.baseSha
          ? `Last pulled ${short(init.sync.baseSha)} from ${init.settings.repo}${init.sync.lastPullAt ? ` on ${when(init.sync.lastPullAt)}` : ''}`
          : `From ${init.settings.repo}. First pull: one collection per tier, with its modes.`,
        art: 'tokens',
      }), steps([
        ['Check', `DS Bridge reads the token files on ${init.settings.branch}.`],
        ['Review', 'Every new, edited or deleted token is listed with its value. Nothing is written yet.'],
        ['Apply', 'Figma variables are created or updated. Your own edits stay until you push them.'],
      ])],
      bar: { label: 'Check for updates', onClick: checkPull },
    };
  }
  const a = p.analysis;
  const prop = p.proposal;
  const fi = figmaIndex(a);
  const remote = a.diff.remote;
  const upToDate = variablesUpToDate(p);
  const pending = componentsToBuild(p);
  const withComponents = pending.length > 0;

  if (p.report || p.componentsReport) {
    const r = p.report;
    const cr = p.componentsReport;
    const problems = [...(r?.errors ?? []), ...(cr?.problems ?? [])];
    const text = [
      r ? `${plural(r.created, 'variable')} created, ${r.updated} updated${r.orphaned ? `, ${r.orphaned} flagged as orphan` : ''}.` : '',
      cr
        ? `${[cr.created ? `${plural(cr.created, 'component set')} created` : '', cr.updated ? `${plural(cr.updated, 'component set')} updated` : '', cr.orphaned ? `${plural(cr.orphaned, 'variant')} flagged as orphan` : ''].filter(Boolean).join(', ') || 'Component sets already matched the code'} on the ${cr.page} page.`
        : '',
      prop.kept.length ? `${plural(prop.kept.length, 'Figma edit')} kept: send them from Push.` : '',
    ].filter(Boolean);
    return {
      body: [
        intro({
          title: problems.length ? 'Pulled, with problems' : 'Figma is up to date',
          text: text.join(' '),
          meta: r ? (r.layout === 'single-collection' ? 'Themes are modes of the Semantic collection.' : 'This file allows one mode per collection, so each theme has its own Semantic collection.') : undefined,
          art: problems.length ? 'fix' : 'tokens',
        }),
        cr?.fontNote ? h('div', { class: 'callout warn' }, h('div', { class: 'callout-title' }, icon('alert'), 'Font replaced'), h('p', null, cr.fontNote)) : null,
        p.done.size ? reviewGroup(p, [...p.done.values()], 'Updated components') : null,
        problems.length
          ? h(
              'section',
              { class: 'group' },
              h('div', { class: 'group-head' }, h('h2', null, 'Problems', h('span', { class: 'group-n' }, String(problems.length)))),
              h('p', { class: 'lede' }, 'Nothing else was skipped. Fix these in code or pull again.'),
              rowList('pull-errors', problems.map((e) => h('li', { class: 'row' }, h('p', null, e))), 5),
            )
          : null,
      ],
      bar: { label: 'Check again', onClick: checkPull, secondary: prop.kept.length ? { label: 'Push my edits', onClick: () => { state.tab = 'push'; scanPush(); } } : undefined },
    };
  }

  const counts: Record<string, number> = {};
  remote.forEach((e) => (counts[e.remote!.kind] = (counts[e.remote!.kind] ?? 0) + 1));
  const summary = [
    counts.added ? `${counts.added} new` : '',
    counts.changed ? `${counts.changed} edited` : '',
    counts.renamed ? `${counts.renamed} renamed` : '',
    counts.removed ? `${counts.removed} deleted on main` : '',
  ].filter(Boolean);

  // Summary first: one sentence for the whole screen, then one line of where it comes from.
  const status = [
    summary.length ? `${summary.join(', ')} on ${init.settings.branch}` : '',
    a.diff.conflicts.length ? plural(a.diff.conflicts.length, 'conflict') : '',
    prop.restored.length ? (p.overwrite ? `${prop.restored.length} replaced with ${init.settings.branch}` : `${prop.restored.length} to recreate`) : '',
    prop.kept.length ? `${plural(prop.kept.length, 'Figma edit')} kept` : '',
    pending.length ? `${plural(pending.length, 'component')} to ${pending.every((c) => c.status === 'updated') ? 'update' : 'build'}` : '',
  ].filter(Boolean);
  const headline = upToDate && !status.length ? 'Already up to date' : !a.baseSha ? 'First pull' : status.join(', ') || 'Already up to date';
  const meta = a.baseSha
    ? [`Last pulled ${short(a.baseSha)}${init.sync.lastPullAt ? ` on ${when(init.sync.lastPullAt)}` : ''}`, a.compare?.aheadBy ? `${plural(a.compare.aheadBy, 'new commit')} on ${init.settings.branch}` : ''].filter(Boolean).join(' · ')
    : `${plural(prop.plan.variables.length, 'variable')} from ${init.settings.repo}, in the Primitives, Brand, Base, Semantic, Density and Component collections.`;
  const body: Child[] = [h('section', { class: 'zone' }, h('h2', { class: 'headline' }, upToDate && status.length ? `Up to date with ${init.settings.branch}. ${status.join(', ')}.` : headline), h('p', { class: 'muted' }, meta))];

  if (remote.length) {
    body.push(
      group(
        `Changes on ${init.settings.branch}`,
        remote.length,
        null,
        counts.removed ? 'Tokens deleted on main stay in Figma with an "[orphan]" note, so nothing in your designs breaks.' : 'Written to Figma when you apply.',
        rowList('pull-remote', remote.map((e) => diffRow(a, e.remote!.kind, { before: e.figma ?? e.base, after: e.head, beforeIndex: fi, afterIndex: a.head.byPath }))),
      ),
    );
  }
  body.push(conflictSection(a, p.choices));
  if (prop.restored.length) {
    body.push(
      group(
        p.overwrite ? `Replaced with ${init.settings.branch}` : 'To recreate',
        prop.restored.length,
        p.overwrite ? h('button', { class: 'btn ghost', onClick: () => { p.overwrite = false; refreshProposals(); } }, 'Keep my edits') : null,
        p.overwrite ? 'Main wins over your Figma edits. Variables that exist only in Figma stay.' : 'Deleted in Figma, but other tokens still point to them.',
        rowList('pull-restored', prop.restored.map((e) => diffRow(a, p.overwrite ? 'replaced' : 'restored', { before: e.figma, after: e.head, beforeIndex: fi, afterIndex: a.head.byPath })), 5),
      ),
    );
  }
  if (prop.kept.length) {
    body.push(
      group(
        'Your Figma edits, kept',
        prop.kept.length,
        prop.kept.some((e) => e.head) ? h('button', { class: 'btn ghost', onClick: () => { p.overwrite = true; refreshProposals(); } }, `Replace with ${init.settings.branch}`) : null,
        'Not on main yet. Send them from Push.',
        rowList('pull-kept', prop.kept.map((e) => diffRow(a, e.local!.kind, { before: e.base, after: e.figma, beforeIndex: a.base?.byPath ?? a.head.byPath, afterIndex: fi })), 5),
      ),
    );
  }
  body.push(componentsGroup(p));
  if (prop.skipped.length) body.push(issueList('warn', 'Not written', prop.skipped.map((s) => ({ code: 'file-problem', severity: 'warning', message: `${s.path}: ${s.reason}` }))));
  body.push(notes(a));

  const open = prop.unresolvedConflicts.length;
  return {
    body,
    bar: upToDate && !withComponents
      ? { label: 'Check again', onClick: checkPull }
      : {
          label: pending.some((c) => c.status === 'updated') ? 'Update all' : 'Apply to Figma',
          onClick: applyPull,
          disabled: open > 0,
          hint: open
            ? `Decide ${plural(open, 'conflict')} first`
            : [upToDate ? '' : `${plural(prop.plan.variables.length, 'variable')}${prop.plan.orphans.length ? `, ${prop.plan.orphans.length} orphaned` : ''}`, withComponents ? plural(pending.length, 'component') : ''].filter(Boolean).join(', '),
          secondary: { label: 'Check again', onClick: checkPull },
        },
  };
}

/** "Button: loading prop, not drawn in this version." or "Badge, root: min-height, calc() has no Figma equivalent." */
function problemText(x: { component: string; part: string; property: string; reason: string }): string {
  if (x.property.startsWith('prop ')) return `${x.component}: ${x.property.slice(5)} prop, ${x.reason}.`;
  return `${x.component}, ${x.part}: ${x.property}, ${x.reason}.`;
}

/** Before and after thumbnails side by side; "after" exists once the set is updated. */
function thumbs(p: PullState, nodeId: string, name: string): HTMLElement {
  const img = (b64: string | undefined, label: string, empty: string) =>
    h(
      'figure',
      { class: 'thumb' },
      b64 ? h('img', { src: `data:image/png;base64,${b64}`, alt: `${name}, ${label.toLowerCase()}` }) : h('div', { class: 'thumb-empty' }, empty),
      h('figcaption', null, label),
    );
  return h('div', { class: 'thumbs' }, img(p.before[nodeId], 'Before', 'No preview'), img(p.after[nodeId], 'After', 'Shown once updated'));
}

/** Figma's "Review updates": one card per changed set, before and after, what changes, and "Update" on its own. */
function reviewGroup(p: PullState, reviews: ComponentReview[], title = 'Component updates'): HTMLElement {
  const rows = reviews.map((r) => {
    const done = p.done.has(r.componentId);
    const variants = [r.addedVariants.length ? `${r.addedVariants.length} new ${r.addedVariants.length === 1 ? 'variant' : 'variants'}` : '', r.removedVariants.length ? `${r.removedVariants.length} removed in code` : ''].filter(Boolean).join(', ');
    return h(
      'li',
      { class: 'row review' },
      h(
        'div',
        { class: 'row-head' },
        h('span', { class: 'comp-name' }, r.name),
        variants ? h('span', { class: 'muted' }, variants) : null,
        done
          ? h('span', { class: 'kind added row-end' }, 'Updated')
          : h('button', { class: 'btn row-end', 'data-focus-id': `update-${r.componentId}`, disabled: !!state.busy || p.proposal.unresolvedConflicts.length > 0, onClick: () => updateComponent(r.componentId) }, 'Update'),
      ),
      thumbs(p, r.nodeId, r.name),
      changeLines(r.changes, ['What', 'In Figma', 'From code']),
    );
  });
  return group(
    title,
    reviews.length,
    null,
    title === 'Component updates' ? 'Changed in code since your last pull. Update one at a time, or all of them with Update all. Instances keep their overrides.' : 'Updated in place: same layers, so instances keep their overrides.',
    rowList(`review-${title}`, rows, 10),
  );
}

/** Pull preview: updates to review for the generated sets, new sets opt-in, and what cannot be bound. */
function componentsGroup(p: PullState): Child {
  if (p.componentsError) {
    return h('div', { class: 'callout warn' }, h('div', { class: 'callout-title' }, icon('alert'), 'Components could not be read'), h('p', null, `${p.componentsError} Variables still pull as usual.`));
  }
  const plan = p.components;
  if (!plan) return null;
  const reviews = [...p.reviews.filter((r) => !p.done.has(r.componentId)), ...p.done.values()];
  const fresh = plan.components.filter((c) => c.status === 'new');
  const upToDate = plan.components.filter((c) => c.status === 'unchanged' && !p.done.has(c.componentId));
  const problems = plan.problems;
  const out: Child[] = [];
  if (reviews.length) out.push(reviewGroup(p, reviews));
  out.push(
    group(
      fresh.length ? 'New components' : 'Components',
      fresh.length || plan.components.length,
      fresh.length
        ? h(
            'label',
            { class: 'check' },
            h('input', { type: 'checkbox', checked: p.includeComponents, 'data-focus-id': 'pull-components', onChange: (e: Event) => { p.includeComponents = (e.target as HTMLInputElement).checked; render(); } }),
            `Also pull new components (${fresh.length})`,
          )
        : null,
      fresh.length
        ? 'Component sets on a "Components" page, built from the code and bound to these variables. Sets are updated in place on the next pull, never duplicated.'
        : reviews.length
          ? `${upToDate.length ? `Up to date: ${upToDate.map((c) => c.name).join(', ')}.` : ''}`.trim() || 'The other component sets match the code.'
          : 'The component sets in this file match the code.',
      [
        fresh.length
          ? rowList(
              'pull-components',
              fresh.map((c) => h('li', { class: 'row' }, h('div', { class: 'row-head' }, h('span', { class: 'kind added' }, 'New'), h('span', { class: 'comp-name' }, c.name), h('span', { class: 'muted' }, plural(c.variants.length, 'variant'))))),
              10,
            )
          : null,
        problems.length
          ? h(
              'details',
              { class: 'notes' },
              h('summary', null, `Not bound or not drawn (${problems.length})`),
              h('p', { class: 'muted' }, 'Drawn without a variable, or not drawn, because Figma has no equivalent in this version.'),
              h('ul', null, problems.map((x) => h('li', null, problemText(x)))),
            )
          : null,
      ],
    ),
  );
  return out;
}

/** "New brand detected" card: a Brand mode with no file in Git, offered as a new brand (opt-in). */
function newBrandCard(r: PushState, b: PushBrand): HTMLElement {
  const c = b.candidate;
  const plan = b.plan;
  const failing = plan?.contrast.failing ?? [];
  const errors = plan?.issues.filter((i) => i.level === 'error') ?? [];
  const id = `brand-${c.slug}`;
  const result = !plan
    ? null
    : errors.length
      ? h('p', { class: 'brand-result fail' }, icon('alert'), `${plural(errors.length, 'problem')} to fix: ${errors[0]!.message}`)
      : failing.length
        ? h(
            'div',
            { class: 'brand-result fail' },
            h('p', null, icon('alert'), `${plural(failing.length, 'pair')} fail${failing.length === 1 ? 's' : ''}`),
            h(
              'ul',
              null,
              failing.slice(0, 3).map((x) => h('li', null, `${x.fg.replace(/^color\./, '')} on ${x.bg.replace(/^color\./, '')}, ${/theme=([^,]+)/.exec(x.modes)?.[1] ?? ''}: ${x.ratio ?? 'n/a'}:1, needs ${x.min}:1`)),
            ),
          )
        : h('p', { class: 'brand-result ok' }, icon('check'), `All ${plan.contrast.checks} contrast checks pass`);
  return h(
    'section',
    { class: 'brand-card' },
    h('h2', null, `New brand detected: ${c.name}`),
    h('p', { class: 'lede' }, `Mode ${c.name} in the Brand collection has no brand file in Git.`),
    c.blocked
      ? h('p', { class: 'muted' }, c.blocked)
      : [
          h(
            'label',
            { class: 'check' },
            h('input', {
              type: 'checkbox',
              id,
              'data-focus-id': id,
              checked: b.included,
              onChange: (e: Event) => {
                if ((e.target as HTMLInputElement).checked) r.includeBrands.add(c.slug);
                else r.includeBrands.delete(c.slug);
                refreshProposals();
              },
            }),
            'Create it in this pull request',
          ),
          b.included && plan ? h('p', { class: 'muted' }, `Adds ${plan.files.filter((f) => f.action === 'create' && f.path.endsWith('.tokens.json')).map((f) => f.path.split('/').slice(-2).join('/')).join(', ')} and lists ${c.slug} in bridge.config.json. Tier 3: a design owner and a tech owner approve.`) : null,
          b.included ? result : null,
        ],
  );
}

// ---------------------------------------------------------------------------------------------
// Components: requests (GitHub issues), never a pull request from Figma

const kindName = (k: RequestKind) => REQUEST_KINDS.find((x) => x.value === k)?.label ?? 'Other';

function attachHint(): string {
  const f = state.push?.form;
  const sel = state.selection;
  if (f?.item) return sel ? `Attaches ${sel.name} if it is a variant of ${f.item.figmaName}, otherwise the whole component.` : `Nothing selected: attaches the whole component. Select a variant to attach only it.`;
  return sel ? `Attaches ${sel.name}.` : 'Select a layer in Figma to attach it.';
}

function openForm(r: PushState, item: ComponentChangeItem | undefined): void {
  const coded = r.components?.coded ?? [];
  const draft: RequestDraft = item
    ? { component: item.component, kind: item.kind, title: suggestTitle(item), summary: '', changes: item.changes, nodeId: item.nodeId, nodeName: item.figmaName }
    : { component: coded[0] ?? '', kind: 'visual', title: '', summary: '', changes: [], nodeId: state.selection?.nodeId, nodeName: state.selection?.name };
  r.form = { key: item?.nodeId ?? 'manual', item, draft, attach: item ? true : !!state.selection };
  void request('selection', {}).then((sel) => {
    state.selection = sel;
    render();
  });
  render();
}

function sendRequest(r: PushState): void {
  const f = r.form;
  if (!f) return;
  const d = f.draft;
  f.error = !d.component.trim() ? 'Pick the component this request is about.' : !d.title.trim() ? 'Add a title.' : !d.summary.trim() ? 'Add a summary: say what should change and why.' : undefined;
  if (f.error) {
    render();
    document.getElementById(d.summary.trim() ? 'req-title' : 'req-summary')?.focus();
    return;
  }
  void run(
    'Sending the request',
    async () => {
      const a = r.analysis;
      const images: string[] = [];
      if (f.attach) {
        const img = await request('export-image', { nodeId: f.item?.nodeId });
        if (img) images.push(img.base64);
      }
      // Manual requests point at the selection they attach, when there is one.
      const sel = !f.item && f.attach ? state.selection : null;
      const draft = sel ? { ...d, nodeId: sel.nodeId, nodeName: sel.name } : f.item ? d : { ...d, nodeId: undefined, nodeName: undefined };
      const coded = (r.components?.coded ?? []).includes(d.component.trim());
      const res = await sendComponentRequest(getClient(), {
        request: toRequest(draft, { fileKey: r.fileKey }),
        images,
        baseBranch: state.init!.settings.branch,
        config: a.headFiles.config,
        coded,
      });
      r.sent.unshift({ component: d.component.trim(), number: res.issue.number, url: res.issue.url });
      r.form = undefined;
      // The request is the new reference: the next scan compares against what was just asked for.
      if (f.item) {
        const done = f.item.nodeId;
        if (r.components) {
          r.components.changed = r.components.changed.filter((x) => x.nodeId !== done);
          r.components.candidates = r.components.candidates.filter((x) => x.nodeId !== done);
        }
        await request('rebaseline', { nodeId: done }).catch(() => undefined);
      }
      void request('notify', { message: `Request #${res.issue.number} opened` });
    },
    () => sendRequest(r),
  );
}

function changeLines(changes: { field: string; before?: string | undefined; after?: string | undefined }[], head: [string, string, string] = ['What', 'Now', 'Requested']): Child {
  if (!changes.length) return null;
  return h(
    'table',
    { class: 'changes' },
    h('thead', null, h('tr', null, head.map((x) => h('th', null, x)))),
    h(
      'tbody',
      null,
      changes.map((c) =>
        h(
          'tr',
          null,
          h('td', null, c.field),
          h('td', { class: 'mono before' }, c.before || 'none'),
          h('td', { class: 'mono' }, c.after || 'removed'),
        ),
      ),
    ),
  );
}

function requestFormView(r: PushState, f: RequestForm): HTMLElement {
  const d = f.draft;
  const coded = r.components?.coded ?? [];
  const manual = !f.item;
  return h(
    'div',
    { class: 'req-form', role: 'group', 'aria-label': 'Request' },
    manual
      ? h(
          'label',
          { class: 'field' },
          h('span', null, 'Component'),
          coded.length
            ? h(
                'select',
                { 'data-focus-id': 'req-component', onChange: (e: Event) => (d.component = (e.target as HTMLSelectElement).value) },
                coded.map((c) => h('option', { value: c, selected: c === d.component }, c)),
              )
            : h('input', { type: 'text', value: d.component, placeholder: 'Button', onInput: (e: Event) => (d.component = (e.target as HTMLInputElement).value) }),
        )
      : null,
    h(
      'label',
      { class: 'field' },
      h('span', null, 'Kind'),
      h(
        'select',
        { 'data-focus-id': 'req-kind', onChange: (e: Event) => (d.kind = (e.target as HTMLSelectElement).value as RequestKind) },
        REQUEST_KINDS.filter((k) => manual ? k.value !== 'new-component' : true).map((k) => h('option', { value: k.value, selected: k.value === d.kind }, k.label)),
      ),
      h('small', null, REQUEST_KINDS.find((k) => k.value === d.kind)?.hint ?? ''),
    ),
    h(
      'label',
      { class: 'field' },
      h('span', null, 'Title'),
      h('input', { type: 'text', id: 'req-title', 'data-focus-id': 'req-title', value: d.title, maxlength: '100', placeholder: 'Add a danger ghost variant', onInput: (e: Event) => (d.title = (e.target as HTMLInputElement).value) }),
    ),
    h(
      'label',
      { class: 'field' },
      h('span', null, 'Summary'),
      h(
        'textarea',
        {
          id: 'req-summary',
          'data-focus-id': 'req-summary',
          rows: '3',
          required: true,
          'aria-invalid': f.error && !d.summary.trim() ? 'true' : undefined,
          placeholder: manual ? 'What should change, and why. The diff cannot see this one, so be specific.' : 'Why this change, and where it is used',
          onInput: (e: Event) => (d.summary = (e.target as HTMLTextAreaElement).value),
        },
        d.summary,
      ),
    ),
    d.changes.length ? h('div', { class: 'field' }, h('span', null, 'Changes'), changeLines(d.changes)) : null,
    h(
      'label',
      { class: 'check' },
      h('input', { type: 'checkbox', id: 'attach-box', checked: f.attach, disabled: manual && !state.selection, onChange: (e: Event) => (f.attach = (e.target as HTMLInputElement).checked) }),
      manual ? 'Attach the current selection' : 'Attach the selected variant',
    ),
    h('small', { id: 'attach-hint', class: 'attach-hint' }, attachHint()),
    f.error ? h('p', { class: 'form-error', role: 'alert' }, icon('alert'), f.error) : null,
    h(
      'div',
      { class: 'inline-actions' },
      h('button', { class: 'btn primary', disabled: !!state.busy, onClick: () => sendRequest(r) }, 'Send request'),
      h('button', { class: 'btn ghost', onClick: () => { r.form = undefined; render(); } }, 'Cancel'),
    ),
  );
}

function componentRow(r: PushState, item: ComponentChangeItem, action: string, edge?: { lead?: Child; tail?: Child }): HTMLElement {
  const open = r.form?.key === item.nodeId;
  return h(
    'li',
    { class: 'row' },
    h(
      'div',
      { class: 'row-head' },
      edge?.lead,
      h('span', { class: `kind ${item.kind === 'new-component' ? 'added' : ''}` }, kindName(item.kind)),
      h('span', { class: 'comp-name' }, item.component),
      item.figmaName !== item.component ? h('span', { class: 'muted' }, item.figmaName) : null,
      edge ? edge.tail : open ? null : h('button', { class: 'btn ghost row-action', 'data-focus-id': `req-${item.nodeId}`, onClick: () => openForm(r, item) }, action),
    ),
    open ? requestFormView(r, r.form!) : changeLines(item.changes),
  );
}

// ---------------------------------------------------------------------------------------------
// Push: the Changes list, like Figma's Publish library dialog

const itemOf = (r: PushState, key: string) => r.items.find((i) => i.key === key);

/** The checkbox at the start of a change row: checked items are sent, unchecked ones stay in Figma. */
function selectBox(r: PushState, item: PublishItem | undefined, name: string): Child {
  if (!item) return null;
  return h('input', {
    type: 'checkbox',
    class: 'select',
    'data-focus-id': `sel-${item.key}`,
    'aria-label': `Include ${name}`,
    checked: isChecked(r.unchecked, item),
    onChange: (e: Event) => {
      if ((e.target as HTMLInputElement).checked) r.unchecked.delete(item.key);
      else r.unchecked.add(item.key);
      refreshProposals();
    },
  });
}

/** Neutral tag plus the row menu ("Mark as experimental", like Figma's "Hide when publishing"). */
function rowTail(r: PushState, item: PublishItem | undefined, name: string, extra: { label: string; onClick: () => void }[] = []): Child {
  if (!item) return null;
  const actions = [
    item.experimental
      ? { label: 'Remove experimental mark', onClick: () => markExperimental(r, item, false) }
      : { label: 'Mark as experimental', onClick: () => markExperimental(r, item, true) },
    ...extra,
  ];
  return [
    item.experimental ? h('span', { class: 'tag', title: 'Unchecked by default on every push. You can still check it.' }, 'Experimental') : null,
    h(
      'details',
      { class: 'row-menu' },
      h('summary', { class: 'btn ghost icon-only', 'data-focus-id': `menu-${item.key}`, 'aria-label': `More actions for ${name}`, title: 'More actions' }, icon('more')),
      h(
        'div',
        { class: 'menu', role: 'menu' },
        actions.map((x) => h('button', { class: 'menu-item', role: 'menuitem', onClick: (e: Event) => { (e.currentTarget as HTMLElement).closest('details')?.removeAttribute('open'); x.onClick(); } }, x.label)),
      ),
    ),
  ];
}

/** One group of the Changes list: a select-all checkbox with the group name and count, one sentence, the rows. */
function changeGroup(r: PushState, kind: 'variable' | 'component', title: string, lede: string, rows: HTMLElement[], key: string): Child {
  const st = groupState(r.items, r.unchecked, kind);
  if (st === 'empty') return null;
  const n = r.items.filter((i) => i.kind === kind).length;
  const on = r.items.filter((i) => i.kind === kind && isChecked(r.unchecked, i)).length;
  const box = h('input', {
    type: 'checkbox',
    'data-focus-id': `all-${kind}`,
    checked: st === 'all',
    onChange: (e: Event) => {
      setGroup(r.items, r.unchecked, kind, (e.target as HTMLInputElement).checked);
      refreshProposals();
    },
  }) as HTMLInputElement;
  box.indeterminate = st === 'some';
  return h(
    'section',
    { class: 'group' },
    h('div', { class: 'group-head' }, h('label', { class: 'check group-check' }, box, h('h2', null, title, h('span', { class: 'group-n' }, on === n ? String(n) : `${on} of ${n}`)))),
    h('p', { class: 'lede' }, lede),
    rowList(key, rows, kind === 'component' ? 20 : PAGE),
  );
}

function variablesGroup(r: PushState): Child {
  const a = r.analysis;
  const fi = figmaIndex(a);
  const after = r.proposal.validation.contrastAfter;
  const before = r.proposal.validation.contrastBefore;
  const rows = a.diff.local.map((e) => {
    const item = itemOf(r, variableKey(e.id));
    const name = (e.figma ?? e.head ?? e.base)?.path ?? e.path;
    return diffRow(a, e.local!.kind, { before: e.head ?? e.base, after: e.figma, beforeIndex: a.head.byPath, afterIndex: fi }, isChecked(r.unchecked, item ?? { key: '' }) ? contrastPills(e.head, e.figma, after, before) : null, {
      lead: selectBox(r, item, name),
      tail: rowTail(r, item, name),
    });
  });
  if (!rows.length) return null;
  return changeGroup(r, 'variable', 'Variables', `Checked edits go into one pull request. Unchecked ones stay in Figma for a later push.`, rows, 'push-local');
}

function componentChangesGroup(r: PushState): Child {
  const changed = r.components?.changed ?? [];
  if (!changed.length) return null;
  const rows = changed.map((item) => {
    const pi = itemOf(r, componentKey(item.nodeId));
    return componentRow(r, item, '', {
      lead: selectBox(r, pi, item.component),
      tail: r.form?.key === item.nodeId ? null : rowTail(r, pi, item.component, [{ label: 'Edit and send on its own', onClick: () => openForm(r, item) }]),
    });
  });
  return changeGroup(r, 'component', 'Components', 'Components need code: each checked change becomes a request (a GitHub issue) for the team. Unchecked ones are not sent.', rows, 'push-components');
}

/** Requests that are not part of the push: sent ones, the manual request, components not in the design system yet. */
function requestsSection(r: PushState): Child {
  const scan = r.components;
  const candidates = scan?.candidates ?? [];
  const manualOpen = r.form?.key === 'manual';
  const content: Child[] = [];
  if (r.componentsError) content.push(h('div', { class: 'callout warn' }, h('div', { class: 'callout-title' }, icon('alert'), 'Components could not be read'), h('p', null, r.componentsError)));
  for (const s of r.sent) {
    content.push(
      h(
        'div',
        { class: 'callout ok', role: 'status' },
        h('div', { class: 'callout-title' }, icon('check'), `Request #${s.number} opened for ${s.component}`),
        h('div', { class: 'inline-actions' }, h('button', { class: 'btn', onClick: () => void request('open-url', { url: s.url }) }, icon('external'), 'Open on GitHub')),
      ),
    );
  }
  if (manualOpen) content.push(h('div', { class: 'rows manual' }, h('div', { class: 'row' }, h('div', { class: 'row-head' }, h('span', { class: 'kind' }, 'Manual'), h('span', { class: 'comp-name' }, 'Request a component change')), requestFormView(r, r.form!))));
  if (scan && !scan.changed.length) content.push(h('p', { class: 'muted' }, scan.figmaOnly.length ? 'Figma-only component changes, nothing to send.' : 'No component changes to request.'));
  if (scan?.figmaOnly.length) content.push(h('p', { class: 'muted' }, `Layers or auto layout changed in ${scan.figmaOnly.join(', ')}, with the same props, variants, tokens and look. That stays in Figma.`));
  if (scan?.explained.length) content.push(h('p', { class: 'muted' }, `${scan.explained.join(', ')} look${scan.explained.length === 1 ? 's' : ''} different because of variable edits. Those go in the variables pull request, not in a request.`));
  if (candidates.length) {
    content.push(
      h(
        'details',
        { class: 'notes candidates', open: candidates.some((c) => r.form?.key === c.nodeId) },
        h('summary', null, `Not in the design system yet (${candidates.length})`),
        h('p', { class: 'muted' }, `Components in this file with no folder in ${scan?.coded.length ? 'the code' : 'code'}. Nothing is sent unless you ask for it.`),
        h('ul', { class: 'rows' }, candidates.map((item) => componentRow(r, item, 'Request as new component'))),
      ),
    );
  }
  return h(
    'section',
    { class: 'group components' },
    h(
      'div',
      { class: 'group-head' },
      h('h2', null, 'Requests'),
      manualOpen ? null : h('button', { class: 'btn ghost', 'data-focus-id': 'req-manual', onClick: () => openForm(r, undefined) }, 'Request a component change'),
    ),
    h('p', { class: 'lede' }, 'For what the scan cannot see: behavior, a bug, an idea, or a component that is not in code yet.'),
    content,
  );
}

function viewPush(): View {
  const init = state.init!;
  if (!init.hasToken) return needToken();
  const r = state.push;
  if (!r) {
    return {
      body: [intro({
        title: 'Push your edits for review',
        text: `Variable edits go to ${init.settings.branch} as a pull request, never straight in. Component changes become requests for the team.`,
        meta: `To ${init.settings.repo}, for review by design and tech owners.`,
        art: 'paint',
      }), steps([
        ['Edit in Figma', 'Change synced variables, or change a component: a variant, a prop, the token a part uses.'],
        ['Review the changes', 'Every change is listed and checked. Uncheck what is not ready; mark work in progress as experimental.'],
        ['Push for review', `Checked variables open a pull request; checked components open requests (GitHub issues). Nothing reaches ${init.settings.branch} until owners approve.`],
      ])],
      bar: { label: 'Scan for changes', onClick: () => scanPush() },
    };
  }
  const a = r.analysis;
  const prop = r.proposal;

  if (r.result) {
    const res = r.result;
    const pr = res.pr;
    const text = [
      pr ? `${pr.appended ? `Commit added to pull request #${pr.pr.number}` : `Pull request #${pr.pr.number} opened as a draft`} on ${pr.branch}. CI runs the usual checks, then a design owner and a tech owner approve.` : '',
      res.requests.length ? `${plural(res.requests.length, 'request')} opened for ${res.requests.map((x) => x.component).join(', ')}.` : '',
      prop.held.length ? `${plural(prop.held.length, 'unchecked variable edit')} stay${prop.held.length === 1 ? 's' : ''} in Figma.` : '',
    ].filter(Boolean);
    const first = pr?.pr.url ?? res.requests[0]?.url;
    return {
      body: [
        intro({ title: 'Pushed for review', text: text.join(' '), meta: pr ? h('span', { class: 'url' }, pr.pr.url) : undefined, art: 'review' }),
        res.failed.length ? issueList('error', 'Not sent', res.failed.map((f) => ({ code: 'file-problem', severity: 'error', message: `${f.component}: ${f.error}` }))) : null,
        requestsSection(r),
      ],
      bar: first
        ? { label: 'Open on GitHub', onClick: () => void request('open-url', { url: first }), secondary: { label: 'Scan again', onClick: () => scanPush() } }
        : { label: 'Scan again', onClick: () => scanPush() },
    };
  }

  const suggestions = a.suggestions.filter((s) => !r.dismissed.has(s.figmaId));
  const compChanges = r.components?.changed ?? [];
  const nothing = !a.diff.local.length && !a.diff.conflicts.length && !a.newBrands.length && !compChanges.length;
  const before = prop.validation.contrastBefore;
  const after = prop.validation.contrastAfter;
  const beforeByKey = new Map(before.map((x) => [pairKey(x), x]));
  // Failures first, then the biggest moves.
  const delta = (x: ContrastResult) => Math.abs((x.ratio ?? 0) - (beforeByKey.get(pairKey(x))?.ratio ?? 0));
  const changedContrast = after
    .filter((x) => beforeByKey.get(pairKey(x))?.ratio !== x.ratio)
    .sort((x, y) => Number(y.level === 'fail') - Number(x.level === 'fail') || delta(y) - delta(x));
  const contrastKey = 'push-contrast';
  const contrastShown = state.expanded.has(contrastKey) ? changedContrast : changedContrast.slice(0, 8);
  const checked = r.items.filter((i) => isChecked(r.unchecked, i));
  const checkedVars = checked.filter((i) => i.kind === 'variable').length;
  const checkedComps = checked.filter((i) => i.kind === 'component').length;
  const newBrands = prop.brands.filter((b) => b.plan).length;
  const prFiles = Object.keys(prop.files).length + prop.brandFiles.length;

  const body: Child[] = [];
  if (!nothing) {
    // Summary first: what goes for review and whether contrast holds, in the screen's one Harbor zone.
    const fails = changedContrast.filter((x) => x.level === 'fail').length;
    const n = r.items.length;
    body.push(
      h(
        'section',
        { class: 'zone' },
        h('h2', { class: 'headline' }, n ? `${plural(n, 'change')} to publish for review` : 'A new brand to propose'),
        h(
          'p',
          { class: 'muted' },
          fails
            ? `${plural(fails, 'contrast pair')} fail${fails === 1 ? 's' : ''}. Fix ${fails === 1 ? 'it' : 'them'} or uncheck the edit before pushing.`
            : changedContrast.length
              ? `All ${plural(changedContrast.length, 'contrast pair')} the checked edits move still pass.`
              : `Nothing reaches ${init.settings.branch} until owners approve.`,
        ),
      ),
    );
  }
  if (suggestions.length) {
    body.push(
      h(
        'section',
        null,
        h('h2', null, 'Renamed?'),
        h('p', { class: 'lede' }, 'These look like renames (same type and value). Confirm so reviewers see a rename instead of a delete and an add.'),
        h(
          'ul',
          { class: 'rows' },
          suggestions.map((s) =>
            h(
              'li',
              { class: 'row' },
              h('div', { class: 'row-head' }, h('span', { class: 'path' }, h('span', { class: 'path-old' }, s.fromPath), icon('arrow'), s.toPath)),
              h(
                'div',
                { class: 'inline-actions' },
                h('button', { class: 'btn', onClick: () => scanPush({ ...r, confirmed: [...r.confirmed, s] }) }, 'It is a rename'),
                h('button', { class: 'btn ghost', onClick: () => { r.dismissed.add(s.figmaId); render(); } }, 'Different tokens'),
              ),
            ),
          ),
        ),
      ),
    );
  }
  if (nothing) {
    body.push(h('div', { class: 'empty' }, h('h2', null, 'Nothing to push'), h('p', null, `Your variables and components match ${init.settings.branch}.`)));
  }
  for (const b of prop.brands) body.push(newBrandCard(r, b));
  if (r.items.length) body.push(h('h2', { class: 'section-title' }, 'Changes'));
  body.push(variablesGroup(r));
  body.push(
    conflictSection(a, r.choices, (e) => {
      const item = itemOf(r, variableKey(e.id));
      return { lead: selectBox(r, item, e.path), tail: rowTail(r, item, e.path) };
    }),
  );
  body.push(componentChangesGroup(r));
  if (a.diff.remote.length) {
    body.push(h('p', { class: 'muted' }, `${plural(a.diff.remote.length, 'token')} changed on main since your last pull. The pull request keeps main's version; pull to see them here.`));
  }
  if (changedContrast.length) {
    body.push(
      h(
        'section',
        null,
        h('h2', null, 'Contrast'),
        h('p', { class: 'lede' }, 'Pairs from contrast.checks.json whose ratio moves with the checked edits, in every brand and theme.'),
        h(
          'table',
          { class: 'contrast' },
          h('thead', null, h('tr', null, h('th', null, 'Pair'), h('th', null, 'Brand and theme'), h('th', { class: 'num' }, 'Before'), h('th', { class: 'num' }, 'After'), h('th', null, 'WCAG'))),
          h(
            'tbody',
            null,
            contrastShown.map((x) =>
              h(
                'tr',
                null,
                h('td', { class: 'pair' }, breakable(x.pair.foreground.replace(/^color\./, '')), ' on ', breakable(x.pair.background.replace(/^color\./, ''))),
                h('td', null, contextLabel(x)),
                h('td', { class: 'num' }, String(beforeByKey.get(pairKey(x))?.ratio ?? 'n/a')),
                h('td', { class: 'num' }, String(x.ratio ?? 'n/a')),
                h('td', null, h('span', { class: `pill ${x.level}`, title: `Needs ${x.pair.min}:1` }, h('strong', null, x.level === 'fail' ? 'Fails' : (x.level ?? 'n/a')))),
              ),
            ),
          ),
        ),
        changedContrast.length > contrastShown.length
          ? h('button', { class: 'btn ghost more', onClick: () => { state.expanded.add(contrastKey); render(); } }, `Show all ${changedContrast.length} pairs`)
          : null,
      ),
    );
  }
  if (prFiles) body.push(issueList('error', 'Fix before sending', prop.validation.blocking));
  body.push(issueList('warn', 'Warnings (not blocking)', prop.validation.warnings));
  if (!nothing) {
    body.push(
      h(
        'section',
        null,
        h(
          'label',
          { class: 'field' },
          h('span', null, 'Description'),
          h('textarea', {
            rows: '3',
            'data-focus-id': 'push-description',
            placeholder: 'What changed and why. It opens the pull request and every request.',
            onInput: (e: Event) => (r.description = (e.target as HTMLTextAreaElement).value),
          }, r.description),
        ),
        prFiles && r.openPr
          ? h(
              'label',
              { class: 'check' },
              h('input', { type: 'checkbox', checked: r.appendToOpen, onChange: (e: Event) => { r.appendToOpen = (e.target as HTMLInputElement).checked; render(); } }),
              `Add to open pull request #${r.openPr.number}`,
            )
          : null,
        prFiles
          ? h(
              'details',
              { class: 'notes' },
              h('summary', null, 'Pull request title'),
              h('input', { type: 'text', 'aria-label': 'Pull request title', value: r.title, placeholder: prop.changes.length ? defaultTitle(prop.changes) : prop.brands.find((b) => b.plan)?.plan?.title ?? '', maxlength: '120', onInput: (e: Event) => (r.title = (e.target as HTMLInputElement).value) }),
            )
          : null,
        h(
          'p',
          { class: 'muted' },
          [
            prFiles ? `${plural(prFiles, 'file')} change in one commit, with a changeset. Token changes are risk tier 3: a design owner and a tech owner both approve.` : '',
            checkedComps ? `${plural(checkedComps, 'request')} for the team, with the component attached.` : '',
          ].filter(Boolean).join(' '),
        ),
      ),
    );
  }
  body.push(requestsSection(r));
  body.push(notes(a));

  const blocked = prFiles ? prop.validation.blocking.length : 0;
  const open = prop.unresolvedConflicts.length;
  const none = !prFiles && !checkedComps;
  const hint = open
    ? `Decide ${plural(open, 'conflict')} first`
    : blocked
      ? `Fix ${plural(blocked, 'problem')} first`
      : none
        ? 'Nothing checked'
        : [checkedVars ? plural(checkedVars, 'variable') : '', newBrands ? plural(newBrands, 'new brand') : '', checkedComps ? plural(checkedComps, 'component') : ''].filter(Boolean).join(', ');
  return {
    body,
    bar: nothing
      ? { label: 'Scan again', onClick: () => scanPush(r) }
      : {
          label: prFiles && r.appendToOpen && r.openPr ? `Push to pull request #${r.openPr.number}` : 'Push for review',
          onClick: submitPush,
          disabled: !!open || !!blocked || none,
          hint,
          secondary: { label: 'Scan again', onClick: () => scanPush(r) },
        },
  };
}

function viewSettings(): View {
  const d = state.settingsDraft;
  const init = state.init!;
  const field = (label: string, key: keyof RepoSettings, hint: string, placeholder: string) =>
    h(
      'label',
      { class: 'field' },
      h('span', null, label),
      h('input', { type: 'text', value: d[key], placeholder, spellcheck: 'false', autocomplete: 'off', onInput: (e: Event) => (d[key] = (e.target as HTMLInputElement).value) }),
      h('small', null, hint),
    );
  return {
    body: [
      init.hasToken ? null : intro({ title: 'Connect your repository', text: 'Point DS Bridge at the repository that holds your token files, then paste a token. Nothing is written until you push.', art: 'guide' }),
      h(
        'section',
        { class: 'card' },
        h('h2', null, 'Where the tokens live'),
        field('Repository', 'repo', 'Owner and name, as in the GitHub URL.', 'owner/name'),
        field('Base branch', 'branch', 'Pulls read from it; pull requests target it.', 'main'),
        field('Tokens folder', 'tokensPath', 'Folder that holds the *.tokens.json files.', 'packages/tokens/src'),
      ),
      h(
        'section',
        { class: 'card' },
        h('div', { class: 'group-head' }, h('h2', null, 'GitHub token'), init.hasToken ? null : h('button', { class: 'btn ghost', onClick: () => void request('open-url', { url: 'https://github.com/settings/personal-access-tokens/new' }) }, 'Create one on GitHub')),
        h(
          'p',
          { class: 'lede' },
          init.hasToken
            ? 'A token is saved on this computer. Paste a new one to replace it.'
            : 'Create a fine-grained personal access token for this repository only, with "Contents", "Pull requests" and "Issues" set to "Read and write".',
        ),
        h(
          'label',
          { class: 'field' },
          h('span', null, 'Fine-grained token'),
          h('input', {
            type: 'password',
            value: '',
            autocomplete: 'off',
            spellcheck: 'false',
            placeholder: init.hasToken ? 'Saved, hidden' : 'github_pat_...',
            onInput: (e: Event) => (state.tokenDraft = (e.target as HTMLInputElement).value),
          }),
          h('small', null, 'Kept in Figma client storage on this computer. Never shown again and never written into the file.'),
        ),
        init.hasToken ? h('div', { class: 'inline-actions' }, h('button', { class: 'btn ghost danger', onClick: removeToken }, 'Remove token')) : null,
      ),
      state.settingsMessage
        ? h(
            'div',
            { class: `callout ${state.settingsMessage.kind === 'ok' ? 'ok' : 'error'}`, role: state.settingsMessage.kind === 'error' ? 'alert' : 'status' },
            h('div', { class: 'callout-title' }, icon(state.settingsMessage.kind === 'ok' ? 'check' : 'alert'), state.settingsMessage.text),
          )
        : null,
    ],
    bar: { label: 'Save and check access', onClick: saveSettings },
  };
}

function actionBar(bar: ActionBar | undefined): Child {
  if (!bar && !state.busy) return null;
  // Fitts: a lone action takes the whole bar; with a secondary or a status it stays on the right.
  const lone = !!bar && !bar.secondary && !bar.hint && !state.busy;
  return h(
    'div',
    { class: lone ? 'bar lone' : 'bar' },
    h(
      'div',
      { class: 'bar-status', 'aria-live': 'polite' },
      state.busy ? [h('span', { class: 'spinner', 'aria-hidden': 'true' }), h('span', { id: 'busy-text' }, state.busy)] : bar?.hint ? h('span', null, bar.hint) : null,
    ),
    bar?.secondary ? h('button', { class: 'btn', disabled: !!state.busy, onClick: bar.secondary.onClick }, bar.secondary.label) : null,
    bar ? h('button', { class: 'btn primary', disabled: !!state.busy || !!bar.disabled, onClick: bar.onClick }, bar.label) : null,
  );
}

function render(): void {
  // Keep focus and scroll stable across re-renders.
  const scroller = document.querySelector('main');
  const scrollTop = scroller?.scrollTop ?? 0;
  // Restore focus only when it was keyboard focus: after a mouse click it would draw a ring nobody asked for.
  const active = document.activeElement as HTMLElement | null;
  const focusedId = active?.matches?.(':focus-visible') ? active.dataset?.focusId : undefined;

  if (!state.init) {
    app.replaceChildren(
      h(
        'main',
        null,
        state.error
          ? h('div', { class: 'callout error', role: 'alert' }, h('div', { class: 'callout-title' }, icon('alert'), 'DS Bridge could not start'), h('p', null, state.error.message))
          : h('p', { class: 'muted loading' }, h('span', { class: 'spinner' }), 'Loading'),
      ),
    );
    return;
  }
  const pushCount = state.push && !state.push.result ? state.push.analysis.diff.local.length + state.push.analysis.diff.conflicts.length + (state.push.components?.changed.length ?? 0) : 0;
  const view = state.tab === 'pull' ? viewPull() : state.tab === 'push' ? viewPush() : viewSettings();

  const tabs = h(
    'nav',
    { class: 'tabs', role: 'tablist', 'aria-label': 'DS Bridge' },
    TABS.map((t) =>
      h(
        'button',
        {
          class: 'tab',
          role: 'tab',
          id: `tab-${t.id}`,
          'data-focus-id': `tab-${t.id}`,
          'aria-selected': state.tab === t.id ? 'true' : 'false',
          'aria-controls': 'panel',
          tabindex: state.tab === t.id ? '0' : '-1',
          onClick: () => {
            state.tab = t.id;
            state.error = undefined;
            render();
          },
          onKeyDown: (e: KeyboardEvent) => {
            if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
            const i = TABS.findIndex((x) => x.id === state.tab);
            state.tab = TABS[(i + (e.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length]!.id;
            render();
            document.getElementById(`tab-${state.tab}`)?.focus();
          },
        },
        t.label,
        t.id === 'push' && pushCount ? h('span', { class: 'count', 'aria-label': `${pushCount} changes` }, String(pushCount)) : null,
      ),
    ),
    h('span', { class: 'repo', title: `${state.init.settings.repo}, branch ${state.init.settings.branch}` }, icon('branch'), state.init.settings.branch),
  );

  const error = state.error
    ? h(
        'div',
        { class: 'callout error', role: 'alert' },
        h('div', { class: 'callout-title' }, icon('alert'), state.error.message),
        state.error.retry
          ? h(
              'div',
              { class: 'inline-actions' },
              h('button', { class: 'btn', onClick: () => { const retry = state.error?.retry; state.error = undefined; retry?.(); } }, icon('refresh'), 'Try again'),
            )
          : null,
      )
    : null;

  app.replaceChildren(tabs, h('main', { id: 'panel', role: 'tabpanel', 'aria-labelledby': `tab-${state.tab}`, 'aria-busy': state.busy ? 'true' : 'false' }, error, view.body), ...([actionBar(view.bar)].filter(Boolean) as Node[]));

  const main = document.querySelector('main');
  if (main) main.scrollTop = scrollTop;
  if (focusedId) (document.querySelector(`[data-focus-id="${focusedId}"]`) as HTMLElement | null)?.focus();
}

render();
loadInit()
  .then(() => {
    if (!state.init!.hasToken) state.tab = 'settings';
    render();
  })
  .catch((err: unknown) => {
    state.error = { message: err instanceof Error ? err.message : String(err) };
    render();
  });
