// App shell behaviour, shipped on every page (small, no framework):
// theme toggle, copy buttons, the mobile navigation sheet, the Cmd+K command palette, header menus, the "On this
// page" rail and, in the Studio, the view of a change (scripts/view-change), the nav counts and the GitHub connection.
import { bindCodeBlocks, bindDialogs, bindTooltips, closeDialog, isDialogOpen, openDialog } from '@bridge-ds/react/dom';
import { getToken, initGitHubConnect } from './github-session';
import { loadReviewNeedsYou, rememberedMine, type QueuePullFull } from './needs-you';
import { initMaintainer } from './maintainer';
import { initVanillaControls } from './vanilla-controls';
import { initViewChange, readOpenPulls } from './view-change';

interface SearchItem {
  kind: 'page' | 'component' | 'token';
  title: string;
  href: string;
  meta?: string;
  keys?: string;
  swatch?: string;
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T | null;

export function announce(text: string) {
  const live = $('live');
  if (!live) return;
  live.textContent = text;
  window.setTimeout(() => {
    if (live.textContent === text) live.textContent = '';
  }, 1500);
}

function initTheme() {
  const root = document.documentElement;
  // One toggle in the top bar, one in the mobile navigation sheet: both stay in step.
  const btns = [...document.querySelectorAll<HTMLButtonElement>('[data-theme-toggle]')];
  if (!btns.length) return;
  const sync = () => btns.forEach((b) => b.setAttribute('aria-pressed', String(root.getAttribute('data-theme') === 'dark')));
  sync();
  btns.forEach((btn) =>
    btn.addEventListener('click', () => {
      const next = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      root.setAttribute('data-theme', next);
      try {
        localStorage.setItem('ds-theme', next);
      } catch {
        /* private mode: theme still applies for this page */
      }
      sync();
      document.dispatchEvent(new CustomEvent('bridge:theme', { detail: next }));
    }),
  );
}

/**
 * Brand and density of the design system previews. Stored per browser, kept on <html> as data-preview-brand and
 * data-preview-density, and applied to every element below <html> that sets data-theme (preview frames, islands):
 * tokens.css resolves brand x theme overrides only when the attributes sit on the same element, so each themed
 * scope carries all three. <html> itself keeps data-brand="bridge" and comfortable density: the Bridge chrome is
 * built with the design system and does not change with the preview scope.
 */
type Scope = { brand: string; density: string };
const SCOPE_DEFAULT: Scope = { brand: 'bridge', density: 'comfortable' };
const LABELS: Record<string, string> = { bridge: 'Bridge', ocean: 'Ocean', comfortable: 'Comfortable', compact: 'Compact' };
/** A label for any brand or density, including brands added after this script was written. */
const labelOf = (v: string) => LABELS[v] ?? v.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

export function currentScope(): Scope {
  const root = document.documentElement;
  return { brand: root.dataset.previewBrand ?? SCOPE_DEFAULT.brand, density: root.dataset.previewDensity ?? SCOPE_DEFAULT.density };
}

function applyScope(scope: Scope, within: ParentNode = document) {
  const root = document.documentElement;
  root.dataset.previewBrand = scope.brand;
  root.dataset.previewDensity = scope.density;
  // Specimen stages on the page's own theme (Library foundation pages): they follow the page theme and the scope.
  const theme = root.dataset.theme ?? 'light';
  within.querySelectorAll<HTMLElement>('[data-scope-stage]').forEach((el) => {
    if (el.dataset.theme !== theme) el.dataset.theme = theme;
  });
  within.querySelectorAll<HTMLElement>('[data-theme]').forEach((el) => {
    if (el === root || el.hasAttribute('data-scope-fixed')) return;
    if (el.dataset.brand !== scope.brand) el.dataset.brand = scope.brand;
    if (el.dataset.density !== scope.density) el.dataset.density = scope.density;
  });
  // Specimen brand and density switches (components/foundations/ScopeSwitch.astro, static SegmentedControls).
  document.querySelectorAll<HTMLElement>('[data-scope-switch]').forEach((s) => paintSegments(s, s.dataset.scopeSwitch === 'density' ? scope.density : scope.brand));
  document.querySelectorAll<HTMLElement>('[data-scope-label]').forEach((l) => {
    const key = l.dataset.scopeLabel as keyof Scope;
    l.textContent = labelOf(scope[key]);
  });
}

function initScope() {
  applyScope(currentScope());
  const set = (patch: Partial<Scope>) => {
    const next = { ...currentScope(), ...patch };
    try {
      localStorage.setItem('ds-brand', next.brand);
      localStorage.setItem('ds-density', next.density);
    } catch {
      /* private mode: applies to this page only */
    }
    applyScope(next);
    announce(`Previews: ${labelOf(next.brand)}, ${labelOf(next.density)}`);
    document.dispatchEvent(new CustomEvent('bridge:scope', { detail: next }));
  };
  // React islands (scope menu, props playground) ask for a change with an event; see components/ds/scope.ts.
  document.addEventListener('bridge:set-scope', (e) => set((e as CustomEvent<Partial<Scope>>).detail ?? {}));
  document.addEventListener('bridge:segment', (e) => {
    const sw = (e.target as HTMLElement).closest<HTMLElement>('[data-scope-switch]');
    const value = (e as CustomEvent<{ value: string }>).detail.value;
    if (sw) set(sw.dataset.scopeSwitch === 'density' ? { density: value } : { brand: value });
  });
  // Islands and drawers add themed scopes after load: keep them in step.
  let queued = false;
  new MutationObserver(() => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      applyScope(currentScope());
    });
  }).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-theme'] });
  // The page theme lives on <html>: specimen stages follow it.
  new MutationObserver(() => applyScope(currentScope())).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  const menu = document.getElementById('scope-menu') as HTMLDetailsElement | null;
  if (menu) {
    document.addEventListener('click', (e) => {
      if (menu.open && !menu.contains(e.target as Node)) menu.open = false;
    });
    menu.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && menu.open) {
        menu.open = false;
        menu.querySelector('summary')?.focus();
      }
    });
  }
}

/**
 * Statically rendered DS SegmentedControls (Astro, no hydration) opt in with `data-vanilla`. Base UI renders every
 * segment with tabindex -1 on the server, so this restores the roving tab stop, selects on click and moves the
 * selection with arrow keys, Home and End, like the hydrated control. A change dispatches `bridge:segment`
 * ({ value }) on the group root, bubbling. Other scripts select programmatically with selectSegment().
 */
const SEG_ROOT = '[data-segmented-control][data-vanilla]';
const segmentsOf = (root: Element) => [...root.querySelectorAll<HTMLButtonElement>('[data-segment]')];
const segDisabled = (b: HTMLButtonElement) => b.disabled || b.hasAttribute('data-disabled');

function paintSegments(root: Element, value: string | null) {
  const segs = segmentsOf(root);
  const current = segs.find((b) => b.dataset.value === value) ?? null;
  const stop = current ?? segs.find((b) => !segDisabled(b)) ?? null;
  for (const b of segs) {
    const on = b === current;
    b.setAttribute('aria-checked', String(on));
    b.toggleAttribute('data-checked', on);
    b.toggleAttribute('data-unchecked', !on);
    b.tabIndex = b === stop ? 0 : -1;
  }
  // Too many segments for the width (a phone): the DS inner track scrolls sideways; keep the selected one in view,
  // clear of the faded edge (the track's scroll-padding).
  const track = root.querySelector<HTMLElement>('[data-segment-track]') ?? (root as HTMLElement);
  if (current && track.scrollWidth > track.clientWidth) {
    const pad = parseFloat(getComputedStyle(track).scrollPaddingInlineStart) || 0;
    const start = current.offsetLeft - pad;
    const end = current.offsetLeft + current.offsetWidth + pad;
    if (start < track.scrollLeft) track.scrollLeft = Math.max(0, start);
    else if (end > track.scrollLeft + track.clientWidth) track.scrollLeft = end - track.clientWidth;
  }
  markOverflow(root as HTMLElement);
}

/** The DS static contract for a scrolling track: data-overflow on the root names the edges of its inner track that hide
 * segments (the CSS fades them). */
function markOverflow(root: HTMLElement) {
  const track = root.querySelector<HTMLElement>('[data-segment-track]') ?? root;
  const max = track.scrollWidth - track.clientWidth;
  const start = track.scrollLeft > 1;
  const end = max - track.scrollLeft > 1;
  const value = start && end ? 'both' : start ? 'start' : end ? 'end' : null;
  if (value) root.setAttribute('data-overflow', value);
  else root.removeAttribute('data-overflow');
}

/** Select a segment of a static SegmentedControl. `emit` dispatches bridge:segment as a user change would. */
export function selectSegment(root: Element, value: string, emit = false) {
  paintSegments(root, value);
  if (emit) root.dispatchEvent(new CustomEvent('bridge:segment', { detail: { value }, bubbles: true }));
}

function initSegmented() {
  document.querySelectorAll(SEG_ROOT).forEach((root) => {
    const checked = root.querySelector<HTMLElement>('[data-segment][aria-checked="true"]');
    paintSegments(root, checked?.dataset.value ?? null);
  });
  // Scrolling tracks (phones): fade the edges that hide segments, on scroll and on resize.
  document.addEventListener(
    'scroll',
    (e) => {
      const root = e.target instanceof HTMLElement ? e.target.closest<HTMLElement>(SEG_ROOT) : null;
      if (root) markOverflow(root);
    },
    { capture: true, passive: true },
  );
  window.addEventListener('resize', () => document.querySelectorAll<HTMLElement>(SEG_ROOT).forEach(markOverflow), { passive: true });
  document.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>(`${SEG_ROOT} [data-segment]`);
    const root = b?.closest(SEG_ROOT);
    if (!b || !root || segDisabled(b) || b.getAttribute('aria-checked') === 'true') return;
    selectSegment(root, b.dataset.value ?? '', true);
  });
  document.addEventListener('keydown', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>(`${SEG_ROOT} [data-segment]`);
    const root = b?.closest(SEG_ROOT);
    if (!b || !root) return;
    const segs = segmentsOf(root).filter((x) => !segDisabled(x));
    const i = segs.indexOf(b);
    const rtl = getComputedStyle(root).direction === 'rtl';
    const step: Record<string, number> = { ArrowRight: rtl ? -1 : 1, ArrowDown: 1, ArrowLeft: rtl ? 1 : -1, ArrowUp: -1 };
    let next: HTMLButtonElement | undefined;
    if (e.key in step) next = segs[(i + step[e.key] + segs.length) % segs.length];
    else if (e.key === 'Home') next = segs[0];
    else if (e.key === 'End') next = segs[segs.length - 1];
    if (!next) return;
    e.preventDefault();
    next.focus();
    if (next !== b) selectSegment(root, next.dataset.value ?? '', true);
  });
}

function initCopy() {
  document.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-copy]');
    if (!b) return;
    let text = b.getAttribute('data-copy') ?? '';
    const from = b.getAttribute('data-copy-from');
    if (from) text = document.getElementById(from)?.textContent ?? '';
    if (!navigator.clipboard) return;
    navigator.clipboard.writeText(text).then(
      () => {
        b.setAttribute('data-copied', '');
        const label = b.querySelector<HTMLElement>('[data-copy-label]');
        const old = label?.textContent;
        if (label) label.textContent = 'Copied';
        announce('Copied to clipboard');
        window.setTimeout(() => {
          b.removeAttribute('data-copied');
          if (label && old != null) label.textContent = old;
        }, 1400);
      },
      () => announce('Copy failed. Select the text and copy it by hand.'),
    );
  });
}

function initRail() {
  const rail = $('rail');
  const open = $<HTMLButtonElement>('rail-toggle');
  const close = $<HTMLButtonElement>('rail-close');
  const scrim = $('scrim');
  const main = $('main');
  if (!rail || !open || !close || !scrim) return;
  const mq = matchMedia('(max-width: 960px)');
  const setInert = () => {
    const isOpen = rail.classList.contains('is-open');
    if (mq.matches) rail.toggleAttribute('inert', !isOpen);
    else rail.removeAttribute('inert');
    main?.toggleAttribute('inert', mq.matches && isOpen);
  };
  const toggle = (state: boolean) => {
    rail.classList.toggle('is-open', state);
    scrim.hidden = !state;
    open.setAttribute('aria-expanded', String(state));
    document.body.classList.toggle('no-scroll', state);
    setInert();
    if (state) close.focus();
    else open.focus();
  };
  open.addEventListener('click', () => toggle(true));
  close.addEventListener('click', () => toggle(false));
  scrim.addEventListener('click', () => toggle(false));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && rail.classList.contains('is-open')) toggle(false);
  });
  mq.addEventListener('change', () => {
    if (!mq.matches && rail.classList.contains('is-open')) toggle(false);
    setInert();
  });
  setInert();
  rail.querySelector('[aria-current="page"]')?.scrollIntoView({ block: 'nearest' });
}

/** Side nav groups: a button with aria-expanded shows or hides its list of pages. Only the current group starts open. */
function initNavGroups() {
  document.querySelectorAll<HTMLButtonElement>('[data-nav-group]').forEach((btn) => {
    const list = document.getElementById(btn.getAttribute('aria-controls') ?? '');
    if (!list) return;
    btn.addEventListener('click', () => {
      const open = btn.getAttribute('aria-expanded') !== 'true';
      btn.setAttribute('aria-expanded', String(open));
      list.hidden = !open;
    });
  });
}

/** Subsequence fuzzy score: consecutive and word-start hits score higher. -1 when not all characters match. */
export function fuzzy(query: string, text: string): number {
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  if (!q) return 0;
  const direct = t.indexOf(q);
  if (direct >= 0) return 1000 - direct * 2 - (t.length - q.length) * 0.5 + (direct === 0 ? 200 : 0);
  let score = 0;
  let ti = 0;
  let streak = 0;
  for (const ch of q) {
    const found = t.indexOf(ch, ti);
    if (found < 0) return -1;
    const boundary = found === 0 || /[\s./_-]/.test(t[found - 1] ?? '');
    streak = found === ti ? streak + 1 : 0;
    score += 10 + streak * 6 + (boundary ? 12 : 0) - Math.min(found - ti, 10);
    ti = found + 1;
  }
  return score;
}

const KIND_LABEL = { page: 'Page', component: 'Component', token: 'Token' } as const;

function initPalette() {
  const dialog = $('palette');
  const input = document.querySelector<HTMLInputElement>('[data-palette-q]');
  const list = $<HTMLUListElement>('palette-list');
  const count = $('palette-count');
  const trigger = $<HTMLButtonElement>('search-open');
  if (!dialog || !input || !list || !trigger) return;
  let data: SearchItem[] | null = null;
  let results: SearchItem[] = [];
  let active = 0;

  const load = async () => {
    if (data) return data;
    try {
      const r = await fetch('/search-index.json');
      data = (await r.json()) as SearchItem[];
    } catch {
      data = [];
    }
    return data;
  };

  const render = () => {
    list.textContent = '';
    if (!results.length) {
      const li = document.createElement('li');
      li.className = 'palette-empty';
      li.textContent = input.value ? `Nothing matches "${input.value}". Try a token path like color.action, or a hex.` : 'Type to search.';
      list.appendChild(li);
    }
    results.forEach((item, i) => {
      const li = document.createElement('li');
      li.id = `pal-${i}`;
      li.setAttribute('role', 'option');
      li.setAttribute('aria-selected', String(i === active));
      const a = document.createElement('a');
      a.href = item.href;
      a.tabIndex = -1;
      const sw = document.createElement('span');
      sw.className = `palette-kind kind-${item.kind}`;
      if (item.swatch) {
        sw.classList.add('has-swatch');
        sw.style.setProperty('--sw', item.swatch);
      }
      sw.setAttribute('aria-hidden', 'true');
      const body = document.createElement('span');
      body.className = 'palette-body';
      const title = document.createElement('span');
      title.className = item.kind === 'token' ? 'palette-title mono' : 'palette-title';
      title.textContent = item.title;
      body.appendChild(title);
      if (item.meta) {
        const meta = document.createElement('span');
        meta.className = 'palette-meta';
        meta.textContent = item.meta;
        body.appendChild(meta);
      }
      const tag = document.createElement('span');
      tag.className = 'palette-tag';
      tag.textContent = KIND_LABEL[item.kind];
      a.append(sw, body, tag);
      li.appendChild(a);
      li.addEventListener('mousemove', () => {
        if (active !== i) {
          active = i;
          sync();
        }
      });
      list.appendChild(li);
    });
    if (count) count.textContent = input.value ? `${results.length} result${results.length === 1 ? '' : 's'}` : '';
    sync();
  };

  const sync = () => {
    [...list.querySelectorAll('[role="option"]')].forEach((el, i) => el.setAttribute('aria-selected', String(i === active)));
    const current = list.querySelector(`#pal-${active}`);
    if (current) {
      input.setAttribute('aria-activedescendant', current.id);
      current.scrollIntoView({ block: 'nearest' });
    } else input.removeAttribute('aria-activedescendant');
  };

  const search = () => {
    const q = input.value.trim();
    const all = data ?? [];
    if (!q) {
      results = all.filter((x) => x.kind !== 'token').slice(0, 12);
    } else {
      const weight = { page: 40, component: 60, token: 0 } as const;
      results = all
        .map((item) => {
          const s = Math.max(fuzzy(q, item.title), fuzzy(q, item.keys ?? '') - 40);
          return { item, s: s < 0 ? -1 : s + weight[item.kind] };
        })
        .filter((x) => x.s >= 0)
        .sort((a, b) => b.s - a.s)
        .slice(0, 40)
        .map((x) => x.item);
    }
    active = 0;
    render();
  };

  const open = async () => {
    if (isDialogOpen(dialog)) return;
    openDialog(dialog);
    input.value = '';
    await load();
    search();
    input.focus();
  };

  trigger.addEventListener('click', open);
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      if (isDialogOpen(dialog)) closeDialog(dialog);
      else open();
    } else if (e.key === '/' && !isDialogOpen(dialog) && !(e.target as HTMLElement).closest('input, textarea, [contenteditable]')) {
      e.preventDefault();
      open();
    }
  });
  input.addEventListener('input', search);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      active = Math.min(active + 1, results.length - 1);
      sync();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      active = Math.max(active - 1, 0);
      sync();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const item = results[active];
      if (item) window.location.href = item.href;
    }
  });
}

/** Header menus (<details data-menu>): close on outside click and on Escape, one open at a time. */
function initMenus() {
  const menus = [...document.querySelectorAll<HTMLDetailsElement>('details[data-menu]')];
  if (!menus.length) return;
  document.addEventListener('click', (e) => {
    for (const m of menus) if (m.open && !m.contains(e.target as Node)) m.open = false;
  });
  for (const m of menus) {
    m.addEventListener('toggle', () => {
      if (m.open) for (const o of menus) if (o !== m) o.open = false;
    });
    m.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && m.open) {
        m.open = false;
        m.querySelector('summary')?.focus();
      }
    });
  }
}

/** Right rail of reading pages: one link per h2, the current section marked while scrolling. */
function initToc() {
  const aside = document.querySelector<HTMLElement>('[data-auto-toc]');
  const list = aside?.querySelector('ul');
  if (!aside || !list) return;
  const heads = [...document.querySelectorAll<HTMLElement>('.page-body h2')].filter((h) => !h.closest('[hidden], dialog, .sr-only') && !h.classList.contains('sr-only'));
  if (heads.length < 2) return;
  const slug = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  for (const h of heads) {
    if (!h.id) h.id = slug(h.textContent ?? '') || `section-${heads.indexOf(h)}`;
    const li = document.createElement('li');
    const a = document.createElement('a');
    a.href = `#${h.id}`;
    a.textContent = (h.textContent ?? '').trim();
    li.appendChild(a);
    list.appendChild(li);
  }
  aside.hidden = false;
  const links = [...list.querySelectorAll('a')];
  if (!('IntersectionObserver' in window)) return;
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        links.forEach((a) => (a.hash === `#${e.target.id}` ? a.setAttribute('aria-current', 'true') : a.removeAttribute('aria-current')));
      }
    },
    { rootMargin: '-10% 0px -75% 0px' },
  );
  heads.forEach((h) => io.observe(h));
}

const DRAFT_KEY = 'bridge.draft.v1';

/** Draft edits kept in this browser by the token editor. */
export function draftCount(): number {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    return raw ? ((JSON.parse(raw) as { edits?: unknown[] }).edits?.length ?? 0) : 0;
  } catch {
    return 0;
  }
}

/** The Changes badge: the changes in review that wait on the viewer's decision (scripts/needs-you), hidden at 0. */
export const setReviewCount = (n: number | null) => setCount('reviews', n);

function setCount(kind: 'drafts' | 'reviews', n: number | null) {
  // The nav shows one number, on Changes: the changes in review that wait on the viewer (hidden at 0).
  document.querySelectorAll<HTMLElement>(`[data-nav-count="${kind}"]`).forEach((el) => {
    el.hidden = !n;
    const v = el.querySelector('[data-nav-count-value]');
    if (v) v.textContent = n ? String(n) : '';
  });
  // The Drafts counter in the Studio header always shows its number, zero included.
  if (kind === 'drafts')
    document.querySelectorAll<HTMLElement>('[data-drafts-open]').forEach((el) => {
      el.dataset.count = String(n ?? 0);
      el.setAttribute('aria-label', `Drafts, ${n ?? 0} change${n === 1 ? '' : 's'} in this browser`);
      const v = el.querySelector('[data-nav-count-value-hd]');
      if (v) v.textContent = String(n ?? 0);
    });
}

/**
 * Changes > "Review and propose" lands on Studio Tokens with #review: open the draft review sheet once the
 * explorer has painted its draft bar (it loads its data first), then drop the hash.
 */
function openReviewFromHash() {
  if (location.hash !== '#review') return;
  let tries = 0;
  const tick = () => {
    const bar = document.querySelector<HTMLElement>('[data-xe-bar]');
    const review = bar?.querySelector<HTMLElement>('[data-xe-review]');
    if (bar && review && !bar.hidden) {
      review.click();
      history.replaceState(null, '', location.pathname + location.search);
      return;
    }
    if (++tries < 60) window.setTimeout(tick, 100);
  };
  tick();
}

function initStudio() {
  if (document.documentElement.dataset.space === 'library') return;
  initGitHubConnect();

  setCount('drafts', draftCount());
  // Paint the last known count at once, so the nav does not jump while GitHub answers (or when it cannot).
  setCount('reviews', getToken() ? rememberedMine() : null);
  // The Overview reads the same statuses for its Needs you list and sets the badge itself.
  const pageCounts = Boolean(document.querySelector('[data-review-count-owner]'));
  openReviewFromHash();
  document.addEventListener('bridge:draft', () => setCount('drafts', draftCount()));
  window.addEventListener('storage', (e) => {
    if (e.key === DRAFT_KEY) setCount('drafts', draftCount());
  });

  // "Viewing: Latest library" on Tokens, Components and Quality, the view banner, and links that keep the view.
  initViewChange();
  // One read of the open changes per page, shared with the view selector (scripts/view-change).
  readOpenPulls()
    .then((f) => {
      // What waits on the viewer in the review queue (the same list as the In review tab and the Overview), with the
      // Overview's rule (lib/overview-todo reviewNeedsYou). Signed out nothing waits on you: no badge.
      if (!pageCounts)
        initGitHubConnect((v) => {
          if (!v) return setCount('reviews', null);
          void loadReviewNeedsYou(f.data.map((p) => ({ ...p, state: p.state ?? 'open' })) as unknown as QueuePullFull[])
            .then((n) => setCount('reviews', n))
            .catch(() => undefined);
        });
    })
    .catch(() => {
      // Rate limited with nothing in the request cache: keep the last count this browser saw.
      setCount('reviews', getToken() ? rememberedMine() : null);
    });
}

export function initShell() {
  initTheme();
  initMaintainer();
  initSegmented();
  initVanillaControls();
  initMenus();
  initToc();
  initStudio();
  initScope();
  initCopy();
  // DS components rendered without React at runtime (static Astro HTML, script-built rows): tooltips, copy, dialogs.
  bindTooltips();
  bindCodeBlocks();
  bindDialogs();
  initRail();
  initNavGroups();
  initPalette();
}
