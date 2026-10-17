// DS Bridge UI: three tabs (Pull: code -> Figma, Push: Figma -> code, Settings). Plain TypeScript and DOM, no framework.
// The UI owns network calls and logic; figma.* access goes through request() to the main thread.
// Layout: tabs on top, scrolling content, and an action bar pinned to the bottom that always shows
// what the primary button will do (or why it is disabled).

import type { ConflictChoice, DiffEntry } from '@bridge-ds/core';
import { type Analysis, type PullProposal, type PushBrand, type PushProposal, type PushResult, analyze, buildPull, buildPush, openPullRequest } from '../sync/flows';
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
import { onProgress, request } from './bridge';
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
}

interface PushState {
  analysis: Analysis;
  snapshot: FigmaSnapshot;
  choices: Map<string, ConflictChoice>;
  confirmed: RenameSuggestion[];
  dismissed: Set<string>;
  proposal: PushProposal;
  title: string;
  notes: string;
  openPr: PullRequest | undefined;
  appendToOpen: boolean;
  /** Slugs of new brand candidates the designer chose to create in this pull request (opt-in, see planBrands). */
  includeBrands: Set<string>;
  result?: PushResult | undefined;
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
}

interface ActionBar {
  label: string;
  onClick: () => void;
  disabled?: boolean | undefined;
  hint?: string | undefined;
  secondary?: { label: string; onClick: () => void } | undefined;
}

const state: State = { tab: 'pull', settingsDraft: { repo: '', branch: '', tokensPath: '' }, tokenDraft: '', expanded: new Set() };
let client: GitHubClient | undefined;
const app = document.getElementById('app')!;

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

function diffRow(a: Analysis, kind: string, sides: RowSides, extra?: Child): HTMLElement {
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
      h('span', { class: `kind ${kind}` }, KIND_LABEL[kind] ?? kind),
      renamed
        ? h('span', { class: 'path' }, h('span', { class: 'path-old' }, breakable(sides.before!.path)), icon('arrow'), h('span', null, breakable(sides.after!.path)))
        : h('span', { class: 'path' }, breakable(t.path)),
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

function conflictBlock(a: Analysis, e: DiffEntry, choices: Map<string, ConflictChoice>): HTMLElement {
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
    h('div', { class: 'row-head' }, h('span', { class: 'kind conflict' }, 'Conflict'), h('span', { class: 'path' }, e.path)),
    h('div', { class: 'choices', role: 'radiogroup', 'aria-label': `Version to keep for ${e.path}` }, side('figma', 'Keep Figma', e.figma, fi), side('main', 'Use main', e.head, a.head.byPath)),
  );
}

function conflictSection(a: Analysis, choices: Map<string, ConflictChoice>): Child {
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
    h('ul', { class: 'rows' }, list.map((e) => conflictBlock(a, e, choices))),
  );
}

function refreshProposals(): void {
  if (state.pull) state.pull.proposal = buildPull(state.pull.analysis, state.pull.choices, { overwrite: state.pull.overwrite });
  if (state.push) state.push.proposal = buildPush(state.push.analysis, state.push.choices, state.push.includeBrands);
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

function checkPull(): void {
  void run(
    'Reading main and your variables',
    async () => {
      const snapshot = await request('snapshot', {});
      const analysis = await analyze(getClient(), state.init!.settings, state.init!.sync, snapshot);
      const choices = new Map<string, ConflictChoice>();
      state.pull = { analysis, choices, overwrite: false, proposal: buildPull(analysis, choices) };
      state.expanded.clear();
    },
    checkPull,
  );
}

function applyPull(): void {
  const p = state.pull;
  if (!p) return;
  void run(
    'Writing variables',
    async () => {
      const report = await request('apply-pull', { plan: p.proposal.plan });
      p.report = report;
      await loadInit();
      state.push = undefined;
      void request('notify', { message: `Pulled ${state.init!.settings.branch}: ${report.created} created, ${report.updated} updated.` });
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
      state.push = {
        analysis,
        snapshot,
        choices,
        confirmed,
        dismissed: keep?.dismissed ?? new Set(),
        proposal: buildPush(analysis, choices, includeBrands),
        includeBrands,
        title: keep?.title ?? '',
        notes: keep?.notes ?? '',
        openPr,
        appendToOpen: keep?.appendToOpen ?? !!openPr,
      };
      state.expanded.clear();
    },
    () => scanPush(keep),
  );
}

function submitPr(): void {
  const r = state.push;
  if (!r) return;
  void run(
    r.appendToOpen && r.openPr ? 'Adding a commit to the pull request' : 'Opening the pull request',
    async () => {
      const result = await openPullRequest(getClient(), r.analysis, r.proposal, {
        title: r.title,
        notes: r.notes,
        fileName: state.init!.fileName,
        appendTo: r.appendToOpen ? r.openPr : undefined,
      });
      r.result = result;
      // The PR exists now; local bookkeeping failures must not hide that.
      try {
        if (result.tags.length) await request('tag-variables', { tags: result.tags });
        await request('save-sync', { sync: { lastPrBranch: result.branch, lastPrUrl: result.pr.url } });
        await loadInit();
      } catch (err) {
        state.error = { message: `The pull request was created, but saving its link in this file failed: ${err instanceof Error ? err.message : String(err)}` };
      }
      void request('notify', { message: `Pull request #${result.pr.number} ${result.appended ? 'updated' : 'opened'}` });
    },
    submitPr,
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
          throw new Error(`This token can read ${info.fullName} but cannot write to it. Give it "Contents: Read and write" and "Pull requests: Read and write".`);
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
  const upToDate = !remote.length && !a.diff.conflicts.length && !prop.restored.length && !!a.baseSha;

  if (p.report) {
    const r = p.report;
    return {
      body: [
        intro({
          title: r.errors.length ? 'Pulled, with problems' : 'Figma is up to date',
          text: `${plural(r.created, 'variable')} created, ${r.updated} updated${r.orphaned ? `, ${r.orphaned} flagged as orphan` : ''}.${prop.kept.length ? ` ${plural(prop.kept.length, 'Figma edit')} kept: send them from Push.` : ''}`,
          meta: r.layout === 'single-collection' ? 'Themes are modes of the Semantic collection.' : 'This file allows one mode per collection, so each theme has its own Semantic collection.',
          art: r.errors.length ? 'fix' : 'tokens',
        }),
        r.errors.length
          ? h(
              'section',
              { class: 'group' },
              h('div', { class: 'group-head' }, h('h2', null, 'Problems', h('span', { class: 'group-n' }, String(r.errors.length)))),
              h('p', { class: 'lede' }, 'Nothing else was skipped. Fix these in code or pull again.'),
              rowList('pull-errors', r.errors.map((e) => h('li', { class: 'row' }, h('p', null, e))), 5),
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
  if (prop.skipped.length) body.push(issueList('warn', 'Not written', prop.skipped.map((s) => ({ code: 'file-problem', severity: 'warning', message: `${s.path}: ${s.reason}` }))));
  body.push(notes(a));

  const open = prop.unresolvedConflicts.length;
  return {
    body,
    bar: upToDate
      ? { label: 'Check again', onClick: checkPull }
      : {
          label: `Apply to Figma`,
          onClick: applyPull,
          disabled: open > 0,
          hint: open ? `Decide ${plural(open, 'conflict')} first` : `${plural(prop.plan.variables.length, 'variable')}${prop.plan.orphans.length ? `, ${prop.plan.orphans.length} orphaned` : ''}`,
          secondary: { label: 'Check again', onClick: checkPull },
        },
  };
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

function viewPush(): View {
  const init = state.init!;
  if (!init.hasToken) return needToken();
  const r = state.push;
  if (!r) {
    return {
      body: [intro({
        title: 'Send your edits for review',
        text: `Your variable edits go to ${init.settings.branch} as a pull request, never straight in.`,
        meta: `To ${init.settings.repo}, for review by design and tech owners.`,
        art: 'paint',
      }), steps([
        ['Edit in Figma', 'Change values, aliases, names or descriptions of synced variables.'],
        ['Scan', 'See each change with its swatches and the contrast it moves. Failing pairs block the push.'],
        ['Open a pull request', `A draft on its own branch. Nothing reaches ${init.settings.branch} until owners approve.`],
      ])],
      bar: { label: 'Scan for changes', onClick: () => scanPush() },
    };
  }
  const a = r.analysis;
  const prop = r.proposal;
  const fi = figmaIndex(a);

  if (r.result) {
    const res = r.result;
    return {
      body: intro({
        title: res.appended ? `Commit added to pull request #${res.pr.number}` : `Pull request #${res.pr.number} opened`,
        text: `On branch ${res.branch}, as a draft. CI runs the usual checks, then a design owner and a tech owner approve.`,
        meta: h('span', { class: 'url' }, res.pr.url),
        art: 'review',
      }),
      bar: {
        label: 'Open on GitHub',
        onClick: () => void request('open-url', { url: res.pr.url }),
        secondary: { label: 'Scan again', onClick: () => scanPush() },
      },
    };
  }

  const suggestions = a.suggestions.filter((s) => !r.dismissed.has(s.figmaId));
  const nothing = !a.diff.local.length && !a.diff.conflicts.length && !a.newBrands.length;
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

  const body: Child[] = [];
  if (!nothing) {
    // Summary first: what goes to main and whether contrast holds, in the screen's one Harbor zone.
    const fails = changedContrast.filter((x) => x.level === 'fail').length;
    const n = a.diff.local.length + a.diff.conflicts.length;
    body.push(
      h(
        'section',
        { class: 'zone' },
        h('h2', { class: 'headline' }, n ? `${plural(n, 'change')} to propose to ${init.settings.branch}` : 'A new brand to propose'),
        h(
          'p',
          { class: 'muted' },
          fails
            ? `${plural(fails, 'contrast pair')} fail${fails === 1 ? 's' : ''}. Fix ${fails === 1 ? 'it' : 'them'} before pushing.`
            : changedContrast.length
              ? `All ${plural(changedContrast.length, 'contrast pair')} it moves still pass. Opens a draft pull request for review.`
              : 'Opens a draft pull request for review.',
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
    body.push(h('div', { class: 'empty' }, h('h2', null, 'Nothing to propose'), h('p', null, `Your variables match ${init.settings.branch}.`)));
  }
  for (const b of prop.brands) body.push(newBrandCard(r, b));
  if (a.diff.local.length) {
    body.push(
      h(
        'section',
        null,
        h('h2', null, `Your changes (${a.diff.local.length})`),
        rowList(
          'push-local',
          a.diff.local.map((e) => diffRow(a, e.local!.kind, { before: e.head ?? e.base, after: e.figma, beforeIndex: a.head.byPath, afterIndex: fi }, contrastPills(e.head, e.figma, after, before))),
        ),
      ),
    );
  }
  body.push(conflictSection(a, r.choices));
  if (a.diff.remote.length) {
    body.push(h('p', { class: 'muted' }, `${plural(a.diff.remote.length, 'token')} changed on main since your last pull. The pull request keeps main's version; pull to see them here.`));
  }
  if (changedContrast.length) {
    body.push(
      h(
        'section',
        null,
        h('h2', null, 'Contrast'),
        h('p', { class: 'lede' }, 'Pairs from contrast.checks.json whose ratio moves with this change, in every brand and theme.'),
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
  body.push(issueList('error', 'Fix before sending', prop.validation.blocking));
  body.push(issueList('warn', 'Warnings (not blocking)', prop.validation.warnings));
  if (!nothing) {
    body.push(
      h(
        'section',
        null,
        h('h2', null, 'Pull request'),
        h(
          'label',
          { class: 'field' },
          h('span', null, 'Title'),
          h('input', { type: 'text', value: r.title, placeholder: prop.changes.length ? defaultTitle(prop.changes) : prop.brands.find((b) => b.plan)?.plan?.title ?? defaultTitle(prop.changes), maxlength: '120', onInput: (e: Event) => (r.title = (e.target as HTMLInputElement).value) }),
        ),
        h(
          'label',
          { class: 'field' },
          h('span', null, 'Why this change (optional)'),
          h('textarea', { rows: '3', placeholder: 'For example: raise contrast of secondary text on subtle backgrounds', onInput: (e: Event) => (r.notes = (e.target as HTMLTextAreaElement).value) }, r.notes),
        ),
        r.openPr
          ? h(
              'label',
              { class: 'check' },
              h('input', { type: 'checkbox', checked: r.appendToOpen, onChange: (e: Event) => { r.appendToOpen = (e.target as HTMLInputElement).checked; render(); } }),
              `Add to open pull request #${r.openPr.number}`,
            )
          : null,
        h('p', { class: 'muted' }, `${plural(Object.keys(prop.files).length + prop.brandFiles.length, 'file')} change in one commit, with a changeset. Token changes are risk tier 3: a design owner and a tech owner both approve.`),
      ),
    );
  }
  body.push(notes(a));

  const blocked = prop.validation.blocking.length;
  const open = prop.unresolvedConflicts.length;
  const newBrands = prop.brands.filter((b) => b.plan).length;
  const noFiles = Object.keys(prop.files).length === 0 && prop.brandFiles.length === 0;
  const hint = open
    ? `Decide ${plural(open, 'conflict')} first`
    : blocked
      ? `Fix ${plural(blocked, 'problem')} first`
      : noFiles
        ? 'Nothing to send'
        : [prop.changes.length ? plural(prop.changes.length, 'token') : '', newBrands ? plural(newBrands, 'new brand') : ''].filter(Boolean).join(' and ') + ` to ${init.settings.branch}`;
  return {
    body,
    bar: nothing
      ? { label: 'Scan again', onClick: () => scanPush(r) }
      : {
          label: r.appendToOpen && r.openPr ? `Push to pull request #${r.openPr.number}` : 'Push and open pull request',
          onClick: submitPr,
          disabled: !!open || !!blocked || noFiles,
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
            : 'Create a fine-grained personal access token for this repository only, with "Contents: Read and write" and "Pull requests: Read and write".',
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
  return h(
    'div',
    { class: 'bar' },
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
  const focusedId = (document.activeElement as HTMLElement | null)?.dataset?.focusId;

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
  const pushCount = state.push && !state.push.result ? state.push.analysis.diff.local.length + state.push.analysis.diff.conflicts.length : 0;
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
