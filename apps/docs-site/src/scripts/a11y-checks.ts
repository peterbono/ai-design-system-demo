// Accessibility page: the brand and theme the contrast list shows (two static DS SegmentedControls driven by
// shell.ts, which emit bridge:segment), the "Compare all" matrix toggle, and opening "How we check" from its link.
// The list starts on the brand and theme the page is using. Every combo is in the markup; this only shows one.
import { currentScope, selectSegment } from './shell';

export function initA11yChecks() {
  const root = document.querySelector<HTMLElement>('[data-a11y-checks]');
  if (!root || root.dataset.ready) return;
  root.dataset.ready = '';
  const brandCtl = root.querySelector<HTMLElement>('[data-a11y-brand]');
  const modeCtl = root.querySelector<HTMLElement>('[data-a11y-mode]');
  const compare = root.querySelector<HTMLButtonElement>('[data-a11y-compare]');
  const valueOf = (ctl: HTMLElement | null) => ctl?.querySelector<HTMLElement>('[data-segment][aria-checked="true"]')?.dataset.value ?? '';
  const has = (ctl: HTMLElement | null, v: string) => !!ctl?.querySelector(`[data-segment][data-value="${CSS.escape(v)}"]`);

  function render() {
    const brand = valueOf(brandCtl);
    const mode = valueOf(modeCtl);
    const key = `${brand}-${mode}`;
    const all = root!.dataset.view === 'compare';
    root!.dataset.combo = key;
    root!.querySelectorAll<HTMLElement>('.a11y-tile').forEach((t) => {
      t.dataset.theme = mode;
      t.dataset.brand = brand;
    });
    root!.querySelectorAll<HTMLElement>('.a11y-res').forEach((r) => {
      const on = r.dataset.c === key;
      r.hidden = !on;
      if (on && r.dataset.title) r.closest('.a11y-row')?.setAttribute('title', r.dataset.title);
    });
    root!.querySelectorAll<HTMLElement>('.a11y-group-status').forEach((s) => (s.hidden = s.dataset.c !== (all ? 'all' : key)));
    root!.querySelectorAll<HTMLElement>('.a11y-matrix [data-c]').forEach((c) => c.toggleAttribute('data-on', c.dataset.c === key));
    root!.querySelectorAll<HTMLElement>('.a11y-rows').forEach((l) => (l.hidden = all));
    root!.querySelectorAll<HTMLElement>('.a11y-matrix').forEach((m) => (m.hidden = !all));
  }

  /** Open the groups that fail in what is shown now; never close one the reader opened. */
  function openFailing() {
    const k = root!.dataset.view === 'compare' ? 'all' : root!.dataset.combo;
    root!.querySelectorAll<HTMLDetailsElement>('.a11y-group').forEach((g) => {
      if (g.querySelector(`.a11y-group-status[data-c="${k}"][data-fails]`)) g.open = true;
    });
  }

  function update() {
    render();
    openFailing();
  }

  // Start on the page's own brand and theme.
  const scope = currentScope();
  const theme = document.documentElement.dataset.theme ?? 'light';
  if (brandCtl && has(brandCtl, scope.brand)) selectSegment(brandCtl, scope.brand);
  if (modeCtl && has(modeCtl, theme)) selectSegment(modeCtl, theme);
  update();

  // A change of the page theme or preview brand moves the list with it; a pick here stays on this list.
  document.addEventListener('bridge:theme', (e) => {
    const next = (e as CustomEvent<string>).detail;
    if (modeCtl && has(modeCtl, next)) selectSegment(modeCtl, next);
    update();
  });
  document.addEventListener('bridge:scope', (e) => {
    const next = (e as CustomEvent<{ brand: string }>).detail?.brand;
    if (brandCtl && next && has(brandCtl, next)) selectSegment(brandCtl, next);
    update();
  });
  brandCtl?.addEventListener('bridge:segment', update);
  modeCtl?.addEventListener('bridge:segment', update);
  compare?.addEventListener('click', () => {
    const on = compare.getAttribute('aria-pressed') !== 'true';
    compare.setAttribute('aria-pressed', String(on));
    root.dataset.view = on ? 'compare' : 'list';
    update();
  });

  // "How we check": the link in the header opens the collapsed method, also on a deep link to #how-we-check.
  const how = document.getElementById('how-we-check') as HTMLDetailsElement | null;
  const openHow = () => {
    if (how && location.hash === '#how-we-check') how.open = true;
  };
  document.querySelector('[data-a11y-how]')?.addEventListener('click', () => {
    if (how) how.open = true;
  });
  window.addEventListener('hashchange', openHow);
  openHow();
}
