// All tokens page: filter field, type chips, row selection with one side panel (a sheet on phones), ?t= deep links.
// Rows are static HTML; this only hides, selects and fills the panel. Copy buttons use the shell's [data-copy].
import { matchesRow, normalizeQuery, rowForLink, type AllModeValue, type AllType } from '../lib/all-tokens';
import { announce } from './shell';

interface PanelToken {
  cssVar: string;
  type: AllType;
  description: string;
  light: AllModeValue;
  dark: AllModeValue;
}

const phone = () => matchMedia('(max-width: 900px)').matches;

export function initAllTokens() {
  const root = document.querySelector<HTMLElement>('[data-at]');
  const dataEl = document.getElementById('at-data');
  if (!root || !dataEl) return;
  const data = JSON.parse(dataEl.textContent || '{}') as Record<string, PanelToken>;
  const q = root.querySelector<HTMLInputElement>('[data-at-q]');
  const rows = [...root.querySelectorAll<HTMLElement>('[data-at-row]')];
  const empty = root.querySelector<HTMLElement>('[data-at-empty]');
  const panel = root.querySelector<HTMLElement>('[data-at-panel]');
  const scrim = root.querySelector<HTMLElement>('[data-at-scrim]');
  if (!q || !panel) return;
  let type: AllType | 'all' = 'all';
  let opener: HTMLElement | null = null;

  const apply = () => {
    let shown = 0;
    for (const r of rows) {
      const hit = matchesRow({ type: r.dataset.type as AllType, search: r.dataset.search ?? '' }, q.value, type);
      r.hidden = !hit;
      if (hit) shown++;
    }
    if (empty) empty.hidden = shown > 0;
    // One Value column when no visible token changes between light and dark (dimensions, motion, numbers).
    const visible = rows.filter((r) => !r.hidden);
    const single = visible.length > 0 && visible.every((r) => r.hasAttribute('data-same'));
    root.toggleAttribute('data-single', single);
    const hLight = root.querySelector('[data-at-h-light]');
    if (hLight) hLight.textContent = single ? 'Value' : 'Light';
    // The panel follows the list: a selected token the filter hides gives way to the first one shown.
    const selected = rows.find((r) => r.hasAttribute('data-selected'));
    if (visible.length && (!selected || selected.hidden)) select(visible[0]!.dataset.atRow!, { url: false });
    announce(shown === 1 ? '1 token' : `${shown} tokens`);
  };

  const paintPanel = (path: string) => {
    const t = data[path];
    if (!t) return;
    const set = (sel: string, text: string) => panel.querySelectorAll<HTMLElement>(sel).forEach((el) => (el.textContent = text));
    set('[data-at-p-name]', t.cssVar);
    set('[data-at-p-var]', `var(${t.cssVar})`);
    const desc = panel.querySelector<HTMLElement>('[data-at-p-desc]');
    if (desc) {
      desc.textContent = t.description;
      desc.hidden = !t.description;
    }
    panel.dataset.type = t.type;
    for (const m of ['light', 'dark'] as const) {
      const box = panel.querySelector<HTMLElement>(`[data-at-mode="${m}"]`);
      if (!box) continue;
      const v = t[m];
      const big = box.querySelector<HTMLElement>('[data-at-p-big]');
      if (big) {
        big.style.backgroundColor = t.type === 'color' ? `var(${t.cssVar})` : '';
        big.style.boxShadow = t.type === 'shadow' ? `var(${t.cssVar})` : '';
      }
      const bigVal = box.querySelector<HTMLElement>('[data-at-p-bigval]');
      if (bigVal) bigVal.textContent = t.type === 'color' || t.type === 'shadow' ? '' : v.css;
      const source = box.querySelector<HTMLElement>('[data-at-p-source]');
      if (source) {
        source.textContent = v.source;
        source.hidden = !v.source;
      }
      const value = box.querySelector<HTMLElement>('[data-at-p-value]');
      if (value) value.textContent = t.type === 'color' ? v.short : v.css;
    }
  };

  const openSheet = (open: boolean) => {
    panel.dataset.open = String(open);
    if (scrim) scrim.hidden = !open || !phone();
    document.documentElement.toggleAttribute('data-at-sheet', open && phone());
  };

  const select = (path: string, opts: { scroll?: boolean; url?: boolean; sheet?: boolean } = {}) => {
    if (!data[path]) return;
    rows.forEach((r) => {
      const on = r.dataset.atRow === path;
      r.toggleAttribute('data-selected', on);
      r.querySelector('[data-at-open]')?.setAttribute('aria-pressed', String(on));
      if (on && opts.scroll) r.scrollIntoView({ block: 'nearest' });
    });
    paintPanel(path);
    if (opts.url !== false) {
      const p = new URLSearchParams(location.search);
      p.delete('focus');
      p.set('t', path);
      history.replaceState(null, '', `${location.pathname}?${p}${location.hash}`);
    }
    if (opts.sheet) {
      openSheet(true);
      if (phone()) panel.focus();
    }
  };

  const closeSheet = () => {
    if (panel.dataset.open !== 'true' || !phone()) return;
    openSheet(false);
    opener?.focus();
  };

  q.addEventListener('input', apply);
  q.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      rows.find((r) => !r.hidden)?.querySelector<HTMLElement>('[data-at-open]')?.focus();
    }
  });

  // Type filter: a static DS SegmentedControl; scripts/shell.ts selects the segment and reports it (bridge:segment).
  root.querySelector('[data-at-chips]')?.addEventListener('bridge:segment', (e) => {
    type = (e as CustomEvent<{ value: string }>).detail.value as AllType | 'all';
    apply();
  });

  root.querySelector('[data-at-rows]')?.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-at-open]');
    if (!b) return;
    opener = b;
    select(b.dataset.atOpen ?? '', { sheet: true });
  });
  // Up and down move between visible rows, like a list.
  root.querySelector('[data-at-rows]')?.addEventListener('keydown', (e) => {
    const ke = e as KeyboardEvent;
    if (ke.key !== 'ArrowDown' && ke.key !== 'ArrowUp') return;
    const buttons = rows.filter((r) => !r.hidden).map((r) => r.querySelector<HTMLElement>('[data-at-open]')!);
    const i = buttons.indexOf(document.activeElement as HTMLElement);
    if (i < 0) return;
    ke.preventDefault();
    const next = buttons[i + (ke.key === 'ArrowDown' ? 1 : -1)];
    if (next) next.focus();
    else if (ke.key === 'ArrowUp') q.focus();
  });

  root.querySelector('[data-at-close]')?.addEventListener('click', closeSheet);
  scrim?.addEventListener('click', closeSheet);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeSheet();
  });
  matchMedia('(max-width: 900px)').addEventListener('change', () => openSheet(false));

  // Deep link: ?t=<path> (or ?focus=) selects; a primitive or group path filters instead.
  const params = new URLSearchParams(location.search);
  const link = params.get('t') ?? params.get('focus');
  const hit = rowForLink(Object.entries(data).map(([path, t]) => ({ path, cssVar: t.cssVar })), link);
  if (hit) select(hit, { scroll: true, url: false, sheet: phone() });
  else {
    if (link) {
      q.value = normalizeQuery(link);
      apply();
      // Primitives, brand and component tokens are not listed here: when nothing matches, point to Studio Tokens.
      const elsewhere = root.querySelector<HTMLElement>('[data-at-elsewhere]');
      if (elsewhere && empty && !empty.hidden) {
        elsewhere.hidden = false;
        const name = elsewhere.querySelector('[data-at-elsewhere-name]');
        if (name) name.textContent = link;
        elsewhere.querySelector('[data-at-elsewhere-link]')?.setAttribute('href', `/studio/tokens/?focus=${encodeURIComponent(link)}`);
        q.addEventListener('input', () => (elsewhere.hidden = true), { once: true });
      }
    }
    const first = rows.find((r) => !r.hidden)?.dataset.atRow;
    if (first) select(first, { url: false });
  }
}
