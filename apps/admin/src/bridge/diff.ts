// "Show what changed", the pure part: from the page's style rules and the tokens a change edits, which rules can
// render differently and through which CSS properties. The DOM part (outline.ts) then compares real computed styles
// with the live tokens and with the change's tokens, and outlines only what differs.

export interface Decl {
  prop: string;
  value: string;
}

export interface RuleLike {
  selector: string;
  decls: Decl[];
}

export interface Usage {
  /** Selector without pseudo-elements, for querySelectorAll. */
  selector: string;
  /** "::before" or "::after" when the rule styles a pseudo-element, else null. */
  pseudo: string | null;
  /** Computed (longhand) properties to compare. */
  props: string[];
  /** CSS variables of the changed tokens this rule depends on, directly or through other variables. */
  roots: string[];
}

const VAR = /var\(\s*(--[\w-]+)/g;

/** The custom properties a value reads: "var(--a, var(--b))" -> ["--a", "--b"]. */
export function varsIn(value: string): string[] {
  return [...value.matchAll(VAR)].map((m) => m[1]!);
}

/**
 * Every variable that resolves through a changed one, with the changed ones it comes from. Definitions are read from
 * every rule whatever its scope (a superset: the computed comparison removes what does not really differ).
 */
export function dependents(rules: RuleLike[], changed: string[]): Map<string, Set<string>> {
  const deps = new Map<string, Set<string>>();
  for (const r of rules) {
    for (const d of r.decls) {
      if (!d.prop.startsWith('--')) continue;
      for (const v of varsIn(d.value)) {
        if (!deps.has(d.prop)) deps.set(d.prop, new Set());
        deps.get(d.prop)!.add(v);
      }
    }
  }
  const roots = new Map<string, Set<string>>(changed.map((c) => [c, new Set([c])]));
  let grew = true;
  while (grew) {
    grew = false;
    for (const [name, uses] of deps) {
      for (const u of uses) {
        const from = roots.get(u);
        if (!from) continue;
        if (!roots.has(name)) roots.set(name, new Set());
        const mine = roots.get(name)!;
        for (const f of from) {
          if (!mine.has(f)) {
            mine.add(f);
            grew = true;
          }
        }
      }
    }
  }
  return roots;
}

const SIDES = ['top', 'right', 'bottom', 'left'];
const SHORTHANDS: Record<string, string[]> = {
  background: ['background-color', 'background-image'],
  border: [...SIDES.map((s) => `border-${s}-color`), ...SIDES.map((s) => `border-${s}-width`)],
  'border-color': SIDES.map((s) => `border-${s}-color`),
  'border-width': SIDES.map((s) => `border-${s}-width`),
  'border-block': ['border-top-color', 'border-bottom-color', 'border-top-width', 'border-bottom-width'],
  'border-inline': ['border-left-color', 'border-right-color', 'border-left-width', 'border-right-width'],
  'border-radius': ['border-top-left-radius', 'border-top-right-radius', 'border-bottom-right-radius', 'border-bottom-left-radius'],
  outline: ['outline-color', 'outline-width'],
  padding: SIDES.map((s) => `padding-${s}`),
  margin: SIDES.map((s) => `margin-${s}`),
  inset: SIDES,
  gap: ['row-gap', 'column-gap'],
  font: ['font-family', 'font-size', 'font-weight', 'line-height'],
  'text-decoration': ['text-decoration-color', 'text-decoration-line'],
  transition: ['transition-duration', 'transition-timing-function'],
};
for (const s of SIDES) SHORTHANDS[`border-${s}`] = [`border-${s}-color`, `border-${s}-width`];
for (const [logical, physical] of [
  ['border-block-start', 'top'],
  ['border-block-end', 'bottom'],
  ['border-inline-start', 'left'],
  ['border-inline-end', 'right'],
] as const) {
  SHORTHANDS[logical] = [`border-${physical}-color`, `border-${physical}-width`];
  SHORTHANDS[`${logical}-color`] = [`border-${physical}-color`];
  SHORTHANDS[`${logical}-width`] = [`border-${physical}-width`];
}
SHORTHANDS['padding-inline'] = ['padding-left', 'padding-right'];
SHORTHANDS['padding-block'] = ['padding-top', 'padding-bottom'];
SHORTHANDS['margin-inline'] = ['margin-left', 'margin-right'];
SHORTHANDS['margin-block'] = ['margin-top', 'margin-bottom'];

/** The computed properties a declared one sets (shorthands and logical properties expand to physical longhands). */
export function longhands(prop: string): string[] {
  return SHORTHANDS[prop] ?? [prop];
}

/** Splits "a, b::before" into its own selectors, keeping commas inside :is() / :where() / :not(). */
function splitSelectors(selector: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of selector) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      out.push(cur.trim());
      cur = '';
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/**
 * The rules whose regular (non-custom) properties read a changed token, directly or through other variables, grouped
 * by selector and pseudo-element.
 */
/** Properties that paint nothing on their own element (native control tint, caret): never a surface. */
const NON_PAINT = new Set(['accent-color', 'caret-color']);

export function usages(rules: RuleLike[], roots: Map<string, Set<string>>): Usage[] {
  const out = new Map<string, Usage>();
  for (const r of rules) {
    const hits = r.decls.filter((d) => !d.prop.startsWith('--') && !NON_PAINT.has(d.prop)).map((d) => ({ d, from: varsIn(d.value).filter((v) => roots.has(v)) })).filter((x) => x.from.length);
    if (!hits.length) continue;
    for (const one of splitSelectors(r.selector)) {
      const m = /::?(before|after|placeholder|marker|selection|backdrop)\b/i.exec(one);
      const pseudo = m ? `::${m[1]!.toLowerCase()}` : null;
      // A text selection only shows while someone selects: not a surface of the screen.
      if (pseudo === '::selection') continue;
      const selector = (m ? one.slice(0, m.index) + one.slice(m.index + m[0].length) : one).trim() || '*';
      const key = `${selector}|${pseudo ?? ''}`;
      const u = out.get(key) ?? { selector, pseudo, props: [], roots: [] };
      for (const { d, from } of hits) {
        for (const p of longhands(d.prop)) if (!u.props.includes(p)) u.props.push(p);
        for (const v of from) for (const root of roots.get(v)!) if (!u.roots.includes(root)) u.roots.push(root);
      }
      out.set(key, u);
    }
  }
  return [...out.values()];
}

/**
 * Surfaces: the outermost changed elements. An element whose ancestor changes for the same token and property paints
 * the same thing inside it, so only the ancestor counts, unless it floats (sticky or fixed): then it paints over other
 * content and is a surface of its own. `contains(a, b)` is true when a is an ancestor of b.
 */
export function outermost<T extends { keys: string[]; floating?: boolean }>(items: T[], contains: (a: T, b: T) => boolean): T[] {
  return items.filter((b) => b.floating || !items.some((a) => a !== b && contains(a, b) && b.keys.every((k) => a.keys.includes(k))));
}

/** "1 token changed: Page canvas, on 3 surfaces". */
export function surfaceLine(tokenNames: string[], surfaces: number): string {
  const names = [...new Set(tokenNames)];
  const tokens = `${names.length} ${names.length === 1 ? 'token' : 'tokens'} changed: ${names.slice(0, 3).join(', ')}${names.length > 3 ? ` and ${names.length - 3} more` : ''}`;
  return `${tokens}, on ${surfaces} ${surfaces === 1 ? 'surface' : 'surfaces'}`;
}

/** Changed surfaces exist on this screen but none is in view: say so, never "nothing changes". */
export function outOfView(n: number): string {
  return n === 1 ? 'Nothing changed in view. 1 surface changes further down: scroll to see it.' : `Nothing changed in view. ${n} surfaces change further down: scroll to see them.`;
}

export const EMPTY_LINE = "This change doesn't touch this screen. Open Screens to see where it does.";

export interface ElementInfo {
  tag: string;
  role: string | null;
  ariaLabel: string | null;
  /** Class names, to read a CSS module's local name ("_sticky_1f7pa_38" -> "sticky"). */
  classes: string[];
  /** A heading inside it, or its own short text. */
  text: string | null;
}

const LANDMARKS: Record<string, string> = { main: 'Content', header: 'Header', nav: 'Navigation', aside: 'Sidebar', footer: 'Footer', form: 'Form', dialog: 'Dialog' };
const ROLES: Record<string, string> = { main: 'Content', banner: 'Header', navigation: 'Navigation', complementary: 'Sidebar', contentinfo: 'Footer', dialog: 'Dialog', toolbar: 'Toolbar', tablist: 'Tabs', table: 'Table', grid: 'Table', menu: 'Menu', listbox: 'List' };
const MODULES: Record<string, string> = { mark: 'Shop logo', shell: 'App shell', column: 'Content column', content: 'Content', sticky: 'Save bar', toolbar: 'Save bar', header: 'Header', sidebar: 'Sidebar', card: 'Card', panel: 'Panel' };
const MODULE_CLASS = /^_([a-zA-Z][a-zA-Z0-9]*)_[a-z0-9]+_\d+$/;

const words = (s: string) => {
  const w = s.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[-_]+/g, ' ').trim().toLowerCase();
  return w.charAt(0).toUpperCase() + w.slice(1);
};

/** The role a person would name: landmark, ARIA role, or component (CSS module), then its text in parentheses. */
export function roleName(info: ElementInfo): string {
  const tag = info.tag.toLowerCase();
  if (tag === 'html' || tag === 'body') return 'Page';
  // Chart marks (recharts draws SVG): the chart is what a person sees.
  if (['svg', 'path', 'line', 'rect', 'circle', 'g', 'polyline', 'stop'].includes(tag)) return 'Chart';
  const locals = info.classes.map((c) => MODULE_CLASS.exec(c)?.[1]).filter((l): l is string => Boolean(l));
  const local = locals.find((l) => MODULES[l]) ?? locals[0];
  const role = info.ariaLabel || (info.role && ROLES[info.role]) || LANDMARKS[tag] || (local ? (MODULES[local] ?? words(local)) : null);
  // A logo's letters are not a name: "Shop logo", not "Shop logo (NP)".
  const text = local === 'mark' ? null : info.text && info.text.length <= 32 && info.text !== role ? info.text : null;
  if (role) return text ? `${role} (${text})` : role;
  return text ?? tag;
}

/** C toggles the outlines, unless the person is typing or holds a modifier. */
export function isKey(e: { key: string; altKey: boolean; ctrlKey: boolean; metaKey: boolean; target: unknown }, key: string): boolean {
  if (e.altKey || e.ctrlKey || e.metaKey || e.key.toLowerCase() !== key) return false;
  const t = e.target as { tagName?: string; isContentEditable?: boolean; closest?: (s: string) => unknown } | null;
  if (!t) return true;
  if (t.isContentEditable) return false;
  const tag = (t.tagName ?? '').toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return false;
  return !(t.closest && t.closest('[role="combobox"], [role="textbox"], [role="searchbox"]'));
}
