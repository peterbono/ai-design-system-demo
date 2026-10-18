// Studio Components controller: filter the list (text, family menu, "need usage guidance"), move between rows with
// the arrow keys (the list is one tab stop), and open a row's detail drawer. Deep links: ?c=<slug> opens that
// component's drawer (the Library "Edit in Studio" door), ?guidance=needed shows only what needs guidance.
// Thumbnails and the drawer preview are scaled to fit their frame; the drawer's one Light/Dark switch moves under the
// open preview, and "Change this component" opens its steps in place (scripts/request-form.ts). The Open requests
// column fills from the requests Studio already reads (GitHub issues labeled component-change), and leaves the page when they cannot be read.
import { openRequestCounts, requestFact } from '../lib/components-studio';
import { isChangeIntent } from '../lib/change-intent';
import { clearChangeDone, initChangeFlow, pickChangeIntent, resetChangeFlow } from './request-form';
import { fitFrames } from './explorer/preview-frames';
import { loadRequestRows } from './requests';
import { selectSegment } from './shell';
import { initViewOnComponents } from './view-components';

// One size for the list thumbnails: a lone control shows a little smaller than life, like its neighbors scaled to fit.
const THUMB_MAX = 0.7;

export function initComponentsStudio() {
  const root = document.querySelector<HTMLElement>('.cm');
  if (!root || root.dataset.ready) return;
  root.dataset.ready = '';
  const q = root.querySelector<HTMLInputElement>('[data-cm-q]');
  const famSelect = root.querySelector<HTMLSelectElement>('[data-cm-fam]');
  const guidanceBtn = root.querySelector<HTMLButtonElement>('[data-cm-guidance]');
  const rows = [...root.querySelectorAll<HTMLTableRowElement>('[data-cm-row]')];
  const bodies = [...root.querySelectorAll<HTMLElement>('[data-cm-family]')];
  const count = root.querySelector<HTMLElement>('[data-cm-count]');
  const none = root.querySelector<HTMLElement>('[data-cm-none]');
  const drawer = document.querySelector<HTMLElement>('[data-cm-drawer]')!;
  const scrim = document.querySelector<HTMLElement>('[data-cm-scrim]')!;
  const title = drawer.querySelector<HTMLElement>('[data-cm-d-title]')!;
  const eyebrow = drawer.querySelector<HTMLElement>('[data-cm-d-family]');
  const shared = drawer.querySelector<HTMLElement>('[data-cm-shared]')!;
  const themeSeg = drawer.querySelector<HTMLElement>('[data-cm-theme]');
  const panels = [...drawer.querySelectorAll<HTMLElement>('[data-cm-panel]')];
  const devs = [...drawer.querySelectorAll<HTMLDetailsElement>('[data-cm-dev]')];
  const table = root.querySelector<HTMLElement>('[data-cm-table]');
  // Open requests by lowercased component name: null while reading, undefined when GitHub could not be read.
  let requestCounts: Map<string, number> | null | undefined = null;
  const params = new URLSearchParams(location.search);
  let family = '';
  let onlyGuidance = params.get('guidance') === 'needed';
  let openRow: HTMLTableRowElement | null = null;
  // The drawer preview's theme: the page theme until the viewer picks one with the switch.
  let previewTheme: string | null = null;
  const themeNow = () => previewTheme ?? (document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light');

  const visibleRows = () => rows.filter((r) => !r.hidden);

  function syncUrl() {
    const p = new URLSearchParams(location.search);
    for (const [k, v] of [
      ['guidance', onlyGuidance ? 'needed' : ''],
      ['family', family],
      ['q', q?.value.trim() ?? ''],
      ['c', openRow?.dataset.cmRow ?? ''],
    ] as const)
      v ? p.set(k, v) : p.delete(k);
    const qs = p.toString();
    history.replaceState(null, '', `${location.pathname}${qs ? `?${qs}` : ''}`);
  }

  function apply() {
    const text = (q?.value ?? '').trim().toLowerCase();
    for (const r of rows) {
      const hit = (!family || r.dataset.family === family) && (!onlyGuidance || r.dataset.guidance !== 'ok') && (!text || (r.dataset.name ?? '').includes(text));
      r.hidden = !hit;
    }
    for (const b of bodies) b.hidden = !b.querySelector('[data-cm-row]:not([hidden])');
    if (famSelect) famSelect.value = family;
    guidanceBtn?.setAttribute('aria-pressed', String(onlyGuidance));
    const shown = visibleRows();
    if (none) none.hidden = shown.length > 0;
    if (count) count.textContent = shown.length === rows.length ? '' : `${shown.length} of ${rows.length} components shown`;
    requestAnimationFrame(() => table && fitFrames(table, { max: THUMB_MAX }));
    // One tab stop: the first visible row, unless the focused one is still visible.
    const active = shown.find((r) => r.tabIndex === 0) ?? shown[0];
    rows.forEach((r) => (r.tabIndex = r === active ? 0 : -1));
    syncUrl();
  }

  function open(row: HTMLTableRowElement) {
    const slug = row.dataset.cmRow!;
    const panel = panels.find((p) => p.dataset.cmPanel === slug);
    if (!panel) return;
    panels.forEach((p) => (p.hidden = p !== panel));
    devs.forEach((x) => {
      x.hidden = x.dataset.cmDev !== slug;
      x.open = false;
    });
    paintDrawerRequests(panel);
    title.textContent = panel.dataset.name ?? slug;
    if (eyebrow) eyebrow.textContent = panel.dataset.family ?? '';
    // The shared switch goes under this preview (back to its hidden home when there is none).
    const pvSlot = panel.querySelector('[data-cm-pv-slot]');
    if (themeSeg) (pvSlot ?? shared).append(themeSeg);
    paintTheme(panel);
    drawer.dataset.component = panel.dataset.name ?? slug;
    drawer.dataset.slug = slug;
    drawer.dataset.hasTokens = String(Boolean(panel.dataset.tokensHref));
    drawer.dataset.tokensHref = panel.dataset.tokensHref ?? '';
    resetChangeFlow(drawer);
    clearChangeDone(drawer);
    openRow?.removeAttribute('aria-expanded');
    openRow = row;
    row.setAttribute('aria-expanded', 'true');
    drawer.hidden = false;
    scrim.hidden = false;
    document.body.classList.add('no-scroll');
    // Focus the title: screen readers announce the component, and Tab reaches the actions next.
    title.focus();
    requestAnimationFrame(() => fitFrames(panel));
    syncUrl();
  }

  /** The open panel's preview in the chosen theme, the switch showing it. */
  function paintTheme(panel: HTMLElement) {
    const theme = themeNow();
    panel.querySelectorAll<HTMLElement>('[data-cm-d-frame]').forEach((f) => (f.dataset.theme = theme));
    if (themeSeg) selectSegment(themeSeg, theme);
  }

  /** The open request part of the drawer's facts line, with a link to them in Changes when there are some. */
  function paintDrawerRequests(panel: HTMLElement) {
    const el = panel.querySelector<HTMLElement>('[data-cm-d-req]');
    if (!el) return;
    const n = requestCounts ? (requestCounts.get((panel.dataset.name ?? '').toLowerCase()) ?? 0) : requestCounts;
    el.textContent = requestFact(n);
    if (n) {
      const a = document.createElement('a');
      a.href = '/studio/changes/?view=requests';
      a.textContent = 'See them in Changes';
      el.append(' ', a);
    }
  }

  async function loadRequestCounts() {
    try {
      requestCounts = openRequestCounts(await loadRequestRows({ closed: false }));
      table?.querySelectorAll<HTMLElement>('[data-cm-req-n]').forEach((cell) => {
        const n = requestCounts?.get(cell.dataset.cmReqN ?? '') ?? 0;
        // Only a real count shows: an empty cell reads "none" without adding 47 zeros to the list.
        cell.textContent = n ? `${n} ${n === 1 ? 'request' : 'requests'}` : '';
      });
    } catch {
      // Without the requests (rate limit, offline) the column would only show blanks: it leaves instead.
      requestCounts = undefined;
      table?.classList.add('cm-no-req');
    }
    const open = panels.find((p) => !p.hidden);
    if (open && !drawer.hidden) paintDrawerRequests(open);
  }

  function close() {
    if (drawer.hidden) return;
    drawer.hidden = true;
    scrim.hidden = true;
    document.body.classList.remove('no-scroll');
    const back = openRow;
    openRow?.removeAttribute('aria-expanded');
    openRow = null;
    syncUrl();
    back?.focus();
  }

  rows.forEach((r) => {
    r.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('a,button')) return;
      rows.forEach((x) => (x.tabIndex = x === r ? 0 : -1));
      open(r);
    });
  });
  root.querySelector('.cm-table')?.addEventListener('keydown', (e) => {
    const ev = e as KeyboardEvent;
    const row = (ev.target as HTMLElement).closest<HTMLTableRowElement>('[data-cm-row]');
    if (!row) return;
    const shown = visibleRows();
    const i = shown.indexOf(row);
    const to = ev.key === 'ArrowDown' ? i + 1 : ev.key === 'ArrowUp' ? i - 1 : ev.key === 'Home' ? 0 : ev.key === 'End' ? shown.length - 1 : null;
    if (to !== null) {
      ev.preventDefault();
      const next = shown[Math.max(0, Math.min(shown.length - 1, to))]!;
      rows.forEach((x) => (x.tabIndex = x === next ? 0 : -1));
      next.focus();
    } else if (ev.key === 'Enter' || ev.key === ' ') {
      ev.preventDefault();
      open(row);
    }
  });

  q?.addEventListener('input', apply);
  famSelect?.addEventListener('change', () => {
    family = famSelect.value;
    apply();
  });
  guidanceBtn?.addEventListener('click', () => {
    onlyGuidance = !onlyGuidance;
    apply();
  });
  root.querySelector('[data-cm-reset]')?.addEventListener('click', () => {
    family = '';
    onlyGuidance = false;
    if (q) q.value = '';
    apply();
  });
  drawer.querySelector('[data-cm-close]')?.addEventListener('click', close);
  themeSeg?.addEventListener('bridge:segment', (e) => {
    previewTheme = (e as CustomEvent<{ value: string }>).detail.value;
    const panel = panels.find((p) => !p.hidden);
    if (panel) {
      paintTheme(panel);
      requestAnimationFrame(() => fitFrames(panel));
    }
  });
  initChangeFlow(drawer);
  scrim.addEventListener('click', close);
  document.addEventListener('keydown', (e) => {
    // Escape inside Change this component closes that step first, not the drawer.
    if (e.key === 'Escape' && drawer.dataset.mode === 'change') {
      resetChangeFlow(drawer, true);
      return;
    }
    if (e.key === 'Escape') close();
    // Keep Tab inside the open drawer.
    if (e.key === 'Tab' && !drawer.hidden) {
      const focusables = [...drawer.querySelectorAll<HTMLElement>('a[href],button:not([disabled]),input,select,textarea')].filter((el) => el.offsetParent !== null);
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (!first || !last) return;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  });

  void loadRequestCounts();
  // Showing an open change (?change=N): previews paint with its tokens (scripts/view-components).
  void initViewOnComponents(root);
  // Thumbnails measure their content: measure again once the web fonts are in, and when the window resizes.
  const refit = () => requestAnimationFrame(() => table && fitFrames(table, { max: THUMB_MAX }));
  void document.fonts?.ready.then(refit);
  window.addEventListener('resize', refit);
  family = params.get('family') ?? '';
  if (q) q.value = params.get('q') ?? '';
  apply();
  const deep = params.get('c');
  const row = deep ? rows.find((r) => r.dataset.cmRow === deep) : null;
  if (row) {
    row.hidden = false;
    row.scrollIntoView({ block: 'center' });
    open(row);
    // From the Overview "Start a change" (?intent=variant|wrong): the change steps open on that choice.
    const intent = params.get('intent');
    if (isChangeIntent(intent)) {
      drawer.querySelector<HTMLButtonElement>('[data-cm-panel]:not([hidden]) [data-cm-change-open]')?.click();
      pickChangeIntent(drawer, intent);
      const p = new URLSearchParams(location.search);
      p.delete('intent');
      history.replaceState(null, '', `${location.pathname}?${p.toString()}`);
    }
  }
}
