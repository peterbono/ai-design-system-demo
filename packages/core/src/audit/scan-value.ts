// Classifies one style declaration (CSS property + value, or a JS style object entry) into hardcoded values,
// design-system token references and references to another theme. Shared by the audit scanners and the
// stylelint and ESLint plugins.
import { COLOR_LITERAL_RE, NAMED_COLORS, parseCssColor } from './color';
import type { FindingCategory } from './types';

export interface ValueHit {
  category: FindingCategory;
  /** The literal as written. */
  text: string;
  /** Offset of the literal in the value. */
  index: number;
}

export interface ValueScan {
  hits: ValueHit[];
  /** CSS variables referenced with var(--x), DS or not. */
  vars: string[];
  /** The value points at another theme (MUI palette path, sx spacing unit...). */
  themeRef: boolean;
}

const COLOR_PROP = /^(color|background(-color|-image)?|border(-(top|right|bottom|left|block|inline)(-(start|end))?)?(-color)?|outline(-color)?|fill|stroke|text-decoration(-color)?|caret-color|accent-color|column-rule(-color)?|stop-color|flood-color|lighting-color|-webkit-text-fill-color|scrollbar-color|box-shadow|text-shadow)$/;
const SPACING_PROP = /^(padding|margin|gap|row-gap|column-gap|grid-gap|grid-row-gap|grid-column-gap|inset|top|right|bottom|left|scroll-margin|scroll-padding)(-(top|right|bottom|left|block|inline|x|y)(-(start|end))?)?$/;
const SIZE_PROP = /^(min-|max-)?(width|height|block-size|inline-size)$|^flex-basis$/;
const RADIUS_PROP = /radius$/;
const BORDER_WIDTH_PROP = /^(border|outline)(-(top|right|bottom|left|block|inline)(-(start|end))?)?(-width)?$|^outline-offset$|^column-rule(-width)?$/;
const MOTION_PROP = /^(transition|animation)(-duration|-delay)?$/;
const EASING_PROP = /^(transition|animation)(-timing-function)?$/;
const SKIP_PROP = /^(content|grid-template(-areas)?|grid-area|src|mask(-image)?|transform|translate|will-change|cursor|quotes|font-feature-settings|font-variation-settings|counter-(reset|increment)|clip-path|d|unicode-range)$/;

/** Keys that are not CSS properties but hold theme values (MUI palette, SCSS and custom properties). */
const looseKey = (p: string) => p.startsWith('$') || p.startsWith('--') || !/^-?[a-z]+(-[a-z]+)*$/.test(p) || !KNOWN_PROPS.has(p);
const KNOWN_PROPS = new Set(
  'color background background-color background-image border border-top border-right border-bottom border-left border-color border-width border-style border-radius border-top-left-radius border-top-right-radius border-bottom-left-radius border-bottom-right-radius border-top-color border-bottom-color border-left-color border-right-color border-top-width border-bottom-width border-left-width border-right-width border-block border-inline border-block-start border-block-end border-inline-start border-inline-end outline outline-color outline-width outline-offset fill stroke text-decoration text-decoration-color caret-color accent-color box-shadow text-shadow padding padding-top padding-right padding-bottom padding-left padding-block padding-inline padding-x padding-y padding-inline-start padding-inline-end padding-block-start padding-block-end margin margin-top margin-right margin-bottom margin-left margin-block margin-inline margin-x margin-y margin-inline-start margin-inline-end margin-block-start margin-block-end gap row-gap column-gap grid-gap inset top right bottom left width height min-width min-height max-width max-height flex-basis font font-family font-size font-weight line-height letter-spacing transition transition-duration transition-delay transition-timing-function animation animation-duration animation-delay animation-timing-function z-index opacity display position flex flex-direction flex-wrap flex-grow flex-shrink align-items justify-content overflow text-align white-space cursor content transform'.split(' '),
);

/** Replaces var(...) (with fallbacks, nested) and url(...) by spaces so offsets stay valid. */
function mask(value: string): string {
  let out = value;
  for (const fn of ['var(', 'url(', 'env(']) {
    let i = out.indexOf(fn);
    while (i >= 0) {
      let depth = 0;
      let j = i + fn.length - 1;
      for (; j < out.length; j++) {
        if (out[j] === '(') depth++;
        else if (out[j] === ')' && --depth === 0) break;
      }
      out = out.slice(0, i) + ' '.repeat(j + 1 - i) + out.slice(j + 1);
      i = out.indexOf(fn, i);
    }
  }
  // Quoted strings (except for font-family, handled before) are not values to tokenize.
  return out.replace(/(["'])(?:(?!\1).)*\1/g, (s) => ' '.repeat(s.length));
}

const LENGTH_RE = /(?<![\w.#-])(-?\d*\.?\d+)(px|rem|em)\b/g;

function lengthCategory(prop: string): FindingCategory | undefined {
  if (RADIUS_PROP.test(prop)) return 'radius';
  if (SPACING_PROP.test(prop)) return 'spacing';
  if (SIZE_PROP.test(prop)) return 'size';
  if (BORDER_WIDTH_PROP.test(prop)) return 'border-width';
  if (prop === 'font-size') return 'font-size';
  if (prop === 'line-height') return 'line-height';
  if (looseKey(prop)) {
    const k = prop.toLowerCase();
    if (/radius|rounded/.test(k)) return 'radius';
    if (/space|spacing|gap|padding|margin|gutter|inset/.test(k)) return 'spacing';
    if (/font-?size|fontsize/.test(k)) return 'font-size';
    if (/width|height|size/.test(k)) return 'size';
  }
  return undefined;
}

/**
 * Scan one CSS declaration. `property` is kebab-case (`background-color`, `$brand`, `--x`, or a theme key
 * such as `main`); `value` is the raw value text.
 */
export function scanCssValue(property: string, value: string): ValueScan {
  const prop = property.trim().toLowerCase();
  const vars = [...value.matchAll(/var\(\s*(--[\w-]+)/g)].map((m) => m[1]!);
  const hits: ValueHit[] = [];
  const out: ValueScan = { hits, vars, themeRef: false };
  if (SKIP_PROP.test(prop)) return out;
  const v = value.trim();
  if (!v || /^(inherit|initial|unset|revert|none|auto|0|normal|currentcolor|transparent)$/i.test(v)) return out;
  if (/^\$[\w-]+$/.test(v) || /^theme\(/.test(v)) {
    out.themeRef = true;
    return out;
  }
  const masked = mask(value);

  if (prop === 'font-family') {
    if (masked.trim() && !/^(inherit|initial|unset)$/i.test(v)) hits.push({ category: 'font-family', text: v, index: value.indexOf(v) });
    return out;
  }
  if (prop === 'box-shadow' || prop === 'text-shadow') {
    // A ring built from tokens (`inset 0 0 0 var(--border-width-default) var(--color-border-default)`) is not
    // hardcoded: bare zero offsets carry no value. Any other number or a color literal is.
    const numbers = masked.replace(/(?<![\w.])0(?![\w.%])/g, ' ');
    if (/\d/.test(numbers) || masked.search(COLOR_LITERAL_RE) >= 0) hits.push({ category: 'shadow', text: v, index: value.indexOf(v) });
    return out;
  }

  // Colors: hex and functions anywhere; named colors only where a color is expected.
  for (const m of masked.matchAll(COLOR_LITERAL_RE)) if (parseCssColor(m[0])) hits.push({ category: 'color', text: m[0], index: m.index! });
  if (COLOR_PROP.test(prop) || prop.startsWith('--') || prop.startsWith('$')) {
    for (const m of masked.matchAll(/(?<![\w#.-])([a-z]+)(?![\w(-])/gi)) {
      const n = m[1]!.toLowerCase();
      if (NAMED_COLORS[n] && !/^(transparent|currentcolor)$/.test(n)) hits.push({ category: 'color', text: m[1]!, index: m.index! });
    }
    // Bare HSL channels, the shadcn/ui theme form: --primary: 222.2 47.4% 11.2%;
    if (prop.startsWith('--') && /^-?[\d.]+(deg)?\s+[\d.]+%\s+[\d.]+%/.test(v) && parseCssColor(v)) hits.push({ category: 'color', text: v, index: value.indexOf(v) });
  }

  if (prop === 'z-index') {
    const n = /^-?\d+$/.test(v) ? Number(v) : NaN;
    if (Number.isFinite(n) && Math.abs(n) > 1) hits.push({ category: 'z-index', text: v, index: value.indexOf(v) });
    return out;
  }
  if (prop === 'font-weight') {
    if (/^(\d{3}|bold|bolder|lighter)$/i.test(v)) hits.push({ category: 'font-weight', text: v, index: value.indexOf(v) });
    return out;
  }
  if (prop === 'line-height' && /^\d*\.?\d+$/.test(v) && Number(v) !== 0) {
    hits.push({ category: 'line-height', text: v, index: value.indexOf(v) });
    return out;
  }
  if (MOTION_PROP.test(prop)) {
    for (const m of masked.matchAll(/(?<![\w.-])(\d*\.?\d+)(ms|s)\b/g)) if (Number(m[1]) !== 0) hits.push({ category: 'duration', text: m[0], index: m.index! });
  }
  if (EASING_PROP.test(prop)) {
    for (const m of masked.matchAll(/cubic-bezier\([^)]*\)|(?<![\w-])(ease-in-out|ease-in|ease-out|ease|linear)(?![\w-])/g)) hits.push({ category: 'easing', text: m[0], index: m.index! });
  }
  const cat = lengthCategory(prop);
  if (cat) for (const m of masked.matchAll(LENGTH_RE)) if (Number(m[1]) !== 0) hits.push({ category: cat, text: m[0].replace(/^-/, ''), index: m.index! + (m[0].startsWith('-') ? 1 : 0) });
  hits.sort((a, b) => a.index - b.index);
  return out;
}

// --- JS style objects ---------------------------------------------------------------------------------------

const MUI_SHORTHAND: Record<string, string> = {
  m: 'margin', mt: 'margin-top', mr: 'margin-right', mb: 'margin-bottom', ml: 'margin-left', mx: 'margin-inline', my: 'margin-block',
  p: 'padding', pt: 'padding-top', pr: 'padding-right', pb: 'padding-bottom', pl: 'padding-left', px: 'padding-inline', py: 'padding-block',
  marginX: 'margin-inline', marginY: 'margin-block', paddingX: 'padding-inline', paddingY: 'padding-block', bgcolor: 'background-color',
};
const UNITLESS = /^(opacity|flex|flex-grow|flex-shrink|order|zoom|column-count|fill-opacity|stroke-opacity|aspect-ratio|grid-row|grid-column|animation-iteration-count|tab-size|orphans|widows|scale)$/;
const MUI_SPACING_KEY = /^(margin|padding)(-.*)?$|^(gap|row-gap|column-gap)$/;
const MUI_PALETTE_PATH = /^(primary|secondary|error|warning|info|success|text|background|grey|action|common|divider)(\.[\w]+)*$/;

/** camelCase or MUI shorthand key -> kebab-case CSS property. */
export function cssPropertyOf(key: string): string {
  if (MUI_SHORTHAND[key]) return MUI_SHORTHAND[key]!;
  if (key.startsWith('--') || key.startsWith('$')) return key;
  return key.replace(/^(Webkit|Moz|ms)(?=[A-Z])/, (p) => `-${p.toLowerCase()}`).replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
}

export type JsStyleContext = 'style' | 'sx' | 'styled' | 'theme';

/**
 * Scan one entry of a JS style object (`style`, MUI `sx`, styled/makeStyles objects, theme objects).
 * Numbers follow React and MUI: px for lengths, theme spacing units for sx margins and paddings.
 */
export function scanJsStyle(key: string, value: string | number, ctx: JsStyleContext): ValueScan {
  const prop = cssPropertyOf(key);
  if (typeof value === 'number') {
    const none: ValueScan = { hits: [], vars: [], themeRef: false };
    if (ctx === 'sx' && (MUI_SPACING_KEY.test(prop) || RADIUS_PROP.test(prop) || MUI_SHORTHAND[key])) return { ...none, themeRef: true };
    if (prop === 'z-index' || prop === 'font-weight' || prop === 'line-height') return scanCssValue(prop, String(value));
    if (UNITLESS.test(prop) || value === 0 || looseKey(prop)) return none;
    if (ctx === 'sx' && SIZE_PROP.test(prop) && Math.abs(value) <= 1) return none; // MUI: fraction = percentage
    const scan = scanCssValue(prop, `${value}px`);
    // Report the number as written.
    scan.hits.forEach((h) => (h.text = String(value)));
    return scan;
  }
  const v = value.trim();
  if ((ctx === 'sx' || ctx === 'theme') && (MUI_PALETTE_PATH.test(v) || (prop === 'typography' && /^[a-z]+\d?$/.test(v))) && !NAMED_COLORS[v.toLowerCase()]) {
    return { hits: [], vars: [], themeRef: true };
  }
  return scanCssValue(prop, value);
}

/** A whole string literal that is a color (`'#1976d2'`, `'rgba(0,0,0,.5)'`): counted wherever it appears in code. */
export function isColorLiteral(text: string): boolean {
  const t = text.trim();
  return /^(#[0-9a-f]{3,8}|(rgba?|hsla?)\([^()]*\))$/i.test(t) && Boolean(parseCssColor(t));
}
