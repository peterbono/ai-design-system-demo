// Studio Components controller: filter the list (text, family chip, "need usage guidance"), move between rows with
// the arrow keys (the list is one tab stop), and open a row's detail drawer. Deep links: ?c=<slug> opens that
// component's drawer (the Library "Edit in Studio" door), ?guidance=needed shows only what needs guidance.

export function initComponentsStudio() {
  const root = document.querySelector<HTMLElement>('.cm');
  if (!root || root.dataset.ready) return;
  root.dataset.ready = '';
  const q = root.querySelector<HTMLInputElement>('[data-cm-q]');
  const chips = [...root.querySelectorAll<HTMLButtonElement>('[data-cm-fam]')];
  const guidanceBtn = root.querySelector<HTMLButtonElement>('[data-cm-guidance]');
  const rows = [...root.querySelectorAll<HTMLTableRowElement>('[data-cm-row]')];
  const bodies = [...root.querySelectorAll<HTMLElement>('[data-cm-family]')];
  const count = root.querySelector<HTMLElement>('[data-cm-count]');
  const none = root.querySelector<HTMLElement>('[data-cm-none]');
  const drawer = document.querySelector<HTMLElement>('[data-cm-drawer]')!;
  const scrim = document.querySelector<HTMLElement>('[data-cm-scrim]')!;
  const title = drawer.querySelector<HTMLElement>('[data-cm-d-title]')!;
  const panels = [...drawer.querySelectorAll<HTMLElement>('[data-cm-panel]')];
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
    chips.forEach((c) => c.setAttribute('aria-pressed', String((c.dataset.cmFam ?? '') === family)));
    guidanceBtn?.setAttribute('aria-pressed', String(onlyGuidance));
    const shown = visibleRows();
    if (none) none.hidden = shown.length > 0;
    if (count) count.textContent = shown.length === rows.length ? '' : `${shown.length} of ${rows.length} components shown`;
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
    title.textContent = panel.dataset.name ?? slug;
    openRow?.removeAttribute('aria-expanded');
    openRow = row;
    row.setAttribute('aria-expanded', 'true');
    drawer.hidden = false;
    scrim.hidden = false;
    document.body.classList.add('no-scroll');
    drawer.querySelector<HTMLElement>('[data-cm-close]')?.focus();
    syncUrl();
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
  chips.forEach((c) =>
    c.addEventListener('click', () => {
      family = c.dataset.cmFam ?? '';
      apply();
    }),
  );
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
  scrim.addEventListener('click', close);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') close();
    // Keep Tab inside the open drawer.
    if (e.key === 'Tab' && !drawer.hidden) {
      const focusables = [...drawer.querySelectorAll<HTMLElement>('a[href],button:not([disabled])')].filter((el) => el.offsetParent !== null);
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
