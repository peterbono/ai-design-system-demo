// CSS, SCSS, Less and CSS-in-JS template text: declarations with their offsets, plus Tailwind @apply.
import { scanCssValue, type ValueScan } from './scan-value';
import { scanClassString, type TailwindHit } from './tailwind';

export interface CssDecl {
  property: string;
  value: string;
  /** Offset of the value in the text. */
  valueStart: number;
  scan: ValueScan;
}

export interface CssScan {
  decls: CssDecl[];
  applies: { start: number; hits: TailwindHit[] }[];
}

/** Comments become spaces (offsets and line numbers stay put). `//` comments only for SCSS and Less. */
export function blankComments(text: string, lineComments: boolean): string {
  let out = text.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ' '));
  if (lineComments) out = out.replace(/(^|[^:"'\\])\/\/[^\n]*/g, (c, pre: string) => pre + ' '.repeat(c.length - pre.length));
  return out;
}

const DECL_RE = /(?<=^|[;{}])(\s*)([$@]?-{0,2}[A-Za-z_][\w-]*)\s*:\s*([^;{}]*?)\s*(?=;|}|$(?![\s\S]))/g;

export function scanCssText(text: string, lang: 'css' | 'scss' | 'less' = 'css'): CssScan {
  const clean = blankComments(text, lang !== 'css');
  const decls: CssDecl[] = [];
  for (const m of clean.matchAll(DECL_RE)) {
    const property = m[2]!;
    if (property.startsWith('@')) continue;
    const value = m[3]!;
    if (!value.trim()) continue;
    // Skip a selector with a pseudo-class that ends the text (no brace after it).
    const valueStart = m.index! + m[0].length - value.length;
    decls.push({ property, value, valueStart, scan: scanCssValue(property, value) });
  }
  const applies = [...clean.matchAll(/@apply\s+([^;{}]+)/g)].map((m) => ({ start: m.index! + m[0].length - m[1]!.length, hits: scanClassString(m[1]!) }));
  return { decls, applies };
}

/** 1-based line and column of an offset. */
export function lineCol(text: string): (offset: number) => { line: number; column: number } {
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) starts.push(i + 1);
  return (offset) => {
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid]! <= offset) lo = mid;
      else hi = mid - 1;
    }
    return { line: lo + 1, column: offset - starts[lo]! + 1 };
  };
}
