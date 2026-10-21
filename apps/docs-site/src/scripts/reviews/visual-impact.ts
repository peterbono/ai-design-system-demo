// Changes > pull request > Visual impact: reads the manifest the visual impact workflow published for the head
// commit, then shows each changed story or screen with a before/after slider and a diff toggle. Returns what the
// collapsed section header shows: the number of changed screens and a small before/after thumbnail.
import { badgeHtml } from '@bridge-ds/react/dom';
import { hasVisualWorkflow, VISUAL_CHECK_LABEL, VISUAL_CHECKS_DOCS } from '@bridge-ds/core';
import { changeLabel, facet, filterShots, modeLabel, VISUAL_BRANCH, visualAsk, visualBase, visualState, type VisualFilter, type VisualManifest, type VisualShot } from '../../lib/visual-impact';
import { attrUrl } from '../../lib/html';
import { esc, GitHubError, ghGet, ghWrite, hasWorkingToken, onAccess, showGhError } from '../github-session';
import { siteConfig } from '../repo-context';

const PAGE = 8;

type TreeEntry = { path: string; type: string; sha: string };

/**
 * Whether the workflow published a manifest for this PR commit, asked without a 404: the branch ref (an empty
 * list when it does not exist), then one level of tree per folder (pr-<n>/<sha>/manifest.json).
 */
export async function manifestPublished(owner: string, repo: string, pr: number, sha: string): Promise<boolean> {
  const refs = await ghGet<{ ref: string; object: { sha: string } }[]>(`/repos/${owner}/${repo}/git/matching-refs/heads/${VISUAL_BRANCH}`);
  const ref = refs.data.find((r) => r.ref === `refs/heads/${VISUAL_BRANCH}`);
  if (!ref) return false;
  let tree = ref.object.sha;
  for (const part of [`pr-${pr}`, sha]) {
    const t = await ghGet<{ tree: TreeEntry[] }>(`/repos/${owner}/${repo}/git/trees/${tree}`);
    const next = t.data.tree.find((e) => e.path === part && e.type === 'tree');
    if (!next) return false;
    tree = next.sha;
  }
  const leaf = await ghGet<{ tree: TreeEntry[] }>(`/repos/${owner}/${repo}/git/trees/${tree}`);
  return leaf.data.tree.some((e) => e.path === 'manifest.json' && e.type === 'blob');
}

/**
 * What the visual impact run says for a pull request commit, without painting anything: a difference on screen, no
 * difference, or null when it has not run (or could not be read). The Overview reads it to tell design work from
 * developer work (lib/work-nature).
 */
export async function impactOf(owner: string, repo: string, pr: number, sha: string): Promise<'changes' | 'no-change' | null> {
  try {
    if (!(await manifestPublished(owner, repo, pr, sha))) return null;
    const r = await ghGet<string>(`${visualBase(owner, repo, pr, sha)}/manifest.json`, { raw: true });
    const kind = visualState(JSON.parse(r.data) as VisualManifest).kind;
    return kind === 'changes' ? 'changes' : kind === 'no-change' ? 'no-change' : null;
  } catch {
    return null;
  }
}

const workflowReads = new Map<string, Promise<boolean | null>>();

/**
 * Whether the repo has the visual impact workflow (core hasVisualWorkflow over .github/workflows), read once per page.
 * False when the folder or the file is not there; null when GitHub could not say (the ask then shows as before).
 */
export function visualWorkflowPresent(owner: string, repo: string): Promise<boolean | null> {
  const key = `${owner}/${repo}`;
  let p = workflowReads.get(key);
  if (!p) {
    p = ghGet<{ name: string; path: string }[]>(`/repos/${owner}/${repo}/contents/.github/workflows`)
      .then((f) => (Array.isArray(f.data) ? hasVisualWorkflow(f.data.map((x) => x.path)) : null))
      .catch((err) => (err instanceof GitHubError && err.status === 404 ? false : null));
    workflowReads.set(key, p);
  }
  return p;
}

/** The quiet line where the before and after would be, on a repo without visual checks: a link to set them up. */
const SET_UP_LINE = `<p class="cg-line rv-what-quiet">This repo has no visual checks yet. <a href="${attrUrl(VISUAL_CHECKS_DOCS)}" target="_blank" rel="noopener">Set up visual checks</a></p>`;

export interface VisualSummary {
  /** Changed screens and stories; null when the workflow has not run for this commit (or could not be read). */
  changed: number | null;
  /** Before and after thumbnails of the biggest change, for the section header. */
  thumb: string;
  /** On demand: someone already asked for this pull request (label visual-check), the run is on its way. */
  asked?: boolean;
  /** On demand: the ask (or its state) is already painted in the top slot, renderTopChange leaves it. */
  paintedTop?: boolean;
  /** The biggest change (first in visualState order) and where its images live, for the before/after on top. */
  top?: VisualShot;
  base?: string;
  /** Every changed story and screen, most changed first ("Try it in the product" opens the top admin screen). */
  shots?: VisualShot[];
  /** The manifest could not be read (not a 404). */
  error?: string;
}

export async function loadVisualImpact(
  slot: HTMLElement,
  o: { owner: string; repo: string; pr: number; sha: string; actionsUrl: string },
  /** The before/after slot on top of the pull request: on demand, the ask lives there, not in the collapsed list. */
  topSlot?: HTMLElement,
): Promise<VisualSummary> {
  const base = visualBase(o.owner, o.repo, o.pr, o.sha);
  let manifest: VisualManifest | null = null;
  try {
    if (await manifestPublished(o.owner, o.repo, o.pr, o.sha)) {
      const r = await ghGet<string>(`${base}/manifest.json`, { raw: true });
      manifest = JSON.parse(r.data) as VisualManifest;
    }
  } catch (err) {
    if (!(err instanceof GitHubError && err.status === 404)) {
      slot.innerHTML = `<p class="rv-error">Could not read the visual impact: ${esc((err as Error).message)}</p>`;
      return { changed: null, thumb: '', error: (err as Error).message };
    }
  }
  const state = visualState(manifest);
  if (state.kind === 'not-computed') {
    // No workflow: no label to add and nothing that runs again, only how to set it up.
    if ((await visualWorkflowPresent(o.owner, o.repo)) === false) {
      (topSlot ?? slot).innerHTML = SET_UP_LINE;
      return { changed: null, thumb: '', paintedTop: Boolean(topSlot) };
    }
    const onTop = Boolean(topSlot) && visualMode() === 'on-demand';
    const asked = await notRun(onTop ? topSlot! : slot, o);
    return { changed: null, thumb: '', asked, paintedTop: onTop };
  }
  const m = state.manifest;
  const head = `<p class="small muted">${esc(String(m.summary.shots))} screenshot${m.summary.shots === 1 ? '' : 's'} compared with main, threshold ${esc(String(m.options.threshold))}.${
    m.selection.components.length ? ` Components in scope: ${m.selection.components.map((c) => esc(c.id)).join(', ')}.` : ''
  }${m.selection.fallback ? ` ${esc(m.selection.fallback)}` : ''}</p>`;
  if (state.kind === 'no-change') {
    slot.innerHTML = `<p class="cg-line">No visual change: every captured story and screen renders the same.</p>${head}`;
    return { changed: 0, thumb: '' };
  }
  const shots = state.shots;
  const filter: VisualFilter = { brand: 'all', theme: 'all', kind: 'all' };
  let shown = PAGE;
  const seg = (name: keyof VisualFilter, label: string, opts: [string, string][]) =>
    `<div class="vi-filter"><span class="vi-filter-label" id="vi-f-${name}">${label}</span><div class="rv-seg" role="group" aria-labelledby="vi-f-${name}">${opts
      .map(([v, t]) => `<button type="button" data-f="${name}" data-v="${esc(v)}" aria-pressed="${filter[name] === v}">${esc(t)}</button>`)
      .join('')}</div></div>`;
  const kinds = new Set(shots.map((s) => s.kind));
  slot.innerHTML = `${head}
    <div class="vi-filters">
      ${seg('brand', 'Brand', [['all', 'All'], ...facet(shots, 'brand').map((b) => [b, b] as [string, string])])}
      ${seg('theme', 'Theme', [['all', 'All'], ...facet(shots, 'theme').map((t) => [t, t] as [string, string])])}
      ${kinds.size > 1 ? seg('kind', 'Show', [['all', 'All'], ['story', 'Stories'], ['route', 'App screens']]) : ''}
    </div>
    <p class="small muted vi-count" role="status" aria-live="polite"></p>
    <div class="vi-list"></div>
    <p><button type="button" class="btn btn-secondary btn-sm vi-more" hidden>Show more</button></p>`;
  const list = slot.querySelector<HTMLElement>('.vi-list')!;
  const count = slot.querySelector<HTMLElement>('.vi-count')!;
  const more = slot.querySelector<HTMLButtonElement>('.vi-more')!;
  const render = () => {
    const visible = filterShots(shots, filter);
    count.textContent = visible.length ? `${Math.min(shown, visible.length)} of ${visible.length} change${visible.length === 1 ? '' : 's'}${visible.length < shots.length ? ` (${shots.length} in all modes)` : ''}` : '';
    list.innerHTML = visible.length ? visible.slice(0, shown).map((s) => shotCard(s, base)).join('') : '<p class="muted">No change in this brand and theme.</p>';
    more.hidden = visible.length <= shown;
    wire(list);
  };
  slot.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-f]');
    if (b) {
      filter[b.dataset.f as keyof VisualFilter] = b.dataset.v as never;
      slot.querySelectorAll<HTMLButtonElement>(`[data-f="${b.dataset.f}"]`).forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      shown = PAGE;
      render();
    }
  });
  more.addEventListener('click', () => {
    shown += PAGE;
    render();
  });
  render();
  const top = shots[0]!;
  const img = (p: string | undefined, label: string) => (p ? `<img src="${esc(`${base}/${p}`)}" alt="" loading="lazy" title="${label}" />` : '');
  const thumb = top.images.before && top.images.after ? `<span class="cg-thumb" aria-hidden="true">${img(top.images.before, 'Before')}${img(top.images.after, 'After')}</span>` : '';
  return { changed: shots.length, thumb, top, base, shots };
}

/**
 * The before/after on top of a pull request: the biggest visual change, with the same slider and diff toggle as
 * the full list, and a link to every changed screen. Without a manifest yet: one quiet line.
 */
export function renderTopChange(slot: HTMLElement, v: VisualSummary, allHref: string): void {
  if (v.error) {
    slot.innerHTML = `<p class="rv-error">Could not read the before and after: ${esc(v.error)}</p>`;
    return;
  }
  if (v.changed === null) {
    if (v.paintedTop) return;
    slot.innerHTML = '<p class="cg-line rv-what-quiet">The before and after is being prepared. It runs on its own whenever tokens or components change.</p>';
    return;
  }
  if (v.changed === 0 || !v.top || !v.base) {
    slot.innerHTML = '<p class="cg-line rv-what-quiet">No visual change.</p>';
    return;
  }
  const n = v.changed;
  // How to use it on first sight: the gesture, then what is compared, in plain words.
  const t = v.top;
  // "Order edit, light": the screen and the theme; the shop is the same for every screen of a change.
  slot.innerHTML = `<div class="rv-what-head"><p class="cg-line">Drag the handle to compare before and after.</p>${
    n > 1 ? `<a href="${attrUrl(allHref)}" data-open-visual>See all ${n} screens</a>` : ''
  }</div>${shotCard(t, v.base, t.theme)}<p class="small muted rv-what-caption">${esc(t.kind === 'route' ? 'App screen' : 'Component examples')}: ${esc(t.label)}${t.theme ? `, ${esc(t.theme)}` : ''}. ${n > 1 ? `The screen that changes most of the ${n} that change.` : 'The only screen that changes.'}</p>`;
  wire(slot);
}

/** visualImpact.mode from bridge.config.json, embedded by the layout. */
function visualMode(): 'auto' | 'on-demand' {
  try {
    const site = siteConfig() as { visualImpact?: { mode?: string } };
    return site.visualImpact?.mode === 'on-demand' ? 'on-demand' : 'auto';
  } catch {
    return 'auto';
  }
}

/**
 * No manifest for this commit. Automatic mode: the run is on its way, link to it. On demand: one button that adds
 * the visual-check label (the workflow runs on that label), or the way to do it on GitHub without a write token.
 */
async function notRun(slot: HTMLElement, o: { owner: string; repo: string; pr: number; sha: string; actionsUrl: string }): Promise<boolean> {
  const mode = visualMode();
  const run = `<a href="${attrUrl(o.actionsUrl)}" target="_blank" rel="noopener">Follow the run</a>`;
  let labels = mode === 'on-demand' ? await ghGet<{ name: string }[]>(`/repos/${o.owner}/${o.repo}/issues/${o.pr}/labels`).then((f) => f.data, () => null) : null;
  const paint = (canWrite: boolean) => {
    const ask = visualAsk({ mode, labels, canWrite, label: VISUAL_CHECK_LABEL });
    const lead = '<p class="cg-line">Your team shows the before and after on demand.</p>';
    slot.innerHTML =
      ask === 'auto'
        ? `<p class="cg-line">Not run yet for the latest edits. <a href="${attrUrl(o.actionsUrl)}" target="_blank" rel="noopener">Run it on GitHub</a></p>`
        : ask === 'asked'
          ? `<p class="cg-line">The before and after shows here once the run on GitHub finishes. ${run}</p>`
          : ask === 'ask'
            ? `<div class="vi-ask">${lead}<button type="button" class="btn btn-secondary btn-lg" data-vi-ask>Show the visual impact</button></div><p class="rv-error" role="alert" data-vi-ask-error hidden></p>`
            : `<div class="vi-ask">${lead}<a class="btn btn-secondary btn-lg" href="https://github.com/${esc(o.owner)}/${esc(o.repo)}/pull/${o.pr}" target="_blank" rel="noopener">Add the ${VISUAL_CHECK_LABEL} label on GitHub</a></div>`;
    const btn = slot.querySelector<HTMLButtonElement>('[data-vi-ask]');
    btn?.addEventListener('click', async () => {
      const error = slot.querySelector<HTMLElement>('[data-vi-ask-error]')!;
      btn.disabled = true;
      btn.textContent = 'Asking GitHub';
      try {
        await ghWrite('POST', `/repos/${o.owner}/${o.repo}/issues/${o.pr}/labels`, { labels: [VISUAL_CHECK_LABEL] });
        labels = [...(labels ?? []), { name: VISUAL_CHECK_LABEL }];
        paint(true);
        const meta = document.querySelector('#cg-sec-visual [data-sec-meta]');
        if (meta) meta.textContent = 'Asked';
      } catch (err) {
        btn.disabled = false;
        btn.textContent = 'Show the visual impact';
        showGhError(error, err, `GitHub did not add the ${VISUAL_CHECK_LABEL} label: ${(err as Error).message}`, 'add labels');
        error.hidden = false;
      }
    });
  };
  paint(hasWorkingToken());
  // A token that turns out read only gets the GitHub way instead of a button that would fail.
  if (mode === 'on-demand') onAccess((a) => slot.isConnected && slot.querySelector('[data-vi-ask]') && a && !a.write && paint(false));
  return visualAsk({ mode, labels, canWrite: false, label: VISUAL_CHECK_LABEL }) === 'asked';
}

/**
 * Where the split starts. Stories render top-left in a wide frame (the Divider story fills the left 45% of 1024px),
 * so a split at 50% put only empty canvas on the After side and read as a blank capture. At 25% both sides show
 * content.
 */
const START = 25;

/** One before/after card. `meta` replaces the mode line (the change view on top says the theme only). */
function shotCard(s: VisualShot, base: string, meta: string = modeLabel(s)): string {
  const size = s.size.after ?? s.size.before ?? { width: 4, height: 3 };
  // The manifest is a repo file: its sizes reach a style and width/height attributes, so they are numbers.
  const w = Number(size.width);
  const h = Number(size.height);
  const url = (p?: string) => (p ? `${base}/${p}` : '');
  const alt = `${s.label}, ${modeLabel(s)}`;
  const boxes = s.boxes
    .map((b) => `<i style="left:${(b.x / w) * 100}%;top:${(b.y / h) * 100}%;width:${(b.width / w) * 100}%;height:${(b.height / h) * 100}%"></i>`)
    .join('');
  const tone = s.status === 'error' ? 'danger' : 'neutral';
  const compare =
    s.images.before && s.images.after
      ? `<div class="vi-compare" style="--pos:${START}%;aspect-ratio:${w} / ${h}">
          <img class="vi-img" src="${esc(url(s.images.after))}" alt="After: ${esc(alt)}" loading="lazy" width="${w}" height="${h}" />
          <div class="vi-before"><img class="vi-img" src="${esc(url(s.images.before))}" alt="Before: ${esc(alt)}" loading="lazy" width="${w}" height="${h}" /></div>
          ${s.images.diff ? `<img class="vi-img vi-diffimg" src="${esc(url(s.images.diff))}" alt="Changed pixels: ${esc(alt)}" loading="lazy" hidden />` : ''}
          <div class="vi-boxes" aria-hidden="true">${boxes}</div>
          <span class="vi-handle" aria-hidden="true"></span>
          <span class="vi-tag is-before" aria-hidden="true">Before</span><span class="vi-tag is-after" aria-hidden="true">After</span>
        </div>
        <div class="vi-controls">
          <label class="vi-range"><span>Before</span><input type="range" min="0" max="100" value="${START}" aria-label="Before and after: drag to compare ${esc(alt)}" /><span>After</span></label>
          ${s.images.diff ? '<button type="button" class="btn btn-secondary btn-sm vi-toggle" aria-pressed="false">Show diff</button>' : ''}
          ${s.images.composite ? `<a class="small" href="${esc(url(s.images.composite))}" target="_blank" rel="noopener">Side by side</a>` : ''}
        </div>`
      : s.images.after || s.images.before
        ? `<img class="vi-single" src="${esc(url(s.images.after ?? s.images.before))}" alt="${esc(alt)}" loading="lazy" />`
        : `<p class="small muted">${esc(s.error ?? 'No image')}</p>`;
  return `<article class="vi-shot"><header class="vi-shot-head"><h3>${esc(s.label)}</h3><span class="small muted">${esc(meta)}</span>${badgeHtml(changeLabel(s), { tone, size: 'sm', className: 'vi-shot-badge' })}</header>${compare}</article>`;
}

function wire(root: HTMLElement) {
  root.querySelectorAll<HTMLElement>('.vi-shot').forEach((card) => {
    const cmp = card.querySelector<HTMLElement>('.vi-compare');
    const range = card.querySelector<HTMLInputElement>('input[type="range"]');
    const toggle = card.querySelector<HTMLButtonElement>('.vi-toggle');
    const diff = card.querySelector<HTMLImageElement>('.vi-diffimg');
    if (!cmp || !range) return;
    range.addEventListener('input', () => cmp.style.setProperty('--pos', `${range.value}%`));
    toggle?.addEventListener('click', () => {
      const on = toggle.getAttribute('aria-pressed') !== 'true';
      toggle.setAttribute('aria-pressed', String(on));
      toggle.textContent = on ? 'Hide diff' : 'Show diff';
      if (diff) diff.hidden = !on;
      cmp.classList.toggle('is-diff', on);
      range.disabled = on;
    });
  });
}
