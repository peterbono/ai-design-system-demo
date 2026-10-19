// Escape hatches that keep a known exception out of the counts without hiding it: a comment on the line above
// (`bridge-audit-ignore-next-line: reason`, in any comment syntax) and an allowlist file of file:line entries.
// Both need a reason, and both keep the ignored items in the report.
import { lineCol } from './css';
import type { AllowlistEntry, ComponentFinding, IgnoredItem, IgnoreVia, StyleFinding } from './types';

export const IGNORE_DIRECTIVE = 'bridge-audit-ignore-next-line';

export interface IgnoreDirective {
  /** Line of the comment (1-based). */
  line: number;
  /** Line it applies to: the one after the comment ends. */
  target: number;
  /** Empty when the comment gives none: such a comment ignores nothing. */
  reason: string;
}

/**
 * Every `bridge-audit-ignore-next-line` comment in a file: `<!-- ...: reason -->` (HTML, Astro, Vue, Svelte),
 * `{/* ...: reason *\/}` (JSX, Astro expressions), `/* ...: reason *\/` (CSS) and `// ...: reason` (scripts).
 * The text after the colon is the reason. A mention outside a comment is not a directive.
 */
export function ignoreDirectives(text: string): IgnoreDirective[] {
  const at = lineCol(text);
  const out: IgnoreDirective[] = [];
  for (const m of text.matchAll(new RegExp(`${IGNORE_DIRECTIVE}\\b`, 'g'))) {
    const start = m.index!;
    // Only white space between the comment opener and the directive (a block comment may open on the line above).
    const opener = /(<!--|\/\*|\/\/)(\s*)$/.exec(text.slice(Math.max(0, start - 200), start));
    const open = opener?.[1];
    if (!open || (open === '//' && opener[2]!.includes('\n'))) continue;
    const from = start + m[0].length;
    let end: number;
    if (open === '//') {
      end = text.indexOf('\n', from);
      if (end < 0) end = text.length;
    } else {
      end = text.indexOf(open === '<!--' ? '-->' : '*/', from);
      if (end < 0) continue;
    }
    const reason = text.slice(from, end).replace(/^\s*:?/, '').replace(/\s+/g, ' ').trim();
    out.push({ line: at(start).line, target: at(end).line + 1, reason });
  }
  return out;
}

export interface IgnoreResult {
  findings: StyleFinding[];
  components: ComponentFinding[];
  ignored: IgnoredItem[];
}

const item = (x: StyleFinding | ComponentFinding, reason: string, via: IgnoreVia): IgnoredItem =>
  'category' in x
    ? { line: x.line, column: x.column, kind: 'value', what: x.value, reason, via }
    : { line: x.line, column: x.column, kind: 'component', what: x.name, reason, via };

/** Apply the file's ignore comments. Comments without a reason, or that match nothing, are reported as errors. */
export function applyIgnoreComments(text: string, findings: StyleFinding[], components: ComponentFinding[]): IgnoreResult & { errors: { line: number; message: string }[] } {
  const errors: { line: number; message: string }[] = [];
  const reasons = new Map<number, string>();
  for (const d of ignoreDirectives(text)) {
    if (!d.reason) {
      errors.push({ line: d.line, message: `${IGNORE_DIRECTIVE} needs a reason after a colon (${IGNORE_DIRECTIVE}: why this one stays); nothing was ignored` });
      continue;
    }
    if (!findings.some((f) => f.line === d.target) && !components.some((c) => c.line === d.target)) {
      errors.push({ line: d.line, message: `${IGNORE_DIRECTIVE} ignores nothing: line ${d.target} has no finding; remove the comment` });
      continue;
    }
    reasons.set(d.target, d.reason);
  }
  const ignored: IgnoredItem[] = [];
  const keep = <T extends StyleFinding | ComponentFinding>(xs: T[]) =>
    xs.filter((x) => {
      const r = reasons.get(x.line);
      if (r === undefined) return true;
      ignored.push(item(x, r, 'comment'));
      return false;
    });
  return { findings: keep(findings), components: keep(components), ignored, errors };
}

/** Apply allowlist entries for one file; returns what each entry matched (index in `entries`). */
export function applyAllowlist(entries: AllowlistEntry[], findings: StyleFinding[], components: ComponentFinding[]): IgnoreResult & { used: Set<number> } {
  const used = new Set<number>();
  const ignored: IgnoredItem[] = [];
  const keep = <T extends StyleFinding | ComponentFinding>(xs: T[]) =>
    xs.filter((x) => {
      const what = 'category' in x ? x.value : x.name;
      const fits = (e: AllowlistEntry) => e.line === x.line && (e.what === undefined || e.what === what);
      // One entry per item when the list has one per item (two links on a line); else one entry covers them all.
      let i = entries.findIndex((e, k) => fits(e) && !used.has(k));
      if (i < 0) i = entries.findIndex(fits);
      if (i < 0) return true;
      used.add(i);
      ignored.push(item(x, entries[i]!.reason, 'allowlist'));
      return false;
    });
  return { findings: keep(findings), components: keep(components), ignored, used };
}

/** Validate an allowlist file's JSON: `{ "entries": [{ "file", "line", "what"?, "reason" }] }`, a reason on each entry. */
export function parseAllowlist(json: unknown): AllowlistEntry[] {
  const fail = (msg: string): never => {
    throw new Error(`allowlist: ${msg}`);
  };
  if (!json || typeof json !== 'object' || !Array.isArray((json as { entries?: unknown }).entries)) fail('expected { "entries": [...] }');
  return ((json as { entries: unknown[] }).entries).map((e, i) => {
    const x = e as Partial<AllowlistEntry>;
    if (typeof x.file !== 'string' || !x.file) fail(`entry ${i} needs "file"`);
    if (typeof x.line !== 'number' || !Number.isInteger(x.line) || x.line < 1) fail(`entry ${i} (${x.file}) needs a "line" number`);
    if (typeof x.reason !== 'string' || !x.reason.trim()) fail(`entry ${i} (${x.file}:${x.line}) needs a "reason"`);
    if (x.what !== undefined && typeof x.what !== 'string') fail(`entry ${i} (${x.file}:${x.line}): "what" must be a string`);
    return { file: x.file!, line: x.line!, ...(x.what !== undefined ? { what: x.what } : {}), reason: x.reason!.trim() };
  });
}
