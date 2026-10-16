// Theme playground: view switch, token inspector tooltip, and the tactile scale controls.
// The controls only set CSS variables on the preview stage. Nothing is saved, nothing leaves the browser.

interface InspectToken {
  name: string;
  path: string;
  kind: 'semantic' | 'primitive';
  color: boolean;
  light: string;
  dark: string;
}
interface Inspect {
  name: string;
  detail?: string;
  tokens: InspectToken[];
}
interface Data {
  baseline: {
    space: { cssVar: string; px: number }[];
    radius: { cssVar: string; px: number; key: string }[];
    fontSize: { cssVar: string; px: number; key: string }[];
  };
  ratios: { key: string; label: string; value: number }[];
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};

function initView(stage: HTMLElement) {
  const buttons = [...document.querySelectorAll<HTMLButtonElement>('[data-view]')].filter((b) => b.tagName === 'BUTTON');
  const set = (view: string) => {
    stage.dataset.view = view;
    buttons.forEach((b) => b.setAttribute('aria-checked', String(b.dataset.view === view)));
  };
  buttons.forEach((b, i) => {
    b.addEventListener('click', () => set(b.dataset.view!));
    b.addEventListener('keydown', (e) => {
      const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
      if (!d) return;
      e.preventDefault();
      const next = buttons[(i + d + buttons.length) % buttons.length]!;
      next.focus();
      set(next.dataset.view!);
    });
  });
  // On narrow screens two stacked frames make the page very long: start with one theme.
  if (matchMedia('(max-width: 1100px)').matches) set('light');
  const outline = document.getElementById('pg-outline') as HTMLInputElement | null;
  outline?.addEventListener('change', () => stage.classList.toggle('show-outlines', outline.checked));
}

function initInspector(stage: HTMLElement, tip: HTMLElement) {
  let current: HTMLElement | null = null;

  const targetOf = (host: HTMLElement): HTMLElement => {
    // Wrappers use display: contents and have no box; highlight their first rendered child instead.
    if (host.classList.contains('pg-t')) return (host.firstElementChild as HTMLElement) ?? host;
    return host;
  };

  const show = (host: HTMLElement) => {
    const data = JSON.parse(host.dataset.inspect ?? '{}') as Inspect;
    const frame = host.closest<HTMLElement>('[data-theme]');
    const theme = (frame?.dataset.theme ?? 'light') as 'light' | 'dark';
    const target = targetOf(host);
    if (current && current !== target) current.classList.remove('is-inspected');
    current = target;
    target.classList.add('is-inspected');

    tip.textContent = '';
    tip.dataset.theme = theme;
    const head = el('div', 'tip-head');
    head.append(el('strong', '', data.name));
    if (data.detail) head.append(el('span', 'tip-detail', data.detail));
    head.append(el('span', 'tip-theme', theme === 'light' ? 'Light' : 'Dark'));
    tip.append(head);
    const list = el('ul', 'tip-list');
    const shown = data.tokens.slice(0, 9);
    for (const t of shown) {
      const li = el('li');
      const sw = el('span', t.color ? 'tip-sw' : 'tip-sw is-scale');
      if (t.color) sw.style.backgroundColor = `var(${t.name})`;
      sw.setAttribute('aria-hidden', 'true');
      const name = el('code', 'tip-name', t.name);
      const full = theme === 'light' ? t.light : t.dark;
      const val = el('span', 'tip-val', full.split(', ').pop() ?? full);
      val.title = full;
      const kind = el('span', `tip-kind is-${t.kind}`, t.kind === 'semantic' ? 'S' : 'P');
      kind.title = t.kind;
      li.append(sw, name, kind, val);
      list.append(li);
    }
    tip.append(list);
    if (data.tokens.length > shown.length) tip.append(el('p', 'tip-more', `and ${data.tokens.length - shown.length} more`));
    if (!data.tokens.length) tip.append(el('p', 'tip-more', 'No tokens found for this part.'));
    tip.hidden = false;
    place(target);
  };

  const place = (target: HTMLElement) => {
    const r = target.getBoundingClientRect();
    const t = tip.getBoundingClientRect();
    const gap = 10;
    let top = r.bottom + gap;
    if (top + t.height > window.innerHeight - 8) top = Math.max(8, r.top - t.height - gap);
    let left = r.left;
    left = Math.min(left, window.innerWidth - t.width - 8);
    left = Math.max(8, left);
    tip.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
  };

  const hide = () => {
    tip.hidden = true;
    current?.classList.remove('is-inspected');
    current = null;
  };

  const hostFrom = (node: EventTarget | null) => (node as HTMLElement | null)?.closest?.<HTMLElement>('[data-inspect]') ?? null;

  stage.addEventListener('mouseover', (e) => {
    const host = hostFrom(e.target);
    if (host) show(host);
  });
  stage.addEventListener('mouseleave', hide);
  stage.addEventListener('focusin', (e) => {
    const host = hostFrom(e.target);
    if (host) show(host);
  });
  stage.addEventListener('focusout', (e) => {
    if (!stage.contains(e.relatedTarget as Node)) hide();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') hide();
  });
  window.addEventListener('scroll', () => current && place(current), { passive: true });
}

function initKnobs(stage: HTMLElement, data: Data) {
  const { baseline, ratios } = data;
  const setVar = (name: string, value: string | null) => {
    if (value === null) stage.style.removeProperty(name);
    else stage.style.setProperty(name, value);
  };

  // Radius
  const radiusOut = document.getElementById('radius-out');
  const radiusPresets: Record<string, Record<string, number> | null> = {
    square: { sm: 0, md: 0, lg: 0 },
    shipped: null,
    soft: { sm: 6, md: 10, lg: 16 },
    pill: { sm: 999, md: 999, lg: 24 },
  };
  const applyRadius = (key: string) => {
    const preset = radiusPresets[key] ?? null;
    for (const r of baseline.radius) {
      if (!['sm', 'md', 'lg'].includes(r.key)) continue;
      setVar(r.cssVar, preset ? `${preset[r.key]}px` : null);
    }
    const label = document.querySelector<HTMLElement>(`input[name="radius"][value="${key}"]`)?.closest('label')?.textContent?.trim();
    if (radiusOut) radiusOut.textContent = label ?? key;
  };
  document.querySelectorAll<HTMLInputElement>('input[name="radius"]').forEach((i) => i.addEventListener('change', () => applyRadius(i.value)));

  // Density
  const density = document.getElementById('density') as HTMLInputElement | null;
  const densityOut = document.getElementById('density-out');
  const densitySteps = [
    { label: 'Compact', m: 0.75 },
    { label: 'Default', m: 1 },
    { label: 'Comfortable', m: 1.25 },
  ];
  const applyDensity = () => {
    const step = densitySteps[Number(density?.value ?? 1)]!;
    for (const s of baseline.space) setVar(s.cssVar, step.m === 1 ? null : `${Math.round(s.px * step.m)}px`);
    if (densityOut) densityOut.textContent = step.label;
    density?.setAttribute('aria-valuetext', step.label);
    stage.closest('body')?.querySelector('.knob-density')?.setAttribute('data-step', String(density?.value ?? 1));
  };
  density?.addEventListener('input', applyDensity);

  // Type scale ratio
  const ratio = document.getElementById('ratio') as HTMLInputElement | null;
  const ratioOut = document.getElementById('ratio-out');
  const ratioNum = document.getElementById('ratio-num');
  const ladder = [...document.querySelectorAll<HTMLElement>('.type-ladder [data-size]')];
  const sizes = baseline.fontSize;
  const baseIndex = Math.max(
    0,
    sizes.findIndex((f) => f.px === 16),
  );
  const applyRatio = () => {
    const r = ratios[Number(ratio?.value ?? 0)]!;
    sizes.forEach((f, i) => {
      const px = r.value ? Math.round(16 * r.value ** (i - baseIndex) * 10) / 10 : null;
      setVar(f.cssVar, px === null ? null : `${px}px`);
      const rung = ladder[i];
      if (rung) rung.style.fontSize = `${px ?? f.px}px`;
    });
    if (ratioOut) ratioOut.textContent = r.label;
    if (ratioNum) ratioNum.textContent = r.value ? String(r.value) : '';
    ratio?.setAttribute('aria-valuetext', r.value ? `${r.label}, ${r.value}` : r.label);
  };
  ratio?.addEventListener('input', applyRatio);

  document.getElementById('pg-reset')?.addEventListener('click', () => {
    const shipped = document.querySelector<HTMLInputElement>('input[name="radius"][value="shipped"]');
    if (shipped) shipped.checked = true;
    applyRadius('shipped');
    if (density) density.value = '1';
    applyDensity();
    if (ratio) ratio.value = '0';
    applyRatio();
  });
}

export function initPlayground() {
  const stage = document.getElementById('pg-stage');
  const tip = document.getElementById('pg-tip');
  const raw = document.getElementById('pg-data')?.textContent;
  if (!stage || !tip || !raw) return;
  initView(stage);
  initInspector(stage, tip);
  initKnobs(stage, JSON.parse(raw) as Data);
}
