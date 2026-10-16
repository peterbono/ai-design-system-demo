// App shell behaviour, shipped on every page (small, no framework):
// theme toggle, copy buttons, the mobile navigation sheet and the Cmd+K command palette.

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
  const btn = $<HTMLButtonElement>('theme-toggle');
  if (!btn) return;
  const sync = () => btn.setAttribute('aria-pressed', String(root.getAttribute('data-theme') === 'dark'));
  sync();
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
  const dialog = $<HTMLDialogElement>('palette');
  const input = $<HTMLInputElement>('palette-q');
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
    if (dialog.open) return;
    dialog.showModal();
    input.value = '';
    await load();
    search();
    input.focus();
  };

  trigger.addEventListener('click', open);
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      if (dialog.open) dialog.close();
      else open();
    } else if (e.key === '/' && !dialog.open && !(e.target as HTMLElement).closest('input, textarea, [contenteditable]')) {
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
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) dialog.close();
  });
  dialog.addEventListener('close', () => trigger.focus());
}

export function initShell() {
  initTheme();
  initCopy();
  initRail();
  initPalette();
}
