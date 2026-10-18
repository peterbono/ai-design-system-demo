// Studio Components controller: filter the list (text, family menu, "need usage guidance"), move between rows with
// the arrow keys (the list is one tab stop), and open a row's detail drawer. Deep links: ?c=<slug> opens that
// component's drawer (the Library "Edit in Studio" door), ?guidance=needed shows only what needs guidance.
// Thumbnails and the drawer preview are scaled to fit their frame; the Requests column fills from the requests
// Studio already reads (GitHub issues labeled component-change), and leaves the page when they cannot be read.
import { openRequestCounts } from '../lib/components-studio';
import { initRequestForm, resetRequestForm } from './request-form';
import { fitFrames } from './explorer/preview-frames';
import { loadRequestRows } from './requests';

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
  const panels = [...drawer.querySelectorAll<HTMLElement>('[data-cm-panel]')];
  const devs = [...drawer.querySelectorAll<HTMLDetailsElement>('[data-cm-dev]')];
  const table = root.querySelector<HTMLElement>('[data-cm-table]');
  // Open requests by lowercased component name: null while reading, undefined when GitHub could not be read.
  let requestCounts: Map<string, number> | null | undefined = null;
  const params = new URLSearchParams(location.search);
  let family = '';
  let onlyGuidance = params.get('guidance') === 'needed';
  let openRow: HTMLTableRowElement | null = null;

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
    requestAnimationFrame(() => table && fitFrames(table, { max: 1 }));
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
    drawer.dataset.component = panel.dataset.name ?? slug;
    drawer.dataset.slug = slug;
    resetRequestForm(drawer);
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

  /** The drawer's "Open requests" fact, with a link to them in Changes when there are some. */
  function paintDrawerRequests(panel: HTMLElement) {
    const dd = panel.querySelector<HTMLElement>('[data-cm-d-req]');
    if (!dd) return;
    if (requestCounts === null) dd.textContent = 'Reading';
    else if (requestCounts === undefined) dd.textContent = 'Not available right now';
    else {
      const n = requestCounts.get((panel.dataset.name ?? '').toLowerCase()) ?? 0;
      dd.innerHTML = n ? `${n} <a href="/studio/changes/?view=requests">See in Changes</a>` : 'None';
    }
  }

  async function loadRequestCounts() {
    try {
      requestCounts = openRequestCounts(await loadRequestRows({ closed: false }));
      table?.querySelectorAll<HTMLElement>('[data-cm-req-n]').forEach((cell) => {
        const n = requestCounts?.get(cell.dataset.cmReqN ?? '') ?? 0;
        cell.textContent = String(n);
        cell.classList.toggle('cm-zero', n === 0);
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
  initRequestForm(drawer);
  scrim.addEventListener('click', close);
  document.addEventListener('keydown', (e) => {
    // Escape inside the request form closes the form first, not the drawer.
    if (e.key === 'Escape' && drawer.dataset.mode === 'request') {
      resetRequestForm(drawer, true);
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
  // Thumbnails measure their content: measure again once the web fonts are in, and when the window resizes.
  const refit = () => requestAnimationFrame(() => table && fitFrames(table, { max: 1 }));
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
  }
}
