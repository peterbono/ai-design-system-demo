// DS Bridge UI: three tabs (Pull, Review changes, Settings). Plain TypeScript and DOM, no framework.
// The UI owns network calls and logic; figma.* access goes through request() to the main thread.
// Layout: tabs on top, scrolling content, and an action bar pinned to the bottom that always shows
// what the primary button will do (or why it is disabled).

import type { ConflictChoice, DiffEntry } from '../core/diff-engine';
import { type Analysis, type PullProposal, type PushProposal, type PushResult, analyze, buildPull, buildPush, openPullRequest } from '../core/flows';
import { GitHubClient, type PullRequest, parseRepo } from '../core/github-client';
import type { RenameSuggestion } from '../core/id-map';
import { defaultTitle } from '../core/pr-composer';
import { type PathIndex, resolve } from '../core/resolver';
import { type LogicalToken, PRIMITIVE_MODE } from '../core/types';
import type { Issue } from '../core/validators';
import { formatValue, isAlias, parseColor, rgbaToHex } from '../core/values';
import { type ContrastResult, pairKey } from '../core/wcag';
import { type ApplyReport, type FigmaSnapshot, type InitPayload, type RepoSettings, modeDisplayName } from '../shared/messages';
import { onProgress, request } from './bridge';
import { type Child, h } from './dom';
import { icon } from './icons';

type Tab = 'pull' | 'review' | 'settings';
const TABS: { id: Tab; label: string }[] = [
  { id: 'pull', label: 'Pull' },
  { id: 'review', label: 'Review changes' },
  { id: 'settings', label: 'Settings' },
];
/** Rows rendered per list before "Show all": keeps large token sets responsive. */
const PAGE = 60;

interface PullState {
  analysis: Analysis;
  choices: Map<string, ConflictChoice>;
  proposal: PullProposal;
  report?: ApplyReport | undefined;
}

interface ReviewState {
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
  result?: PushResult | undefined;
}

interface State {
  tab: Tab;
  init?: InitPayload | undefined;
  busy?: string | undefined;
  error?: { message: string; retry?: (() => void) | undefined } | undefined;
  pull?: PullState | undefined;
  review?: ReviewState | undefined;
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
const modeLabel = (mode: string) => (mode === PRIMITIVE_MODE ? 'Value' : modeDisplayName(mode));

/** Index used to resolve aliases of Figma-side tokens: Git tokens overlaid with Figma's. */
function figmaIndex(a: Analysis): PathIndex {
  const idx = new Map(a.head.byPath);
  for (const t of a.figmaTokens) idx.set(t.path, t);
  return idx;
}

function swatch(index: PathIndex, t: LogicalToken | undefined, mode: string): Child {
  if (!t || t.type !== 'color') return null;
  const r = resolve(index, t.path, mode);
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
  const r = resolve(index, t.path, mode);
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
  return t.tier === 'primitive' ? [PRIMITIVE_MODE] : a.head.layout.themes.map((th) => th.mode);
}

function contrastPills(path: string, after: ContrastResult[] | undefined, before?: ContrastResult[]): Child {
  if (!after) return null;
  const prev = new Map((before ?? []).map((r) => [pairKey(r), r]));
  const mine = after.filter((r) => r.ratio !== undefined && (r.pair.foreground === path || r.pair.background === path));
  if (!mine.length) return null;
  return h(
    'div',
    { class: 'pills' },
    mine.map((r) => {
      const other = r.pair.foreground === path ? r.pair.background : r.pair.foreground;
      const was = prev.get(pairKey(r))?.ratio;
      const level = r.level === 'fail' ? 'Fails AA' : r.level;
      return h(
        'span',
        {
          class: `pill ${r.level}`,
          title: `${r.pair.foreground} on ${r.pair.background}, ${modeDisplayName(r.mode)}${was !== undefined && was !== r.ratio ? `. Was ${was}:1` : ''}`,
        },
        h('strong', null, level ?? ''),
        ` ${r.ratio}:1 ${modeDisplayName(r.mode)}, ${r.pair.foreground === path ? 'on' : 'under'} ${other.replace(/^color\./, '')}`,
      );
    }),
  );
}

interface RowSides {
  before: LogicalToken | undefined;
  after: LogicalToken | undefined;
  beforeIndex: PathIndex;
  afterIndex: PathIndex;
}

const KIND_LABEL: Record<string, string> = { added: 'New', changed: 'Edited', renamed: 'Renamed', removed: 'Deleted' };

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

function rowList(key: string, rows: HTMLElement[]): HTMLElement {
  const all = state.expanded.has(key);
  const shown = all ? rows : rows.slice(0, PAGE);
  return h(
    'div',
    null,
    h('ul', { class: 'rows' }, shown),
    rows.length > shown.length
      ? h('button', { class: 'btn ghost more', onClick: () => { state.expanded.add(key); render(); } }, `Show all ${rows.length}`)
      : null,
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
  if (state.pull) state.pull.proposal = buildPull(state.pull.analysis, state.pull.choices);
  if (state.review) state.review.proposal = buildPush(state.review.analysis, state.review.choices);
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
      state.pull = { analysis, choices, proposal: buildPull(analysis, choices) };
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
      state.review = undefined;
      void request('notify', { message: `Pulled ${state.init!.settings.branch}: ${report.created} created, ${report.updated} updated.` });
    },
    applyPull,
  );
}

function scanReview(keep?: ReviewState): void {
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
      state.review = {
        analysis,
        snapshot,
        choices,
        confirmed,
        dismissed: keep?.dismissed ?? new Set(),
        proposal: buildPush(analysis, choices),
        title: keep?.title ?? '',
        notes: keep?.notes ?? '',
        openPr,
        appendToOpen: keep?.appendToOpen ?? !!openPr,
      };
      state.expanded.clear();
    },
    () => scanReview(keep),
  );
}

function submitPr(): void {
  const r = state.review;
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
      state.review = undefined;
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
    state.review = undefined;
    state.settingsMessage = { kind: 'ok', text: 'Token removed from this computer.' };
  });
}

// ---------------------------------------------------------------------------------------------
// Views

interface View {
  body: Child;
  bar?: ActionBar | undefined;
}

function needToken(): View {
  return {
    body: h(
      'div',
      { class: 'empty' },
      h('h2', null, 'Connect a repository'),
      h('p', null, 'DS Bridge needs a GitHub token to read the tokens on main and open pull requests.'),
    ),
    bar: { label: 'Open Settings', onClick: () => { state.tab = 'settings'; render(); } },
  };
}

function viewPull(): View {
  const init = state.init!;
  if (!init.hasToken) return needToken();
  const p = state.pull;
  const where = h(
    'p',
    { class: 'lede' },
    `Bring ${init.settings.branch} from ${init.settings.repo} into this file. `,
    init.sync.baseSha
      ? `Last pulled ${short(init.sync.baseSha)}${init.sync.lastPullAt ? ` on ${when(init.sync.lastPullAt)}` : ''}.`
      : 'First pull: the Primitives and Semantic collections are created for you.',
  );
  if (!p) {
    return {
      body: h('section', null, h('h2', null, 'Pull from GitHub'), where, h('p', { class: 'muted' }, 'You see every change before anything is written. Your own unpublished edits are kept, and nothing is deleted.')),
      bar: { label: 'Check for updates', onClick: checkPull },
    };
  }
  const a = p.analysis;
  const prop = p.proposal;
  const fi = figmaIndex(a);
  const remote = a.diff.remote;
  const upToDate = !remote.length && !a.diff.conflicts.length && !!a.baseSha;

  if (p.report) {
    const r = p.report;
    return {
      body: [
        h(
          'div',
          { class: r.errors.length ? 'callout warn' : 'callout ok', role: 'status' },
          h('div', { class: 'callout-title' }, icon(r.errors.length ? 'alert' : 'check'), r.errors.length ? 'Pulled with problems' : 'Figma is up to date'),
          h(
            'p',
            null,
            `${plural(r.created, 'variable')} created, ${r.updated} updated${r.orphaned ? `, ${r.orphaned} flagged as orphan` : ''}. ${
              r.layout === 'single-collection' ? 'Themes are modes of the Semantic collection.' : 'This file allows one mode per collection, so each theme has its own Semantic collection.'
            }`,
          ),
          r.errors.length ? h('ul', null, r.errors.map((e) => h('li', null, e))) : null,
        ),
        prop.kept.length ? h('p', { class: 'muted' }, `${plural(prop.kept.length, 'unpublished edit')} kept. Send them from Review changes.`) : null,
      ],
      bar: { label: 'Check again', onClick: checkPull, secondary: prop.kept.length ? { label: 'Review my edits', onClick: () => { state.tab = 'review'; scanReview(); } } : undefined },
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

  const body: Child[] = [
    h('section', null, h('h2', null, upToDate ? 'Already up to date' : 'Changes on main'), where, a.compare?.aheadBy ? h('p', { class: 'muted' }, `${init.settings.branch} has ${plural(a.compare.aheadBy, 'new commit')} since then.`) : null),
  ];
  if (remote.length) {
    body.push(
      h(
        'section',
        null,
        h('h2', null, summary.join(', ')),
        counts.removed ? h('p', { class: 'lede' }, 'Tokens deleted on main stay in Figma with an "[orphan]" note so nothing in your designs breaks. Delete them yourself when ready.') : null,
        rowList('pull-remote', remote.map((e) => diffRow(a, e.remote!.kind, { before: e.figma ?? e.base, after: e.head, beforeIndex: fi, afterIndex: a.head.byPath }))),
      ),
    );
  } else if (!a.baseSha && !a.diff.conflicts.length) {
    body.push(h('p', { class: 'muted' }, `${plural(prop.plan.variables.length, 'variable')} will be created or linked to the tokens on main.`));
  }
  body.push(conflictSection(a, p.choices));
  if (prop.kept.length) {
    body.push(
      h(
        'section',
        null,
        h('h2', null, `Your edits, kept (${prop.kept.length})`),
        h('p', { class: 'lede' }, 'Not on main yet. A pull leaves them alone; send them from Review changes.'),
        rowList('pull-kept', prop.kept.map((e) => diffRow(a, e.local!.kind, { before: e.base, after: e.figma, beforeIndex: a.base?.byPath ?? a.head.byPath, afterIndex: fi }))),
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

function viewReview(): View {
  const init = state.init!;
  if (!init.hasToken) return needToken();
  const r = state.review;
  if (!r) {
    return {
      body: h(
        'section',
        null,
        h('h2', null, 'Propose your edits'),
        h('p', { class: 'lede' }, `Compare the variables in this file with ${init.settings.branch} and send the differences as a pull request. Design and tech owners review it before anything ships.`),
        h('p', { class: 'muted' }, 'Edit values, aliases, names or descriptions in the Primitives and Semantic collections, then scan.'),
      ),
      bar: { label: 'Scan for changes', onClick: () => scanReview() },
    };
  }
  const a = r.analysis;
  const prop = r.proposal;
  const fi = figmaIndex(a);

  if (r.result) {
    const res = r.result;
    return {
      body: h(
        'div',
        { class: 'callout ok', role: 'status' },
        h('div', { class: 'callout-title' }, icon('check'), res.appended ? `Commit added to pull request #${res.pr.number}` : `Pull request #${res.pr.number} opened`),
        h('p', null, `On branch ${res.branch}, as a draft. CI runs the same checks as for any change, and a design owner and a tech owner must approve before it is merged.`),
        h('p', { class: 'muted url' }, res.pr.url),
      ),
      bar: {
        label: 'Open on GitHub',
        onClick: () => void request('open-url', { url: res.pr.url }),
        secondary: { label: 'Scan again', onClick: () => scanReview() },
      },
    };
  }

  const suggestions = a.suggestions.filter((s) => !r.dismissed.has(s.figmaId));
  const nothing = !a.diff.local.length && !a.diff.conflicts.length;
  const before = prop.validation.contrastBefore;
  const after = prop.validation.contrastAfter;
  const beforeByKey = new Map(before.map((x) => [pairKey(x), x]));
  // Failures first, then the biggest moves.
  const delta = (x: ContrastResult) => Math.abs((x.ratio ?? 0) - (beforeByKey.get(pairKey(x))?.ratio ?? 0));
  const changedContrast = after
    .filter((x) => beforeByKey.get(pairKey(x))?.ratio !== x.ratio)
    .sort((x, y) => Number(y.level === 'fail') - Number(x.level === 'fail') || delta(y) - delta(x));
  const contrastKey = 'review-contrast';
  const contrastShown = state.expanded.has(contrastKey) ? changedContrast : changedContrast.slice(0, 8);

  const body: Child[] = [];
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
                h('button', { class: 'btn', onClick: () => scanReview({ ...r, confirmed: [...r.confirmed, s] }) }, 'It is a rename'),
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
  if (a.diff.local.length) {
    body.push(
      h(
        'section',
        null,
        h('h2', null, `Your changes (${a.diff.local.length})`),
        rowList(
          'review-local',
          a.diff.local.map((e) => diffRow(a, e.local!.kind, { before: e.head ?? e.base, after: e.figma, beforeIndex: a.head.byPath, afterIndex: fi }, e.figma ? contrastPills(e.figma.path, after, before) : null)),
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
        h('p', { class: 'lede' }, 'Declared text and background pairs whose ratio moves with this change.'),
        h(
          'table',
          { class: 'contrast' },
          h('thead', null, h('tr', null, h('th', null, 'Pair'), h('th', null, 'Theme'), h('th', { class: 'num' }, 'Before'), h('th', { class: 'num' }, 'After'), h('th', null, 'WCAG'))),
          h(
            'tbody',
            null,
            contrastShown.map((x) =>
              h(
                'tr',
                null,
                h('td', { class: 'pair' }, breakable(x.pair.foreground.replace(/^color\./, '')), ' on ', breakable(x.pair.background.replace(/^color\./, ''))),
                h('td', null, modeDisplayName(x.mode)),
                h('td', { class: 'num' }, String(beforeByKey.get(pairKey(x))?.ratio ?? 'n/a')),
                h('td', { class: 'num' }, String(x.ratio ?? 'n/a')),
                h('td', null, h('span', { class: `pill ${x.level}` }, h('strong', null, x.level === 'fail' ? 'Fails AA' : (x.level ?? 'n/a')))),
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
  body.push(issueList('warn', 'Already on main (not blocking)', prop.validation.warnings));
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
          h('input', { type: 'text', value: r.title, placeholder: defaultTitle(prop.changes), maxlength: '120', onInput: (e: Event) => (r.title = (e.target as HTMLInputElement).value) }),
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
        h('p', { class: 'muted' }, `${plural(Object.keys(prop.files).length, 'file')} change in one commit, with a changeset. Token changes are risk tier 3: a design owner and a tech owner both approve.`),
      ),
    );
  }
  body.push(notes(a));

  const blocked = prop.validation.blocking.length;
  const open = prop.unresolvedConflicts.length;
  const noFiles = Object.keys(prop.files).length === 0;
  const hint = open
    ? `Decide ${plural(open, 'conflict')} first`
    : blocked
      ? `Fix ${plural(blocked, 'problem')} first`
      : noFiles
        ? 'Nothing to send'
        : `${plural(prop.changes.length, 'token')} to ${init.settings.branch}`;
  return {
    body,
    bar: nothing
      ? { label: 'Scan again', onClick: () => scanReview(r) }
      : {
          label: r.appendToOpen && r.openPr ? 'Add to pull request' : 'Open pull request',
          onClick: submitPr,
          disabled: !!open || !!blocked || noFiles,
          hint,
          secondary: { label: 'Scan again', onClick: () => scanReview(r) },
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
      h(
        'section',
        null,
        h('h2', null, 'Where the tokens live'),
        field('Repository', 'repo', 'Owner and name, as in the GitHub URL.', 'owner/name'),
        field('Base branch', 'branch', 'Pulls read from it; pull requests target it.', 'main'),
        field('Tokens folder', 'tokensPath', 'Folder that holds the *.tokens.json files.', 'packages/tokens/src'),
      ),
      h(
        'section',
        null,
        h('h2', null, 'GitHub token'),
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
  const reviewCount = state.review && !state.review.result ? state.review.analysis.diff.local.length + state.review.analysis.diff.conflicts.length : 0;
  const view = state.tab === 'pull' ? viewPull() : state.tab === 'review' ? viewReview() : viewSettings();

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
        t.id === 'review' && reviewCount ? h('span', { class: 'count', 'aria-label': `${reviewCount} changes` }, String(reviewCount)) : null,
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
