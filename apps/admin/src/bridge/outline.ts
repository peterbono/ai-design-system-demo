// "Show what changed", the DOM part. Finds the elements of the current screen whose computed style differs between
// the live tokens and the change's tokens: the rules that read a changed token (diff.ts) give the candidates and the
// properties to compare, then the live stylesheet is switched on and off inside one synchronous task (no paint in
// between, so nothing flashes) and only real differences are kept. Never guessed.
import { dependents, longhands, outermost, roleName, usages, varsIn, type RuleLike, type Usage } from './diff';

export interface PropChange {
  prop: string;
  /** Computed value with the live tokens. */
  before: string;
  /** Computed value with the change's tokens. */
  after: string;
}

export interface ChangedElement {
  el: Element;
  pseudo: string | null;
  /** CSS variables of the changed tokens behind the difference. */
  roots: string[];
  props: PropChange[];
  /** What a person calls it: "Page", "Save bar (Save changes)". */
  label: string;
  /** "root|property" pairs: an ancestor with all of them paints the same change. */
  keys: string[];
  /** Sticky or fixed: paints over other content, so it is a surface even inside a changed ancestor. */
  floating: boolean;
}

export interface DiffResult {
  /** Every element whose computed style differs. */
  elements: ChangedElement[];
  /** The outermost of them: what is outlined and counted (when visible). */
  surfaces: ChangedElement[];
  /** Time the comparison took, in ms (rules are read once per page load and cached). */
  ms: number;
}

let ruleCache: { key: string; rules: RuleLike[] } | null = null;

function declsOf(style: CSSStyleDeclaration): RuleLike['decls'] {
  // cssText keeps shorthands written with var() (their longhands read empty until substitution).
  return style.cssText
    .split(';')
    .map((d) => {
      const i = d.indexOf(':');
      return i < 0 ? null : { prop: d.slice(0, i).trim().toLowerCase(), value: d.slice(i + 1).trim() };
    })
    .filter((d): d is { prop: string; value: string } => Boolean(d && d.prop && d.value));
}

function walk(list: CSSRuleList, out: RuleLike[]) {
  for (const rule of Array.from(list)) {
    if (rule instanceof CSSStyleRule) {
      out.push({ selector: rule.selectorText, decls: declsOf(rule.style) });
      if (rule.cssRules?.length) walk(rule.cssRules, out);
    } else if ('cssRules' in rule && (rule as CSSGroupingRule).cssRules) {
      walk((rule as CSSGroupingRule).cssRules, out);
    }
  }
}

/** The page's own style rules (same origin), without the live tokens stylesheet the toolbar adds. Cached. */
export function pageRules(): RuleLike[] {
  const sheets = Array.from(document.styleSheets).filter((s) => !(s.ownerNode instanceof Element && s.ownerNode.hasAttribute('data-bridge-live')));
  const key = sheets.map((s) => s.href ?? `inline:${(s.ownerNode as Element | null)?.textContent?.length ?? 0}`).join('|');
  if (ruleCache?.key === key) return ruleCache.rules;
  const rules: RuleLike[] = [];
  for (const s of sheets) {
    try {
      walk(s.cssRules, rules);
    } catch {
      // A cross-origin sheet cannot be read: it holds no rule of this app.
    }
  }
  ruleCache = { key, rules };
  return rules;
}

/** "Page", "Content column", "Save bar (Save changes)": landmark, ARIA role or component first, its text after. */
export function describe(el: Element): string {
  const heading = el.querySelector('h1, h2, h3')?.textContent?.replace(/\s+/g, ' ').trim();
  const own = el.textContent?.replace(/\s+/g, ' ').trim();
  return roleName({
    tag: el.tagName,
    role: el.getAttribute('role'),
    ariaLabel: el.getAttribute('aria-label'),
    classes: Array.from(el.classList),
    text: heading || (own && own.length <= 32 ? own : null),
  });
}

/** The part of an element inside the viewport, or null when none of it shows (hidden, transparent, off screen). */
export function shownRect(el: Element): DOMRect | null {
  const check = (el as Element & { checkVisibility?: (o: object) => boolean }).checkVisibility;
  if (check && !check.call(el, { opacityProperty: true, visibilityProperty: true })) return null;
  const r = el.getBoundingClientRect();
  const w = Math.min(r.right, window.innerWidth) - Math.max(r.left, 0);
  const h = Math.min(r.bottom, window.innerHeight) - Math.max(r.top, 0);
  return w > 0 && h > 0 ? r : null;
}

const visible = (el: Element) => el.getClientRects().length > 0;

/**
 * Compares the candidates under both token sets. `live` is the toolbar's stylesheet with the live tokens (loaded);
 * `ignore` holds the toolbar's own nodes.
 */
export function changedElements(changedVars: string[], live: HTMLLinkElement, ignore: (el: Element) => boolean): DiffResult {
  const t0 = performance.now();
  const rules = pageRules();
  const roots = dependents(rules, changedVars);
  const uses: Usage[] = usages(rules, roots);
  type Candidate = { el: Element; pseudo: string | null; props: Set<string>; roots: Set<string> };
  const candidates = new Map<string, Candidate>();
  const ids = new WeakMap<Element, number>();
  let next = 0;
  for (const u of uses) {
    let found: NodeListOf<Element>;
    try {
      found = document.querySelectorAll(u.selector);
    } catch {
      continue;
    }
    for (const el of Array.from(found)) {
      if (ignore(el) || !visible(el)) continue;
      if (!ids.has(el)) ids.set(el, next++);
      const key = `${ids.get(el)}|${u.pseudo ?? ''}`;
      const c = candidates.get(key) ?? { el, pseudo: u.pseudo, props: new Set<string>(), roots: new Set<string>() };
      u.props.forEach((p) => c.props.add(p));
      u.roots.forEach((r) => c.roots.add(r));
      candidates.set(key, c);
    }
  }
  // Inline styles and SVG presentation attributes (charts) read tokens too: <path stroke="var(--color-...)">.
  for (const el of Array.from(document.querySelectorAll('[style*="var(--"], [stroke*="var(--"], [fill*="var(--"], [stop-color*="var(--"]'))) {
    if (ignore(el) || !visible(el)) continue;
    const props = new Set<string>();
    const hit = new Set<string>();
    const take = (prop: string, value: string | null) => {
      if (!value) return;
      const from = varsIn(value).filter((v) => roots.has(v));
      if (!from.length) return;
      longhands(prop).forEach((p) => props.add(p));
      from.forEach((v) => roots.get(v)!.forEach((r) => hit.add(r)));
    };
    for (const d of declsOf((el as HTMLElement).style ?? ({ cssText: '' } as CSSStyleDeclaration))) take(d.prop, d.value);
    for (const attr of ['stroke', 'fill', 'stop-color']) take(attr, el.getAttribute(attr));
    if (!props.size) continue;
    if (!ids.has(el)) ids.set(el, next++);
    const key = `${ids.get(el)}|`;
    const c = candidates.get(key) ?? { el, pseudo: null, props: new Set<string>(), roots: new Set<string>() };
    props.forEach((p) => c.props.add(p));
    hit.forEach((r) => c.roots.add(r));
    candidates.set(key, c);
  }
  const list = [...candidates.values()].map((c) => ({ ...c, propList: [...c.props] }));
  const read = () => list.map((c) => {
    const cs = getComputedStyle(c.el, c.pseudo);
    return c.propList.map((p) => cs.getPropertyValue(p));
  });
  // One synchronous task: the browser cannot paint between the two reads, so the page never shows the other side.
  // Transitions are held while it runs: a component that animates its colour would otherwise report its old value
  // mid-transition (links, buttons), and switching back would start a visible transition.
  const still = document.createElement('style');
  still.setAttribute('data-bridge-still', '');
  still.textContent = '*, *::before, *::after { transition: none !important; }';
  document.head.appendChild(still);
  const media = live.media;
  let withLive: string[][] = [];
  let withChange: string[][] = [];
  try {
    getComputedStyle(document.documentElement).color;
    live.media = 'all';
    withLive = read();
    live.media = 'not all';
    withChange = read();
  } finally {
    live.media = media;
    // Settle on the original values before transitions come back, so nothing animates.
    read();
    still.remove();
  }
  const elements: ChangedElement[] = [];
  list.forEach((c, i) => {
    const props = c.propList.map((prop, j) => ({ prop, before: withLive[i]![j]!, after: withChange[i]![j]! })).filter((p) => p.before !== p.after);
    if (!props.length) return;
    const roots = [...c.roots];
    const position = getComputedStyle(c.el).position;
    elements.push({
      el: c.el,
      pseudo: c.pseudo,
      roots,
      props,
      label: describe(c.el),
      keys: roots.flatMap((r) => props.map((p) => `${r}|${p.prop}`)),
      floating: position === 'sticky' || position === 'fixed',
    });
  });
  // Every mark of one chart is one surface: the outermost svg, labelled "Chart".
  const charts = new Map<Element, ChangedElement>();
  const plain: ChangedElement[] = [];
  for (const e of elements) {
    let svg = e.el.closest('svg');
    while (svg?.parentElement?.closest('svg')) svg = svg.parentElement.closest('svg');
    if (!svg) {
      plain.push(e);
      continue;
    }
    const c: ChangedElement = charts.get(svg) ?? { el: svg, pseudo: null, roots: [], props: [], label: 'Chart', keys: [], floating: false };
    for (const r of e.roots) if (!c.roots.includes(r)) c.roots.push(r);
    for (const p of e.props) if (!c.props.some((x) => x.prop === p.prop)) c.props.push(p);
    for (const k of e.keys) if (!c.keys.includes(k)) c.keys.push(k);
    charts.set(svg, c);
  }
  const surfaces = outermost([...plain, ...charts.values()], (a, b) => a.el !== b.el && a.el.contains(b.el));
  return { elements, surfaces, ms: Math.round((performance.now() - t0) * 10) / 10 };
}
