// What a product branch introduces that the library lacks: the adoption audit run on each changed product file at the
// branch head and at its start (the merge base with main), keeping only what the branch added. Each new hardcoded value
// or foreign component is then mapped to the nearest library target:
// - values written on a library component (an inline style, or a CSS module class used on it) form one variant of that
//   component: "Badge: overdue tone";
// - a component from another UI library with no library equivalent is a new component;
// - any other value is a token the library lacks: "New color #C2410C", beside the closest token.
// Values that equal a token, and components the library already has, are fixes (use the library), not pieces.
// Pure: file texts in, pieces out. Uses the audit, so the TypeScript compiler (syntax only).
import type { LayeredTokenSet } from '../layered';
import { pieceId, proposedTokenPath, tokenLabel, type MissingPiece, type PieceAspect, type PieceNearest, type PieceValue } from '../prod-branch';
import type { DesignSystemIndex } from './ds-index';
import { auditFile, isAuditable } from './report';
import type { ComponentFinding, StyleFinding, TokenSuggestion } from './types';

export interface BranchFile {
  /** Repo-relative path. */
  path: string;
  /** Text at the branch start, null when the branch adds the file. */
  before: string | null;
  /** Text at the branch head, null when the branch removes it. */
  after: string | null;
}

export interface MissingPiecesResult {
  pieces: MissingPiece[];
  /** New values equal to a token and new non-library components the library has an equivalent for. */
  fixes: { file: string; line: number; what: string; use: string }[];
  /** Files read. */
  files: number;
}

const lines = (text: string) => text.split(/\r?\n/);

/** Trimmed lines of a text as a multiset: a finding is new when its line was not there before. */
function lineBag(text: string | null): Map<string, number> {
  const bag = new Map<string, number>();
  for (const l of text ? lines(text) : []) {
    const k = l.trim();
    if (k) bag.set(k, (bag.get(k) ?? 0) + 1);
  }
  return bag;
}

const offsetOf = (text: string, line: number, column: number): number => {
  let off = 0;
  const ls = text.split('\n');
  for (let i = 0; i < line - 1 && i < ls.length; i++) off += ls[i]!.length + 1;
  return off + Math.max(0, column - 1);
};

/** The JSX element whose opening tag holds `offset` (an inline style value), or null. */
export function enclosingTag(text: string, offset: number): { name: string; start: number } | null {
  for (let i = offset - 1; i >= Math.max(0, offset - 4000); i--) {
    if (text[i] !== '<' || !/[A-Za-z]/.test(text[i + 1] ?? '')) continue;
    let depth = 0;
    let closed = false;
    for (let j = i + 1; j < offset; j++) {
      const c = text[j];
      if (c === '{') depth++;
      else if (c === '}') depth--;
      else if (c === '>' && depth <= 0 && text[j - 1] !== '=') {
        closed = true;
        break;
      }
    }
    if (closed) return null;
    const m = /^<([A-Za-z][\w.]*)/.exec(text.slice(i));
    return m ? { name: m[1]!, start: i } : null;
  }
  return null;
}

/** The plain text right after an opening tag (`<Badge ...>Overdue</Badge>` gives "Overdue"), when short. */
export function childText(text: string, tagStart: number): string | null {
  let depth = 0;
  for (let j = tagStart + 1; j < text.length; j++) {
    const c = text[j];
    if (c === '{') depth++;
    else if (c === '}') depth--;
    else if (c === '>' && depth <= 0 && text[j - 1] !== '=') {
      if (text[j - 1] === '/') return null;
      const rest = /^([^<{]*)</.exec(text.slice(j + 1));
      const t = rest?.[1]?.trim() ?? '';
      return t && t.split(/\s+/).length <= 3 && t.length <= 30 ? t : null;
    }
  }
  return null;
}

/** The classes of the CSS rule a declaration at `offset` belongs to: `.badge.overdue { color: red }` gives ["badge", "overdue"]. */
export function ruleClasses(text: string, offset: number): string[] {
  const open = text.lastIndexOf('{', offset);
  if (open < 0) return [];
  const prev = Math.max(text.lastIndexOf('}', open), text.lastIndexOf(';', open));
  const selector = text.slice(prev + 1, open);
  return [...selector.matchAll(/\.([A-Za-z_][\w-]*)/g)].map((m) => m[1]!);
}

const GENERIC = new Set(['status', 'badge', 'tag', 'pill', 'chip', 'style', 'styles', 'root', 'wrapper', 'container', 'item', 'label', 'text', 'color', 'bg', 'is', 'has', 'variant', 'tone', 'custom', 'new']);

/** "badgeOverdue" on Badge -> "overdue"; "invoice-status--late" -> "late". */
export function nameFromClass(cls: string, component?: string): string {
  const words = cls
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[\s_-]+/)
    .map((w) => w.toLowerCase())
    .filter(Boolean);
  const comp = component?.toLowerCase();
  const kept = words.filter((w) => w !== comp && !GENERIC.has(w));
  return kept[kept.length - 1] ?? words[words.length - 1] ?? cls;
}

const ASPECT: Record<string, PieceAspect> = { color: 'tone', radius: 'shape', spacing: 'size', size: 'size', 'font-size': 'size', 'line-height': 'size' };

function aspectOf(values: PieceValue[]): PieceAspect {
  for (const a of ['tone', 'shape', 'size'] as const) if (values.some((v) => ASPECT[v.category] === a)) return a;
  return 'style';
}

const norm = (f: { category: string; value: string }) => (f.category === 'color' ? f.value.toLowerCase() : f.value.replace(/\s+/g, ''));

function nearestOf(s: TokenSuggestion | undefined): PieceNearest | undefined {
  if (!s) return undefined;
  return { token: s.token, cssVar: s.cssVar, value: s.value, level: s.level, label: tokenLabel(s.token) };
}

const TOKEN_TYPE: Record<string, string> = { color: 'color', duration: 'duration', 'font-weight': 'fontWeight', 'line-height': 'number', 'z-index': 'number', 'font-family': 'fontFamily', shadow: 'shadow', easing: 'cubicBezier' };

const valueTitle = (category: string, value: string): string => {
  const v = category === 'color' && /^#[0-9a-f]+$/i.test(value) ? value.toUpperCase() : value;
  const word: Record<string, string> = { color: 'color', radius: 'radius', spacing: 'spacing', size: 'size', 'font-size': 'text size', 'font-weight': 'font weight', 'line-height': 'line height', shadow: 'shadow', duration: 'duration', easing: 'easing', 'z-index': 'layer', 'border-width': 'border width', 'font-family': 'font' };
  return `New ${word[category] ?? category} ${v}`;
};

interface Hit {
  file: string;
  line: number;
  finding: StyleFinding;
}

/**
 * The pieces a product branch adds that the library lacks. `files` are the changed files (only auditable ones are
 * read; pass the product's files). `set` lets token pieces name the token files of the closest token (light and dark).
 */
export function missingPieces(input: { files: BranchFile[]; ds: DesignSystemIndex; set?: LayeredTokenSet | undefined }): MissingPiecesResult {
  const { ds } = input;
  const files = input.files.filter((f) => f.after !== null && isAuditable(f.path));
  const fixes: MissingPiecesResult['fixes'] = [];
  const variants = new Map<string, { component: string; name: string; hits: Hit[] }>();
  const tokens = new Map<string, { category: string; value: string; name: string | null; hits: Hit[] }>();
  const foreign = new Map<string, { finding: ComponentFinding; hits: { file: string; line: number }[] }>();
  // Classes of CSS modules: which DS component uses each one, read from every changed file at its head.
  const classUse = (cls: string): { component: string; text: string | null } | null => {
    const re = new RegExp(`<([A-Z][\\w.]*)\\b[^<]*?styles(?:\\.${cls}\\b|\\[['"]${cls}['"]\\])`);
    for (const f of files) {
      const m = re.exec(f.after!);
      if (m && ds.components.has(m[1]!.split('.')[0]!)) return { component: m[1]!.split('.')[0]!, text: childText(f.after!, m.index) };
    }
    return null;
  };

  for (const f of files) {
    const after = f.after!;
    const report = auditFile(f.path, after, ds);
    const before = lineBag(f.before);
    const afterLines = lines(after);
    // Lines the branch added (a line that was there before is not the branch's doing), counted so repeats stay fair.
    const added = (line: number) => {
      const k = afterLines[line - 1]?.trim() ?? '';
      const n = before.get(k) ?? 0;
      if (n > 0) {
        before.set(k, n - 1);
        return false;
      }
      return true;
    };
    const addedLines = new Map<number, boolean>();
    const isNew = (line: number) => {
      if (!addedLines.has(line)) addedLines.set(line, added(line));
      return addedLines.get(line)!;
    };
    const css = report.lang === 'css' || report.lang === 'scss' || report.lang === 'less';
    for (const finding of report.findings) {
      if (!isNew(finding.line)) continue;
      const s = finding.suggestion;
      const at = { file: f.path, line: finding.line };
      if (s?.level === 'exact' || (s?.level === 'high' && finding.category !== 'color')) {
        fixes.push({ ...at, what: finding.value, use: s.token });
        continue;
      }
      const offset = offsetOf(after, finding.line, finding.column);
      let component: string | null = null;
      let name: string | null = null;
      if (css) {
        const classes = ruleClasses(after, offset);
        for (const cls of [...classes].reverse()) {
          const use = classUse(cls);
          if (use) {
            component = use.component;
            name = nameFromClass(cls, use.component);
            break;
          }
        }
        if (!component && classes.length) name = nameFromClass(classes[classes.length - 1]!);
      } else {
        const tag = enclosingTag(after, offset);
        const root = tag?.name.split('.')[0];
        if (tag && root && ds.components.has(root)) {
          component = root;
          name = childText(after, tag.start);
          const cls = /className=\{?["'`]?([\w-]+)/.exec(after.slice(tag.start, offset))?.[1];
          if (!name && cls) name = nameFromClass(cls, root);
        }
      }
      const hit: Hit = { ...at, finding };
      if (component) {
        const label = (name ?? 'custom').toLowerCase();
        const key = `${component}|${label}`;
        const v = variants.get(key) ?? { component, name: label, hits: [] };
        v.hits.push(hit);
        variants.set(key, v);
        continue;
      }
      const key = `${finding.category}|${norm(finding)}`;
      const t = tokens.get(key) ?? { category: finding.category, value: finding.value, name, hits: [] };
      if (!t.name && name) t.name = name;
      t.hits.push(hit);
      tokens.set(key, t);
    }
    for (const c of report.components) {
      if (!isNew(c.line)) continue;
      if (c.suggestion) {
        fixes.push({ file: f.path, line: c.line, what: c.name, use: c.suggestion });
        continue;
      }
      if (c.kind !== 'foreign') continue;
      const e = foreign.get(c.name) ?? { finding: c, hits: [] };
      e.hits.push({ file: f.path, line: c.line });
      foreign.set(c.name, e);
    }
  }

  const where = (hits: { file: string; line: number }[]) => hits.slice(0, 5).map((h) => ({ file: h.file, line: h.line }));
  const pieces: MissingPiece[] = [];
  for (const v of variants.values()) {
    const values: PieceValue[] = [];
    for (const h of v.hits) {
      const pv = { category: h.finding.category, ...(h.finding.property ? { property: h.finding.property } : {}), value: h.finding.value };
      if (!values.some((x) => x.category === pv.category && x.property === pv.property && norm(x) === norm(pv))) values.push(pv);
    }
    const aspect = aspectOf(values);
    const bg = v.hits.find((h) => /background/.test(h.finding.property ?? ''))?.finding.suggestion;
    const nearest = nearestOf(bg ?? v.hits.find((h) => h.finding.suggestion)?.finding.suggestion);
    const shown = values.map((x) => `${x.property ?? x.category} ${x.value}`).join(', ');
    pieces.push({
      id: pieceId([v.component, v.name, aspect]),
      kind: 'variant',
      title: `${v.component}: ${v.name} ${aspect}`,
      summary: `${v.component} restyled by hand (${shown}).${nearest ? ` ${nearest.level === 'high' ? 'It looks a lot like' : 'The closest in the library is'} ${nearest.label}.` : ''}`,
      name: v.name,
      component: v.component,
      aspect,
      values,
      ...(nearest ? { nearest } : {}),
      where: where(v.hits),
    });
  }
  for (const [name, e] of foreign) {
    pieces.push({
      id: pieceId(['component', name]),
      kind: 'component',
      title: `New component: ${name}`,
      summary: `${name} comes from ${e.finding.library}, and the library has nothing like it.`,
      name,
      component: name.split('.').pop()!,
      values: [],
      where: where(e.hits),
    });
  }
  for (const t of tokens.values()) {
    const nearest = nearestOf(t.hits[0]!.finding.suggestion);
    const pname = t.name ?? `${t.category === 'color' ? 'custom' : t.category}`;
    const path = proposedTokenPath(nearest?.token, pname, t.category);
    const tokenFiles = nearest && input.set ? [...new Set(input.set.defs.filter((d) => d.path === nearest.token).map((d) => d.file))] : [];
    const n = t.hits.length;
    pieces.push({
      id: pieceId([t.category, t.name ?? t.value.replace(/^#/, '')]),
      kind: 'token',
      title: valueTitle(t.category, t.value),
      summary: `Written by hand in ${n === 1 ? 'one place' : `${n} places`}.${nearest ? ` ${nearest.level === 'high' ? 'It looks a lot like' : 'The closest in the library is'} ${nearest.label} (${nearest.value}).` : ' The library has nothing close.'}`,
      name: pname,
      values: [{ category: t.category, ...(t.hits[0]!.finding.property ? { property: t.hits[0]!.finding.property } : {}), value: t.value }],
      ...(nearest ? { nearest } : {}),
      where: where(t.hits),
      token: { path, type: TOKEN_TYPE[t.category] ?? 'dimension', value: t.value, files: tokenFiles },
    });
  }
  // Variants and components first (they read as features), then values; ids stay unique.
  const order: Record<MissingPiece['kind'], number> = { variant: 0, component: 1, token: 2 };
  const seen = new Set<string>();
  const out = pieces
    .sort((a, b) => order[a.kind] - order[b.kind])
    .map((p) => {
      let id = p.id;
      for (let i = 2; seen.has(id); i++) id = `${p.id}-${i}`;
      seen.add(id);
      return id === p.id ? p : { ...p, id };
    });
  return { pieces: out, fixes, files: files.length };
}
