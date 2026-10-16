// Finds hardcoded values in a CSS/TSX snippet and suggests the tokens that should replace them.
import { core, type TokenSet } from './core-adapter.js';

export interface Finding {
  line: number;
  text: string;
  kind: 'color' | 'length' | 'duration' | 'z-index' | 'shadow' | 'easing' | 'font-weight';
  property?: string;
  suggestions: { cssVar: string; path: string; value: string; tier?: string; exact: boolean }[];
}

// CSS property -> token paths that fit its intent (a background wants a bg/surface token, not a text one).
const PROPERTY_HINTS: [RegExp, RegExp][] = [
  [/^(color|fill|stroke)$/, /(^|\.)(text|fg|icon|foreground|link)(\.|-|$)/],
  [/background/, /(^|\.)(bg|surface|background|fill)(\.|-|$)/],
  [/border|outline/, /(^|\.)(border|outline|ring|divider)(\.|-|$)/],
  [/radius/, /radius/],
  [/^(padding|margin|gap|inset|top|left|right|bottom)/, /(^|\.)(space|layout|inset|gap|padding)/],
  [/^(width|height|min-|max-)/, /(^|\.)(size|height|width)/],
  [/font-size/, /font\.size/],
  [/line-height/, /line-height/],
];

const dist = (a: { r: number; g: number; b: number }, b: { r: number; g: number; b: number }) => Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b);

export function auditSnippet(set: TokenSet, code: string, max = 3): Finding[] {
  const combo = set.defaultCombo;
  const resolved = set.allPaths().map((p) => {
    const r = set.resolve(p, combo);
    return { path: p, type: r.type, css: r.css, value: r.value, tier: set.tierOf(p) };
  });
  // Semantic first (component tokens belong to their component), primitives and palette roles last.
  const rank = (tier?: string) => (tier === 'semantic' ? 0 : tier === 'component' ? 1 : tier === 'density' ? 2 : tier === 'brand' ? 3 : 4);
  const findings: Finding[] = [];
  const lines = code.split('\n');
  lines.forEach((line, i) => {
    if (/var\(--/.test(line) && !/#[0-9a-f]{3,8}\b|\d(px|rem|ms)\b/i.test(line.replace(/var\([^)]*\)/g, ''))) return;
    const stripped = line.replace(/var\([^)]*\)/g, '');
    // The CSS (or camelCase JS) property a literal belongs to: the last `name:` before it on the line.
    const propAt = (idx: number) => /([a-zA-Z-]+)['"]?\s*:[^;:,{]*$/.exec(stripped.slice(0, idx))?.[1]?.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`).toLowerCase();
    let prop: string | undefined;
    const hinted = (p: string) => {
      const re = PROPERTY_HINTS.find(([r]) => prop && r.test(prop))?.[1];
      return !re || re.test(p) ? 0 : 1;
    };
    const push = (kind: Finding['kind'], text: string, cands: typeof resolved, exactFn: (c: (typeof resolved)[number]) => boolean, score?: (c: (typeof resolved)[number]) => number) => {
      const sorted = [...cands].sort((a, b) => Number(!exactFn(a)) - Number(!exactFn(b)) || hinted(a.path) - hinted(b.path) || (score ? score(a) - score(b) : 0) || rank(a.tier) - rank(b.tier));
      findings.push({
        line: i + 1,
        text,
        kind,
        ...(prop ? { property: prop } : {}),
        suggestions: sorted.slice(0, max).map((c) => ({ cssVar: `var(${set.cssVarName(c.path)})`, path: c.path, value: c.css, ...(c.tier ? { tier: c.tier } : {}), exact: exactFn(c) })),
      });
    };
    for (const m of stripped.matchAll(/#[0-9a-f]{3,8}\b|rgba?\([^)]*\)/gi)) {
      let target = core.toRgba(m[0]);
      if (!target) {
        const n = /rgba?\(\s*(\d+)[ ,]+(\d+)[ ,]+(\d+)/i.exec(m[0]);
        if (n) target = { r: +n[1]! / 255, g: +n[2]! / 255, b: +n[3]! / 255, a: 1 };
      }
      if (!target) continue;
      prop = propAt(m.index!);
      const all = resolved.filter((c) => c.type === 'color').map((c) => ({ ...c, rgb: core.toRgba(c.value) })).filter((c) => c.rgb);
      // Components use semantic or component tokens for color: suggest those, nearest first, matching the property.
      const usable = all.filter((c) => rank(c.tier) <= 1);
      const colors = usable.length ? usable : all;
      const t = target;
      const d = (c: (typeof colors)[number]) => dist(c.rgb!, t);
      push('color', m[0], colors, (c) => d(c as (typeof colors)[number]) < 0.004, (c) => d(c as (typeof colors)[number]));
    }
    if (/z-?index/i.test(line)) {
      prop = 'z-index';
      const n = /z-?index['"]?\s*:\s*(\d+)/i.exec(stripped);
      if (n) push('z-index', n[1]!, resolved.filter((c) => /^(z|layer)/.test(c.path)), (c) => c.css === n[1]);
    }
    if (/box-shadow|boxShadow/.test(line) && !/var\(--/.test(line)) (prop = 'box-shadow'), push('shadow', line.trim(), resolved.filter((c) => c.type === 'shadow'), () => false);
    for (const m of stripped.matchAll(/cubic-bezier\([^)]*\)/g)) (prop = propAt(m.index!)), push('easing', m[0], resolved.filter((c) => c.type === 'cubicBezier'), (c) => c.css.replace(/\s/g, '') === m[0].replace(/\s/g, ''));
    if (/box-shadow|boxShadow/.test(line)) return;
    for (const m of stripped.matchAll(/(?<![\w.#-])(\d*\.?\d+)(px|rem)\b/g)) {
      if (m[1] === '0') continue;
      prop = propAt(m.index!);
      const css = `${Number(m[1])}${m[2]}`;
      const px = m[2] === 'rem' ? Number(m[1]) * 16 : Number(m[1]);
      const dims = resolved.filter((c) => c.type === 'dimension');
      const toPx = (s: string) => (s.endsWith('rem') ? parseFloat(s) * 16 : parseFloat(s));
      const exact = dims.filter((c) => c.css === css || toPx(c.css) === px);
      push('length', m[0], exact.length ? exact : dims, (c) => c.css === css || toPx(c.css) === px, exact.length ? undefined : (c) => Math.abs(toPx(c.css) - px));
    }
    for (const m of stripped.matchAll(/(?<![\w.-])(\d*\.?\d+)(ms|s)\b/g)) {
      prop = propAt(m.index!);
      const ms = m[2] === 's' ? Number(m[1]) * 1000 : Number(m[1]);
      const durs = resolved.filter((c) => c.type === 'duration');
      const toMs = (s: string) => (s.endsWith('ms') ? parseFloat(s) : parseFloat(s) * 1000);
      push('duration', m[0], durs, (c) => toMs(c.css) === ms, (c) => Math.abs(toMs(c.css) - ms));
    }
    const fw = /font-?weight['"]?\s*:\s*['"]?(\d{3})/i.exec(stripped);
    if (fw) (prop = 'font-weight'), push('font-weight', fw[1]!, resolved.filter((c) => c.type === 'fontWeight' || /weight/.test(c.path)), (c) => c.css === fw[1]);
  });
  return findings;
}
