// Guardrails checked before a PR can be opened. They mirror the repo rules (AGENTS.md,
// docs/GOVERNANCE.md) so designers get the answer in Figma instead of a red CI run later.

import { modeDisplayName } from '../shared/messages';
import { findReferenceProblems } from './resolver';
import type { TokenSet } from './token-set';
import { PRIMITIVE_MODE } from './types';
import { aliasTarget, isAlias } from './values';
import { AA_MIN, type ContrastPair, type ContrastResult, evaluatePairs } from './wcag';

export type IssueCode =
  | 'file-problem'
  | 'semantic-raw-value'
  | 'semantic-alias-not-primitive'
  | 'broken-reference'
  | 'alias-cycle'
  | 'all-scopes'
  | 'missing-theme'
  | 'contrast'
  | 'contrast-unresolved'
  | 'type-change';

export interface Issue {
  code: IssueCode;
  severity: 'error' | 'warning';
  message: string;
  path?: string | undefined;
  mode?: string | undefined;
}

const issueKey = (i: Issue) => `${i.code}|${i.path ?? ''}|${i.mode ?? ''}|${i.code === 'file-problem' ? i.message : ''}`;
const themeName = (mode: string) => (mode === PRIMITIVE_MODE ? 'all themes' : modeDisplayName(mode));

/** All rule violations in a token set. */
export function validateSet(set: TokenSet, pairs: ContrastPair[]): { issues: Issue[]; contrast: ContrastResult[] } {
  const issues: Issue[] = [];
  const modes = set.layout.themes.map((t) => t.mode);

  for (const p of set.problems) issues.push({ code: 'file-problem', severity: 'error', message: p });

  for (const t of set.tokens.values()) {
    if (t.scopes?.includes('ALL_SCOPES')) {
      issues.push({
        code: 'all-scopes',
        severity: 'error',
        path: t.path,
        message: `${t.path} is offered in every Figma picker ("All supported properties"). Pick the specific properties it is meant for in the variable's scoping settings.`,
      });
    }
    if (t.tier !== 'semantic') continue;
    for (const mode of modes) {
      const v = t.values[mode];
      if (v === undefined) {
        issues.push({
          code: 'missing-theme',
          severity: 'error',
          path: t.path,
          mode,
          message: `${t.path} has no value in ${themeName(mode)}. Semantic tokens must exist in every theme.`,
        });
        continue;
      }
      if (!isAlias(v)) {
        issues.push({
          code: 'semantic-raw-value',
          severity: 'error',
          path: t.path,
          mode,
          message: `${t.path} uses a raw value in ${themeName(mode)}. Semantic tokens must point to a primitive (pick a variable from Primitives instead of typing a value).`,
        });
        continue;
      }
      const target = set.byPath.get(aliasTarget(v));
      if (target && target.tier !== 'primitive') {
        issues.push({
          code: 'semantic-alias-not-primitive',
          severity: 'error',
          path: t.path,
          mode,
          message: `${t.path} points to ${target.path}, another semantic token, in ${themeName(mode)}. Semantic tokens must point directly to a primitive.`,
        });
      }
    }
  }

  for (const p of findReferenceProblems(set.byPath, modes)) {
    issues.push(
      p.kind === 'broken'
        ? {
            code: 'broken-reference',
            severity: 'error',
            path: p.path,
            mode: p.mode,
            message: `${p.path} points to ${p.target}, which does not exist (${themeName(p.mode)}).`,
          }
        : {
            code: 'alias-cycle',
            severity: 'error',
            path: p.path,
            mode: p.mode,
            message: `${p.path} is part of a loop of references: ${p.chain.join(' -> ')} (${themeName(p.mode)}).`,
          },
    );
  }

  const contrast = evaluatePairs(set.byPath, pairs, modes);
  for (const r of contrast) {
    const path = `${r.pair.foreground} on ${r.pair.background}`;
    if (r.error) {
      issues.push({ code: 'contrast-unresolved', severity: 'warning', path, mode: r.mode, message: `Contrast of ${path} in ${themeName(r.mode)} cannot be checked: ${r.error}.` });
    } else if (r.level === 'fail') {
      const min = AA_MIN[r.pair.kind];
      issues.push({
        code: 'contrast',
        severity: 'error',
        path,
        mode: r.mode,
        message: `${r.pair.foreground} on ${r.pair.background} is ${r.ratio}:1 in ${themeName(r.mode)}; WCAG AA needs ${min}:1 for ${r.pair.kind === 'ui' ? 'interface elements' : 'text'}.`,
      });
    }
  }
  return { issues, contrast };
}

export interface TypeChange {
  path: string;
  from: string;
  to: string;
}

export interface ProposalValidation {
  /** Problems this change introduces. They disable the PR button. */
  blocking: Issue[];
  /** Problems that already exist on main, or soft checks. Shown, not blocking. */
  warnings: Issue[];
  contrastBefore: ContrastResult[];
  contrastAfter: ContrastResult[];
}

/**
 * Validate the files a PR would produce. Errors already present on main are reported as warnings
 * so an unrelated, pre-existing problem does not block a designer's change; everything the change
 * introduces blocks.
 */
export function validateProposal(proposed: TokenSet, head: TokenSet, pairs: ContrastPair[], typeChanges: TypeChange[] = []): ProposalValidation {
  const after = validateSet(proposed, pairs);
  const before = validateSet(head, pairs);
  const existing = new Set(before.issues.map(issueKey));
  const blocking: Issue[] = [];
  const warnings: Issue[] = [];
  for (const i of after.issues) {
    if (i.severity === 'warning') warnings.push(i);
    else if (existing.has(issueKey(i))) warnings.push({ ...i, severity: 'warning', message: `Already on main: ${i.message}` });
    else blocking.push(i);
  }
  for (const c of typeChanges) {
    blocking.push({
      code: 'type-change',
      severity: 'error',
      path: c.path,
      message: `${c.path} changed type from ${c.from} to ${c.to}. Type changes are not allowed; create a new token instead.`,
    });
  }
  return { blocking, warnings, contrastBefore: before.contrast, contrastAfter: after.contrast };
}
