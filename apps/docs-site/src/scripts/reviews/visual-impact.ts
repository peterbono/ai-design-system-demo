// Reviews > pull request > Visual impact: reads the manifest the visual impact workflow published for the
// head commit, then shows each changed story or screen with a before/after slider and a diff toggle.
import { changeLabel, facet, filterShots, modeLabel, VISUAL_BRANCH, visualBase, visualState, type VisualFilter, type VisualManifest, type VisualShot } from '../../lib/visual-impact';
import { esc, GitHubError, ghGet } from '../github-session';

const PAGE = 8;

type TreeEntry = { path: string; type: string; sha: string };

/**
 * Whether the workflow published a manifest for this PR commit, asked without a 404: the branch ref (an empty
 * list when it does not exist), then one level of tree per folder (pr-<n>/<sha>/manifest.json).
 */
async function manifestPublished(owner: string, repo: string, pr: number, sha: string): Promise<boolean> {
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

export async function loadVisualImpact(slot: HTMLElement, o: { owner: string; repo: string; pr: number; sha: string; actionsUrl: string }): Promise<void> {
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
      return;
    }
  }
  const state = visualState(manifest);
  if (state.kind === 'not-computed') {
    slot.innerHTML = `<div class="vi-empty"><p><strong>Not computed yet.</strong> The visual impact workflow screenshots the impacted stories and admin screens at the base and at <span class="mono">${esc(o.sha.slice(0, 7))}</span>, then publishes the diffs here. It runs on pull requests that change tokens or components and takes a few minutes.</p><p><a href="${esc(o.actionsUrl)}" target="_blank" rel="noopener">Check the workflow runs</a></p></div>`;
    return;
  }
  const m = state.manifest;
  const head = `<p class="small muted">${m.summary.shots} screenshot${m.summary.shots === 1 ? '' : 's'} compared, base <span class="mono">${esc(m.base.sha.slice(0, 7))}</span> to head <span class="mono">${esc(m.head.sha.slice(0, 7))}</span>, threshold ${m.options.threshold}.${
    m.selection.components.length ? ` Components in scope: ${m.selection.components.map((c) => esc(c.id)).join(', ')}.` : ''
  }${m.selection.fallback ? ` ${esc(m.selection.fallback)}` : ''}</p>`;
  if (state.kind === 'no-change') {
    slot.innerHTML = `<div class="vi-empty is-pass"><p><strong>No visual change.</strong> Every captured story and screen renders the same before and after this pull request.</p>${head}</div>`;
    return;
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
}

function shotCard(s: VisualShot, base: string): string {
  const size = s.size.after ?? s.size.before ?? { width: 4, height: 3 };
  const url = (p?: string) => (p ? `${base}/${p}` : '');
  const alt = `${s.label}, ${modeLabel(s)}`;
  const boxes = s.boxes
    .map((b) => `<i style="left:${(b.x / size.width) * 100}%;top:${(b.y / size.height) * 100}%;width:${(b.width / size.width) * 100}%;height:${(b.height / size.height) * 100}%"></i>`)
    .join('');
  const tone = s.status === 'changed' ? (s.percent >= 1 ? 'is-warn' : '') : s.status === 'error' ? 'is-fail' : 'is-info';
  const compare =
    s.images.before && s.images.after
      ? `<div class="vi-compare" style="--pos:50%;aspect-ratio:${size.width} / ${size.height}">
          <img class="vi-img" src="${esc(url(s.images.after))}" alt="After: ${esc(alt)}" loading="lazy" width="${size.width}" height="${size.height}" />
          <div class="vi-before"><img class="vi-img" src="${esc(url(s.images.before))}" alt="Before: ${esc(alt)}" loading="lazy" width="${size.width}" height="${size.height}" /></div>
          ${s.images.diff ? `<img class="vi-img vi-diffimg" src="${esc(url(s.images.diff))}" alt="Changed pixels: ${esc(alt)}" loading="lazy" hidden />` : ''}
          <div class="vi-boxes" aria-hidden="true">${boxes}</div>
          <span class="vi-handle" aria-hidden="true"></span>
          <span class="vi-tag is-before" aria-hidden="true">Before</span><span class="vi-tag is-after" aria-hidden="true">After</span>
        </div>
        <div class="vi-controls">
          <label class="vi-range"><span>Before</span><input type="range" min="0" max="100" value="50" aria-label="Before and after: drag to compare ${esc(alt)}" /><span>After</span></label>
          ${s.images.diff ? '<button type="button" class="btn btn-secondary btn-sm vi-toggle" aria-pressed="false">Show diff</button>' : ''}
          ${s.images.composite ? `<a class="small" href="${esc(url(s.images.composite))}" target="_blank" rel="noopener">Side by side</a>` : ''}
        </div>`
      : s.images.after || s.images.before
        ? `<img class="vi-single" src="${esc(url(s.images.after ?? s.images.before))}" alt="${esc(alt)}" loading="lazy" />`
        : `<p class="small muted">${esc(s.error ?? 'No image')}</p>`;
  return `<article class="vi-shot"><header class="vi-shot-head"><h3>${esc(s.label)}</h3><span class="small muted">${esc(modeLabel(s))}</span><span class="pill ${tone}">${esc(changeLabel(s))}</span></header>${compare}</article>`;
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
