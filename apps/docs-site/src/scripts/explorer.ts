// Token explorer: filters over server-rendered cards, and the detail drawer rendered from the embedded JSON.
// Cards are plain buttons; the drawer is a modal <dialog>, so Esc closes it and focus returns to the card.

type Mode = 'light' | 'dark';
interface Link {
  name: string;
  href: string;
}
interface Token {
  path: string;
  cssVar: string;
  figma: string;
  type: string;
  typeLabel: string;
  layer: 'primitive' | 'brand' | 'semantic' | 'density' | 'component';
  description?: string;
  deprecated?: boolean | string;
  value: string;
  hex?: string;
  modes?: Record<Mode, { chain: string[]; css: string; hex?: string }>;
  brands?: Record<string, Record<Mode, { chain: string[]; css: string; hex?: string }>>;
  densities?: Record<string, string>;
  used: boolean;
  usedBy: Link[];
  referencedBy?: { path: string; modes: Mode[] }[];
  contrast: { other: string; role: 'fg' | 'bg'; fgVar: string; bgVar: string; usage: 'text' | 'ui'; modes: Record<Mode, { ratio: number; aa: boolean }> }[];
  href: string;
  file?: string;
  kind: string;
}

const MODES: Mode[] = ['light', 'dark'];
const MODE_LABEL: Record<Mode, string> = { light: 'Light', dark: 'Dark' };
const TIER_LABEL: Record<string, string> = { primitive: 'Primitive', brand: 'Brand', semantic: 'Semantic', density: 'Density', component: 'Component' };
const BRAND_LABEL: Record<string, string> = { bridge: 'Bridge', ocean: 'Ocean' };
const isAlias = (t: Token) => t.layer !== 'primitive';
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const ICON = {
  edit: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16z"/><path d="m13.5 6.5 4 4"/></svg>',
  copy: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="8.5" y="8.5" width="11" height="11" rx="2"/><path d="M15.5 8.5V6a1.5 1.5 0 0 0-1.5-1.5H6A1.5 1.5 0 0 0 4.5 6v8A1.5 1.5 0 0 0 6 15.5h2.5"/></svg>',
};

/** Visual sample for a token value, inside a theme-pinned wrapper so semantic tokens resolve per theme. */
function sample(t: Token, mode: Mode | null, size: 'lg' | 'sm' = 'lg'): string {
  const v = `var(${t.cssVar})`;
  const theme = mode ? ` data-theme="${mode}"` : '';
  const cls = `tx-sample tx-sample-${size} kind-${t.kind}`;
  switch (t.kind) {
    case 'color':
      return `<span class="${cls}"${theme}><span class="pv-fill" style="background-color:${v}"></span></span>`;
    case 'shadow':
      return `<span class="${cls} pv-shadow-solo"${theme || ' data-theme="light"'}><i style="box-shadow:${v}"></i></span>`;
    case 'radius':
      return `<span class="${cls}"${theme}><span class="pv-corner" style="border-top-left-radius:${v}"></span></span>`;
    case 'stroke':
      return `<span class="${cls}"${theme}><span class="pv-stroke" style="border-top-width:${v}"></span></span>`;
    case 'space':
      return `<span class="${cls}"${theme}><span class="pv-space"><span style="width:${v}"></span></span></span>`;
    case 'size':
      return `<span class="${cls}"${theme}><span class="pv-text" style="font-size:${v}">Ag</span></span>`;
    case 'family':
      return `<span class="${cls}"${theme}><span class="pv-text" style="font-family:${v}">Ag</span></span>`;
    case 'weight':
      return `<span class="${cls}"${theme}><span class="pv-text" style="font-weight:${v}">Ag</span></span>`;
    default:
      return `<span class="${cls}"${theme}><span class="pv-leading" style="line-height:${v}">Tokens decide,<br>Figma explores.</span></span>`;
  }
}

function node(path: string, kind: 'self' | 'semantic' | 'primitive', byPath: Map<string, Token>, note?: string): string {
  const tier = byPath.get(path)?.layer;
  const label = note ?? (kind === 'self' ? 'This token' : TIER_LABEL[tier ?? kind] ?? 'Semantic');
  const known = byPath.has(path);
  const inner = `<span class="tx-node-kind">${label}</span><span class="tx-node-name">${esc(path)}</span>`;
  return known && kind !== 'self'
    ? `<button type="button" class="tx-node is-${kind}" data-goto="${esc(path)}" title="Open ${esc(path)}">${inner}</button>`
    : `<span class="tx-node is-${kind}">${inner}</span>`;
}

function valueNode(t: Token, mode: Mode | null): string {
  const css = mode && t.modes ? t.modes[mode].css : t.value;
  const hex = mode && t.modes ? t.modes[mode].hex : t.hex;
  const showHex = hex && t.type === 'color' && hex !== css;
  return `<span class="tx-node is-value">${t.type === 'color' ? sample(t, mode, 'sm') : ''}<span class="tx-node-kind">Value</span><span class="tx-node-name">${esc(css)}${showHex ? ` <span class="muted">${esc(hex!)}</span>` : ''}</span></span>`;
}

function graph(t: Token, byPath: Map<string, Token>): string {
  if (isAlias(t) && t.modes) {
    return MODES.map((m) => {
      const hops = t.modes![m].chain.map((h) => node(h, byPath.get(h)?.layer === 'primitive' ? 'primitive' : 'semantic', byPath));
      const nodes = [node(t.path, 'self', byPath), ...hops, valueNode(t, m)];
      return `<div class="tx-graph-row"><span class="tx-graph-mode">${MODE_LABEL[m]}</span><div class="tx-graph">${nodes.join('<span class="tx-link" aria-hidden="true"></span>')}</div></div>`;
    }).join('');
  }
  const refs = t.referencedBy ?? [];
  const fan = refs.length
    ? `<div class="tx-fan">${refs
        .slice(0, 8)
        .map((r) => `<div class="tx-fan-item">${node(r.path, 'semantic', byPath, `${TIER_LABEL[byPath.get(r.path)?.layer ?? 'semantic']}, ${r.modes.length === MODES.length ? 'both themes' : `${MODE_LABEL[r.modes[0]!].toLowerCase()} only`}`)}</div>`)
        .join('')}${refs.length > 8 ? `<p class="muted small">and ${refs.length - 8} more</p>` : ''}</div><span class="tx-link" aria-hidden="true"></span>`
    : '';
  return `<div class="tx-graph-row"><div class="tx-graph${refs.length ? ' has-fan' : ''}">${fan}${node(t.path, 'self', byPath)}<span class="tx-link" aria-hidden="true"></span>${valueNode(t, null)}</div></div>${
    refs.length ? '' : '<p class="muted small tx-graph-note">No token points to this primitive.</p>'
  }`;
}

function copyRow(kind: string, value: string): string {
  return `<button type="button" class="tx-copy" data-copy="${esc(value)}" aria-label="Copy ${esc(kind)} ${esc(value)}"><span class="tx-copy-kind">${esc(kind)}</span><span class="tx-copy-value">${esc(value)}</span><span class="tx-copy-act">${ICON.copy}<span data-copy-label>Copy</span></span></button>`;
}

function render(t: Token, byPath: Map<string, Token>): string {
  const pills = [
    `<span class="pill ${isAlias(t) ? 'is-accent' : ''}">${TIER_LABEL[t.layer]}</span>`,
    t.brands ? '<span class="pill">Changes with brand</span>' : '',
    `<span class="pill">${esc(t.typeLabel)}</span>`,
    t.used ? '' : '<span class="pill is-warn">Unused</span>',
    t.deprecated ? '<span class="pill is-fail">Deprecated</span>' : '',
  ].join('');
  const desc = t.description ? `<p class="tx-d-desc">${esc(t.description)}</p>` : '';
  const dep = typeof t.deprecated === 'string' ? `<p class="tx-d-desc"><strong>Deprecated:</strong> ${esc(t.deprecated)}</p>` : '';

  const stage = (inner: string, theme: Mode, brand?: string, label = '', css = '') =>
    `<div class="tx-value"><div class="tx-value-stage" data-theme="${theme}"${brand ? ` data-brand="${brand}" data-scope-fixed` : ''}>${inner}</div><div class="tx-value-meta"><strong>${esc(label)}</strong><span class="mono">${esc(css)}</span></div></div>`;
  const values = t.densities
    ? `<div class="tx-values">${Object.entries(t.densities)
        .map(([d, css]) => stage(sample(t, null), 'light', undefined, d === 'compact' ? 'Compact' : 'Comfortable', css))
        .join('')}</div>`
    : t.brands
    ? `<div class="tx-values is-grid">${Object.entries(t.brands)
        .flatMap(([b, modes]) => MODES.map((m) => stage(sample(t, m), m, b, `${BRAND_LABEL[b] ?? b}, ${MODE_LABEL[m]}`, modes[m].css)))
        .join('')}</div>`
    : isAlias(t) && t.modes
      ? `<div class="tx-values">${MODES.map(
          (m) =>
            `<div class="tx-value"><div class="tx-value-stage" data-theme="${m}">${sample(t, m)}</div><div class="tx-value-meta"><strong>${MODE_LABEL[m]}</strong><span class="mono">${esc(
              t.modes![m].css,
            )}</span></div></div>`,
        ).join('')}</div>`
      : `<div class="tx-values is-single"><div class="tx-value"><div class="tx-value-stage" data-theme="light">${sample(t, null)}</div><div class="tx-value-meta"><strong>Same in every theme</strong><span class="mono">${esc(
          t.value,
        )}</span></div></div></div>`;

  const contrast = t.contrast.length
    ? `<ul class="tx-contrast">${t.contrast
        .map((c) => {
          const tiles = MODES.map((m) => {
            const r = c.modes[m];
            const sw =
              c.usage === 'text'
                ? `<span class="tx-aa" data-theme="${m}" style="background-color:var(${c.bgVar});color:var(${c.fgVar})">Aa</span>`
                : `<span class="tx-aa" data-theme="${m}" style="background-color:var(${c.bgVar})"><i style="border-color:var(${c.fgVar})"></i></span>`;
            return `<div class="tx-ratio">${sw}<span class="tx-ratio-text"><span class="num">${r.ratio.toFixed(2)}:1</span><span class="pill ${r.aa ? 'is-pass' : 'is-fail'}">${r.aa ? 'AA pass' : 'AA fail'}</span><span class="muted">${MODE_LABEL[m]}</span></span></div>`;
          }).join('');
          return `<li><p class="tx-contrast-pair">${c.role === 'fg' ? 'On' : 'Under'} <button type="button" class="tx-inline-link" data-goto="${esc(c.other)}">${esc(c.other)}</button> <span class="muted">(${c.usage === 'text' ? 'text, needs 4.5:1' : 'UI, needs 3:1'})</span></p><div class="tx-ratios">${tiles}</div></li>`;
        })
        .join('')}</ul>`
    : `<p class="tx-empty-line">${
        t.type !== 'color'
          ? 'Contrast only applies to color tokens.'
          : t.layer !== 'semantic'
            ? 'Contrast is checked on semantic pairs. Open the semantic token that uses this value to see its pairs.'
            : 'Not part of any checked pair. Add it to packages/tokens/src/contrast.checks.json to track it.'
      }</p>`;

  const users = t.usedBy.length
    ? `<ul class="tx-users">${t.usedBy.map((u) => `<li><a href="${esc(u.href)}">${esc(u.name)}</a></li>`).join('')}</ul>${
        t.layer === 'primitive' ? '<p class="muted small">Includes components that reach this value through an alias.</p>' : ''
      }`
    : `<p class="tx-empty-line">No component reads this token yet${t.layer === 'primitive' ? ', directly or through an alias' : ''}.</p>`;

  return `
    <header class="tx-d-head">
      ${sample(t, isAlias(t) ? 'light' : null)}
      <div>
        <h2 id="tx-d-title" class="tx-d-title" tabindex="-1">${esc(t.path)}</h2>
        <div class="tx-d-pills">${pills}</div>
      </div>
      ${explorerMode() === 'read' ? `<a class="btn btn-secondary btn-sm tx-d-door" href="${studioHref(t.path)}">${ICON.edit}Edit in Studio</a>` : ''}
    </header>
    ${desc}${dep}
    <section class="tx-d-sec" aria-label="Names">
      <div class="tx-copies">${copyRow('CSS variable', `var(${t.cssVar})`)}${copyRow('Token path', t.path)}${copyRow('Figma variable', t.figma)}</div>
    </section>
    <section class="tx-d-sec"><h3>${isAlias(t) ? 'Alias chain' : 'Who points here'}</h3>${graph(t, byPath)}</section>
    <section class="tx-d-sec"><h3>Values</h3>${values}</section>
    <section class="tx-d-sec"><h3>Contrast pairs <span class="tx-d-n">${t.contrast.length}</span></h3>${contrast}</section>
    <section class="tx-d-sec"><h3>Used by <span class="tx-d-n">${t.usedBy.length}</span></h3>${users}</section>
    <p class="tx-d-foot">${
      explorerMode() === 'edit'
        ? `<a href="/tokens/?t=${encodeURIComponent(t.path)}">See it in the Library</a> <span class="muted">or</span> <a href="${esc(t.href)}">on its foundations page</a>`
        : `<a href="${esc(t.href)}">See it on its foundations page</a> <span class="muted">or</span> <a href="/studio/versions/?token=${encodeURIComponent(t.path)}">its history</a>`
    }</p>`;
}

/** Read in the Library, edit in the Studio. Set by TokenExplorerSlot. */
const explorerMode = () => document.querySelector<HTMLElement>('[data-explorer-mode]')?.dataset.explorerMode ?? 'read';

/** The door: from a Library token to the Studio editor, focused on that token, with a draft started. */
const studioHref = (path: string) => `/studio/tokens/?t=${encodeURIComponent(path)}`;

export function initExplorer() {
  const dataEl = document.getElementById('tx-data');
  if (!dataEl) return;
  const tokens = JSON.parse(dataEl.textContent || '[]') as Token[];
  const byPath = new Map(tokens.map((t) => [t.path, t]));
  const cards = [...document.querySelectorAll<HTMLLIElement>('.tk')];
  const sections = [...document.querySelectorAll<HTMLElement>('[data-layer-section]')];
  const q = document.getElementById('tx-q') as HTMLInputElement;
  const count = document.getElementById('tx-count')!;
  const empty = document.getElementById('tx-empty')!;
  const drawer = document.getElementById('tx-drawer') as HTMLDialogElement;
  const body = document.getElementById('tx-d-body')!;
  const filters: Record<string, string> = { layer: '', usage: '', type: '' };
  let returnFocus: HTMLElement | null = null;

  const params = new URLSearchParams(location.search);
  for (const k of Object.keys(filters)) filters[k] = params.get(k) ?? '';
  q.value = params.get('q') ?? '';

  const syncUrl = () => {
    const p = new URLSearchParams();
    if (q.value.trim()) p.set('q', q.value.trim());
    for (const [k, v] of Object.entries(filters)) if (v) p.set(k, v);
    const open = drawer.open ? drawer.dataset.path : '';
    if (open) p.set('t', open);
    const s = p.toString();
    try {
      history.replaceState(null, '', s ? `?${s}` : location.pathname);
    } catch {
      /* file:// or sandboxed: filters still work */
    }
  };

  const syncButtons = () => {
    document.querySelectorAll<HTMLElement>('[data-filter]').forEach((group) => {
      const key = group.dataset.filter!;
      group.querySelectorAll<HTMLButtonElement>('button[data-value]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.value === filters[key])));
    });
  };

  const apply = () => {
    const needle = q.value.trim().toLowerCase().replace(/^var\(|\)$/g, '');
    const words = needle.split(/\s+/).filter(Boolean);
    let shown = 0;
    for (const li of cards) {
      const ok =
        (!filters.layer || li.dataset.layer === filters.layer) &&
        (!filters.usage || li.dataset.used === filters.usage) &&
        (!filters.type || li.dataset.type === filters.type) &&
        words.every((w) => li.dataset.search!.includes(w));
      li.hidden = !ok;
      if (ok) shown++;
    }
    for (const s of sections) {
      const n = s.querySelectorAll('.tk:not([hidden])').length;
      s.hidden = n === 0;
      const c = s.querySelector('[data-section-count]');
      if (c) c.textContent = String(n);
    }
    count.textContent = shown === tokens.length ? `${shown} tokens` : `${shown} of ${tokens.length} tokens`;
    empty.hidden = shown > 0;
    syncButtons();
    syncUrl();
  };

  document.querySelectorAll<HTMLElement>('[data-filter]').forEach((group) => {
    group.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-value]');
      if (!b) return;
      filters[group.dataset.filter!] = b.dataset.value ?? '';
      apply();
    });
  });
  let timer = 0;
  q.addEventListener('input', () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(apply, 80);
  });
  document.getElementById('tx-clear')?.addEventListener('click', () => {
    q.value = '';
    for (const k of Object.keys(filters)) filters[k] = '';
    apply();
    q.focus();
  });

  const open = (path: string, from?: HTMLElement | null) => {
    const t = byPath.get(path);
    if (!t) return;
    body.querySelector('[data-ed-slot]')?.dispatchEvent(new Event('ed:dispose'));
    body.innerHTML = render(t, byPath);
    // The token history panel (scripts/history/token-panel.ts) fills itself in.
    document.dispatchEvent(new CustomEvent('bridge:token-detail', { detail: { path, body } }));
    if (document.body.classList.contains('is-editing')) {
      // Edit mode: the editor goes right under the title, above the read-only details.
      const slot = document.createElement('section');
      slot.className = 'tx-d-sec ed-slot';
      slot.dataset.edSlot = '';
      slot.setAttribute('aria-label', 'Edit token');
      body.querySelector('.tx-d-head')?.after(slot);
      document.dispatchEvent(new CustomEvent('bridge:token-open', { detail: { path, slot } }));
    }
    drawer.dataset.path = path;
    if (!drawer.open) {
      returnFocus = from ?? (document.activeElement as HTMLElement | null);
      drawer.showModal();
      document.body.classList.add('no-scroll');
    }
    body.scrollTop = 0;
    document.getElementById('tx-d-title')?.focus();
    syncUrl();
  };

  document.addEventListener('click', (e) => {
    const card = (e.target as HTMLElement).closest<HTMLElement>('[data-open]');
    if (card) open(card.dataset.open!, card);
  });
  body.addEventListener('click', (e) => {
    const go = (e.target as HTMLElement).closest<HTMLElement>('[data-goto]');
    if (go) open(go.dataset.goto!);
  });
  document.getElementById('tx-d-close')?.addEventListener('click', () => drawer.close());
  drawer.addEventListener('click', (e) => {
    if (e.target === drawer) drawer.close();
  });
  // Re-render the open drawer when edit mode turns on or off.
  document.addEventListener('bridge:editing', () => {
    if (drawer.open && drawer.dataset.path) open(drawer.dataset.path);
  });
  drawer.addEventListener('close', () => {
    body.querySelector('[data-ed-slot]')?.dispatchEvent(new Event('ed:dispose'));
    document.body.classList.remove('no-scroll');
    delete drawer.dataset.path;
    syncUrl();
    const card = returnFocus;
    returnFocus = null;
    card?.focus();
  });

  apply();
  const initial = params.get('t') ?? document.querySelector<HTMLElement>('[data-explorer-focus]')?.dataset.explorerFocus ?? null;
  if (initial && byPath.has(initial)) {
    const card = document.querySelector<HTMLElement>(`[data-open="${CSS.escape(initial)}"]`);
    open(initial, card);
  }
}
