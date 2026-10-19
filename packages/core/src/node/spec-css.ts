// A small CSS cascade for component specs: parses CSS modules into rules, matches selectors against a simplified
// element tree in a given interaction state (default, hover, pressed, disabled) and computes each element's values with
// inheritance. Enough for token-only component CSS (classes, attributes, :hover, :not(), :has(), combinators, @media);
// it is not a browser. Pure: no DOM, no Node API.

export interface CssDecl {
  prop: string;
  value: string;
}

export interface CssRule {
  /** CSS module the rule comes from (class names are scoped to it). */
  module: string;
  selector: Complex;
  /** Selector as written, for reports. */
  text: string;
  decls: CssDecl[];
  specificity: [number, number, number];
  order: number;
}

type Simple =
  | { t: 'class'; name: string }
  | { t: 'tag'; name: string }
  | { t: 'any' }
  | { t: 'attr'; name: string; value?: string | undefined }
  | { t: 'pseudo'; name: string; args?: Complex[] | undefined }
  | { t: 'element'; name: string };

type Combinator = ' ' | '>' | '+' | '~';

export interface Complex {
  /** Left to right. The first part's combinator only matters in :has() (relative selectors). */
  parts: { combinator: Combinator | null; compound: Simple[] }[];
}

/** An element of a component's rendered tree, as the cascade sees it. */
export interface CssElement {
  tag: string;
  /** Module-scoped class names: "<module>|<class>". */
  classes: Set<string>;
  parent?: CssElement | undefined;
  children: CssElement[];
  /** Optional parts (hidden by default) do not exist for :has(), sibling and child-position selectors. */
  present: boolean;
  isRoot: boolean;
  /** A text field: matches input, :disabled, [data-disabled] in the disabled state, ::placeholder. */
  inputLike: boolean;
  /**
   * A Base UI part (`<BaseCheckbox.Root>`, `<BaseSwitch.Thumb>`): carries the data attributes Base UI sets from the
   * component's state (data-checked, data-unchecked, data-indeterminate, data-disabled).
   */
  baseUi?: boolean | undefined;
  /** Base UI parts: their checked state, the drawn one ("state") or their own (a checked option in a group). */
  checked?: 'state' | 'true' | 'false' | 'mixed' | undefined;
  /** data-* and aria-* attributes the JSX sets for the props drawn (`data-invalid={invalid || undefined}`), as strings. */
  attrs?: Map<string, string> | undefined;
}

export interface CssState {
  hover: boolean;
  active: boolean;
  disabled: boolean;
  /** Checked state Base UI parts and native checkboxes carry: undefined when the component has none. */
  checked?: 'true' | 'false' | 'mixed' | undefined;
}

export const DEFAULT_STATE: CssState = { hover: false, active: false, disabled: false };

// ---------------------------------------------------------------------------------------------
// Parsing

/** Splits on `sep` at depth 0 (outside parentheses, brackets and quotes). */
export function splitTop(text: string, sep: string | RegExp): string[] {
  const out: string[] = [];
  let depth = 0;
  let quote = '';
  let buf = '';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quote) {
      buf += ch;
      if (ch === quote) quote = '';
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '(' || ch === '[') depth++;
    else if (ch === ')' || ch === ']') depth--;
    if (depth === 0 && (typeof sep === 'string' ? ch === sep : sep.test(ch))) {
      out.push(buf);
      buf = '';
      continue;
    }
    buf += ch;
  }
  out.push(buf);
  return out.map((s) => s.trim()).filter(Boolean);
}

/** Parses one complex selector ("a > .b:hover .c"). Throws on syntax it does not know. */
export function parseSelector(text: string): Complex {
  let i = 0;
  const s = text.trim();
  const parts: Complex['parts'] = [];
  let combinator: Combinator | null = null;
  const ident = () => {
    const m = /^-?[A-Za-z_][\w-]*/.exec(s.slice(i));
    if (!m) throw new Error(`Unexpected "${s.slice(i, i + 12)}" in selector "${text}"`);
    i += m[0].length;
    return m[0];
  };
  const parenArgs = () => {
    // s[i] === '('
    let depth = 0;
    const start = i + 1;
    for (; i < s.length; i++) {
      if (s[i] === '(') depth++;
      else if (s[i] === ')' && --depth === 0) break;
    }
    const inner = s.slice(start, i);
    i++; // ')'
    return inner;
  };
  while (i < s.length) {
    const compound: Simple[] = [];
    for (;;) {
      const ch = s[i];
      if (ch === '.') {
        i++;
        compound.push({ t: 'class', name: ident() });
      } else if (ch === '#') {
        i++;
        compound.push({ t: 'attr', name: 'id', value: ident() });
      } else if (ch === '*') {
        i++;
        compound.push({ t: 'any' });
      } else if (ch === '[') {
        const end = s.indexOf(']', i);
        const inner = s.slice(i + 1, end);
        i = end + 1;
        const m = /^\s*([\w-]+)\s*(?:[~|^$*]?=\s*["']?([^"'\]]*)["']?)?\s*$/.exec(inner);
        compound.push({ t: 'attr', name: m?.[1] ?? inner, value: m?.[2] });
      } else if (ch === ':' && s[i + 1] === ':') {
        i += 2;
        compound.push({ t: 'element', name: ident() });
      } else if (ch === ':') {
        i++;
        const name = ident();
        if (s[i] === '(') {
          const inner = parenArgs();
          const args = ['not', 'is', 'where', 'has', 'matches'].includes(name) ? splitTop(inner, ',').map(parseRelative) : undefined;
          compound.push({ t: 'pseudo', name, args });
        } else compound.push({ t: 'pseudo', name });
      } else if (ch && /[A-Za-z]/.test(ch)) {
        compound.push({ t: 'tag', name: ident().toLowerCase() });
      } else break;
    }
    if (!compound.length) throw new Error(`Empty compound in selector "${text}"`);
    parts.push({ combinator, compound });
    // Combinator
    const rest = /^\s*([>+~])?\s*/.exec(s.slice(i))!;
    if (i + rest[0].length >= s.length) break;
    combinator = (rest[1] as Combinator | undefined) ?? ' ';
    if (!rest[0].length) throw new Error(`Unexpected "${s.slice(i, i + 12)}" in selector "${text}"`);
    i += rest[0].length;
  }
  return { parts };
}

/** A selector inside :has() may start with a combinator ("> .icon"). */
function parseRelative(text: string): Complex {
  const m = /^\s*([>+~])\s*/.exec(text);
  const c = parseSelector(m ? text.slice(m[0].length) : text);
  c.parts[0]!.combinator = (m?.[1] as Combinator | undefined) ?? ' ';
  return c;
}

function specificityOf(c: Complex): [number, number, number] {
  const sp: [number, number, number] = [0, 0, 0];
  const add = (x: [number, number, number]) => {
    sp[0] += x[0];
    sp[1] += x[1];
    sp[2] += x[2];
  };
  for (const p of c.parts)
    for (const s of p.compound) {
      if (s.t === 'class') sp[1]++;
      else if (s.t === 'attr') s.name === 'id' ? sp[0]++ : sp[1]++;
      else if (s.t === 'tag' || s.t === 'element') sp[2]++;
      else if (s.t === 'pseudo') {
        if (s.name === 'where') continue;
        if (s.args) {
          const best = s.args.map(specificityOf).sort(cmpSpec).pop();
          if (best) add(best);
        } else sp[1]++;
      }
    }
  return sp;
}

const cmpSpec = (a: [number, number, number], b: [number, number, number]) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];

/** Media queries a component in Figma is drawn under: a mouse (hover: hover), nothing else. */
export function mediaApplies(query: string): boolean {
  const q = query.replace(/\s+/g, ' ').trim().toLowerCase();
  if (q.startsWith('@supports')) return true;
  const cond = q.replace(/^@media /, '');
  return /^\((any-)?hover: ?hover\)$/.test(cond) || cond === 'screen' || cond === 'all';
}

/** Rules of one CSS module, in source order. `@media` blocks are kept only when they apply in Figma. */
export function parseCssModule(module: string, text: string, startOrder = 0): { rules: CssRule[]; errors: string[] } {
  const rules: CssRule[] = [];
  const errors: string[] = [];
  let order = startOrder;
  const clean = text.replace(/\/\*[\s\S]*?\*\//g, '');
  const walk = (src: string) => {
    let i = 0;
    let buf = '';
    while (i < src.length) {
      const ch = src[i]!;
      if (ch !== '{') {
        if (ch === ';' && buf.trim().startsWith('@')) buf = ''; // @import, @charset
        else buf += ch;
        i++;
        continue;
      }
      const head = buf.trim();
      buf = '';
      let depth = 1;
      const start = ++i;
      while (i < src.length && depth > 0) {
        if (src[i] === '{') depth++;
        else if (src[i] === '}') depth--;
        i++;
      }
      const inner = src.slice(start, i - 1);
      if (head.startsWith('@')) {
        if (/^@(media|supports)/.test(head) && mediaApplies(head)) walk(inner);
        continue;
      }
      const decls = splitTop(inner, ';')
        .map((d) => {
          const c = d.indexOf(':');
          return c < 0 ? undefined : { prop: d.slice(0, c).trim().toLowerCase(), value: d.slice(c + 1).trim().replace(/\s*!important$/, '') };
        })
        .filter((d): d is CssDecl => !!d && !!d.prop);
      for (const sel of splitTop(head, ',')) {
        try {
          const selector = parseSelector(sel);
          rules.push({ module, selector, text: sel.replace(/\s+/g, ' '), decls, specificity: specificityOf(selector), order: order++ });
        } catch (err) {
          errors.push(`${module}: ${(err as Error).message}`);
        }
      }
    }
  };
  walk(clean);
  return { rules, errors };
}

// ---------------------------------------------------------------------------------------------
// Matching

const TAG_ALIASES: Record<string, string[]> = {
  input: ['input', 'baseinput'],
  textarea: ['textarea'],
  button: ['button', 'basebutton'],
  svg: ['svg'],
};

function tagMatches(el: CssElement, name: string): boolean {
  const tag = el.tag.toLowerCase();
  return (TAG_ALIASES[name] ?? [name]).includes(tag) || (name === 'input' && el.inputLike);
}

const presentChildren = (el: CssElement) => el.children.filter((c) => c.present);

function siblingsBefore(el: CssElement): CssElement[] {
  if (!el.parent) return [];
  const sibs = presentChildren(el.parent);
  const idx = sibs.indexOf(el);
  return idx < 0 ? [] : sibs.slice(0, idx);
}

/** Base UI's checked attributes for a state: data-checked, data-unchecked or data-indeterminate, and aria-checked. */
function checkedAttr(name: string, checked: CssState['checked']): string | undefined {
  if (checked === undefined) return undefined;
  if (name === 'aria-checked') return checked;
  if (name === 'data-checked' || name === 'data-selected' || name === 'data-active') return checked === 'true' ? '' : undefined;
  if (name === 'data-unchecked') return checked === 'false' ? '' : undefined;
  if (name === 'data-indeterminate') return checked === 'mixed' ? '' : undefined;
  return undefined;
}

function attrMatches(el: CssElement, s: Extract<Simple, { t: 'attr' }>, state: CssState): boolean {
  switch (s.name) {
    case 'data-disabled':
    case 'disabled':
      return state.disabled && (el.isRoot || el.inputLike || !!el.baseUi);
    default: {
      // Base UI parts carry the checked state; any element carries the data-* and aria-* attributes its JSX sets.
      const own = el.checked === 'state' || (el.inputLike && el.checked === undefined) ? state.checked : el.checked;
      const fromState = el.baseUi || el.inputLike ? checkedAttr(s.name, own) : undefined;
      const v = fromState ?? el.attrs?.get(s.name);
      // data-loading, data-pressed, data-popup-open...: not set by the drawn props, so not part of the drawn states.
      if (v === undefined) return false;
      return s.value === undefined || s.value === v;
    }
  }
}

function pseudoMatches(el: CssElement, s: Extract<Simple, { t: 'pseudo' }>, state: CssState, module: string): boolean {
  switch (s.name) {
    case 'hover':
      return state.hover;
    case 'active':
      return state.active;
    case 'disabled':
      return state.disabled && (el.isRoot || el.inputLike);
    case 'enabled':
      return !state.disabled;
    case 'placeholder-shown':
      return el.inputLike;
    case 'checked':
      return (el.inputLike || !!el.baseUi) && (el.checked === 'state' || el.checked === undefined ? state.checked : el.checked) === 'true';
    case 'indeterminate':
      return (el.inputLike || !!el.baseUi) && (el.checked === 'state' || el.checked === undefined ? state.checked : el.checked) === 'mixed';
    case 'not':
      return !(s.args ?? []).some((a) => matchComplex(a, el, state, module));
    case 'is':
    case 'where':
    case 'matches':
      return (s.args ?? []).some((a) => matchComplex(a, el, state, module));
    case 'has':
      return (s.args ?? []).some((a) => hasMatch(a, el, state, module));
    case 'first-child':
      return !!el.parent && presentChildren(el.parent)[0] === el;
    case 'last-child': {
      const sibs = el.parent ? presentChildren(el.parent) : [];
      return sibs[sibs.length - 1] === el;
    }
    case 'only-child':
      return !!el.parent && presentChildren(el.parent).length === 1;
    default:
      // focus, focus-visible, focus-within, checked, invalid...: not drawn.
      return false;
  }
}

function compoundMatches(compound: Simple[], el: CssElement, state: CssState, module: string, pseudoElement?: string): boolean {
  let sawElement = false;
  for (const s of compound) {
    switch (s.t) {
      case 'class':
        if (!el.classes.has(`${module}|${s.name}`)) return false;
        break;
      case 'tag':
        if (!tagMatches(el, s.name)) return false;
        break;
      case 'any':
        break;
      case 'attr':
        if (!attrMatches(el, s, state)) return false;
        break;
      case 'pseudo':
        if (!pseudoMatches(el, s, state, module)) return false;
        break;
      case 'element':
        sawElement = true;
        if (s.name !== pseudoElement) return false;
        break;
    }
  }
  return pseudoElement ? sawElement : !sawElement;
}

function matchAt(c: Complex, i: number, el: CssElement, state: CssState, module: string, anchor?: CssElement, pseudoElement?: string): boolean {
  const part = c.parts[i]!;
  if (!compoundMatches(part.compound, el, state, module, i === c.parts.length - 1 ? pseudoElement : undefined)) return false;
  if (i === 0) {
    if (!anchor) return true;
    switch (part.combinator ?? ' ') {
      case '>':
        return el.parent === anchor;
      case ' ': {
        for (let p = el.parent; p; p = p.parent) if (p === anchor) return true;
        return false;
      }
      case '+':
        return siblingsBefore(el).slice(-1)[0] === anchor;
      case '~':
        return siblingsBefore(el).includes(anchor);
    }
  }
  switch (part.combinator) {
    case '>':
      return !!el.parent && matchAt(c, i - 1, el.parent, state, module, anchor);
    case ' ': {
      for (let p = el.parent; p; p = p.parent) if (matchAt(c, i - 1, p, state, module, anchor)) return true;
      return false;
    }
    case '+': {
      const prev = siblingsBefore(el).slice(-1)[0];
      return !!prev && matchAt(c, i - 1, prev, state, module, anchor);
    }
    case '~':
      return siblingsBefore(el).some((p) => matchAt(c, i - 1, p, state, module, anchor));
    default:
      return false;
  }
}

export function matchComplex(c: Complex, el: CssElement, state: CssState, module: string, pseudoElement?: string): boolean {
  return matchAt(c, c.parts.length - 1, el, state, module, undefined, pseudoElement);
}

function descendants(el: CssElement): CssElement[] {
  const out: CssElement[] = [];
  const walk = (e: CssElement) => {
    for (const c of presentChildren(e)) {
      out.push(c);
      walk(c);
    }
  };
  walk(el);
  return out;
}

function hasMatch(c: Complex, anchor: CssElement, state: CssState, module: string): boolean {
  const first = c.parts[0]!.combinator;
  const pool = first === '+' || first === '~' ? (anchor.parent ? presentChildren(anchor.parent) : []) : descendants(anchor);
  return pool.some((el) => matchAt(c, c.parts.length - 1, el, state, module, anchor));
}

// ---------------------------------------------------------------------------------------------
// Cascade

const SIDES = ['top', 'right', 'bottom', 'left'] as const;
const BORDER_STYLES = new Set(['none', 'hidden', 'solid', 'dashed', 'dotted', 'double', 'groove', 'ridge', 'inset', 'outset']);

function boxValues(parts: string[]): [string, string, string, string] | undefined {
  const [a, b = a, c = a, d = b] = parts;
  return a === undefined ? undefined : [a, b!, c!, d!];
}

/** Expands the shorthands component CSS uses into longhands, so later longhands override them as in a browser. */
export function expandDecl(d: CssDecl): CssDecl[] {
  const parts = splitTop(d.value, /\s/);
  const sides = (prefix: string, suffix: string, vals: string[] | undefined) =>
    vals ? SIDES.map((s, i) => ({ prop: `${prefix}${s}${suffix}`, value: vals[i]! })) : [d];
  switch (d.prop) {
    case 'padding':
      return sides('padding-', '', boxValues(parts));
    case 'padding-inline': {
      const [s, e = s] = parts;
      return [
        { prop: 'padding-left', value: s! },
        { prop: 'padding-right', value: e! },
      ];
    }
    case 'padding-block': {
      const [s, e = s] = parts;
      return [
        { prop: 'padding-top', value: s! },
        { prop: 'padding-bottom', value: e! },
      ];
    }
    case 'padding-inline-start':
      return [{ prop: 'padding-left', value: d.value }];
    case 'padding-inline-end':
      return [{ prop: 'padding-right', value: d.value }];
    case 'padding-block-start':
      return [{ prop: 'padding-top', value: d.value }];
    case 'padding-block-end':
      return [{ prop: 'padding-bottom', value: d.value }];
    case 'border-width':
      return sides('border-', '-width', boxValues(parts));
    case 'border-color':
      return sides('border-', '-color', boxValues(parts));
    case 'border':
    case 'border-top':
    case 'border-right':
    case 'border-bottom':
    case 'border-left': {
      const { width, color } = splitBorder(parts);
      const which = d.prop === 'border' ? SIDES : [d.prop.slice(7) as (typeof SIDES)[number]];
      return which.flatMap((s) => [
        { prop: `border-${s}-width`, value: width },
        { prop: `border-${s}-color`, value: color },
      ]);
    }
    case 'border-inline-start':
    case 'border-inline-end':
    case 'border-block-start':
    case 'border-block-end': {
      // Logical sides, left to right and top to bottom (the components are drawn in a left-to-right file).
      const side = { 'border-inline-start': 'left', 'border-inline-end': 'right', 'border-block-start': 'top', 'border-block-end': 'bottom' }[d.prop]!;
      return expandDecl({ ...d, prop: `border-${side}` });
    }
    case 'inset-block-start':
      return [{ prop: 'top', value: d.value }];
    case 'inset-block-end':
      return [{ prop: 'bottom', value: d.value }];
    case 'inset-inline-start':
      return [{ prop: 'left', value: d.value }];
    case 'inset-inline-end':
      return [{ prop: 'right', value: d.value }];
    case 'inset': {
      const v = boxValues(parts);
      return v ? SIDES.map((side, i) => ({ prop: side, value: v[i]! })) : [d];
    }
    case 'inset-block': {
      const [a, b = a] = parts;
      return [
        { prop: 'top', value: a! },
        { prop: 'bottom', value: b! },
      ];
    }
    case 'inset-inline': {
      const [a, b = a] = parts;
      return [
        { prop: 'left', value: a! },
        { prop: 'right', value: b! },
      ];
    }
    case 'place-items': {
      const [align, justify = align] = parts;
      return [
        { prop: 'align-items', value: align! },
        { prop: 'justify-items', value: justify! },
      ];
    }
    case 'text-decoration': {
      const line = parts.filter((x) => /^(none|underline|overline|line-through)$/.test(x));
      return line.length ? [{ prop: 'text-decoration-line', value: line.join(' ') }] : [d];
    }
    case 'gap': {
      const [row, col = row] = parts;
      return [
        { prop: 'row-gap', value: row! },
        { prop: 'column-gap', value: col! },
      ];
    }
    case 'flex-flow': {
      const out: CssDecl[] = [];
      for (const x of parts) {
        if (/^(row|column)(-reverse)?$/.test(x)) out.push({ prop: 'flex-direction', value: x });
        else if (/wrap/.test(x)) out.push({ prop: 'flex-wrap', value: x });
      }
      return out.length ? out : [d];
    }
    case 'font':
      return d.value === 'inherit' ? ['font-family', 'font-size', 'font-weight', 'line-height'].map((prop) => ({ prop, value: 'inherit' })) : [d];
    default:
      return [d];
  }
}

function splitBorder(parts: string[]): { width: string; color: string } {
  const styleAt = parts.findIndex((p) => BORDER_STYLES.has(p));
  if (styleAt >= 0) {
    const width = parts.slice(0, styleAt).join(' ') || parts.slice(styleAt + 1).find((p) => /width|^\d/.test(p)) || 'medium';
    const color = parts.slice(styleAt + 1).filter((p) => p !== width).join(' ') || 'currentcolor';
    return { width, color };
  }
  if (parts.length === 1 && (parts[0] === '0' || parts[0] === 'none')) return { width: '0', color: 'currentcolor' };
  const width = parts.find((p) => /width|^\d/.test(p)) ?? 'medium';
  return { width, color: parts.filter((p) => p !== width).join(' ') || 'currentcolor' };
}

/** Properties a child inherits from its parent (custom properties always inherit). */
// text-decoration is not inherited in CSS, but it is drawn through the text of the element's inline children: for
// the drawn text it behaves as inherited.
export const INHERITED = new Set(['color', 'font-family', 'font-size', 'font-weight', 'line-height', 'letter-spacing', 'cursor', 'white-space', 'visibility', 'text-decoration-line', 'text-decoration-color']);

export interface Declared {
  prop: string;
  value: string;
  rule: CssRule;
}

/** Winning declarations for an element (own rules only), keyed by longhand property. */
export function declaredFor(rules: CssRule[], el: CssElement, state: CssState, pseudoElement?: string): Map<string, Declared> {
  const matched = rules.filter((r) => matchComplex(r.selector, el, state, r.module, pseudoElement));
  matched.sort((a, b) => cmpSpec(a.specificity, b.specificity) || a.order - b.order);
  const out = new Map<string, Declared>();
  for (const r of matched) for (const d of r.decls) for (const x of expandDecl(d)) out.set(x.prop, { prop: x.prop, value: x.value, rule: r });
  return out;
}

/** Computed values: inherited ones from the parent, then the element's own declarations ("inherit" takes the parent's). */
export function computeValues(own: Map<string, Declared>, parent: Map<string, string> | undefined): Map<string, string> {
  const out = new Map<string, string>();
  if (parent) for (const [k, v] of parent) if (k.startsWith('--') || INHERITED.has(k)) out.set(k, v);
  for (const [k, d] of own) {
    // `color: currentcolor` is the parent's color (CSS Color 4), like inherit.
    if (d.value === 'inherit' || (k === 'color' && d.value.trim().toLowerCase() === 'currentcolor')) {
      const pv = parent?.get(k);
      if (pv !== undefined) out.set(k, pv);
      else out.delete(k);
    } else if (k.startsWith('--') && d.value === 'initial') {
      // A custom property reset on purpose (`--_col-width: initial`): a var() of it leaves the property unset.
      out.set(k, 'initial');
    } else if (d.value === 'initial' || d.value === 'unset') out.delete(k);
    else out.set(k, d.value);
  }
  return out;
}
