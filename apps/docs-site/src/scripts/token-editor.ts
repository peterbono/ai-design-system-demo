// Token editor: the draft behind Studio Tokens. Every applied edit lands in a draft (kept in localStorage), runs the
// same guardrails as the build and the Figma plugin, and is proposed as a pull request with the user's own GitHub
// token, or sent as a suggestion when the repo takes suggestions (bridge.config.json "changes"). The cell editor (scripts/explorer/inline-edit.ts) and the review sheet (scripts/explorer/review.ts) read and
// write it through the API below; the Drafts page shows it as a tray. Nothing is written to the repo without review.
import {
  buildTokenSet,
  branchName,
  classifyRisk,
  commitMessage,
  composeChangeset,
  composePrBody,
  layoutOptions,
  loadConfig,
  loadRepoFiles,
  parseContrastChecks,
  validateProposal,
  contrastScope,
  evaluatePairs,
  LayeredTokenSet,
  planTokenProposal,
  suggestTokenProposalOnGitHub,
  type ContrastResult,
  type BridgeConfig,
  type LogicalToken,
  type TokenSet,
} from '@bridge-ds/core';
import {
  aliasCandidates,
  applyDraft,
  contrastMoves,
  draftSlug,
  emptyDraft,
  guardrails,
  previewOverrides,
  trayRows,
  type Applied,
  type Draft,
  type DraftEdit,
  type Guardrails,
} from '../lib/editor-model';
import { badgeHtml, closeDialog, isDialogOpen, openDialog, tokenValueHtml } from '@bridge-ds/react/dom';
import { currentViewer, esc, getToken, hasWorkingToken, initGitHubConnect, onAccess, paintGates, prefersSignIn, readRepo, relativeTime, setButtonDisabled, setButtonLabel, showGhError, studioClient } from './github-session';
import { ghVerb, notSentLine, SEE_SUGGESTION, sendButton, sendDialogTitle, sendingLine, SUGGEST_NEXT, suggestionSentLine } from '../lib/gh-wording';
import { assertBranchWrites, changesModeOnPage } from './changes-mode';
import { draftTokenEdits } from '../lib/draft-token-edits';
import { branchWithJiraKey, parseJiraKey, titleWithJiraKey, VOCAB } from '../lib/vocabulary';
import { docsNotesForTokens } from '../lib/docs-draft-model';
import { cellValue, tierAxis } from '../lib/explorer/model';
import { numericValue } from '../lib/explorer/format';
import { prTitleFrom, proposalTitle, reviewSentence, suggestionTitleFrom, type TitleEdit } from '../lib/propose-copy';
import {
  addedSentence,
  ChangeConflictError,
  changeDraftKey,
  changeTitle,
  conflictHref,
  defaultTarget,
  draftDestination,
  dropEdits,
  isTokenChange,
  parseChangeDraft,
  parseTargetValue,
  scopeBanner,
  targetOptions,
  targetValue,
  type ChangeTarget,
  type TargetChoice,
} from '../lib/continue-change';
import { addToChange, loadChangeTokens, readChange, readTargets } from './continue-change';
import { scopeHref, scopeOf } from '../lib/view-scope';
import { ConflictNotice, ScopeBanner, TargetChoice as TargetChoiceView, mountInto, unmountFrom } from '../components/ds/studio/ContinueChange';
import { createElement } from 'react';
import { attrUrl } from '../lib/html';
import { studioHref } from '../lib/team-path';

/** Components that paint with a token (build-time usage embedded by the explorer), for the docs notes of a proposal. */
function usedByComponents(path: string): string[] {
  try {
    const usage = JSON.parse(document.getElementById('xp-usage')?.textContent || '{}') as Record<string, { usedBy?: { name: string }[] }>;
    return (usage[path]?.usedBy ?? []).map((c) => c.name);
  } catch {
    return [];
  }
}

/** The config's repository, or the one this site documents when the config names none. */
function repoOf(config: BridgeConfig): { owner: string; name: string; defaultBranch: string } {
  if (config.repo) return config.repo;
  const r = readRepo();
  return { owner: r.owner, name: r.repo, defaultBranch: r.defaultBranch };
}

const DRAFT_KEY = 'bridge.draft.v1';
interface State {
  config: BridgeConfig;
  originals: Record<string, string>;
  head: TokenSet;
  pairs: ReturnType<typeof parseContrastChecks>;
  draft: Draft;
  applied: Applied | null;
  checks: Guardrails | null;
  contrastBefore: ReturnType<typeof validateProposal>['contrastBefore'];
  contrastAfter: ReturnType<typeof validateProposal>['contrastAfter'];
}

let S: State | null = null;

/**
 * The editor scoped to one change (/studio/tokens/?change=N&edit=1, "Edit tokens in this change"): values come from the
 * change, the draft is kept apart (per change, with the version it was made on) and saving adds to the change.
 */
interface Scope {
  number: number;
  title: string;
  /** The change's version the draft is made on: the base of the 3-way check. */
  baseSha: string | null;
  state: 'loading' | 'ready' | 'error';
  error?: string;
}
let scope: Scope | null = null;
/** Outside a change: the changes the viewer can add to, and where the edits go. */
let targets: ChangeTarget[] = [];
let choice: TargetChoice = { kind: 'new' };
const repoKey = () => (S ? `${repoOf(S.config).owner}/${repoOf(S.config).name}` : '');
const draftKey = () => (scope ? changeDraftKey(repoKey(), scope.number) : DRAFT_KEY);
/** Edits wait while the change loads or when it cannot be edited. */
const blocked = () => Boolean(scope && scope.state !== 'ready');
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T | null;
/** Fields of the add and propose dialogs, by data-ed-field: DS Input and Textarea do not keep a custom id. */
const field = <T extends HTMLElement>(name: string) => document.querySelector<T>(`[data-ed-field="${name}"]`);

function loadDraft(): Draft {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    return raw ? (JSON.parse(raw) as Draft) : emptyDraft();
  } catch {
    return emptyDraft();
  }
}

function saveDraft() {
  try {
    if (!S || blocked()) return;
    if (scope) {
      if (S.draft.edits.length) localStorage.setItem(draftKey(), JSON.stringify({ edits: S.draft.edits, baseSha: scope.baseSha }));
      else localStorage.removeItem(draftKey());
    } else localStorage.setItem(DRAFT_KEY, JSON.stringify(S.draft));
  } catch {
    /* private mode: the draft lives for this page */
  }
}

const uid = () => Math.random().toString(36).slice(2, 10);

function recompute() {
  if (!S) return;
  const opts = layoutOptions(S.config);
  S.applied = applyDraft(S.head, S.originals, S.draft, opts);
  const v = validateProposal(S.applied.proposed, S.head, S.pairs);
  S.contrastBefore = v.contrastBefore;
  S.contrastAfter = v.contrastAfter;
  S.checks = guardrails(S.head, S.applied.proposed, S.pairs);
  paintTray();
  document.dispatchEvent(new CustomEvent('bridge:draft'));
}

let timer = 0;
const schedule = () => {
  window.clearTimeout(timer);
  timer = window.setTimeout(recompute, 60);
};

/** Adds or replaces the value edit for one token and mode. Returning to the original value drops the edit. */
function setValue(t: LogicalToken, mode: string, after: unknown) {
  if (!S || blocked()) return;
  const before = S.head.byPath.get(t.path)?.values[mode];
  S.draft.edits = S.draft.edits.filter((e) => !(e.kind === 'value' && e.path === t.path && e.mode === mode));
  if (JSON.stringify(before) !== JSON.stringify(after)) S.draft.edits.push({ kind: 'value', id: uid(), path: t.path, mode, before, after });
  saveDraft();
  schedule();
}

// ---------------------------------------------------------------------------------------------------------------
// Draft values

function currentValue(t: LogicalToken, mode: string): unknown {
  const e = [...(S?.draft.edits ?? [])].reverse().find((x) => x.kind === 'value' && x.path === t.path && x.mode === mode) as Extract<DraftEdit, { kind: 'value' }> | undefined;
  return e ? e.after : t.values[mode];
}

// ---------------------------------------------------------------------------------------------------------------
// Draft tray

function paintTray() {
  if (!S?.applied || !S.checks) return;
  const rows = trayRows(S.head, S.applied.proposed, S.draft);
  const n = rows.length;
  const fails = S.checks.blocking.length;
  // Drafts never need GitHub: adding, editing and exporting stay in this browser. Only proposing opens a pull
  // request, so it is the one gated action (data-gh-gate): without a connection a click opens Connect GitHub.
  const propose = $<HTMLButtonElement>('ed-propose');
  if (propose) {
    // Docs edits share the draft but are sent from the Library page's edit mode (Edit docs).
    setButtonDisabled(propose, !rows.some((r) => r.edit.kind !== 'docs') || fails > 0);
    paintGates(propose.parentElement ?? document);
  }
  const tray = $('ed-tray');
  if (!tray) return;
  // The Drafts page shows the tray as a page section, always visible; elsewhere it is a bar that appears while editing.
  const asPage = tray.dataset.variant === 'page';
  // Studio Tokens: a bar at the bottom only while the draft has changes; the header's Drafts button opens it as a
  // side sheet at any count.
  tray.hidden = !asPage && n === 0 && tray.dataset.sheet !== 'true';
  const empty = $('ed-drafts-empty');
  if (empty) empty.hidden = n > 0;
  $('ed-tray-count')!.textContent = n ? `${n} draft edit${n > 1 ? 's' : ''}` : 'No draft edits yet';
  const status = $('ed-tray-status')!;
  status.textContent = !n ? 'Open a token to edit it.' : fails ? `${fails} guardrail${fails > 1 ? 's' : ''} block proposing` : 'Guardrails pass';
  status.className = `ed-tray-status ${!n ? '' : fails ? 'is-fail' : 'is-pass'}`;
  const moves = contrastMoves({ contrastBefore: S.contrastBefore, contrastAfter: S.contrastAfter });
  $('ed-tray-list')!.innerHTML = rows.length
    ? rows
        .map(
          (r) => `<li class="ed-tray-row">
            <div class="ed-tray-main"><span class="mono">${esc(r.label)}</span>${r.context ? badgeHtml(r.context, { size: 'sm' }) : ''}</div>
            <div class="ed-tray-vals">${r.before ? tokenValueHtml(r.before.text, { swatch: r.before.hex ?? false, previous: true, size: 'sm' }) : ''}${r.before && r.after ? '<span class="muted">-></span>' : ''}${r.after ? tokenValueHtml(r.after.text, { swatch: r.after.hex ?? false, size: 'sm' }) : ''}</div>
            <button type="button" class="btn btn-secondary btn-sm" data-ed-undo="${r.index}">Undo</button>
          </li>`,
        )
        .join('') +
      (moves.length
        ? `<li class="ed-tray-contrast"><p class="small"><strong>Contrast moves</strong></p><ul>${moves
            .slice(0, 10)
            .map((m) => `<li class="${m.after < m.min ? 'is-fail' : ''}"><span class="mono small">${esc(m.fg)} on ${esc(m.bg)}</span> <span class="small muted">${esc(m.where)}</span> <span class="num small">${m.before?.toFixed(2) ?? '?'} -> ${m.after.toFixed(2)} (min ${esc(String(m.min))})</span></li>`)
            .join('')}</ul></li>`
        : '') +
      (S.checks.blocking.length
        ? `<li class="ed-tray-contrast"><div class="ed-block"><strong>Fix before proposing</strong><ul>${S.checks.blocking
            .slice(0, 8)
            .map((i) => `<li>${esc(i.message)}</li>`)
            .join('')}</ul></div></li>`
        : '')
    : `<li class="ed-tray-empty">${asPage ? 'No draft yet. Open a token in Studio Tokens and change a value: it lands here.' : 'Edits you make show up here, with before and after values and their contrast impact.'}</li>`;
}

/** What a send made: a pull request (direct mode) or a suggestion (suggest mode). */
type Sent = { kind: 'branch'; number: number } | { kind: 'suggestion'; number: number; url: string; warnings: string[] };

async function propose(title: string, notes: string, jira: string | null): Promise<Sent> {
  if (!S) throw new Error('Editor not ready');
  const token = getToken();
  if (!token) throw new Error(`${ghVerb(prefersSignIn())} first.`);
  const { owner, name, defaultBranch } = repoOf(S.config);
  const client = studioClient(`${owner}/${name}`, token);
  const mainSha = await client.getBranchSha(defaultBranch);
  if (!mainSha) throw new Error(`Branch ${defaultBranch} not found.`);
  // Re-read the latest token files so the change applies on top of main as it is now.
  const latest = await loadRepoFiles(client, mainSha, S.config.tokens.root);
  const config = latest.config ?? S.config;
  const opts = layoutOptions(config);
  const head = buildTokenSet(latest.files, opts);
  const pairs = parseContrastChecks(latest.contrastChecks);
  const applied = applyDraft(head, latest.files, S.draft, opts);
  if (!applied.changes.length) throw new Error('main already has these values, so there is nothing to review.');
  const validation = validateProposal(applied.proposed, head, pairs);
  if (validation.blocking.length) throw new Error(`Guardrails block these edits on main: ${validation.blocking[0]!.message}`);
  const docsNotes = docsNotesForTokens(applied.changes.map((c) => (c.target ?? c.current)!.path), usedByComponents);
  if (changesModeOnPage() === 'suggest') return suggest({ config, latest, head, pairs, mainSha, defaultBranch, title, notes: [notes.trim(), docsNotes].filter(Boolean).join('\n\n'), jira });
  const branch = branchWithJiraKey(branchName(draftSlug(S.draft), new Date()), jira);
  const risk = classifyRisk({ tokenChanges: applied.changes, config });
  const baseTitle = prTitleFrom(title) || prTitleFrom(proposalSummary()?.title ?? '') || `tokens: ${applied.changes.length} token change${applied.changes.length > 1 ? 's' : ''} from Bridge`;
  const body = composePrBody({
    changes: applied.changes,
    head,
    proposed: applied.proposed,
    validation,
    baseBranch: defaultBranch,
    headSha: mainSha,
    baseSha: mainSha,
    origin: {
      tool: 'the Bridge token editor',
      surface: 'the Bridge web editor',
      authoredBy: 'Human designer in the Bridge web editor (no AI involved in the values)',
    },
    title: baseTitle,
    notes: [notes.trim(), docsNotes].filter(Boolean).join('\n\n'),
    upstreamPaths: [],
    resolvedConflicts: [],
  });
  const files: { path: string; sha: string }[] = [];
  for (const [rel, text] of Object.entries(applied.files)) files.push({ path: `${latest.tokensPath}/${rel}`, sha: await client.createBlob(text) });
  if (config.changeset) {
    const cs = composeChangeset(applied.changes, { title: baseTitle, branch, packageName: config.changeset.package, source: 'from the Bridge web editor' });
    files.push({ path: cs.path, sha: await client.createBlob(cs.content) });
  }
  // The Jira key goes first in the title (and the branch name) so Jira's GitHub integration links them.
  const prTitle = titleWithJiraKey(baseTitle, jira);
  const tree = await client.createTree(latest.treeSha, files);
  const commit = await client.createCommit(commitMessage(prTitle, applied.changes, 'Proposed with the Bridge token editor.'), tree, [mainSha]);
  await client.createBranch(branch, commit);
  const pr = await client.createPullRequest({ title: prTitle, head: branch, base: defaultBranch, body, draft: false });
  await client.addLabels(pr.number, ['tokens', 'source: bridge-web', `tier: ${risk.tier}`]).catch(() => false);
  return { kind: 'branch', number: pr.number };
}

/**
 * Suggest mode: the draft as core token edits, planned on main as it is now (validation, contrast, tier, the same body
 * as a pull request) and filed as a suggestion through core. No branch, no commit, no pull request: the DS lead
 * reviews it, a developer applies it.
 */
async function suggest(a: {
  config: BridgeConfig;
  latest: Awaited<ReturnType<typeof loadRepoFiles>>;
  head: TokenSet;
  pairs: ReturnType<typeof parseContrastChecks>;
  mainSha: string;
  defaultBranch: string;
  title: string;
  notes: string;
  jira: string | null;
}): Promise<Sent> {
  if (!S) throw new Error('Editor not ready');
  const { owner, name } = repoOf(a.config);
  const client = studioClient(`${owner}/${name}`, getToken());
  const edits = draftTokenEdits(a.head, S.draft);
  const n = new Set(edits.map((e) => e.path)).size;
  const plain = suggestionTitleFrom(a.title) || proposalSummary()?.title || `${n} token change${n === 1 ? '' : 's'}`;
  const before = new LayeredTokenSet(a.config, new Map(Object.entries(a.latest.files)));
  const plan = planTokenProposal({ before, pairs: a.pairs, edits, title: titleWithJiraKey(plain, a.jira), summary: a.notes || undefined, config: a.config, tool: 'Bridge Studio' });
  if (!plan) throw new Error('main already has these values, so there is nothing to suggest.');
  if (plan.blocked) throw new Error(`Guardrails block these edits on main: ${plan.blocked}.`);
  const r = await suggestTokenProposalOnGitHub(client, plan, {
    base: a.defaultBranch,
    baseSha: a.mainSha,
    source: 'studio',
    suggestedBy: currentViewer()?.login,
    labels: a.config.integrations?.requests?.labels ?? [],
    assignees: a.config.integrations?.requests?.assignees ?? [],
  });
  return { kind: 'suggestion', number: r.number, url: r.url, warnings: r.warnings };
}

// ---------------------------------------------------------------------------------------------------------------
// API for the token explorer (scripts/explorer/): inline cell edits go through the same draft, guardrails and tray.

let setEditingImpl: ((on: boolean) => void) | null = null;

/** Turns edit mode on or off (body.is-editing, the tray, the bridge:editing event). */
export function setEditing(on: boolean) {
  setEditingImpl?.(on);
}

export const editorReady = () => S !== null;

/** Current state: the head set, the draft applied to it, guardrails and contrast before and after the draft. */
export function editorSnapshot() {
  if (!S) return null;
  return {
    head: S.head,
    proposed: S.applied?.proposed ?? S.head,
    draft: S.draft,
    checks: S.checks,
    contrastBefore: S.contrastBefore,
    contrastAfter: S.contrastAfter,
  };
}

/** Sets one mode of one token in the draft (an alias string like "{palette.neutral.600}" or a DTCG literal). */
export function editValue(path: string, mode: string, value: unknown) {
  const t = S?.head.byPath.get(path);
  if (t) setValue(t, mode, value);
}

/** The value a token has in the draft for one mode (the head value when the draft does not touch it). */
export function draftValue(path: string, mode: string): unknown {
  const t = S?.head.byPath.get(path);
  return t ? currentValue(t, mode) : undefined;
}

/** Same-type tokens a token may alias, following the tier rules. */
export function aliasOptions(path: string): string[] {
  const t = S?.head.byPath.get(path);
  return S && t ? aliasCandidates(S.head, t) : [];
}

/** Applies several mode values at once (the cell editor's Apply), with one recompute. */
export function applyValues(values: { path: string; mode: string; value: unknown }[]) {
  if (!S || blocked()) return;
  for (const v of values) {
    const t = S.head.byPath.get(v.path);
    if (!t) continue;
    const before = t.values[v.mode];
    S.draft.edits = S.draft.edits.filter((e) => !(e.kind === 'value' && e.path === v.path && e.mode === v.mode));
    if (JSON.stringify(before) !== JSON.stringify(v.value)) S.draft.edits.push({ kind: 'value', id: uid(), path: v.path, mode: v.mode, before, after: v.value });
  }
  saveDraft();
  recompute();
}

/** Sets the description of one token in the draft. Back to the original text drops the edit. */
export function editDescription(path: string, text: string) {
  const t = S?.head.byPath.get(path);
  if (!S || !t || blocked()) return;
  S.draft.edits = S.draft.edits.filter((e) => !(e.kind === 'description' && e.path === path));
  if (text.trim() !== (t.description ?? '').trim()) S.draft.edits.push({ kind: 'description', id: uid(), path, before: t.description, after: text.trim() });
  saveDraft();
  recompute();
}

/** The description a token has in the draft. */
export function draftDescription(path: string): string {
  const e = [...(S?.draft.edits ?? [])].reverse().find((x) => x.kind === 'description' && x.path === path) as Extract<DraftEdit, { kind: 'description' }> | undefined;
  return e ? e.after : (S?.head.byPath.get(path)?.description ?? '');
}

/** Modes of a token the draft changes (value edits), for the edited dot on its cells. */
export function editedModes(path: string): Set<string> {
  return new Set((S?.draft.edits ?? []).filter((e): e is Extract<DraftEdit, { kind: 'value' }> => e.kind === 'value' && e.path === path).map((e) => e.mode));
}

/**
 * Contrast of every checked pair with `pending` values applied on top of the current draft: what the cell editor
 * shows before Apply. Nothing is saved.
 */
export function previewContrast(pending: { path: string; mode: string; value: unknown }[]): ContrastResult[] {
  const proposed = pendingSet(pending);
  return S && proposed ? evaluatePairs(proposed.byPath, S.pairs, contrastScope(proposed)) : [];
}

// The draft with pending values on top, memoized on the pending values: the popover asks for contrast and for the
// preview overrides of the same pick.
let pendingMemo: { key: string; set: TokenSet } | null = null;
function pendingSet(pending: { path: string; mode: string; value: unknown }[]): TokenSet | null {
  if (!S) return null;
  const key = JSON.stringify([S.draft.edits, pending]);
  if (pendingMemo?.key === key) return pendingMemo.set;
  const edits: DraftEdit[] = S.draft.edits.filter((e) => !(e.kind === 'value' && pending.some((p) => p.path === e.path && p.mode === e.mode)));
  for (const p of pending) edits.push({ kind: 'value', id: 'pending', path: p.path, mode: p.mode, before: S.head.byPath.get(p.path)?.values[p.mode], after: p.value });
  const set = applyDraft(S.head, S.originals, { edits }, layoutOptions(S.config)).proposed;
  pendingMemo = { key, set };
  return set;
}

/** CSS overrides that paint the draft plus `pending` values (the popover's pick, before Apply) in one context. */
export function pendingOverrides(pending: { path: string; mode: string; value: unknown }[], ctx: { brand: string; theme: string; density: string }): Record<string, string> {
  const proposed = pendingSet(pending);
  return S && proposed ? previewOverrides(S.head, proposed, ctx) : {};
}

/**
 * What the "Create branch" dialog says about the draft: a plain title drafted from the edits ("Darker primary
 * action fill"), the risk tier and who approves it, from governance.rights.
 */
export function proposalSummary(): { title: string; tier: 1 | 2 | 3; sentence: string } | null {
  if (!S?.applied) return null;
  const set = S.applied.proposed;
  const head = S.head;
  const resolved = (from: typeof head, path: string, mode: string, type: string | undefined) => {
    const t = head.byPath.get(path) ?? set.byPath.get(path);
    const axis = t ? tierAxis(t.tier) : undefined;
    const m = S!.config.modes;
    const ctx = { brand: m.defaults.brand ?? m.brands[0], theme: m.defaults.theme ?? m.themes[0], density: m.defaults.density ?? m.densities[0] };
    const v = cellValue(from, path, axis ? { ...ctx, [axis]: mode } : ctx);
    return type === 'color' ? v.hex : numericValue(v.resolved);
  };
  const edits: TitleEdit[] = S.draft.edits
    .filter((e) => e.kind !== 'docs')
    .map((e) => {
      if (e.kind !== 'value') return { kind: e.kind as TitleEdit['kind'], path: e.path };
      const type = head.byPath.get(e.path)?.type;
      return { kind: 'value', path: e.path, type, before: resolved(head, e.path, e.mode, type), after: resolved(set, e.path, e.mode, type) };
    });
  const risk = classifyRisk({ tokenChanges: S.applied.changes, config: S.config });
  const tier = (risk.tier === 1 || risk.tier === 2 ? risk.tier : 3) as 1 | 2 | 3;
  return { title: proposalTitle(edits), tier, sentence: reviewSentence(tier, S.config.governance.rights, changesModeOnPage()) };
}

/** Removes one draft edit by its index in the draft. */
export function undoEdit(index: number) {
  if (!S) return;
  S.draft.edits.splice(index, 1);
  saveDraft();
  recompute();
}

/** Empties the draft (the caller confirms). */
export function discardDraft() {
  if (!S) return;
  S.draft = emptyDraft();
  saveDraft();
  recompute();
}

/** The head and proposed sets and the CSS overrides that paint the draft on a preview scope. */
export function draftOverrides(ctx: { brand: string; theme: string; density: string }): Record<string, string> {
  if (!S?.applied) return {};
  return previewOverrides(S.head, S.applied.proposed, ctx);
}

/** Drops every draft edit of one token. */
export function undoToken(path: string) {
  if (!S) return;
  S.draft.edits = S.draft.edits.filter((x) => x.path !== path);
  saveDraft();
  recompute();
}

// ---------------------------------------------------------------------------------------------------------------
// Continue a change

/**
 * The send button's words, one verb family: add to a branch (the one edited, or the default target), else request
 * review; in suggest mode always "Send suggestion" (nothing is added to a branch there).
 */
export function sendLabel(): string {
  if (changesModeOnPage() === 'suggest') return sendButton('tokens', 'suggest');
  return scope ? 'Add to this branch' : choice.kind === 'change' ? 'Add to branch' : VOCAB.requestReview;
}

/** Where the draft goes, for the review sheet's note (null: nothing to say). */
export function destinationNote(): string | null {
  if (scope?.state === 'ready') return `Your edits are added to ${scope.title}.`;
  const t = choice.kind === 'change' ? targets.find((x) => choice.kind === 'change' && x.number === choice.number) : undefined;
  const n = new Set((S?.draft.edits ?? []).filter((e) => e.kind !== 'docs').map((e) => e.path)).size;
  return t ? draftDestination(t, n) : null;
}

function paintScope() {
  const slot = document.querySelector<HTMLElement>('[data-ed-scope]');
  if (!slot || !scope) return;
  slot.hidden = false;
  document.body.dataset.editScope = scope.state;
  const words =
    scope.state === 'error'
      ? { title: `Cannot edit ${scope.title}`, body: scope.error ?? 'It could not be read. Reload the page to try again.' }
      : scope.state === 'loading'
        ? { title: `Opening ${scope.title}`, body: 'Reading its token values. Edits wait until they are in.' }
        : scopeBanner(scope.title);
  mountInto(slot, createElement(ScopeBanner, { title: words.title, body: words.body, backHref: studioHref(`changes/?pr=${scope.number}`), viewHref: scopeHref(location, { kind: 'view', change: scope.number }) }));
}

/** Reads the change and its token files, then swaps them in as the values the editor edits. */
async function openScope(n: number) {
  if (!S) return;
  const sc: Scope = { number: n, title: `branch #${n}`, baseSha: null, state: 'loading' };
  scope = sc;
  paintScope();
  try {
    // Suggest mode: a branch takes no edits from Studio. The way out is the draft outside the branch.
    assertBranchWrites('add edits to branches', 'Open Tokens without a branch and send your edits as a suggestion.');
    const pull = await readChange(S.config, n);
    sc.title = changeTitle(pull.title);
    paintScope();
    const { owner, name } = repoOf(S.config);
    if (!isTokenChange(pull, `${owner}/${name}`)) {
      throw new Error(
        pull.state !== 'open' || pull.merged_at
          ? 'It is no longer open, so it takes no more edits. Open Tokens to create a new branch.'
          : 'This branch does not edit tokens. Explorations, brands and docs keep their own editors.',
      );
    }
    // A draft made earlier on this change keeps the version it was made on, so the 3-way check stays honest.
    let stored = parseChangeDraft(null);
    try {
      stored = parseChangeDraft(localStorage.getItem(changeDraftKey(`${owner}/${name}`, n)));
    } catch {
      /* private mode */
    }
    const sha = stored.edits.length && stored.baseSha ? stored.baseSha : pull.head.sha;
    const loaded = await loadChangeTokens(S.config, sha);
    Object.assign(S, { config: loaded.config, originals: loaded.originals, head: loaded.head, pairs: loaded.pairs, draft: { edits: stored.edits } });
    pendingMemo = null;
    sc.baseSha = sha;
    sc.state = 'ready';
  } catch (err) {
    sc.state = 'error';
    sc.error = (err as Error).message;
  }
  paintScope();
  recompute();
}

/** The changes the viewer can add to (signed in, outside a change), and the default choice. */
async function refreshTargets(): Promise<void> {
  if (!S || scope) return;
  try {
    // Suggest mode: every send is a new suggestion, so there is no branch to add to.
    targets = changesModeOnPage() === 'suggest' ? [] : await readTargets(S.config);
  } catch {
    targets = [];
  }
  const keep = choice.kind === 'change' && targets.some((t) => choice.kind === 'change' && t.number === choice.number);
  if (!keep) choice = defaultTarget(targets);
  // The dialog may already be open (the list reads after sign-in): repaint its choice.
  if (isDialogOpen('ed-propose-dialog')) paintSend();
  document.dispatchEvent(new CustomEvent('bridge:draft'));
}

/** The send dialog for the current choice: the target radios, the title fields for a new change, the button. */
function paintSend() {
  const adding = Boolean(scope) || choice.kind === 'change';
  const t = scope ? null : targets.find((x) => choice.kind === 'change' && x.number === choice.number);
  const name = scope?.title ?? t?.title ?? '';
  const h = $('ed-propose-dialog-title');
  if (h) h.textContent = scope ? `Add to ${name}` : sendDialogTitle(changesModeOnPage());
  const fields = field('propose-new');
  if (fields) fields.hidden = adding;
  const who = field('propose-who');
  if (who) who.hidden = false;
  const approvals = 'Approvals given before may need to be given again.';
  if (who && adding) who.textContent = scope ? `Your edits go on top of ${name}, and reviewers see them there. ${approvals}` : `Reviewers see your edits in the branch you pick. ${approvals}`;
  const go = $<HTMLButtonElement>('ed-propose-go');
  if (go) setButtonLabel(go, sendLabel());
  const slot = field('propose-target');
  if (!slot) return;
  slot.hidden = Boolean(scope) || !targets.length;
  if (slot.hidden) {
    unmountFrom(slot);
    return;
  }
  mountInto(
    slot,
    createElement(TargetChoiceView, {
      options: targetOptions(targets, relativeTime),
      value: targetValue(choice),
      onChange: (v: string) => {
        choice = parseTargetValue(v) ?? { kind: 'new' };
        clearConflict();
        paintSend();
        const sum = proposalSummary();
        const w = field('propose-who');
        if (sum && w && choice.kind === 'new') w.textContent = sum.sentence;
        document.dispatchEvent(new CustomEvent('bridge:draft'));
      },
    }),
  );
}

/**
 * Adds the draft to change `into`. `keepMine`: tokens the designer chose to keep their value for after a conflict
 * (an explicit choice in the notice, never a silent overwrite).
 */
async function addInto(into: number, keepMine: string[] = []) {
  const out = $('ed-propose-status')!;
  if (!S?.applied) return;
  out.textContent = 'Adding to the branch';
  try {
    assertBranchWrites('add to branches', 'Send your edits as a suggestion instead.');
    const r = await addToChange({ n: into, config: S.config, base: S.head, ours: S.applied.proposed, draft: S.draft, scoped: Boolean(scope), keepMine });
    out.textContent = addedSentence(r.added.length, r.title, r.upstream);
    // Token edits are in the change now; docs edits stay in the local draft (the docs editor sends them).
    S.draft = { edits: scope ? [] : S.draft.edits.filter((e) => e.kind === 'docs') };
    saveDraft();
    location.href = studioHref(`changes/?pr=${r.number}&added=${r.added.length}`);
  } catch (err) {
    if (err instanceof ChangeConflictError) {
      out.textContent = '';
      showConflict(err);
    } else showGhError(out, err, `Not added: ${(err as Error).message}`, 'add to branches');
  }
}

/** The conflict notice replaces the dialog's primary: keep mine or keep theirs, per the tokens it names. */
function clearConflict() {
  const slot = field('propose-conflict');
  const go = field('propose-go');
  if (go) go.hidden = false;
  if (!slot) return;
  slot.hidden = true;
  unmountFrom(slot);
}

function showConflict(err: ChangeConflictError) {
  const slot = field('propose-conflict');
  if (!slot) return;
  slot.hidden = false;
  const go = field('propose-go');
  if (go) go.hidden = true;
  const h = $('ed-propose-dialog-title');
  if (h) h.textContent = 'Your edits were not added';
  const who = field('propose-who');
  if (who) who.hidden = true;
  mountInto(
    slot,
    createElement(ConflictNotice, {
      text: err.message,
      paths: err.paths,
      href: conflictHref(err.change),
      // Mine: save again, letting the draft win on these tokens only.
      onKeepMine: () => {
        clearConflict();
        void addInto(err.change, err.paths);
      },
      // Theirs: drop the draft's edits of these tokens, then save the rest (if any).
      onKeepTheirs: () => {
        if (!S) return;
        clearConflict();
        S.draft = dropEdits(S.draft, err.paths);
        saveDraft();
        recompute();
        if (S.draft.edits.some((e) => e.kind !== 'docs')) void addInto(err.change);
        else {
          $('ed-propose-status')!.textContent = 'Your edit was dropped. The branch keeps its value, so there is nothing left to add.';
          paintSend();
        }
      },
    }),
  );
}

export function initTokenEditor() {
  if (S) return;
  // Token files, config and contrast pairs: from the token explorer component (xp-*), or the older page ids.
  const filesEl = $('xp-files') ?? $('tx-files');
  const cfgEl = $('xp-config') ?? $('tx-config');
  const checksEl = $('xp-checks') ?? $('bridge-contrast');
  if (!filesEl || !cfgEl) return;
  const config = loadConfig(cfgEl.textContent || '{}');
  const originals = JSON.parse(filesEl.textContent || '{}') as Record<string, string>;
  const head = buildTokenSet(originals, layoutOptions(config));
  // One address model (lib/view-scope): ?change=N views a change (read only), ?change=N&edit=1 edits it here.
  const pageScope = scopeOf(location.search, location.pathname);
  const scoped = pageScope.kind === 'edit' ? pageScope.change : null;
  const viewing = pageScope.kind === 'view';
  S = { config, originals, head, pairs: parseContrastChecks(checksEl?.textContent || undefined), draft: scoped ? emptyDraft() : loadDraft(), applied: null, checks: null, contrastBefore: [], contrastAfter: [] };
  if (scoped) void openScope(scoped);

  let lastViewer: string | null = null;
  initGitHubConnect((v) => {
    paintTray();
    // Signed in outside a change: read which changes take more edits (the default target of the send dialog).
    if (!scoped && v && v.login !== lastViewer) void refreshTargets();
    lastViewer = v?.login ?? null;
  });
  // Write access widens the list (a writer may add to any token change): read it again once known.
  if (!scoped) onAccess((a) => a && void refreshTargets());

  const toggle = $<HTMLButtonElement>('tx-edit-toggle');
  setEditingImpl = (on: boolean) => {
    if (on && viewing) return;
    document.body.classList.toggle('is-editing', on);
    toggle?.setAttribute('aria-pressed', String(on));
    try {
      sessionStorage.setItem('bridge.editing', on ? '1' : '');
    } catch {
      /* ignore */
    }
    paintTray();
    document.dispatchEvent(new CustomEvent('bridge:editing', { detail: on }));
  };
  toggle?.addEventListener('click', () => setEditing(!document.body.classList.contains('is-editing')));
  let startEditing = new URLSearchParams(location.search).get('edit') === '1';
  try {
    startEditing ||= sessionStorage.getItem('bridge.editing') === '1';
  } catch {
    /* ignore */
  }
  recompute();
  // Studio Tokens turns edit mode on itself (the explorer in mode "edit"); the Drafts page only shows the tray.
  // Viewing a change is read only: nothing turns editing on (the draft stays as it is, for the latest library).
  if (!viewing && (startEditing || (S.draft.edits.length && !$('ed-tray')?.dataset.variant))) setEditing(true);

  const tray = $('ed-tray');
  // Side sheet: the header's Drafts button opens the tray on the right, whatever the count.
  const scrim = document.querySelector<HTMLElement>('[data-ed-sheet-scrim]');
  const closeBtn = document.querySelector<HTMLButtonElement>('[data-ed-sheet-close]');
  let sheetReturn: HTMLElement | null = null;
  const setSheet = (on: boolean) => {
    if (!tray || tray.dataset.variant === 'page') return;
    if (on) {
      sheetReturn = document.activeElement as HTMLElement | null;
      tray.dataset.sheet = 'true';
      tray.dataset.open = 'true';
      tray.setAttribute('role', 'dialog');
      tray.setAttribute('aria-modal', 'true');
    } else {
      delete tray.dataset.sheet;
      tray.dataset.open = 'false';
      tray.removeAttribute('role');
      tray.removeAttribute('aria-modal');
    }
    $('ed-tray-toggle')?.setAttribute('aria-expanded', String(on));
    if (scrim) scrim.hidden = !on;
    if (closeBtn) closeBtn.hidden = !on;
    document.body.classList.toggle('no-scroll', on);
    paintTray();
    if (on) closeBtn?.focus();
    else {
      sheetReturn?.focus();
      sheetReturn = null;
    }
  };
  document.addEventListener('click', (e) => {
    const open = (e.target as HTMLElement).closest('[data-drafts-open]');
    if (!open || !tray || tray.dataset.variant === 'page' || (e as MouseEvent).metaKey || (e as MouseEvent).ctrlKey) return;
    e.preventDefault();
    setSheet(tray.dataset.sheet !== 'true');
  });
  closeBtn?.addEventListener('click', () => setSheet(false));
  scrim?.addEventListener('click', () => setSheet(false));
  tray?.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && tray.dataset.sheet === 'true') {
      e.stopPropagation();
      setSheet(false);
    }
  });
  $('ed-tray-toggle')?.addEventListener('click', () => {
    if (tray?.dataset.variant === 'page' || tray?.dataset.sheet === 'true') return;
    const open = tray?.dataset.open !== 'true';
    if (tray) tray.dataset.open = String(open);
    $('ed-tray-toggle')?.setAttribute('aria-expanded', String(open));
  });
  $('ed-tray-list')?.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-ed-undo]');
    if (!b || !S) return;
    S.draft.edits.splice(Number(b.dataset.edUndo), 1);
    saveDraft();
    recompute();
  });
  $('ed-discard')?.addEventListener('click', () => {
    if (!S || !S.draft.edits.length || !window.confirm('Discard every draft edit?')) return;
    S.draft = emptyDraft();
    saveDraft();
    recompute();
  });
  $('ed-add')?.addEventListener('click', (e) => openDialog('ed-add-dialog', { returnFocus: e.currentTarget as HTMLElement }));
  $('ed-add-save')?.addEventListener('click', () => {
    if (!S) return;
    const path = (field<HTMLInputElement>('add-path')?.value ?? '').trim();
    const light = (field<HTMLInputElement>('add-light')?.value ?? '').trim();
    const dark = (field<HTMLInputElement>('add-dark')?.value ?? '').trim();
    const err = field('add-error')!;
    const problem = !/^color(\.[a-z0-9-]+)+$/.test(path)
      ? 'Name it like color.bg.canvas: dot-separated, lowercase, starting with color.'
      : S.head.byPath.has(path)
        ? `${path} already exists.`
        : !S.head.byPath.has(light) || !S.head.byPath.has(dark)
          ? 'Point both themes at existing palette roles, like palette.neutral.50.'
          : '';
    (err.querySelector('[data-ed-error-text]') ?? err).textContent = problem;
    err.hidden = !problem;
    if (problem) return;
    S.draft.edits.push({ kind: 'add', id: uid(), path, type: 'color', tier: 'semantic', values: { light: `{${light}}`, dark: `{${dark}}` } });
    saveDraft();
    recompute();
    closeDialog('ed-add-dialog', 'add');
  });
  // The title starts from the edit in plain words; once the person types their own, a later edit keeps it.
  let autoTitle = '';
  $('ed-propose')?.addEventListener('click', () => {
    if (!S?.draft.edits.length || !hasWorkingToken() || blocked()) return;
    resetSent();
    clearConflict();
    $('ed-propose-status')!.textContent = '';
    paintSend();
    const sum = proposalSummary();
    const titleField = field<HTMLInputElement>('propose-title');
    if (sum && titleField && (!titleField.value.trim() || titleField.value === autoTitle)) {
      titleField.value = sum.title;
      autoTitle = sum.title;
    }
    const who = field('propose-who');
    if (sum && who && !scope && choice.kind === 'new') who.textContent = sum.sentence;
    openDialog('ed-propose-dialog');
  });
  $('ed-propose-go')?.addEventListener('click', async () => {
    const go = $<HTMLButtonElement>('ed-propose-go')!;
    const out = $('ed-propose-status')!;
    setButtonDisabled(go, true);
    clearConflict();
    const into = scope?.number ?? (choice.kind === 'change' ? choice.number : null);
    if (into) {
      await addInto(into);
      setButtonDisabled(go, false);
      return;
    }
    let jira: string | null;
    const jiraField = field<HTMLInputElement>('propose-jira');
    jiraField?.removeAttribute('aria-invalid');
    try {
      jira = parseJiraKey(jiraField?.value);
    } catch (err) {
      out.textContent = (err as Error).message;
      setButtonDisabled(go, false);
      jiraField?.setAttribute('aria-invalid', 'true');
      jiraField?.focus();
      return;
    }
    const mode = changesModeOnPage();
    out.textContent = sendingLine(mode);
    try {
      const sent = await propose(field<HTMLInputElement>('propose-title')?.value ?? '', field<HTMLTextAreaElement>('propose-notes')?.value ?? '', jira);
      // Docs edits stay: they are proposed from the docs editor.
      S!.draft = { edits: S!.draft.edits.filter((e) => e.kind === 'docs') };
      saveDraft();
      if (sent.kind === 'branch') {
        location.href = studioHref(`changes/?pr=${sent.number}`);
        return;
      }
      recompute();
      showSent(sent);
    } catch (err) {
      showGhError(out, err, notSentLine(mode, (err as Error).message), mode === 'suggest' ? 'send suggestions' : 'create branches');
      setButtonDisabled(go, false);
    }
  });
}

/**
 * The send dialog once a suggestion is filed: the done sentence (who reviews, who applies), one quiet link to it, and
 * the dialog's only action becomes Done. The draft is already cleared.
 */
function showSent(sent: Extract<Sent, { kind: 'suggestion' }>) {
  const h = $('ed-propose-dialog-title');
  if (h) h.textContent = 'Suggestion sent';
  const fields = field('propose-new');
  if (fields) fields.hidden = true;
  const who = field('propose-who');
  if (who) who.textContent = SUGGEST_NEXT;
  const target = field('propose-target');
  if (target) target.hidden = true;
  const go = field('propose-go');
  if (go) go.hidden = true;
  const close = $('ed-propose-dialog')?.querySelector<HTMLButtonElement>('[data-dialog-close]:not([aria-label])');
  if (close) {
    close.dataset.edLabel ??= close.textContent ?? '';
    setButtonLabel(close, 'Done');
  }
  const out = $('ed-propose-status');
  if (out) out.innerHTML = `${esc(suggestionSentLine(sent.number))} <a href="${attrUrl(sent.url)}" target="_blank" rel="noopener">${esc(SEE_SUGGESTION)}</a>${sent.warnings.length ? ` <span class="muted">${esc(sent.warnings.join(' '))}</span>` : ''}`;
}

/** Back to the send state after a suggestion was shown (the next open of the dialog). */
function resetSent() {
  const go = field('propose-go');
  if (go) go.hidden = false;
  const close = $('ed-propose-dialog')?.querySelector<HTMLButtonElement>('[data-dialog-close]:not([aria-label])');
  if (close?.dataset.edLabel !== undefined) {
    setButtonLabel(close, close.dataset.edLabel);
    delete close.dataset.edLabel;
  }
  setButtonDisabled($<HTMLButtonElement>('ed-propose-go')!, false);
}
