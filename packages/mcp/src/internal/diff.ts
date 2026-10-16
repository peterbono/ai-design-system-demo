// Designer-readable token diff, downstream impact, risk tier, PR body and changeset.
// TO BE REPLACED by diff, tier classifier, PR body builder and changeset writer in @bridge/core (see ../core-adapter.ts).
import { comboKey, type Combo, type TokenDef, type TokenSet } from './dtcg.js';
import type { ContrastDelta } from './contrast.js';

export interface TokenChange {
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

/** First combo whose layers include `file`, preferring the default. */
export function comboForFile(set: TokenSet, file: string): Combo {
  const all = [set.defaultCombo, ...set.combos()];
  return all.find((c) => set.layerFiles(c).files.includes(file)) ?? set.defaultCombo;
}

export function diffTokenSets(before: TokenSet, after: TokenSet): TokenChange[] {
  const key = (d: TokenDef) => `${d.file}\u0000${d.path}`;
  const b = new Map(before.defs.map((d) => [key(d), d]));
  const a = new Map(after.defs.map((d) => [key(d), d]));
  const css = (set: TokenSet, d: TokenDef) => set.resolve(d.path, comboForFile(set, d.file)).css;
  const changes: TokenChange[] = [];
  const removed: TokenDef[] = [];
  const added: TokenDef[] = [];
  for (const [k, d] of b) {
    const n = a.get(k);
    if (!n) {
      removed.push(d);
      continue;
    }
    const fields: TokenChange['fields'] = [];
    if (!same(d.value, n.value)) fields.push('value');
    if (d.type !== n.type) fields.push('type');
    if (d.description !== n.description) fields.push('description');
    if (!same(d.extensions, n.extensions)) fields.push('extensions');
    if (!fields.length) continue;
    changes.push({
      kind: 'changed',
      path: d.path,
      file: d.file,
      ...(after.tierOfFile(d.file) ? { tier: after.tierOfFile(d.file)! } : {}),
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
  // A removal and an addition with the same value in the same file is a rename.
  for (const r of [...removed]) {
    const i = added.findIndex((x) => x.file === r.file && same(x.value, r.value) && x.type === r.type);
    if (i < 0) continue;
    const n = added.splice(i, 1)[0]!;
    removed.splice(removed.indexOf(r), 1);
    changes.push({ kind: 'renamed', path: n.path, from: r.path, file: n.file, ...(n.type ? { type: n.type } : {}), fields: [], before: r.value, after: n.value, afterCss: css(after, n), ...(after.tierOfFile(n.file) ? { tier: after.tierOfFile(n.file)! } : {}) });
  }
  for (const d of removed) changes.push({ kind: 'removed', path: d.path, file: d.file, ...(d.type ? { type: d.type } : {}), fields: [], before: d.value, beforeCss: css(before, d), ...(before.tierOfFile(d.file) ? { tier: before.tierOfFile(d.file)! } : {}) });
  for (const d of added) changes.push({ kind: 'added', path: d.path, file: d.file, ...(d.type ? { type: d.type } : {}), fields: [], after: d.value, afterCss: css(after, d), ...(d.description ? { descriptionAfter: d.description } : {}), ...(after.tierOfFile(d.file) ? { tier: after.tierOfFile(d.file)! } : {}) });
  return changes.sort((x, y) => x.path.localeCompare(y.path) || x.file.localeCompare(y.file));
}

/** Tokens whose resolved value moved in some mode although they were not edited (they alias an edited token). */
export function impact(before: TokenSet, after: TokenSet, direct: TokenChange[], limit = 60): { total: number; entries: ImpactEntry[] } {
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

// --- tiers ------------------------------------------------------------------------------------------------

export interface TierResult {
  tier: 1 | 2 | 3;
  bump: 'patch' | 'minor' | 'major';
  reasons: string[];
}

const BUMPS = ['patch', 'minor', 'major'] as const;

/** Risk tier from docs/GOVERNANCE.md: any token added, changed, renamed or removed is Tier 3. */
export function classify(changes: TokenChange[], otherFiles: string[] = [], guardrails: string[] = [], componentsDir?: string): TierResult {
  let tier: 1 | 2 | 3 = 1;
  let bump = 0;
  const reasons: string[] = [];
  const raise = (t: 1 | 2 | 3, b: number, why: string) => {
    tier = Math.max(tier, t) as 1 | 2 | 3;
    bump = Math.max(bump, b);
    reasons.push(why);
  };
  const count = (k: TokenChange['kind']) => changes.filter((c) => c.kind === k).length;
  if (count('removed')) raise(3, 2, `${count('removed')} token(s) removed: breaking for anyone using them (major)`);
  if (count('renamed')) raise(3, 2, `${count('renamed')} token(s) renamed: the old CSS variables disappear (major)`);
  if (count('added')) raise(3, 1, `${count('added')} token(s) added (minor)`);
  const valueChanges = changes.filter((c) => c.kind === 'changed' && c.fields.some((f) => f !== 'description'));
  if (valueChanges.length) raise(3, 1, `${valueChanges.length} token value(s) changed: visible change (minor)`);
  const docOnly = changes.filter((c) => c.kind === 'changed' && c.fields.every((f) => f === 'description'));
  if (docOnly.length) raise(1, 0, `${docOnly.length} description(s) changed only (patch)`);
  for (const f of otherFiles) {
    if (guardrails.some((g) => (g.endsWith('/') ? f.startsWith(g) : f === g))) raise(3, 1, `${f} is a guardrail file`);
    else if (componentsDir && f.startsWith(`${componentsDir}/`)) raise(2, 1, `${f}: component change (Tier 2, draft until design review)`);
  }
  if (!reasons.length) reasons.push('No token or guardrail change');
  return { tier, bump: BUMPS[bump]!, reasons };
}

// --- PR body and changeset --------------------------------------------------------------------------------

const short = (v: unknown) => {
  if (v === undefined) return '';
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  return s.length > 60 ? `${s.slice(0, 57)}...` : s;
};
const cell = (s: string) => s.replace(/\|/g, '\\|').replace(/\n/g, ' ');
const swatch = (css?: string) => (css && /^#[0-9a-f]{6}$/i.test(css) ? `\`${css}\`` : css ? `\`${cell(css)}\`` : '');

export function tokenTable(changes: TokenChange[]): string {
  if (!changes.length) return '_No token changes._';
  const rows = changes.map((c) => {
    const what = c.kind === 'renamed' ? `renamed from \`${c.from}\`` : c.kind === 'changed' ? c.fields.join(', ') : c.kind;
    const before = c.kind === 'added' ? '' : c.kind === 'renamed' ? '' : `${swatch(c.beforeCss)}${typeof c.before === 'string' && c.before.startsWith('{') ? ` (${cell(short(c.before))})` : ''}`;
    const after = c.kind === 'removed' ? '' : `${swatch(c.afterCss)}${typeof c.after === 'string' && c.after.startsWith('{') ? ` (${cell(short(c.after))})` : ''}`;
    return `| \`${c.path}\` | ${what} | ${before} | ${after} | ${c.file} |`;
  });
  return ['| Token | Change | Before | After | File |', '| --- | --- | --- | --- | --- |', ...rows].join('\n');
}

export function contrastTable(deltas: ContrastDelta[], limit = 40): string {
  if (!deltas.length) return '_No contrast pair moved._';
  const rows = deltas.slice(0, limit).map((d) => `| \`${d.fg}\` on \`${d.bg}\` | ${d.modes} | ${d.before ?? 'n/a'} | ${d.after ?? 'n/a'} | ${d.min} | ${d.passAfter ? 'pass' : '**fail**'} |`);
  const more = deltas.length > limit ? `\n\n_${deltas.length - limit} more pair(s) not shown._` : '';
  return ['| Pair | Mode | Before | After | Min | Result |', '| --- | --- | --- | --- | --- | --- |', ...rows].join('\n') + more;
}

export function buildPrBody(args: { summary: string; changes: TokenChange[]; contrast: ContrastDelta[]; impact: { total: number; entries: ImpactEntry[] }; tier: TierResult; validationErrors: number; author?: string }): string {
  const t = args.tier.tier;
  const box = (n: number) => (n === t ? '[x]' : '[ ]');
  const impactList = args.impact.entries.slice(0, 15).map((e) => `- \`${e.path}\`: ${swatch(e.before)} -> ${swatch(e.after)} (${e.modes.length} mode${e.modes.length > 1 ? 's' : ''})`);
  return [
    '## What changed and why',
    '',
    args.summary.trim(),
    '',
    `Proposed through Bridge MCP${args.author ? ` by ${args.author}` : ''}. Agent-authored: a human design owner and tech owner review and merge.`,
    '',
    '## Risk tier',
    '',
    `- ${box(1)} Tier 1, low: docs, stories, lint or a11y fixes, no visual or API change`,
    `- ${box(2)} Tier 2, medium: new component, variant or prop (additive). Opened as draft until design review`,
    `- ${box(3)} Tier 3, high: token added/changed/removed, breaking API, or guardrail change. Design + tech owner approval required`,
    '',
    ...args.tier.reasons.map((r) => `- ${r}`),
    `- Semver bump: \`${args.tier.bump}\``,
    '',
    '## Token changes',
    '',
    tokenTable(args.changes),
    '',
    '## Contrast before and after',
    '',
    contrastTable(args.contrast),
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

export function buildChangeset(pkg: string, bump: TierResult['bump'], summary: string): string {
  return `---\n${JSON.stringify(pkg)}: ${bump}\n---\n\n${summary.trim()}\n`;
}

export const slugify = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'change';
