// Branch name, commit message, changeset and a reviewer-friendly PR body for a token change.

import { modeDisplayName } from '../shared/messages';
import type { AcceptedChange } from './compose';
import { resolve } from './resolver';
import type { TokenSet } from './token-set';
import { type LogicalToken, PRIMITIVE_MODE } from './types';
import type { ProposalValidation } from './validators';
import { formatValue, isAlias, valuesEqual } from './values';
import { type ContrastResult, pairKey } from './wcag';

export const RISK_TIER = 'Tier 3: token change, needs design + tech approval';

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
  const r = resolve(set.byPath, t.path, mode);
  const resolved = r.value === undefined ? 'unresolved' : formatValue(t.type, r.value);
  return `${formatValue(t.type, v)} (${resolved})`;
};

const cell = (s: string) => s.replace(/\|/g, '\\|').replace(/\n/g, ' ') || ' ';
const code = (s: string) => (s ? `\`${s}\`` : '');

function valueCell(head: TokenSet, proposed: TokenSet, c: AcceptedChange, mode: string): string {
  const t = c.target ?? c.current!;
  if (t.tier === 'primitive' && mode !== PRIMITIVE_MODE) return 'same in all themes';
  const before = describe(head, c.current, mode);
  const after = describe(proposed, c.target, mode);
  if (c.current && c.target && valuesEqual(t.type, c.current.values[mode], c.target.values[mode]) && before === after) return before ? `${code(before)} (unchanged)` : ' ';
  return `${before ? code(before) : 'none'} -> ${after ? code(after) : 'removed'}`;
}

function contrastCell(path: string, before: ContrastResult[], after: ContrastResult[]): string {
  const b = new Map(before.map((r) => [pairKey(r), r]));
  const parts: string[] = [];
  for (const r of after) {
    if (r.pair.foreground !== path && r.pair.background !== path) continue;
    const prev = b.get(pairKey(r));
    const other = r.pair.foreground === path ? r.pair.background : r.pair.foreground;
    const fmt = (x: ContrastResult | undefined) => (x?.ratio !== undefined ? `${x.ratio}` : 'n/a');
    parts.push(`${modeDisplayName(r.mode)} vs ${other}: ${fmt(prev)} -> ${fmt(r)} ${r.level ?? ''}`.trim());
  }
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
  figmaFileName: string;
  title: string;
  notes: string;
  /** Upstream changes kept from main (informational). */
  upstreamPaths: string[];
  /** Conflicts the designer resolved, with the side picked. */
  resolvedConflicts: { path: string; choice: 'figma' | 'main' }[];
}

export function composePrBody(input: PrInput): string {
  const { changes, head, proposed, validation } = input;
  const modes = head.layout.themes.map((t) => t.mode);
  const lines: string[] = [];
  lines.push('## What changed and why', '');
  lines.push(input.notes.trim() || `Token edits made in Figma (file "${input.figmaFileName}") and exported with DS Bridge.`);
  lines.push('', `Opened from the DS Bridge Figma plugin. Figma is the editing surface; this PR is the change. Nothing is merged until it is reviewed.`);
  lines.push('');
  lines.push('## Risk tier', '', `- [x] ${RISK_TIER}`, '');
  lines.push('## Changes', '');
  const header = ['Token', 'Change', ...modes.map((m) => `${modeDisplayName(m)} (old -> new)`), 'Contrast (before -> after)'];
  lines.push(`| ${header.join(' | ')} |`, `| ${header.map(() => '---').join(' | ')} |`);
  for (const c of changes) {
    const t = (c.target ?? c.current)!;
    const kind = changeKind(c);
    const name = kind === 'renamed' ? `${code(c.current!.path)} -> ${code(c.target!.path)}` : code(t.path);
    const valueModes = t.tier === 'primitive' ? modes.map((m, i) => (i === 0 ? PRIMITIVE_MODE : m)) : modes;
    const values = valueModes.map((m) => cell(valueCell(head, proposed, c, m)));
    const extras: string[] = [];
    if (c.current && c.target && (c.current.description ?? '') !== (c.target.description ?? '')) extras.push('description');
    lines.push(`| ${name} | ${kind}${extras.length ? ` (+${extras.join(', ')})` : ''} | ${values.join(' | ')} | ${contrastCell(t.path, validation.contrastBefore, validation.contrastAfter)} |`);
  }
  lines.push('');

  const before = new Map(validation.contrastBefore.map((r) => [pairKey(r), r]));
  const impacted = validation.contrastAfter.filter((r) => before.get(pairKey(r))?.ratio !== r.ratio);
  if (impacted.length) {
    lines.push('### Contrast impact', '', '| Pair | Theme | Before | After | WCAG |', '| --- | --- | --- | --- | --- |');
    for (const r of impacted) {
      const b = before.get(pairKey(r));
      lines.push(
        `| ${code(r.pair.foreground)} on ${code(r.pair.background)} | ${modeDisplayName(r.mode)} | ${b?.ratio ?? 'n/a'} | ${r.ratio ?? 'n/a'} | ${r.level ?? 'n/a'} |`,
      );
    }
    lines.push('');
  }

  if (input.resolvedConflicts.length) {
    lines.push('### Conflicts resolved in Figma', '');
    for (const c of input.resolvedConflicts) lines.push(`- ${code(c.path)}: kept the ${c.choice === 'figma' ? 'Figma' : 'main'} version`);
    lines.push('');
  }
  if (input.upstreamPaths.length) {
    lines.push(`### Kept from main`, '', `${input.upstreamPaths.length} token(s) changed on main since this Figma file was last pulled; this PR leaves them as they are on main.`, '');
  }
  if (validation.warnings.length) {
    lines.push('### Warnings (not introduced by this change)', '');
    for (const w of validation.warnings) lines.push(`- ${w.message}`);
    lines.push('');
  }

  lines.push('## Guardrail checklist', '');
  const ok = validation.blocking.length === 0;
  lines.push(`- [${ok ? 'x' : ' '}] Checked by DS Bridge: semantic tokens alias primitives, no raw values in semantic tokens`);
  lines.push(`- [${ok ? 'x' : ' '}] Checked by DS Bridge: no broken references or alias cycles, no "ALL_SCOPES" variables`);
  lines.push(`- [${ok ? 'x' : ' '}] Checked by DS Bridge: declared text pairs meet WCAG AA (4.5:1) in every theme`);
  lines.push('- [ ] CI green: token build, typecheck, Stylelint, Storybook build, changeset present');
  lines.push('- [ ] Design review: Storybook checked in light and dark, Accessibility panel clean');
  lines.push('- [ ] Tech review: names, semver bump, no consumer breakage');
  lines.push('- [ ] Design owner and tech owner approved (CODEOWNERS)');
  lines.push('');
  lines.push('## Authored by', '', '- [x] Human designer in Figma, via the DS Bridge plugin (no AI involved in the values)', '');
  lines.push('<details><summary>Sync details</summary>', '');
  lines.push(`- Base (last pull): ${input.baseSha ? code(input.baseSha.slice(0, 7)) : 'none (first sync)'}`);
  lines.push(`- ${input.baseBranch} at export: ${code(input.headSha.slice(0, 7))}`);
  lines.push(`- Figma file: ${input.figmaFileName}`);
  lines.push('', '</details>', '');
  return lines.join('\n');
}

/** Semver bump per .changeset/README.md: removals and renames are breaking, the rest is minor. */
export function changesetBump(changes: AcceptedChange[]): 'minor' | 'major' {
  return changes.some((c) => ['removed', 'renamed'].includes(changeKind(c))) ? 'major' : 'minor';
}

export function composeChangeset(changes: AcceptedChange[], title: string, branch: string): { path: string; content: string } {
  const bump = changesetBump(changes);
  const name = branch.replace(/^tokens\//, 'ds-bridge-').replace(/[^a-z0-9-]/gi, '-');
  const list = changes
    .slice(0, 20)
    .map((c) => `- ${changeKind(c)} \`${(c.target ?? c.current)!.path}\``)
    .join('\n');
  const more = changes.length > 20 ? `\n- and ${changes.length - 20} more` : '';
  return {
    path: `.changeset/${name}.md`,
    content: `---\n"@demo-ds/tokens": ${bump}\n---\n\n${title} (from Figma via DS Bridge).\n\n${list}${more}\n`,
  };
}

export function commitMessage(title: string, changes: AcceptedChange[]): string {
  const body = changes.map((c) => `- ${changeKind(c)} ${(c.target ?? c.current)!.path}`).join('\n');
  return `tokens: ${title.replace(/^tokens:\s*/i, '')}\n\n${body}\n\nExported from Figma with DS Bridge.`;
}
