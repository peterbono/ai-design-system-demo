// Astro, Vue and Svelte files: the frontmatter and <script> blocks go through the TS scanner, <style> blocks
// through the style sheet audit, and the template markup is read here: DS components used as tags, native
// elements a DS component should render, re-created DS components, style and class attributes, color attributes.
import { classifyTag, importsOf, LOOKALIKE_ATTRS, lookalikesInClassList, scanCode, tailwindFindings, type CodeScan, type ImportMap } from './code';
import { lineCol } from './css';
import type { DesignSystemIndex } from './ds-index';
import { isColorLiteral } from './scan-value';
import { auditCssText } from './style';
import { scanClassString } from './tailwind';
import type { ComponentFinding } from './types';

export type MarkupLang = 'astro' | 'vue' | 'svelte';
export const MARKUP_EXTENSIONS = ['.astro', '.vue', '.svelte'];

interface Range {
  start: number;
  end: number;
}
interface Block extends Range {
  attrs: string;
}

/** Same length as `text`, with every character outside (or inside) the ranges blanked; newlines stay. */
function mask(text: string, ranges: Range[], keepInside: boolean): string {
  const inside = new Uint8Array(text.length);
  for (const r of ranges) inside.fill(1, r.start, r.end);
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    out += c === '\n' || Boolean(inside[i]) === keepInside ? c : ' ';
  }
  return out;
}

const attrOf = (attrs: string, name: string) => new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(attrs)?.slice(1).find((v) => v !== undefined);

/** Script blocks that hold code (not JSON data or templates). */
const isCodeScript = (attrs: string) => {
  const type = attrOf(attrs, 'type')?.toLowerCase();
  return !type || ['module', 'text/javascript', 'application/javascript', 'text/typescript', 'ts', 'text/babel'].includes(type);
};

/** Frontmatter (Astro), script and style blocks, and the template ranges between them. */
export function markupBlocks(text: string, lang: MarkupLang): { frontmatter?: Range; scripts: Block[]; styles: Block[]; nonTemplate: Range[] } {
  const nonTemplate: Range[] = [];
  let frontmatter: Range | undefined;
  let from = 0;
  if (lang === 'astro') {
    const open = /^\s*---[^\S\n]*\n/.exec(text);
    if (open) {
      const close = /\n---[^\S\n]*(\n|$)/g;
      close.lastIndex = open[0].length - 1;
      const m = close.exec(text);
      if (m) {
        frontmatter = { start: open[0].length, end: m.index + 1 };
        from = m.index + m[0].length;
        nonTemplate.push({ start: 0, end: from });
      }
    }
  }
  const scripts: Block[] = [];
  const styles: Block[] = [];
  const re = /<(script|style)\b((?:[^>"']|"[^"]*"|'[^']*')*)>([\s\S]*?)<\/\1\s*>/gi;
  re.lastIndex = from;
  for (let m; (m = re.exec(text)); ) {
    const contentStart = m.index + m[0].indexOf('>', m[1]!.length + 1 + m[2]!.length) + 1;
    const block = { start: contentStart, end: contentStart + m[3]!.length, attrs: m[2]! };
    (m[1]!.toLowerCase() === 'script' ? scripts : styles).push(block);
    nonTemplate.push({ start: m.index, end: m.index + m[0].length });
  }
  for (const m of text.slice(from).matchAll(/<!--[\s\S]*?-->/g)) nonTemplate.push({ start: from + m.index!, end: from + m.index! + m[0].length });
  return { ...(frontmatter ? { frontmatter } : {}), scripts, styles, nonTemplate };
}

/** Index after the `}` that closes the `{` at `i` (strings, template literals and nesting included). */
function closeBrace(s: string, i: number): number {
  let depth = 0;
  for (let k = i; k < s.length; k++) {
    const c = s[k]!;
    if (c === '{') depth++;
    else if (c === '}') {
      if (--depth === 0) return k + 1;
    } else if (c === '"' || c === "'") {
      const e = s.indexOf(c, k + 1);
      if (e < 0) return s.length;
      k = e;
    } else if (c === '`') {
      for (k++; k < s.length && s[k] !== '`'; k++) {
        if (s[k] === '\\') k++;
        else if (s[k] === '$' && s[k + 1] === '{') k = closeBrace(s, k + 1) - 1;
      }
    }
  }
  return s.length;
}

interface Attr {
  name: string;
  /** static: quoted or bare text; expr: a JS expression (`{...}` in Astro and Svelte, `:x="..."` in Vue). */
  kind: 'static' | 'expr' | 'bare' | 'spread';
  value: string;
  valueStart: number;
}

/** Attributes of the tag whose name ends at `i`, up to its closing `>`. */
function readTag(s: string, i: number, lang: MarkupLang): { attrs: Attr[]; end: number; selfClosing: boolean } {
  const attrs: Attr[] = [];
  let k = i;
  while (k < s.length) {
    while (k < s.length && /\s/.test(s[k]!)) k++;
    const c = s[k];
    if (c === undefined) break;
    if (c === '>') return { attrs, end: k + 1, selfClosing: false };
    if (c === '/' && s[k + 1] === '>') return { attrs, end: k + 2, selfClosing: true };
    if (c === '{') {
      // `{...props}` spread or `{href}` shorthand.
      const e = closeBrace(s, k);
      const inner = s.slice(k + 1, e - 1).trim();
      attrs.push(inner.startsWith('...') ? { name: '', kind: 'spread', value: inner, valueStart: k + 1 } : { name: inner, kind: 'expr', value: inner, valueStart: k + 1 });
      k = e;
      continue;
    }
    const nm = /^[^\s=>/"'{]+/.exec(s.slice(k, k + 200));
    if (!nm) {
      k++;
      continue;
    }
    const name = nm[0];
    k += name.length;
    let j = k;
    while (j < s.length && /\s/.test(s[j]!)) j++;
    if (s[j] !== '=') {
      attrs.push({ name, kind: 'bare', value: '', valueStart: k });
      continue;
    }
    j++;
    while (j < s.length && /\s/.test(s[j]!)) j++;
    const q = s[j];
    const bound = lang === 'vue' && /^(:|v-bind:|v-on:|@|v-)/.test(name);
    if (q === '"' || q === "'") {
      const e = s.indexOf(q, j + 1);
      const end = e < 0 ? s.length : e;
      attrs.push({ name, kind: bound ? 'expr' : 'static', value: s.slice(j + 1, end), valueStart: j + 1 });
      k = end + 1;
    } else if (q === '{') {
      const e = closeBrace(s, j);
      attrs.push({ name, kind: 'expr', value: s.slice(j + 1, e - 1), valueStart: j + 1 });
      k = e;
    } else {
      const m = /^[^\s>]+/.exec(s.slice(j));
      const v = m?.[0].replace(/\/$/, '') ?? '';
      attrs.push({ name, kind: 'static', value: v, valueStart: j });
      k = j + v.length;
    }
  }
  return { attrs, end: s.length, selfClosing: false };
}

/** `:href`, `v-bind:href`, `bind:value` -> `href`, `value`. */
const attrName = (n: string) => n.replace(/^(v-bind:|:|bind:)/, '');
const pascal = (kebab: string) => kebab.replace(/(^|-)([a-z0-9])/g, (_m, _d, c: string) => c.toUpperCase());
const NO_COLOR_ATTR_TAGS = new Set(['meta', 'link']);

/** Audit an Astro, Vue or Svelte file. Line and column numbers are the file's own. */
export function scanMarkup(path: string, text: string, lang: MarkupLang, ds: DesignSystemIndex): CodeScan {
  const out: CodeScan = { findings: [], tokenUsages: 0, themeRefs: 0, ds: {}, components: [], definitions: [] };
  const pos = lineCol(text);
  const blocks = markupBlocks(text, lang);
  const imports: ImportMap = new Map();

  const merge = (c: CodeScan) => {
    out.findings.push(...c.findings);
    out.tokenUsages += c.tokenUsages;
    out.themeRefs += c.themeRefs;
    for (const [n, k] of Object.entries(c.ds)) out.ds[n] = (out.ds[n] ?? 0) + k;
    out.components.push(...c.components);
    out.definitions.push(...c.definitions);
  };

  // Frontmatter and scripts: the TS scanner on the file with everything else blanked, so positions stay put.
  const codeRanges = [...(blocks.frontmatter ? [{ ...blocks.frontmatter, attrs: '' }] : []), ...blocks.scripts.filter((b) => isCodeScript(b.attrs))];
  for (const r of codeRanges) {
    const jsx = /^(tsx|jsx)$/i.test(attrOf(r.attrs, 'lang') ?? '');
    const code = mask(text, [r], true);
    const file = `${path}.${jsx ? 'tsx' : 'ts'}`;
    merge(scanCode(file, code, ds));
    for (const [k, v] of importsOf(file, code)) imports.set(k, v);
  }

  for (const b of blocks.styles) {
    const l = (attrOf(b.attrs, 'lang') ?? 'css').toLowerCase();
    const r = auditCssText(text.slice(b.start, b.end), l === 'scss' || l === 'sass' ? 'scss' : l === 'less' ? 'less' : 'css', ds, { pos, offset: b.start });
    out.findings.push(...r.findings);
    out.tokenUsages += r.tokenUsages;
    out.themeRefs += r.themeRefs;
  }

  /** A JS expression from the template, scanned in place: a prefix line above it keeps its line and column. */
  const scanExpr = (prefix: string, expr: string, offset: number, suffix: string, keepLookalikes = false) => {
    const { line, column } = pos(offset);
    const src = line >= 2 ? `${'\n'.repeat(line - 2)}${prefix}\n${' '.repeat(column - 1)}${expr}${suffix}` : `${prefix}${expr}${suffix}`;
    const c = scanCode(`${path}.tsx`, src, ds);
    merge({ ...c, components: keepLookalikes ? c.components.filter((x) => x.kind === 'recreated' && x.name.startsWith('.')) : [], definitions: [], ds: {} });
  };

  const styleAttr = (a: Attr) => {
    if (a.kind === 'static') {
      const css = lang === 'svelte' ? a.value.replace(/\{[^}]*\}/g, (m) => ' '.repeat(m.length)) : a.value;
      const r = auditCssText(css, 'css', ds, { pos, offset: a.valueStart, source: 'style' });
      out.findings.push(...r.findings);
      out.tokenUsages += r.tokenUsages;
      out.themeRefs += r.themeRefs;
      return;
    }
    const str = /^(\s*)([`'"])([\s\S]*)\2\s*$/.exec(a.value);
    if (str) {
      // A string or template literal: its text is CSS; `${...}` parts are left out.
      const body = str[3]!.replace(/\$\{[^}]*\}/g, (m) => ' '.repeat(m.length));
      const r = auditCssText(body, 'css', ds, { pos, offset: a.valueStart + str[1]!.length + 1, source: 'style' });
      out.findings.push(...r.findings);
      out.tokenUsages += r.tokenUsages;
      out.themeRefs += r.themeRefs;
      return;
    }
    scanExpr('const style: CSSProperties =', a.value, a.valueStart, ';');
  };

  // Template markup: the file with frontmatter, scripts, styles and comments blanked.
  const tpl = mask(text, blocks.nonTemplate, false);
  const pending: ComponentFinding[] = [];
  let noscript = 0;
  const TAG = /<(\/?)([A-Za-z][\w.:-]*)/g;
  for (let m; (m = TAG.exec(tpl)); ) {
    const raw = m[2]!;
    if (m[1]) {
      if (raw.toLowerCase() === 'noscript') noscript = Math.max(0, noscript - 1);
      continue;
    }
    const tag = readTag(tpl, m.index + m[0].length, lang);
    TAG.lastIndex = tag.end;
    const lower = raw.toLowerCase();
    if (lower === 'noscript' && !tag.selfClosing) {
      noscript++;
      continue;
    }
    const attrs = tag.attrs;
    const get = (n: string) => attrs.find((a) => attrName(a.name) === n);

    for (const a of attrs) {
      const n = attrName(a.name);
      if (n === 'style') styleAttr(a);
      else if (lang === 'svelte' && a.name.startsWith('style:') && a.kind === 'static') {
        const prop = a.name.slice(6).split('|')[0]!;
        const r = auditCssText(`${prop}:${a.value}`, 'css', ds, { pos, offset: a.valueStart - prop.length - 1, source: 'style' });
        out.findings.push(...r.findings);
        out.tokenUsages += r.tokenUsages;
        out.themeRefs += r.themeRefs;
      } else if (/^(class|className|class:list)$/.test(n)) {
        if (a.kind === 'static') {
          // Homemade look-alikes (`class="pill"`, `class="tooltip"`): the DS component they imitate.
          for (const l of lookalikesInClassList(a.value, ds.components)) out.components.push({ ...pos(a.valueStart), name: `.${l.token}`, kind: 'recreated', library: 'local', suggestion: l.component });
          const r = tailwindFindings(scanClassString(a.value), a.valueStart, pos, ds);
          out.findings.push(...r.findings);
          out.themeRefs += r.themeRefs;
        } else if (a.kind === 'expr') scanExpr('cn(', a.value, a.valueStart, ')', true);
      } else if (LOOKALIKE_ATTRS[n] && ds.components.has(LOOKALIKE_ATTRS[n]!)) {
        out.components.push({ ...pos(a.valueStart - a.name.length - 1), name: `[${n}]`, kind: 'recreated', library: 'local', suggestion: LOOKALIKE_ATTRS[n]! });
      } else if (a.kind === 'static' && !NO_COLOR_ATTR_TAGS.has(lower) && isColorLiteral(a.value)) {
        const suggestion = ds.suggest('color', a.value.trim(), n);
        out.findings.push({ ...pos(a.valueStart), category: 'color', property: n, value: a.value.trim(), source: 'jsx-attr', ...(suggestion ? { suggestion } : {}) });
      }
    }

    let name = raw;
    if (raw.includes(':')) continue; // svelte:head, Vue and Svelte directives as tags
    if (raw.includes('-')) {
      // Vue and Svelte may write imported components in kebab case; any other dashed tag is a custom element.
      if (!imports.has(pascal(raw))) continue;
      name = pascal(raw);
    }
    const isNative = /^[a-z]/.test(name) && !name.includes('.');
    if (isNative && noscript > 0) continue; // fallback markup for no-JS browsers
    const type = get('type');
    const r = classifyTag({ name, ...pos(m.index), ...(type?.kind === 'static' ? { type: type.value } : {}), hasHref: Boolean(get('href')) }, imports, ds);
    if (r.ds) out.ds[r.ds] = (out.ds[r.ds] ?? 0) + 1;
    if (r.component) out.components.push(r.component);
    if (r.localCandidate) pending.push(r.localCandidate);
  }

  // The file itself defines a component named after it (Button.vue, Card.astro).
  const base = /([^/]+)\.(astro|vue|svelte)$/.exec(path)?.[1];
  if (base && /^[A-Z][A-Za-z0-9]*$/.test(base)) out.definitions.push({ name: base, line: 1 });
  const defined = new Set(out.definitions.map((d) => d.name));
  out.components.push(...pending.filter((f) => defined.has(f.suggestion!)));
  out.findings.sort((a, b) => a.line - b.line || a.column - b.column);
  out.components.sort((a, b) => a.line - b.line || a.column - b.column);
  return out;
}
