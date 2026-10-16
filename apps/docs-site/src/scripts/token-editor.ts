// Token editor: Edit mode of the token explorer. Every edit lands in a draft (kept in localStorage), repaints a live
// preview of real components, runs the same guardrails as the build and the Figma plugin, and is proposed as a pull
// request with the user's own GitHub token. Nothing is written to the repo without review.
import {
  GitHubClient,
  buildTokenSet,
  branchName,
  classifyRisk,
  commitMessage,
  composeChangeset,
  composePrBody,
  isAlias,
  aliasTarget,
  layoutOptions,
  loadConfig,
  loadRepoFiles,
  parseColor,
  parseContrastChecks,
  rgbaToDtcg,
  rgbaToHex,
  hexToRgba,
  resolve,
  validateProposal,
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
import { currentScope } from './shell';
import { esc, getToken, initGitHubConnect, readRepo } from './github-session';

/** The config's repository, or the one this site documents when the config names none. */
function repoOf(config: BridgeConfig): { owner: string; name: string; defaultBranch: string } {
  if (config.repo) return config.repo;
  const r = readRepo();
  return { owner: r.owner, name: r.repo, defaultBranch: r.defaultBranch };
}

const DRAFT_KEY = 'bridge.draft.v1';
const MODE_LABEL: Record<string, string> = { light: 'Light', dark: 'Dark', bridge: 'Bridge', ocean: 'Ocean', comfortable: 'Comfortable', compact: 'Compact' };
const label = (m: string) => MODE_LABEL[m] ?? m.charAt(0).toUpperCase() + m.slice(1);
const TIER_NOTE: Record<string, string> = {
  primitive: 'You are editing a primitive: a raw value. Every brand role and semantic token that points here changes with it, in every theme. Prefer re-pointing a semantic token or a palette role.',
  brand: 'You are editing a brand palette role. It changes every semantic token that uses this role, in both themes, for this brand only.',
  semantic: 'You are editing a semantic token. Point it at a palette role; raw values are allowed but skip the brand layer, so brands cannot re-theme them.',
  base: 'You are editing a theme-independent token (motion, layers, sizes). It applies in every theme and brand.',
  density: 'You are editing a density token. It changes control heights and paddings for this density only.',
  component: 'You are editing a component token. Point it at a semantic token so themes and brands flow through.',
};

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
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T | null;

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
    if (S) localStorage.setItem(DRAFT_KEY, JSON.stringify(S.draft));
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
  paintPreview();
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
  if (!S) return;
  const before = S.head.byPath.get(t.path)?.values[mode];
  S.draft.edits = S.draft.edits.filter((e) => !(e.kind === 'value' && e.path === t.path && e.mode === mode));
  if (JSON.stringify(before) !== JSON.stringify(after)) S.draft.edits.push({ kind: 'value', id: uid(), path: t.path, mode, before, after });
  saveDraft();
  schedule();
}

// ---------------------------------------------------------------------------------------------------------------
// Preview

function paintPreview() {
  if (!S?.applied) return;
  const scope = currentScope();
  document.querySelectorAll<HTMLElement>('[data-ed-frame]').forEach((frame) => {
    const theme = frame.dataset.theme ?? 'light';
    const vars = previewOverrides(S!.head, S!.applied!.proposed, { brand: scope.brand, theme, density: scope.density });
    frame.removeAttribute('style');
    for (const [k, v] of Object.entries(vars)) frame.style.setProperty(k, v);
  });
}

// ---------------------------------------------------------------------------------------------------------------
// Editor section inside the token drawer

function currentValue(t: LogicalToken, mode: string): unknown {
  const e = [...(S?.draft.edits ?? [])].reverse().find((x) => x.kind === 'value' && x.path === t.path && x.mode === mode) as Extract<DraftEdit, { kind: 'value' }> | undefined;
  return e ? e.after : t.values[mode];
}

function resolvedHex(t: LogicalToken, mode: string): string | null {
  if (!S?.applied) return null;
  const set = S.applied.proposed;
  const axis = t.tier === 'brand' ? 'brand' : t.tier === 'semantic' ? 'theme' : t.tier === 'density' ? 'density' : null;
  const scope = currentScope();
  const ctx = { brand: scope.brand, theme: 'light', density: scope.density, overrides: set.overrideIndex, ...(axis ? { [axis]: mode } : {}) };
  const r = resolve(set.byPath, t.path, ctx);
  const c = r.value !== undefined ? parseColor(r.value) : undefined;
  return c ? rgbaToHex(c) : null;
}

function rawEditor(t: LogicalToken, value: unknown): string {
  if (t.type === 'color') {
    const c = isAlias(value) ? undefined : parseColor(value);
    const hex = c ? rgbaToHex(c) : '#000000';
    return `<div class="ed-raw-row"><input type="color" value="${hex.slice(0, 7)}" data-ed-color aria-label="Pick a color" /><input class="ed-input mono" value="${hex}" data-ed-hex aria-label="Hex value" spellcheck="false" /></div>`;
  }
  if (t.type === 'dimension' || t.type === 'duration') {
    const d = !isAlias(value) && value && typeof value === 'object' ? (value as { value: number; unit: string }) : { value: 0, unit: t.type === 'duration' ? 'ms' : 'px' };
    return `<div class="ed-raw-row"><button type="button" class="ed-step" data-ed-step="-1" aria-label="Decrease">-</button><input class="ed-input num" type="number" value="${d.value}" step="${t.type === 'duration' ? 25 : 1}" data-ed-num aria-label="Value" /><button type="button" class="ed-step" data-ed-step="1" aria-label="Increase">+</button><span class="ed-unit mono" data-ed-unit>${esc(d.unit)}</span></div>`;
  }
  return `<input class="ed-input mono" value="${esc(isAlias(value) ? '' : JSON.stringify(value))}" data-ed-json aria-label="Raw value as JSON" />`;
}

export function renderEditor(path: string, slot: HTMLElement) {
  if (!S) return;
  const t = (S.applied?.proposed ?? S.head).byPath.get(path) ?? S.head.byPath.get(path);
  if (!t) {
    slot.innerHTML = '<p class="muted small">This token is not in the token files this site was built from.</p>';
    return;
  }
  const modes = Object.keys(t.values);
  let mode = slot.dataset.mode && modes.includes(slot.dataset.mode) ? slot.dataset.mode : modes[0]!;
  const candidates = aliasCandidates(S.head, t);
  const listId = `ed-alias-${uid()}`;
  const draw = () => {
    const v = currentValue(t, mode);
    const alias = isAlias(v) ? aliasTarget(v) : '';
    const hex = t.type === 'color' ? resolvedHex(t, mode) : null;
    const edited = S!.draft.edits.some((e) => (e.kind === 'value' && e.path === t.path) || ((e.kind === 'rename' || e.kind === 'delete') && e.path === t.path));
    const nudgeRaw = t.tier === 'semantic' || t.tier === 'component';
    slot.innerHTML = `
      <div class="ed">
        <div class="ed-head"><h3>Edit</h3>${edited ? '<span class="pill is-accent">In draft</span>' : ''}</div>
        <p class="ed-note is-${t.tier}">${esc(TIER_NOTE[t.tier] ?? '')}</p>
        ${
          modes.length > 1
            ? `<div class="ed-modes" role="radiogroup" aria-label="Mode">${modes
                .map((m) => `<button type="button" role="radio" aria-checked="${m === mode}" data-ed-mode="${esc(m)}">${esc(label(m))}</button>`)
                .join('')}</div>`
            : ''
        }
        <div class="ed-field">
          <label class="ed-label" for="${listId}-in">${t.tier === 'primitive' ? 'Value' : 'Points to'}</label>
          ${
            t.tier === 'primitive'
              ? rawEditor(t, v)
              : `<div class="ed-alias">${hex ? `<span class="ed-sw" style="background-color:${hex}"></span>` : ''}<input id="${listId}-in" class="ed-input mono" list="${listId}" value="${esc(alias)}" placeholder="${alias ? '' : 'Raw value below'}" data-ed-alias spellcheck="false" autocomplete="off" /><datalist id="${listId}">${candidates
                  .map((c) => `<option value="${esc(c)}"></option>`)
                  .join('')}</datalist></div>
                 <p class="ed-hint">${candidates.length} ${t.type} tokens you can point to from this tier.</p>
                 <details class="ed-rawbox"${alias ? '' : ' open'}><summary>${nudgeRaw ? 'Use a raw value (not recommended)' : 'Use a raw value'}</summary>${rawEditor(t, v)}</details>`
          }
        </div>
        <div class="ed-frames" aria-label="Live preview, light and dark">
          ${['light', 'dark']
            .map((th) => `<div class="ed-frame" data-theme="${th}" data-ed-frame><span class="ed-frame-label">${th === 'light' ? 'Light' : 'Dark'}</span>${$('ed-preview-tpl')?.innerHTML ?? ''}</div>`)
            .join('')}
        </div>
        <div class="ed-row-actions">
          ${t.tier === 'semantic' ? '<button type="button" class="btn btn-secondary btn-sm" data-ed-rename>Rename</button><button type="button" class="btn btn-secondary btn-sm ed-danger" data-ed-delete>Delete</button>' : ''}
          <button type="button" class="btn btn-secondary btn-sm" data-ed-reset ${edited ? '' : 'disabled'}>Undo edits on this token</button>
        </div>
        <div class="ed-live" data-ed-live></div>
      </div>`;
    paintLive(slot, t);
    paintPreview();
  };

  slot.oninput = (e) => {
    const el = e.target as HTMLInputElement;
    if (el.matches('[data-ed-alias]')) {
      const p = el.value.trim();
      if (S!.head.byPath.has(p) || (S!.applied?.proposed.byPath.has(p) ?? false)) setValue(t, mode, `{${p}}`);
      else if (!p) return;
      else setValue(t, mode, `{${p}}`); // broken references are shown by the guardrails, not silently dropped
    }
    if (el.matches('[data-ed-color]')) {
      const hexIn = slot.querySelector<HTMLInputElement>('[data-ed-hex]');
      if (hexIn) hexIn.value = el.value;
      const c = hexToRgba(el.value);
      if (c) setValue(t, mode, rgbaToDtcg(c));
    }
    if (el.matches('[data-ed-hex]')) {
      const c = /^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(el.value.trim()) ? hexToRgba(el.value.trim()) : undefined;
      el.setAttribute('aria-invalid', String(!c));
      if (c) setValue(t, mode, rgbaToDtcg(c));
    }
    if (el.matches('[data-ed-num]')) {
      const unit = slot.querySelector('[data-ed-unit]')?.textContent ?? 'px';
      const n = Number(el.value);
      if (Number.isFinite(n)) setValue(t, mode, { value: n, unit });
    }
    if (el.matches('[data-ed-json]')) {
      try {
        setValue(t, mode, JSON.parse(el.value));
        el.setAttribute('aria-invalid', 'false');
      } catch {
        el.setAttribute('aria-invalid', 'true');
      }
    }
  };
  slot.onclick = (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('button');
    if (!b) return;
    if (b.dataset.edMode) {
      mode = b.dataset.edMode;
      slot.dataset.mode = mode;
      draw();
    } else if (b.dataset.edStep) {
      const input = slot.querySelector<HTMLInputElement>('[data-ed-num]');
      if (input) {
        input.value = String(Number(input.value) + Number(b.dataset.edStep) * Number(input.step || 1));
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
    } else if (b.hasAttribute('data-ed-reset')) {
      S!.draft.edits = S!.draft.edits.filter((x) => x.path !== t.path);
      saveDraft();
      recompute();
      draw();
    } else if (b.hasAttribute('data-ed-delete')) {
      if (!window.confirm(`Delete ${t.path}? Components that read it will lose the value. This is a breaking change (major).`)) return;
      S!.draft.edits.push({ kind: 'delete', id: uid(), path: t.path });
      saveDraft();
      recompute();
      draw();
    } else if (b.hasAttribute('data-ed-rename')) {
      const to = window.prompt(`New name for ${t.path}`, t.path)?.trim();
      if (!to || to === t.path) return;
      if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(to)) return window.alert('Use dot-separated lowercase names, like color.bg.canvas.');
      S!.draft.edits.push({ kind: 'rename', id: uid(), path: t.path, to });
      saveDraft();
      recompute();
      draw();
    }
  };
  const onDraft = () => paintLive(slot, t);
  document.addEventListener('bridge:draft', onDraft);
  slot.addEventListener('ed:dispose', () => document.removeEventListener('bridge:draft', onDraft), { once: true });
  draw();
}

function paintLive(slot: HTMLElement, t: LogicalToken) {
  const live = slot.querySelector<HTMLElement>('[data-ed-live]');
  if (!live || !S?.checks) return;
  const mine = S.checks.blocking.filter((i) => !i.path || i.path === t.path || i.code === 'contrast');
  const moves = contrastMoves({ contrastBefore: S.contrastBefore, contrastAfter: S.contrastAfter }).filter((m) => m.fg === t.path || m.bg === t.path || S!.draft.edits.some((e) => e.path === t.path));
  live.innerHTML = `
    ${
      mine.length
        ? `<div class="ed-block" role="alert"><strong>Proposing is blocked</strong><ul>${mine
            .slice(0, 6)
            .map((i) => `<li>${esc(i.message)}</li>`)
            .join('')}</ul></div>`
        : S.draft.edits.length
          ? '<p class="ed-ok">Guardrails pass: references resolve, no cycles, every contrast pair meets its minimum.</p>'
          : ''
    }
    ${
      moves.length
        ? `<ul class="ed-moves">${moves
            .slice(0, 8)
            .map((m) => `<li class="${m.after < m.min ? 'is-fail' : ''}"><span class="mono small">${esc(m.fg)} on ${esc(m.bg)}</span><span class="small muted">${esc(m.where)}</span><span class="num">${m.before?.toFixed(2) ?? '?'} -> <strong>${m.after.toFixed(2)}</strong></span></li>`)
            .join('')}</ul>`
        : ''
    }`;
}

// ---------------------------------------------------------------------------------------------------------------
// Draft tray

function paintTray() {
  const tray = $('ed-tray');
  if (!tray || !S?.applied || !S.checks) return;
  const rows = trayRows(S.head, S.applied.proposed, S.draft);
  const n = rows.length;
  // The Drafts page shows the tray as a page section, always visible; elsewhere it is a bar that appears while editing.
  const asPage = tray.dataset.variant === 'page';
  // Studio Tokens: a bar at the bottom only while the draft has changes; the header's Drafts button opens it as a
  // side sheet at any count.
  tray.hidden = !asPage && n === 0 && tray.dataset.sheet !== 'true';
  const empty = $('ed-drafts-empty');
  if (empty) empty.hidden = n > 0;
  $('ed-tray-count')!.textContent = n ? `${n} draft change${n > 1 ? 's' : ''}` : 'No draft changes yet';
  const fails = S.checks.blocking.length;
  const status = $('ed-tray-status')!;
  status.textContent = !n ? 'Open a token to edit it.' : fails ? `${fails} guardrail${fails > 1 ? 's' : ''} block proposing` : 'Guardrails pass';
  status.className = `ed-tray-status ${!n ? '' : fails ? 'is-fail' : 'is-pass'}`;
  const propose = $<HTMLButtonElement>('ed-propose')!;
  const signedIn = Boolean(getToken());
  // Without a token the draft can still leave the browser, as a JSON file with the edited token files.
  propose.disabled = !n || (signedIn && fails > 0);
  propose.textContent = signedIn ? 'Propose change' : 'Export draft';
  const exp = $('ed-export');
  if (exp) exp.hidden = !signedIn;
  const sw = (hex: string | null) => (hex ? `<span class="ed-sw sm" style="background-color:${hex}"></span>` : '');
  const moves = contrastMoves({ contrastBefore: S.contrastBefore, contrastAfter: S.contrastAfter });
  $('ed-tray-list')!.innerHTML = rows.length
    ? rows
        .map(
          (r) => `<li class="ed-tray-row">
            <div class="ed-tray-main"><span class="mono">${esc(r.label)}</span>${r.context ? `<span class="pill">${esc(r.context)}</span>` : ''}</div>
            <div class="ed-tray-vals">${r.before ? `${sw(r.before.hex)}<span class="mono small">${esc(r.before.text)}</span>` : ''}${r.before && r.after ? '<span class="muted">-></span>' : ''}${r.after ? `${sw(r.after.hex)}<span class="mono small">${esc(r.after.text)}</span>` : ''}</div>
            <button type="button" class="btn btn-secondary btn-sm" data-ed-undo="${r.index}">Undo</button>
          </li>`,
        )
        .join('') +
      (moves.length
        ? `<li class="ed-tray-contrast"><p class="small"><strong>Contrast moves</strong></p><ul>${moves
            .slice(0, 10)
            .map((m) => `<li class="${m.after < m.min ? 'is-fail' : ''}"><span class="mono small">${esc(m.fg)} on ${esc(m.bg)}</span> <span class="small muted">${esc(m.where)}</span> <span class="num small">${m.before?.toFixed(2) ?? '?'} -> ${m.after.toFixed(2)} (min ${m.min})</span></li>`)
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

function downloadDraft() {
  if (!S?.applied) return;
  const payload = {
    $comment: 'Bridge token draft. Apply the files to the token root, or open a pull request with them.',
    repo: `${repoOf(S.config).owner}/${repoOf(S.config).name}`,
    tokensRoot: S.config.tokens.root,
    edits: S.draft.edits,
    files: S.applied.files,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `bridge-draft-${draftSlug(S.draft)}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}

async function propose(title: string, notes: string): Promise<number> {
  if (!S) throw new Error('Editor not ready');
  const token = getToken();
  if (!token) throw new Error('Connect GitHub first.');
  const { owner, name, defaultBranch } = repoOf(S.config);
  const client = new GitHubClient(`${owner}/${name}`, token);
  const mainSha = await client.getBranchSha(defaultBranch);
  if (!mainSha) throw new Error(`Branch ${defaultBranch} not found.`);
  // Re-read the latest token files so the change applies on top of main as it is now.
  const latest = await loadRepoFiles(client, mainSha, S.config.tokens.root);
  const config = latest.config ?? S.config;
  const opts = layoutOptions(config);
  const head = buildTokenSet(latest.files, opts);
  const pairs = parseContrastChecks(latest.contrastChecks);
  const applied = applyDraft(head, latest.files, S.draft, opts);
  if (!applied.changes.length) throw new Error('main already has these values. Nothing to propose.');
  const validation = validateProposal(applied.proposed, head, pairs);
  if (validation.blocking.length) throw new Error(`Guardrails block this change on the latest main: ${validation.blocking[0]!.message}`);
  const branch = branchName(draftSlug(S.draft), new Date());
  const risk = classifyRisk({ tokenChanges: applied.changes, config });
  const prTitle = title.trim() || `tokens: ${applied.changes.length} token change${applied.changes.length > 1 ? 's' : ''} from Bridge`;
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
    title: prTitle,
    notes,
    upstreamPaths: [],
    resolvedConflicts: [],
  });
  const files: { path: string; sha: string }[] = [];
  for (const [rel, text] of Object.entries(applied.files)) files.push({ path: `${latest.tokensPath}/${rel}`, sha: await client.createBlob(text) });
  if (config.changeset) {
    const cs = composeChangeset(applied.changes, { title: prTitle, branch, packageName: config.changeset.package, source: 'from the Bridge web editor' });
    files.push({ path: cs.path, sha: await client.createBlob(cs.content) });
  }
  const tree = await client.createTree(latest.treeSha, files);
  const commit = await client.createCommit(commitMessage(prTitle, applied.changes, 'Proposed with the Bridge token editor.'), tree, [mainSha]);
  await client.createBranch(branch, commit);
  const pr = await client.createPullRequest({ title: prTitle, head: branch, base: defaultBranch, body, draft: false });
  await client.addLabels(pr.number, ['tokens', 'source: bridge-web', `tier-${risk.tier}`]).catch(() => false);
  return pr.number;
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

/** Drops every draft edit of one token. */
export function undoToken(path: string) {
  if (!S) return;
  S.draft.edits = S.draft.edits.filter((x) => x.path !== path);
  saveDraft();
  recompute();
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
  S = { config, originals, head, pairs: parseContrastChecks(checksEl?.textContent || undefined), draft: loadDraft(), applied: null, checks: null, contrastBefore: [], contrastAfter: [] };

  initGitHubConnect(() => paintTray());

  const toggle = $<HTMLButtonElement>('tx-edit-toggle');
  setEditingImpl = (on: boolean) => {
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
  // The explorer drawer asks for an editor when edit mode is on. Listen before edit mode starts: turning it on
  // re-renders an open drawer.
  document.addEventListener('bridge:token-open', (e) => {
    const { path, slot } = (e as CustomEvent<{ path: string; slot: HTMLElement }>).detail;
    if (document.body.classList.contains('is-editing')) renderEditor(path, slot);
  });
  recompute();
  // Studio Tokens turns edit mode on itself (the explorer in mode "edit"); the Drafts page only shows the tray.
  if (startEditing || (S.draft.edits.length && !$('ed-tray')?.dataset.variant)) setEditing(true);
  document.addEventListener('bridge:scope', () => paintPreview());

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
    if (!S || !S.draft.edits.length || !window.confirm('Discard every draft change?')) return;
    S.draft = emptyDraft();
    saveDraft();
    recompute();
  });
  $('ed-add')?.addEventListener('click', () => ($<HTMLDialogElement>('ed-add-dialog') as HTMLDialogElement | null)?.showModal());
  $('ed-add-save')?.addEventListener('click', () => {
    if (!S) return;
    const path = ($<HTMLInputElement>('ed-add-path')?.value ?? '').trim();
    const light = ($<HTMLInputElement>('ed-add-light')?.value ?? '').trim();
    const dark = ($<HTMLInputElement>('ed-add-dark')?.value ?? '').trim();
    const err = $('ed-add-error')!;
    const problem = !/^color(\.[a-z0-9-]+)+$/.test(path)
      ? 'Name it like color.bg.canvas: dot-separated, lowercase, starting with color.'
      : S.head.byPath.has(path)
        ? `${path} already exists.`
        : !S.head.byPath.has(light) || !S.head.byPath.has(dark)
          ? 'Point both themes at existing palette roles, like palette.neutral.50.'
          : '';
    err.textContent = problem;
    err.hidden = !problem;
    if (problem) return;
    S.draft.edits.push({ kind: 'add', id: uid(), path, type: 'color', tier: 'semantic', values: { light: `{${light}}`, dark: `{${dark}}` } });
    saveDraft();
    recompute();
    ($<HTMLDialogElement>('ed-add-dialog') as HTMLDialogElement).close();
  });
  $('ed-propose')?.addEventListener('click', () => {
    if (!S?.draft.edits.length) return;
    if (!getToken()) return downloadDraft();
    ($<HTMLDialogElement>('ed-propose-dialog') as HTMLDialogElement | null)?.showModal();
  });
  $('ed-export')?.addEventListener('click', downloadDraft);
  $('ed-propose-go')?.addEventListener('click', async () => {
    const go = $<HTMLButtonElement>('ed-propose-go')!;
    const out = $('ed-propose-status')!;
    go.disabled = true;
    out.textContent = 'Creating a branch, committing the token files and a changeset, opening the pull request';
    try {
      const n = await propose($<HTMLInputElement>('ed-propose-title')?.value ?? '', $<HTMLTextAreaElement>('ed-propose-notes')?.value ?? '');
      S!.draft = emptyDraft();
      saveDraft();
      location.href = `/studio/reviews/?pr=${n}`;
    } catch (err) {
      out.textContent = `Not proposed: ${(err as Error).message}`;
      go.disabled = false;
    }
  });
}
