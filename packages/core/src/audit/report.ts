// Turns scanned files into the versioned audit report, compares it with a baseline, renders Markdown,
// and plans the safe CSS autofix (exact token matches only).
import { scanCode } from './code';
import { lineCol, scanCssText } from './css';
import type { DesignSystemIndex } from './ds-index';
import type { ValueHit } from './scan-value';
import { parseCssColor } from './color';
import {
  AUDIT_SCHEMA_VERSION,
  FINDING_CATEGORIES,
  type AuditReport,
  type BaselineDiff,
  type CategoryCount,
  type FileReport,
  type FindingCategory,
  type HistoryPoint,
  type StyleFinding,
  type TokenSuggestion,
  type TopFix,
} from './types';

export const AUDIT_EXTENSIONS = ['.css', '.scss', '.sass', '.less', '.tsx', '.jsx', '.ts', '.js', '.mjs', '.cjs', '.mts', '.cts'];
export const AUDIT_IGNORE_DIRS = ['node_modules', 'dist', 'build', 'out', 'coverage', '.git', '.next', '.nuxt', '.astro', '.turbo', '.cache', '.vercel', 'storybook-static', 'vendor', 'public'];
const IGNORE_FILE = /\.d\.[cm]?ts$|\.(test|spec|stories|story)\.[cm]?[jt]sx?$|\.min\.(css|js)$|(^|\/)(vite|vitest|jest|webpack|rollup|eslint|postcss|tailwind|babel|next|astro|prettier|stylelint|tsup)\.config\.[cm]?[jt]s$/;

/** Should the audit read this repo-relative path? */
export function isAuditable(path: string): boolean {
  if (!AUDIT_EXTENSIONS.some((e) => path.endsWith(e))) return false;
  if (IGNORE_FILE.test(path)) return false;
  return !path.split('/').some((seg) => AUDIT_IGNORE_DIRS.includes(seg));
}

const langOf = (path: string): FileReport['lang'] => {
  const ext = path.slice(path.lastIndexOf('.') + 1);
  if (ext === 'css') return 'css';
  if (ext === 'scss' || ext === 'sass') return 'scss';
  if (ext === 'less') return 'less';
  if (ext === 'tsx') return 'tsx';
  if (ext === 'jsx') return 'jsx';
  if (/^[cm]?ts$/.test(ext)) return 'ts';
  return 'js';
};

/** A literal the CSS autofix may replace: exact token value, same spelling for lengths and durations. */
export function isSafeFix(h: { category: FindingCategory; text: string }, s: TokenSuggestion | undefined): boolean {
  if (!s || s.level !== 'exact') return false;
  switch (h.category) {
    case 'color': {
      const a = parseCssColor(h.text);
      const b = parseCssColor(s.value);
      return Boolean(a && b && s.distance <= 0.5 && Math.abs(a.a - b.a) < 0.01);
    }
    case 'spacing':
    case 'size':
    case 'radius':
    case 'border-width':
    case 'font-size':
    case 'duration':
    case 'z-index':
    case 'font-weight':
    case 'line-height':
      return h.text.trim() === s.value.trim();
    case 'shadow':
      return s.distance === 0;
    default:
      return false;
  }
}

export type AuditedFile = FileReport & { definitions: { name: string; line: number }[]; dsByName: Record<string, number> };

/** Audit one file. */
export function auditFile(path: string, text: string, ds: DesignSystemIndex): AuditedFile {
  const lang = langOf(path);
  if (lang === 'css' || lang === 'scss' || lang === 'less') {
    const at = lineCol(text);
    const scan = scanCssText(text, lang);
    const findings: StyleFinding[] = [];
    let tokenUsages = 0;
    let themeRefs = 0;
    for (const d of scan.decls) {
      for (const v of d.scan.vars) ds.isDsVar(v) ? tokenUsages++ : themeRefs++;
      if (d.scan.themeRef) themeRefs++;
      else if (lang !== 'css' && !d.property.startsWith('$')) themeRefs += (d.value.match(/\$[\w-]+/g) ?? []).length;
      const property = d.property.toLowerCase();
      for (const h of d.scan.hits) {
        const suggestion = ds.suggest(h.category, h.text, property);
        const p = at(d.valueStart + h.index);
        findings.push({ ...p, category: h.category, property, value: h.text, source: 'css', ...(suggestion ? { suggestion } : {}), ...(isSafeFix(h, suggestion) ? { autofix: true } : {}) });
      }
    }
    for (const a of scan.applies) {
      for (const h of a.hits) {
        if (h.kind === 'scale') themeRefs++;
        else if (h.kind !== 'token' && h.value) {
          const cat: FindingCategory = parseCssColor(h.value) ? 'color' : h.category === 'color-or-size' ? 'font-size' : h.category === 'color-or-width' ? 'border-width' : h.category === 'color-or-shadow' ? 'shadow' : h.category === 'font' ? 'font-family' : (h.category as FindingCategory);
          const suggestion = ds.suggest(cat, h.value);
          findings.push({ ...at(a.start + h.index), category: cat, value: h.cls, source: 'tailwind', ...(suggestion ? { suggestion } : {}) });
        } else if (h.kind === 'token' && h.value) {
          const v = /var\(\s*(--[\w-]+)/.exec(h.value)?.[1];
          if (v && ds.isDsVar(v)) tokenUsages++;
          else themeRefs++;
        }
      }
    }
    findings.sort((x, y) => x.line - y.line || x.column - y.column);
    return { path, lang, tokenUsages, themeRefs, hardcoded: findings.length, dsComponents: 0, otherComponents: 0, findings, components: [], definitions: [], dsByName: {} };
  }
  const c = scanCode(path, text, ds);
  const dsCount = Object.values(c.ds).reduce((a, b) => a + b, 0);
  return { path, lang, tokenUsages: c.tokenUsages, themeRefs: c.themeRefs, hardcoded: c.findings.length, dsComponents: dsCount, otherComponents: c.components.length, findings: c.findings, components: c.components, definitions: c.definitions, dsByName: c.ds };
}

const pct = (num: number, den: number) => (den > 0 ? Math.round((num / den) * 1000) / 10 : null);

export interface AuditInput {
  files: { path: string; text: string }[];
  skipped?: number;
  target: string;
  label?: string;
  version?: string;
  generatedAt?: string;
}

/** Build the report for a set of files. */
export function buildAuditReport(input: AuditInput, ds: DesignSystemIndex): AuditReport {
  const reports = input.files.map((f) => auditFile(f.path, f.text, ds));
  const files: FileReport[] = reports.map(({ definitions: _d, dsByName: _n, ...r }) => r);
  const byCategory: Partial<Record<FindingCategory, CategoryCount>> = {};
  const fixes = new Map<string, TopFix & { fileSet: Set<string> }>();
  const components: AuditReport['components'] = { ds: {}, foreign: {}, native: {}, recreated: [] };
  let tokenUsages = 0;
  let hardcoded = 0;
  let themeRefs = 0;
  let dsInstances = 0;
  let uiInstances = 0;

  for (const r of reports) {
    tokenUsages += r.tokenUsages;
    hardcoded += r.hardcoded;
    themeRefs += r.themeRefs;
    dsInstances += r.dsComponents;
    uiInstances += r.dsComponents + r.otherComponents;
    for (const [n, k] of Object.entries(r.dsByName)) components.ds[n] = (components.ds[n] ?? 0) + k;
    for (const f of r.findings) {
      const c = (byCategory[f.category] ??= { hardcoded: 0, exact: 0, suggested: 0 });
      c.hardcoded++;
      if (f.suggestion) c.suggested++;
      if (f.suggestion?.level === 'exact') c.exact++;
      const key = `${f.category}|${f.value.toLowerCase()}|${f.suggestion?.token ?? ''}`;
      const fx = fixes.get(key) ?? { category: f.category, value: f.value, count: 0, files: 0, fileSet: new Set<string>(), ...(f.suggestion ? { suggestion: f.suggestion } : {}) };
      fx.count++;
      fx.fileSet.add(r.path);
      fixes.set(key, fx);
    }
    for (const comp of r.components) {
      if (comp.kind === 'native') components.native[comp.name] = (components.native[comp.name] ?? 0) + 1;
      else if (comp.kind === 'foreign') {
        const lib = (components.foreign[comp.library] ??= { instances: 0, components: {} });
        lib.instances++;
        lib.components[comp.name] = (lib.components[comp.name] ?? 0) + 1;
      }
    }
  }
  // Re-created DS components: local definitions named like a DS component (shadcn/ui files included).
  for (const r of reports) {
    for (const d of r.definitions) {
      if (!ds.components.has(d.name)) continue;
      const instances = reports.reduce((n, x) => n + x.components.filter((c) => (c.kind === 'recreated' || c.library === 'shadcn/ui (local)') && c.name.split('.')[0] === d.name).length, 0);
      components.recreated.push({ name: d.name, file: r.path, line: d.line, instances });
    }
  }
  const topFiles = files
    .filter((f) => f.hardcoded + f.otherComponents > 0)
    .sort((a, b) => b.hardcoded + b.otherComponents - (a.hardcoded + a.otherComponents) || a.path.localeCompare(b.path))
    .slice(0, 15)
    .map((f) => ({ path: f.path, hardcoded: f.hardcoded, otherComponents: f.otherComponents, tokenUsages: f.tokenUsages, dsComponents: f.dsComponents }));
  const topFixes = [...fixes.values()]
    .sort((a, b) => b.count - a.count || (b.suggestion?.confidence ?? 0) - (a.suggestion?.confidence ?? 0))
    .slice(0, 25)
    .map(({ fileSet, ...f }) => ({ ...f, files: fileSet.size }));
  return {
    $schema: 'https://raw.githubusercontent.com/peterbono/ai-design-system-demo/main/packages/core/audit-report.schema.json',
    schemaVersion: AUDIT_SCHEMA_VERSION,
    tool: { name: 'bridge', version: input.version ?? '0.1.0' },
    ...(input.label ? { label: input.label } : {}),
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    target: { path: input.target, files: files.length, skipped: input.skipped ?? 0 },
    designSystem: { packages: ds.packages, components: ds.components.size, tokens: ds.tokenCount, modes: ds.modes },
    metrics: { tokenAdoption: pct(tokenUsages, tokenUsages + hardcoded), componentAdoption: pct(dsInstances, uiInstances), tokenUsages, hardcoded, themeRefs, dsComponentInstances: dsInstances, uiComponentInstances: uiInstances },
    byCategory: Object.fromEntries(FINDING_CATEGORIES.filter((c) => byCategory[c]).map((c) => [c, byCategory[c]!])),
    components: { ...components, recreated: components.recreated.sort((a, b) => b.instances - a.instances || a.name.localeCompare(b.name)) },
    topFiles,
    topFixes,
    files: files.sort((a, b) => a.path.localeCompare(b.path)),
    history: [],
  };
}

const delta = (a: number | null, b: number | null) => (a === null || b === null ? null : Math.round((b - a) * 10) / 10);

export function historyPoint(r: AuditReport): HistoryPoint {
  return {
    ...(r.label ? { label: r.label } : {}),
    generatedAt: r.generatedAt,
    tokenAdoption: r.metrics.tokenAdoption,
    componentAdoption: r.metrics.componentAdoption,
    hardcoded: r.metrics.hardcoded,
    uiComponentInstances: r.metrics.uiComponentInstances,
    dsComponentInstances: r.metrics.dsComponentInstances,
  };
}

/** Compare with an earlier report of the same codebase: progress, per category and per file. */
export function compareWithBaseline(report: AuditReport, baseline: AuditReport): AuditReport {
  if (baseline.schemaVersion !== AUDIT_SCHEMA_VERSION) throw new Error(`baseline schemaVersion ${String(baseline.schemaVersion)} is not supported (expected ${AUDIT_SCHEMA_VERSION})`);
  const before = new Map(baseline.files.map((f) => [f.path, f.hardcoded + f.otherComponents]));
  const after = new Map(report.files.map((f) => [f.path, f.hardcoded + f.otherComponents]));
  const byCategory: BaselineDiff['byCategory'] = {};
  for (const c of FINDING_CATEGORIES) {
    const b = baseline.byCategory[c]?.hardcoded ?? 0;
    const a = report.byCategory[c]?.hardcoded ?? 0;
    if (a || b) byCategory[c] = { before: b, after: a, delta: a - b };
  }
  const improved: BaselineDiff['improved'] = [];
  const regressed: BaselineDiff['regressed'] = [];
  for (const [path, a] of after) {
    const b = before.get(path);
    if (b === undefined) continue;
    if (a < b) improved.push({ path, before: b, after: a });
    else if (a > b) regressed.push({ path, before: b, after: a });
  }
  const diff: BaselineDiff = {
    ...(baseline.label ? { label: baseline.label } : {}),
    generatedAt: baseline.generatedAt,
    tokenAdoption: { before: baseline.metrics.tokenAdoption, after: report.metrics.tokenAdoption, delta: delta(baseline.metrics.tokenAdoption, report.metrics.tokenAdoption) },
    componentAdoption: { before: baseline.metrics.componentAdoption, after: report.metrics.componentAdoption, delta: delta(baseline.metrics.componentAdoption, report.metrics.componentAdoption) },
    hardcoded: { before: baseline.metrics.hardcoded, after: report.metrics.hardcoded, delta: report.metrics.hardcoded - baseline.metrics.hardcoded },
    byCategory,
    improved: improved.sort((x, y) => y.before - y.after - (x.before - x.after)),
    regressed: regressed.sort((x, y) => y.after - y.before - (x.after - x.before)),
    newFiles: [...after.keys()].filter((p) => !before.has(p)).sort(),
    removedFiles: [...before.keys()].filter((p) => !after.has(p)).sort(),
  };
  return { ...report, baseline: diff, history: [...(baseline.history ?? []), historyPoint(baseline)] };
}

const fmtPct = (n: number | null) => (n === null ? 'n/a' : `${n}%`);
const fmtDelta = (n: number | null) => (n === null ? '' : ` (${n > 0 ? '+' : ''}${n} pts)`);
const esc = (s: string) => s.replace(/\|/g, '\\|').replace(/`/g, "'");

/** Short Markdown summary for a PR comment or a CI job summary. */
export function auditMarkdown(r: AuditReport, opts: { topFiles?: number; topFixes?: number } = {}): string {
  const m = r.metrics;
  const b = r.baseline;
  const lines = [
    `## Design system adoption${r.label ? `: ${r.label}` : ''}`,
    '',
    `Audited ${r.target.files} files in \`${r.target.path}\` against ${r.designSystem.tokens} tokens and ${r.designSystem.components} components (${r.designSystem.packages.join(', ') || 'no DS package configured'}).`,
    '',
    '| Metric | Value |',
    '| --- | --- |',
    `| Token adoption | **${fmtPct(m.tokenAdoption)}**${fmtDelta(b?.tokenAdoption.delta ?? null)} |`,
    `| Component adoption | **${fmtPct(m.componentAdoption)}**${fmtDelta(b?.componentAdoption.delta ?? null)} |`,
    `| Token references | ${m.tokenUsages} |`,
    `| Hardcoded values | ${m.hardcoded}${b ? ` (${b.hardcoded.delta > 0 ? '+' : ''}${b.hardcoded.delta})` : ''} |`,
    `| Other theme references | ${m.themeRefs} |`,
    `| DS component instances | ${m.dsComponentInstances} of ${m.uiComponentInstances} |`,
    '',
  ];
  const cats = FINDING_CATEGORIES.filter((c) => r.byCategory[c]);
  if (cats.length) {
    lines.push('### Hardcoded values by category', '', '| Category | Hardcoded | Exact token | Suggested |', '| --- | ---: | ---: | ---: |');
    for (const c of cats) {
      const x = r.byCategory[c]!;
      lines.push(`| ${c} | ${x.hardcoded} | ${x.exact} | ${x.suggested} |`);
    }
    lines.push('');
  }
  const foreign = Object.entries(r.components.foreign).sort((a, b) => b[1].instances - a[1].instances);
  const native = Object.entries(r.components.native).sort((a, b) => b[1] - a[1]);
  if (foreign.length || native.length || r.components.recreated.length) {
    lines.push('### Components', '');
    for (const [lib, x] of foreign) {
      const top = Object.entries(x.components).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([n, k]) => `${n} ${k}`).join(', ');
      lines.push(`- **${lib}**: ${x.instances} instances (${top})`);
    }
    if (native.length) lines.push(`- **Native elements**: ${native.map(([n, k]) => `<${n}> ${k}`).join(', ')}`);
    if (r.components.recreated.length) lines.push(`- **Re-created DS components**: ${r.components.recreated.map((x) => `${x.name} (${x.file}:${x.line})`).join(', ')}`);
    const dsUsed = Object.entries(r.components.ds).sort((a, b) => b[1] - a[1]);
    if (dsUsed.length) lines.push(`- **DS components used**: ${dsUsed.map(([n, k]) => `${n} ${k}`).join(', ')}`);
    lines.push('');
  }
  const files = r.topFiles.slice(0, opts.topFiles ?? 10);
  if (files.length) {
    lines.push('### Top files to migrate', '', '| File | Hardcoded | Non-DS components | Token refs |', '| --- | ---: | ---: | ---: |');
    for (const f of files) lines.push(`| \`${esc(f.path)}\` | ${f.hardcoded} | ${f.otherComponents} | ${f.tokenUsages} |`);
    lines.push('');
  }
  const fixes = r.topFixes.filter((f) => f.suggestion).slice(0, opts.topFixes ?? 10);
  if (fixes.length) {
    lines.push('### Top fixes', '', '| Value | Use | Confidence | Count |', '| --- | --- | --- | ---: |');
    for (const f of fixes) lines.push(`| \`${esc(f.value)}\` (${f.category}) | \`var(${f.suggestion!.cssVar})\` ${esc(f.suggestion!.value)}${f.suggestion!.mode ? ` [${f.suggestion!.mode}]` : ''} | ${f.suggestion!.level} | ${f.count} |`);
    lines.push('');
  }
  if (b) {
    lines.push(`### Progress since ${b.label ?? b.generatedAt}`, '');
    lines.push(`- ${b.improved.length} files improved, ${b.regressed.length} regressed, ${b.newFiles.length} new, ${b.removedFiles.length} removed.`);
    for (const f of b.regressed.slice(0, 5)) lines.push(`- Regressed: \`${esc(f.path)}\` ${f.before} -> ${f.after}`);
    lines.push('');
  }
  return lines.join('\n');
}

export interface CssFixEdit {
  line: number;
  column: number;
  from: string;
  to: string;
  token: string;
}

/** Safe autofix for a CSS/SCSS/Less file: exact token matches become var(--token). Returns the edits and the new text. */
export function planCssFixes(text: string, lang: 'css' | 'scss' | 'less', ds: DesignSystemIndex): { edits: CssFixEdit[]; output: string } {
  const at = lineCol(text);
  const scan = scanCssText(text, lang);
  const edits: (CssFixEdit & { start: number; end: number })[] = [];
  for (const d of scan.decls) {
    const property = d.property.toLowerCase();
    // A shadow is one value; other categories replace the literal inside the value.
    for (const h of d.scan.hits as ValueHit[]) {
      const s = ds.suggest(h.category, h.text, property);
      if (!isSafeFix(h, s)) continue;
      const start = d.valueStart + h.index;
      edits.push({ ...at(start), start, end: start + h.text.length, from: h.text, to: `var(${s!.cssVar})`, token: s!.token });
    }
  }
  let output = text;
  for (const e of [...edits].sort((a, b) => b.start - a.start)) output = output.slice(0, e.start) + e.to + output.slice(e.end);
  return { edits: edits.map(({ start: _s, end: _e, ...e }) => e), output };
}
