// Branch name, commit message and a reviewer-friendly PR body for a token change (changesets: changeset.ts).

import type { AcceptedChange } from './compose';
import { resolve } from './resolver';
import { type TokenSet, contextFor, modesOf } from './token-set';
import { type LogicalToken, SINGLE_MODE, TIER_AXIS, TIER_NAMES, isMultiMode, modeDisplayName } from './types';
import { RISK_LABELS, classifyRisk, figmaPushNextLine, figmaPushTierLabel, summarizeTokenChange } from './risk';
import type { ProposalValidation } from './validators';
import { formatValue, isAlias, valuesEqual } from './values';
import { type ContrastResult, contextLabel, pairKey } from './wcag';

/** Label of the risk tier every token change gets (see risk.ts). */
export const RISK_TIER = RISK_LABELS[3];

export function slugify(text: string, max = 40): string {
  const s = text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  // Cut at a word boundary so branch names do not end in half a word.
  const cut = s.length <= max ? s : s.slice(0, max + 1).replace(/-[^-]*$/, '');
  return cut.replace(/-+$/g, '') || 'update';
}

const pad = (n: number) => String(n).padStart(2, '0');

/** "tokens/<slug>-<yyyymmdd-hhmm>" in UTC. */
export function branchName(slug: string, date: Date): string {
  const stamp = `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}-${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}`;
  return `tokens/${slugify(slug)}-${stamp}`;
}

export type RowKind = 'added' | 'changed' | 'renamed' | 'removed';

export function changeKind(c: AcceptedChange): RowKind {
  if (!c.target) return 'removed';
  if (!c.current) return 'added';
  return c.current.path !== c.target.path ? 'renamed' : 'changed';
}

export function defaultTitle(changes: AcceptedChange[]): string {
  const paths = changes.map((c) => (c.target ?? c.current)!.path);
  const first = paths[0] ?? 'tokens';
  const verb = (() => {
    const kinds = new Set(changes.map(changeKind));
    if (kinds.size === 1) return { added: 'Add', changed: 'Update', renamed: 'Rename', removed: 'Remove' }[[...kinds][0]!];
    return 'Update';
  })();
  return paths.length <= 1 ? `${verb} token ${first}` : `${verb} ${paths.length} tokens (${first} and more)`;
}

const describe = (set: TokenSet, t: LogicalToken | undefined, mode: string): string => {
  if (!t) return '';
  const v = t.values[mode];
  if (v === undefined) return '';
  if (!isAlias(v)) return formatValue(t.type, v);
  const r = resolve(set.byPath, t.path, contextFor(set, t.tier, mode));
  const resolved = r.value === undefined ? 'unresolved' : formatValue(t.type, r.value);
  return `${formatValue(t.type, v)} (${resolved})`;
};

const cell = (s: string) => s.replace(/\|/g, '\\|').replace(/\n/g, ' ') || ' ';
const code = (s: string) => (s ? `\`${s}\`` : '');

function valueText(head: TokenSet, proposed: TokenSet, c: AcceptedChange, mode: string): string {
  const t = c.target ?? c.current!;
  const before = describe(head, c.current, mode);
  const after = describe(proposed, c.target, mode);
  if (c.current && c.target && valuesEqual(t.type, c.current.values[mode], c.target.values[mode]) && before === after) return before ? `${code(before)} (unchanged)` : '';
  return `${before ? code(before) : 'none'} -> ${after ? code(after) : 'removed'}`;
}

/** One line per mode of the token's tier ("Light: a -> b"), or the bare value for single-mode tiers. */
function valuesCell(head: TokenSet, proposed: TokenSet, c: AcceptedChange): string {
  const t = c.target ?? c.current!;
  if (!isMultiMode(t.tier)) return valueText(head, proposed, c, SINGLE_MODE);
  return modesOf(head.layout, t.tier)
    .map((m) => {
      const text = valueText(head, proposed, c, m);
      return text ? `${modeDisplayName(m)}: ${text}` : '';
    })
    .filter(Boolean)
    .join('<br>');
}

/** Modes whose value differs; undefined means every mode (added, removed, renamed or retyped). */
export function changedModes(c: AcceptedChange): Set<string> | undefined {
  if (!c.current || !c.target || c.current.path !== c.target.path || c.current.type !== c.target.type) return undefined;
  const modes = new Set([...Object.keys(c.current.values), ...Object.keys(c.target.values)]);
  return new Set([...modes].filter((m) => !valuesEqual(c.target!.type, c.current!.values[m], c.target!.values[m])));
}

/**
 * Does this contrast result depend on the changed token? True when either color resolves through
 * the token (directly, or indirectly through aliases: a palette role or a primitive that a semantic
 * token points to) in that brand x theme, using a mode that changed. A semantic token a brand
 * overrides for the theme is not used there, so it does not count.
 */
function dependsOn(r: ContrastResult, path: string, tier: LogicalToken['tier'], modes: Set<string> | undefined): boolean {
  const axis = TIER_AXIS[tier];
  if (modes && modes.size === 0) return false; // description or scopes only
  if (modes && axis) {
    const mode = axis === 'brand' ? r.brand : axis === 'theme' ? r.theme : undefined;
    // Density does not change colors; a brand or theme that did not change is not affected.
    if (mode === undefined || !modes.has(mode)) return false;
  }
  return r.steps.some((s) => s.path === path && s.via === 'token');
}

/** Pairs affected by a change, with before and after results matched by brand x theme x pair. */
export function affectedContrast(c: AcceptedChange, before: ContrastResult[], after: ContrastResult[]): { before?: ContrastResult | undefined; after?: ContrastResult | undefined }[] {
  const modes = changedModes(c);
  const keys = new Set<string>();
  if (c.current) for (const r of before) if (dependsOn(r, c.current.path, c.current.tier, modes)) keys.add(pairKey(r));
  if (c.target) for (const r of after) if (dependsOn(r, c.target.path, c.target.tier, modes)) keys.add(pairKey(r));
  const b = new Map(before.map((r) => [pairKey(r), r]));
  const a = new Map(after.map((r) => [pairKey(r), r]));
  return [...keys].map((k) => ({ before: b.get(k), after: a.get(k) }));
}

/** Contrast lines shown per row of the Changes table before pointing to the full impact table. */
export const CONTRAST_CELL_MAX = 12;

function contrastCell(c: AcceptedChange, before: ContrastResult[], after: ContrastResult[]): string {
  const rows = affectedContrast(c, before, after);
  const fmt = (x: ContrastResult | undefined) => (x?.ratio !== undefined ? `${x.ratio}` : 'n/a');
  // Changed ratios first, then the biggest drops, so the cell leads with what a reviewer must look at.
  const delta = (x: (typeof rows)[number]) => (x.after?.ratio ?? 0) - (x.before?.ratio ?? 0);
  rows.sort((x, y) => Number(delta(y) === 0) - Number(delta(x) === 0) || delta(x) - delta(y));
  const parts = rows.slice(0, CONTRAST_CELL_MAX).map((x) => {
    const r = (x.after ?? x.before)!;
    return `${contextLabel(r)}, ${r.pair.foreground} on ${r.pair.background}: ${fmt(x.before)} -> ${fmt(x.after)} ${x.after?.level ?? ''}`.trim();
  });
  if (rows.length > CONTRAST_CELL_MAX) parts.push(`and ${rows.length - CONTRAST_CELL_MAX} more (see Contrast impact)`);
  return parts.join('<br>') || ' ';
}

export interface PrInput {
  changes: AcceptedChange[];
  head: TokenSet;
  proposed: TokenSet;
  validation: ProposalValidation;
  baseBranch: string;
  headSha: string;
  baseSha: string | undefined;
  /** Who opened the PR and where the edits were made. */
  origin: PrOrigin;
  title: string;
  notes: string;
  /** Upstream changes kept from main (informational). */
  upstreamPaths: string[];
  /** Conflicts resolved before opening the PR: "edit" kept the edited side, "main" kept the base branch. */
  resolvedConflicts: { path: string; choice: 'figma' | 'edit' | 'main' }[];
  /**
   * Pushed from the Figma plugin: design-approved (docs/BUILD-REQUESTS.md), so the tier line says what happens next
   * instead of the approvals. Default: true when `origin.surface` is Figma.
   */
  fromFigma?: boolean | undefined;
}

/** Where a token change comes from. The plugin, the CLI and the MCP server each pass their own. */
export interface PrOrigin {
  /** Tool that opened the PR, for example "the DS Bridge Figma plugin". */
  tool: string;
  /** Where the edits were made, for example "Figma". */
  surface: string;
  /** File or session the edits come from, for example the Figma file name. */
  location?: string | undefined;
  /** "Authored by" line, for example "Human designer in Figma, via the DS Bridge plugin (no AI involved in the values)". */
  authoredBy: string;
}

export function composePrBody(input: PrInput): string {
  const { changes, head, proposed, validation } = input;
  const lines: string[] = [];
  lines.push('## What changed and why', '');
  const o = input.origin;
  lines.push(input.notes.trim() || `Token edits made in ${o.surface}${o.location ? ` ("${o.location}")` : ''}, exported with ${o.tool}.`);
  const risk = classifyRisk({ tokenChanges: changes });
  const fromFigma = input.fromFigma ?? /^figma$/i.test(o.surface.trim());
  const kinds = changes.map(summarizeTokenChange);
  lines.push('', `Opened from ${o.tool}. ${o.surface} is the editing surface; this PR is the change. ${fromFigma ? figmaPushNextLine(kinds) : 'Nothing is merged until it is reviewed.'}`);
  lines.push('');
  lines.push('## Risk tier', '', `- [x] ${fromFigma ? figmaPushTierLabel(risk.tier, kinds) : risk.label}`, '');
  lines.push('## Changes', '');
  const header = ['Token', 'Tier', 'Change', 'Value (old -> new)', 'Contrast (before -> after)'];
  lines.push(`| ${header.join(' | ')} |`, `| ${header.map(() => '---').join(' | ')} |`);
  for (const c of changes) {
    const t = (c.target ?? c.current)!;
    const kind = changeKind(c);
    const name = kind === 'renamed' ? `${code(c.current!.path)} -> ${code(c.target!.path)}` : code(t.path);
    const extras: string[] = [];
    if (c.current && c.target && (c.current.description ?? '') !== (c.target.description ?? '')) extras.push('description');
    lines.push(
      `| ${name} | ${TIER_NAMES[t.tier]} | ${kind}${extras.length ? ` (+${extras.join(', ')})` : ''} | ${cell(valuesCell(head, proposed, c))} | ${contrastCell(c, validation.contrastBefore, validation.contrastAfter)} |`,
    );
  }
  lines.push('');

  const before = new Map(validation.contrastBefore.map((r) => [pairKey(r), r]));
  const impacted = validation.contrastAfter.filter((r) => before.get(pairKey(r))?.ratio !== r.ratio);
  if (impacted.length) {
    lines.push('### Contrast impact', '', '| Pair | Brand and theme | Before | After | Minimum | WCAG |', '| --- | --- | --- | --- | --- | --- |');
    for (const r of impacted) {
      const b = before.get(pairKey(r));
      lines.push(
        `| ${code(r.pair.foreground)} on ${code(r.pair.background)} | ${contextLabel(r)} | ${b?.ratio ?? 'n/a'} | ${r.ratio ?? 'n/a'} | ${r.pair.min} | ${r.level ?? 'n/a'} |`,
      );
    }
    lines.push('');
  }

  if (input.resolvedConflicts.length) {
    lines.push(`### Conflicts resolved in ${o.surface}`, '');
    for (const c of input.resolvedConflicts) lines.push(`- ${code(c.path)}: kept the ${c.choice === 'main' ? input.baseBranch : o.surface} version`);
    lines.push('');
  }
  if (input.upstreamPaths.length) {
    lines.push(`### Kept from ${input.baseBranch}`, '', `${input.upstreamPaths.length} token(s) changed on ${input.baseBranch} since the last pull; this PR leaves them as they are on ${input.baseBranch}.`, '');
  }
  if (validation.warnings.length) {
    lines.push('### Warnings (not introduced by this change)', '');
    for (const w of validation.warnings) lines.push(`- ${w.message}`);
    lines.push('');
  }

  lines.push('## Guardrail checklist', '');
  const ok = validation.blocking.length === 0;
  lines.push(`- [${ok ? 'x' : ' '}] Checked by Bridge: tiers alias in order (brand -> primitives, semantic colors -> palette roles, component -> semantic), no raw values where an alias is required`);
  lines.push(`- [${ok ? 'x' : ' '}] Checked by Bridge: no broken references or alias cycles, no "ALL_SCOPES" variables`);
  lines.push(`- [${ok ? 'x' : ' '}] Checked by Bridge: every pair in contrast.checks.json meets its minimum in every brand and theme`);
  lines.push('- [ ] CI green: token build, typecheck, Stylelint, Storybook build, changeset present');
  lines.push('- [ ] Design review: Storybook checked in light and dark, both brands, Accessibility panel clean');
  lines.push('- [ ] Tech review: names, semver bump, no consumer breakage');
  lines.push('- [ ] Design owner and tech owner approved (CODEOWNERS)');
  lines.push('');
  lines.push('## Authored by', '', `- [x] ${o.authoredBy}`, '');
  lines.push('<details><summary>Sync details</summary>', '');
  lines.push(`- Base (last pull): ${input.baseSha ? code(input.baseSha.slice(0, 7)) : 'none (first sync)'}`);
  lines.push(`- ${input.baseBranch} at export: ${code(input.headSha.slice(0, 7))}`);
  if (o.location) lines.push(`- ${o.surface}: ${o.location}`);
  lines.push('', '</details>', '');
  return lines.join('\n');
}

/** Commit message: "tokens: <title>", one line per change, then `footer`. */
export function commitMessage(title: string, changes: AcceptedChange[], footer = 'Exported with Bridge.'): string {
  const body = changes.map((c) => `- ${changeKind(c)} ${(c.target ?? c.current)!.path}`).join('\n');
  return `tokens: ${title.replace(/^tokens:\s*/i, '')}\n\n${body}\n\n${footer}`;
}
