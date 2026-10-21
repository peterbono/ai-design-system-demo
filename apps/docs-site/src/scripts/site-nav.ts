// The product site header (components/site/SiteHeader.astro), framework free:
//   - Product and Resources: disclosure menus. Click or Enter toggles; with a fine pointer they also open on hover
//     (a short delay both ways) and a click right after a hover-open keeps them open. Arrow Down/Up open and focus the
//     first/last link, arrows move inside the panel, Left/Right move between the top items, Escape closes and returns
//     focus, focus leaving a menu closes it.
//   - Under 900px: one sheet behind "Open menu" / "Close menu"; Escape or a click outside closes it.
// Without this script the panels stay closed and the sheet hidden: every destination is also in the footer.

const WIDE = '(min-width: 900px)';

export function initSiteNav() {
  const nav = document.querySelector<HTMLElement>('[data-nav]');
  if (!nav) return;
  const menus = [...nav.querySelectorAll<HTMLElement>('[data-menu]')];
  const fine = window.matchMedia('(hover: hover) and (pointer: fine)');
  let hoverOpenedAt = 0;
  const btn = (m: HTMLElement) => m.querySelector<HTMLButtonElement>('button')!;
  const panel = (m: HTMLElement) => m.querySelector<HTMLElement>('.nv-panel')!;
  const links = (m: HTMLElement) => [...panel(m).querySelectorAll<HTMLAnchorElement>('a')];
  const via = new WeakMap<HTMLElement, 'click' | 'hover' | ''>();

  const setOpen = (m: HTMLElement, on: boolean) => {
    m.classList.toggle('open', on);
    btn(m).setAttribute('aria-expanded', String(on));
    if (on) menus.forEach((o) => o !== m && setOpen(o, false));
  };
  const closeAll = () => menus.forEach((m) => setOpen(m, false));

  for (const m of menus) {
    const b = btn(m);
    let t = 0;
    b.addEventListener('click', () => {
      const open = m.classList.contains('open');
      if (open && Date.now() - hoverOpenedAt < 450) {
        via.set(m, 'click');
        return;
      }
      setOpen(m, !open);
      via.set(m, open ? '' : 'click');
    });
    b.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        setOpen(m, true);
        via.set(m, 'click');
        const l = links(m);
        l[e.key === 'ArrowDown' ? 0 : l.length - 1]?.focus();
      } else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        const tops = [...nav.querySelectorAll<HTMLElement>('.nv-list > li > button, .nv-list > li > a')];
        const next = tops[tops.indexOf(b) + (e.key === 'ArrowRight' ? 1 : -1)];
        if (!next) return;
        e.preventDefault();
        const wasOpen = m.classList.contains('open');
        closeAll();
        next.focus();
        const nm = next.closest<HTMLElement>('[data-menu]');
        if (wasOpen && nm) setOpen(nm, true);
      }
    });
    panel(m).addEventListener('keydown', (e) => {
      const l = links(m);
      const k = l.indexOf(document.activeElement as HTMLAnchorElement);
      const go = { ArrowDown: (k + 1) % l.length, ArrowUp: (k - 1 + l.length) % l.length, Home: 0, End: l.length - 1 }[e.key];
      if (go === undefined) return;
      e.preventDefault();
      l[go]?.focus();
    });
    m.addEventListener('mouseenter', () => {
      if (!fine.matches) return;
      clearTimeout(t);
      t = window.setTimeout(() => {
        if (m.classList.contains('open')) return;
        setOpen(m, true);
        via.set(m, 'hover');
        hoverOpenedAt = Date.now();
      }, 120);
    });
    m.addEventListener('mouseleave', () => {
      if (!fine.matches) return;
      clearTimeout(t);
      t = window.setTimeout(() => {
        if (via.get(m) === 'hover' && !panel(m).contains(document.activeElement)) setOpen(m, false);
      }, 220);
    });
    m.addEventListener('focusout', (e) => {
      if (!m.contains(e.relatedTarget as Node | null)) setOpen(m, false);
    });
  }

  const sheet = nav.querySelector<HTMLElement>('[data-sheet]');
  const openBtn = nav.querySelector<HTMLButtonElement>('[data-sheet-open]');
  const closeBtn = nav.querySelector<HTMLButtonElement>('[data-sheet-close]');
  const setSheet = (on: boolean, focus = true) => {
    nav.classList.toggle('sheet-open', on);
    if (openBtn) openBtn.hidden = on;
    if (closeBtn) closeBtn.hidden = !on;
    if (!focus) return;
    if (on) window.setTimeout(() => sheet?.querySelector<HTMLAnchorElement>('a')?.focus(), 20);
    else openBtn?.focus();
  };
  openBtn?.addEventListener('click', () => setSheet(true));
  closeBtn?.addEventListener('click', () => setSheet(false));

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const m = menus.find((x) => x.classList.contains('open'));
    if (m) {
      setOpen(m, false);
      btn(m).focus();
    } else if (nav.classList.contains('sheet-open')) setSheet(false);
  });
  document.addEventListener('click', (e) => {
    const target = e.target as Node;
    menus.forEach((m) => !m.contains(target) && setOpen(m, false));
    if (nav.classList.contains('sheet-open') && !sheet?.contains(target) && !openBtn?.contains(target) && !closeBtn?.contains(target)) setSheet(false, false);
  });
  window.matchMedia(WIDE).addEventListener('change', (q) => (q.matches ? setSheet(false, false) : closeAll()));
}
