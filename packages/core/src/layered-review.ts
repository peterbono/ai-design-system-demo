// Contrast, designer-readable diff, downstream impact and the pull request body for changes to a layered
// token set (the CLI and the MCP server). Risk tier and semver bump come from risk.ts, the same rules
// the Figma plugin and the docs site use.

import { type Combo, type LayeredDef, type LayeredTokenSet, comboKey } from './layered';
import { RISK_LABELS, type RiskResult, type SemverBump, type TokenChangeSummary, classifyRisk } from './risk';
import type { BridgeConfig } from './config';
import { rgbaToHex } from './values';
import { type ContrastPair, contrastRatio, renderedColor } from './wcag';

// --- contrast ---------------------------------------------------------------------------------------------

export interface LayeredContrastResult {
  fg: string;
  bg: string;
  min: number;
  /** Mode combination, e.g. "brand=ocean,theme=dark,density=comfortable". */
  modes: string;
  ratio: number | null;
  pass: boolean;
  fgValue?: string;
  bgValue?: string;
  note?: string;
}

export interface ContrastDelta {
  fg: string;
  bg: string;
  min: number;
  modes: string;
  before: number | null;
  after: number | null;
  passBefore: boolean;
  passAfter: boolean;
}

export function checkLayeredPair(set: LayeredTokenSet, pair: ContrastPair, combo: Combo): LayeredContrastResult {
  const base = { fg: pair.foreground, bg: pair.background, min: pair.min, modes: comboKey(combo) };
  const f = set.resolve(pair.foreground, combo);
  const b = set.resolve(pair.background, combo);
  if (f.error || b.error) return { ...base, ratio: null, pass: false, note: f.error ?? b.error! };
  const fc = renderedColor(f.value);
  const bc = renderedColor(b.value);
  if (!fc || !bc) return { ...base, ratio: null, pass: false, note: 'not a color Bridge can measure (needs srgb or hex)' };
  if (bc.a < 1) return { ...base, ratio: null, pass: false, note: 'background is translucent: contrast depends on what is behind it' };
  const ratio = Math.round(contrastRatio(fc, bc) * 100) / 100;
  return { ...base, ratio, pass: ratio >= pair.min, fgValue: rgbaToHex(fc), bgValue: rgbaToHex(bc), ...(fc.a < 1 ? { note: 'foreground alpha composited over background' } : {}) };
}

/** Every pair in every combination of `modes` (config contrast.modes, else all modes). */
export function runLayeredContrast(set: LayeredTokenSet, pairs: ContrastPair[], modes?: string[]): LayeredContrastResult[] {
  const combos = set.combos(modes ?? set.config.contrast?.modes);
  return combos.flatMap((c) => pairs.map((p) => checkLayeredPair(set, p, c)));
}

/** Pairs whose ratio moved between two runs, plus the ones that fail after. */
export function contrastDelta(before: LayeredContrastResult[], after: LayeredContrastResult[]): ContrastDelta[] {
  const key = (r: LayeredContrastResult) => `${r.fg}|${r.bg}|${r.modes}`;
  const prev = new Map(before.map((r) => [key(r), r]));
  return after
    .map((a) => {
      const b = prev.get(key(a));
      return { fg: a.fg, bg: a.bg, min: a.min, modes: a.modes, before: b?.ratio ?? null, after: a.ratio, passBefore: b?.pass ?? true, passAfter: a.pass };
    })
    .filter((d) => d.before !== d.after || !d.passAfter);
}

// --- diff -------------------------------------------------------------------------------------------------

export interface LayeredChange {
  kind: 'added' | 'removed' | 'changed' | 'renamed';
  path: string;
  /** Old path, for renames. */
  from?: string;
  file: string;
  tier?: string;
  type?: string;
  fields: ('value' | 'type' | 'description' | 'extensions')[];
  before?: unknown;
  after?: unknown;
  /** Resolved CSS value in the file's own mode (dark file -> dark theme). */
  beforeCss?: string;
  afterCss?: string;
  descriptionBefore?: string;
  descriptionAfter?: string;
}

export interface ImpactEntry {
  path: string;
  modes: string[];
  before: string;
  after: string;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Token changes per file between two sets. A removal plus an addition with the same value in the same file is a rename. */
export function diffLayered(before: LayeredTokenSet, after: LayeredTokenSet): LayeredChange[] {
  const key = (d: LayeredDef) => `${d.file}\u0000${d.path}`;
  const b = new Map(before.defs.map((d) => [key(d), d]));
  const a = new Map(after.defs.map((d) => [key(d), d]));
  const css = (set: LayeredTokenSet, d: LayeredDef) => set.resolve(d.path, set.comboForFile(d.file)).css;
  const tierOf = (set: LayeredTokenSet, f: string) => {
    const t = set.tierOfFile(f);
    return t ? { tier: t } : {};
  };
  const changes: LayeredChange[] = [];
  const removed: LayeredDef[] = [];
  const added: LayeredDef[] = [];
  for (const [k, d] of b) {
    const n = a.get(k);
    if (!n) {
      removed.push(d);
      continue;
    }
    const fields: LayeredChange['fields'] = [];
    if (!same(d.value, n.value)) fields.push('value');
    if (d.type !== n.type) fields.push('type');
    if (d.description !== n.description) fields.push('description');
    if (!same(d.extensions, n.extensions)) fields.push('extensions');
    if (!fields.length) continue;
    changes.push({
      kind: 'changed',
      path: d.path,
      file: d.file,
      ...tierOf(after, d.file),
      ...(n.type ? { type: n.type } : {}),
      fields,
      before: d.value,
      after: n.value,
      beforeCss: css(before, d),
      afterCss: css(after, n),
      ...(d.description !== n.description ? { descriptionBefore: d.description ?? '', descriptionAfter: n.description ?? '' } : {}),
    });
  }
  for (const [k, d] of a) if (!b.has(k)) added.push(d);
  for (const r of [...removed]) {
    const i = added.findIndex((x) => x.file === r.file && same(x.value, r.value) && x.type === r.type);
    if (i < 0) continue;
    const n = added.splice(i, 1)[0]!;
    removed.splice(removed.indexOf(r), 1);
    changes.push({ kind: 'renamed', path: n.path, from: r.path, file: n.file, ...(n.type ? { type: n.type } : {}), fields: [], before: r.value, after: n.value, afterCss: css(after, n), ...tierOf(after, n.file) });
  }
  for (const d of removed) changes.push({ kind: 'removed', path: d.path, file: d.file, ...(d.type ? { type: d.type } : {}), fields: [], before: d.value, beforeCss: css(before, d), ...(d.description ? { descriptionBefore: d.description } : {}), ...tierOf(before, d.file) });
  for (const d of added) changes.push({ kind: 'added', path: d.path, file: d.file, ...(d.type ? { type: d.type } : {}), fields: [], after: d.value, afterCss: css(after, d), ...(d.description ? { descriptionAfter: d.description } : {}), ...tierOf(after, d.file) });
  return changes.sort((x, y) => x.path.localeCompare(y.path) || x.file.localeCompare(y.file));
}

/** Tokens whose resolved value moved in some mode although they were not edited (they alias an edited token). */
export function layeredImpact(before: LayeredTokenSet, after: LayeredTokenSet, direct: LayeredChange[], limit = 60): { total: number; entries: ImpactEntry[] } {
  const skip = new Set(direct.map((c) => c.path));
  const byPath = new Map<string, ImpactEntry>();
  for (const combo of after.combos()) {
    const paths = new Set([...before.view(combo).keys(), ...after.view(combo).keys()]);
    for (const p of paths) {
      if (skip.has(p)) continue;
      const x = before.resolve(p, combo).css;
      const y = after.resolve(p, combo).css;
      if (x === y) continue;
      const e = byPath.get(p);
      if (e) e.modes.push(comboKey(combo));
      else byPath.set(p, { path: p, modes: [comboKey(combo)], before: x, after: y });
    }
  }
  const all = [...byPath.values()].sort((a, b) => a.path.localeCompare(b.path));
  return { total: all.length, entries: all.slice(0, limit) };
}

// --- tier (shared classifier) -----------------------------------------------------------------------------

/** Summary the shared classifier understands. Extensions-only changes count as a change (they can carry scopes). */
export const toChangeSummary = (c: LayeredChange): TokenChangeSummary => ({
  kind: c.kind,
  path: c.path,
  ...(c.kind === 'changed' ? { descriptionOnly: c.fields.length > 0 && c.fields.every((f) => f === 'description') } : {}),
});

export interface ChangeTier {
  tier: 1 | 2 | 3;
  bump: SemverBump;
  reasons: string[];
  label: string;
}

/** classifyRisk over layered changes plus the other files of a change. */
export function classifyLayered(changes: LayeredChange[], otherFiles: string[] = [], config?: BridgeConfig): ChangeTier {
  const r: RiskResult = classifyRisk({ tokenChanges: changes.map(toChangeSummary), files: otherFiles.map((path) => ({ path })), config });
  return { tier: r.tier, bump: r.bump ?? 'patch', reasons: r.reasons.length ? r.reasons : ['No token or guardrail change'], label: r.label };
}

// --- tables and body --------------------------------------------------------------------------------------

const short = (v: unknown) => {
  if (v === undefined) return '';
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  return s.length > 60 ? `${s.slice(0, 57)}...` : s;
};
const cell = (s: string) => s.replace(/\|/g, '\\|').replace(/\n/g, ' ');
const swatch = (css?: string) => (css ? `\`${cell(css)}\`` : '');
const aliasNote = (v: unknown) => (typeof v === 'string' && v.startsWith('{') ? ` (${cell(short(v))})` : '');

export function changeTable(changes: LayeredChange[]): string {
  if (!changes.length) return '_No token changes._';
  const rows = changes.map((c) => {
    const what = c.kind === 'renamed' ? `renamed from \`${c.from}\`` : c.kind === 'changed' ? c.fields.join(', ') : c.kind;
    const before = c.kind === 'added' || c.kind === 'renamed' ? '' : `${swatch(c.beforeCss)}${aliasNote(c.before)}`;
    const after = c.kind === 'removed' ? '' : `${swatch(c.afterCss)}${aliasNote(c.after)}`;
    return `| \`${c.path}\` | ${what} | ${before} | ${after} | ${c.file} |`;
  });
  return ['| Token | Change | Before | After | File |', '| --- | --- | --- | --- | --- |', ...rows].join('\n');
}

export function contrastDeltaTable(deltas: ContrastDelta[], limit = 40): string {
  if (!deltas.length) return '_No contrast pair moved._';
  const rows = deltas.slice(0, limit).map((d) => `| \`${d.fg}\` on \`${d.bg}\` | ${d.modes} | ${d.before ?? 'n/a'} | ${d.after ?? 'n/a'} | ${d.min} | ${d.passAfter ? 'pass' : '**fail**'} |`);
  const more = deltas.length > limit ? `\n\n_${deltas.length - limit} more pair(s) not shown._` : '';
  return ['| Pair | Mode | Before | After | Min | Result |', '| --- | --- | --- | --- | --- | --- |', ...rows].join('\n') + more;
}

export interface ProposalBodyInput {
  summary: string;
  changes: LayeredChange[];
  contrast: ContrastDelta[];
  impact: { total: number; entries: ImpactEntry[] };
  tier: ChangeTier;
  validationErrors: number;
  /** "Bridge MCP", "the bridge CLI". */
  tool?: string;
  author?: string;
}

export function composeProposalBody(args: ProposalBodyInput): string {
  const t = args.tier.tier;
  const box = (n: 1 | 2 | 3) => `- ${n === t ? '[x]' : '[ ]'} ${RISK_LABELS[n]}`;
  const impactList = args.impact.entries.slice(0, 15).map((e) => `- \`${e.path}\`: ${swatch(e.before)} -> ${swatch(e.after)} (${e.modes.length} mode${e.modes.length > 1 ? 's' : ''})`);
  return [
    '## What changed and why',
    '',
    args.summary.trim(),
    '',
    `Proposed through ${args.tool ?? 'Bridge MCP'}${args.author ? ` by ${args.author}` : ''}. Agent-authored: a human design owner and tech owner review and merge.`,
    '',
    '## Risk tier',
    '',
    box(1),
    box(2),
    box(3),
    '',
    ...args.tier.reasons.map((r) => `- ${r}`),
    `- Semver bump: \`${args.tier.bump}\``,
    '',
    '## Token changes',
    '',
    changeTable(args.changes),
    '',
    '## Contrast before and after',
    '',
    contrastDeltaTable(args.contrast),
    '',
    '## Downstream impact',
    '',
    args.impact.total ? [`${args.impact.total} token(s) resolve to a new value because they alias an edited token.`, '', ...impactList, args.impact.total > 15 ? `- and ${args.impact.total - 15} more` : ''].filter(Boolean).join('\n') : '_No other token changes value._',
    '',
    '## Checks',
    '',
    `- Token validation: ${args.validationErrors ? `**${args.validationErrors} error(s)**` : 'no errors'} (DTCG schema, aliases, light and dark parity)`,
    `- Contrast gate: ${args.contrast.some((d) => !d.passAfter) ? '**failing pairs, see table**' : 'all pairs pass'}`,
    '',
    '## Authored by',
    '',
    '- [ ] Human',
    '- [x] AI agent (Claude), reviewed by a human before merge',
    '',
    '## Design review checklist',
    '',
    '- [ ] Checked in light and dark themes and in every brand',
    '- [ ] Contrast table reviewed, no pair loosened',
    '- [ ] Changeset bump matches the tier',
    '',
  ].join('\n');
}
