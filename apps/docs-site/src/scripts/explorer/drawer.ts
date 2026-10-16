// The token detail drawer of the Library foundation pages (components/explorer/TokenDetailDrawer.astro): the same
// renderDetail() as the token explorer, in read mode, opened from a token row. Values follow the brand and density
// the previews use (top bar), in both themes. Links inside the panel ("Aliased by", contrast pairs) open that token.
import { initTokenHistoryPanel } from '../history/token-panel';
import { currentScope } from '../shell';
import { emptyFilters, planColumns, type ViewState } from '../../lib/explorer/model';
import { loadExplorerData } from './data';
import { renderDetail } from './detail';
import type { ExplorerData, ExplorerState, View } from './types';
import { copyText } from './util';

export function initTokenDrawer() {
  const root = document.querySelector<HTMLElement>('[data-fd-drawer]');
  if (!root || root.dataset.ready) return;
  root.dataset.ready = '';
  const panel = root.querySelector<HTMLElement>('[data-fd-detail]')!;
  const scrim = root.querySelector<HTMLElement>('[data-fd-scrim]')!;
  let data: ExplorerData | null = null;
  let current: string | null = null;
  let returnFocus: HTMLElement | null = null;
  initTokenHistoryPanel();

  function viewFor(d: ExplorerData, path: string): View | null {
    const x = d.byPath.get(path);
    if (!x) return null;
    const scope = currentScope();
    const pick = (list: string[], want: string) => (list.includes(want) ? want : (list[0] ?? ''));
    const vs: ViewState = { brand: pick(d.modes.brands, scope.brand), theme: d.modes.themes[0] ?? '', density: pick(d.modes.densities, scope.density), allCombos: false };
    const plan = planColumns({ lens: 'collections', tier: x.tier }, d.modes, vs, x.varies);
    return { visible: [x], plan, columns: plan.columns };
  }

  function state(path: string): ExplorerState {
    return {
      mode: 'read',
      selection: { lens: 'collections', tier: 'all' },
      filters: emptyFilters(),
      view: { brand: '', theme: '', density: '', allCombos: false },
      syntax: 'css',
      showCode: false,
      showDescription: false,
      collapsed: new Set(),
      treeOpen: new Set(),
      selected: path,
      active: null,
    };
  }

  function syncUrl(path: string | null) {
    try {
      const p = new URLSearchParams(location.search);
      if (path) p.set('t', path);
      else p.delete('t');
      const q = p.toString();
      history.replaceState(null, '', `${location.pathname}${q ? `?${q}` : ''}${location.hash}`);
    } catch {
      /* sandboxed: the drawer still works */
    }
  }

  function open(path: string, opener?: HTMLElement | null) {
    data ??= loadExplorerData();
    const view = viewFor(data, path);
    if (!view) return;
    const wasOpen = !panel.hidden;
    current = path;
    renderDetail(panel, data, view, state(path), path);
    panel.hidden = false;
    scrim.hidden = false;
    document.body.classList.add('no-scroll');
    if (!wasOpen) returnFocus = opener ?? (document.activeElement as HTMLElement | null);
    document.querySelectorAll('[data-fd-row][aria-current]').forEach((r) => r.removeAttribute('aria-current'));
    document.querySelector(`[data-fd-row="${CSS.escape(path)}"]`)?.setAttribute('aria-current', 'true');
    panel.querySelector<HTMLElement>('#xp-d-title')?.focus();
    syncUrl(path);
  }

  function close() {
    if (panel.hidden) return;
    panel.hidden = true;
    scrim.hidden = true;
    document.body.classList.remove('no-scroll');
    document.querySelectorAll('[data-fd-row][aria-current]').forEach((r) => r.removeAttribute('aria-current'));
    current = null;
    syncUrl(null);
    const back = returnFocus;
    returnFocus = null;
    back?.focus();
  }

  document.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    const opener = t.closest<HTMLElement>('[data-fd-open]');
    if (opener?.dataset.fdOpen) {
      e.preventDefault();
      open(opener.dataset.fdOpen, opener);
    }
  });
  panel.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    const copy = t.closest<HTMLElement>('[data-copy]');
    if (copy) {
      e.stopPropagation();
      return void copyText(copy.dataset.copy!, copy);
    }
    const go = t.closest<HTMLElement>('[data-goto]');
    if (go?.dataset.goto) return open(go.dataset.goto);
    if (t.closest('[data-xp-close]')) close();
  });
  panel.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    }
  });
  scrim.addEventListener('click', close);
  document.addEventListener('bridge:scope', () => {
    if (current && !panel.hidden) open(current);
  });

  const deep = new URLSearchParams(location.search).get('t');
  if (deep) open(deep);
}
