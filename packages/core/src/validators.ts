// Guardrails checked before a PR can be opened. They mirror the repo rules (AGENTS.md,
// docs/ARCHITECTURE.md "Token tiers", docs/GOVERNANCE.md) so designers get the answer in Figma
// instead of a red CI run later.
//
// Tier rules (what each tier may alias):
//   primitive  literal values, or another primitive
//   brand      an alias to a primitive (palette, radius and font roles re-point raw scales)
//   base       a literal or a primitive (motion, layers, icon sizes)
//   semantic   an alias, never a literal. Colors alias a Brand palette role (palette.*); translucent
//              primitives (color.alpha.*) are the only raw colors allowed. Non-color semantic tokens
//              (focus ring width, elevation) may alias a primitive or a brand role.
//   density    an alias to a primitive (space and size scales)
//   component  an alias to a semantic, base, density or brand role token, or a primitive scale step
//              (space, type). Never a raw color ramp or a palette role.
// Brand x theme overrides follow the semantic rule and must override an existing semantic token.

import { findReferenceProblems } from './resolver';
import { type TokenSet, modesOf } from './token-set';
import { type LogicalToken, SINGLE_MODE, TIER_AXIS, TIER_NAMES, type Tier, isMultiMode, modeDisplayName } from './types';
import { aliasTarget, collectRefs, isAlias } from './values';
import { type ContrastPair, type ContrastResult, contextLabel, contrastScope, evaluatePairs } from './wcag';

export type IssueCode =
  | 'file-problem'
  | 'raw-value'
  | 'alias-tier'
  | 'broken-reference'
  | 'alias-cycle'
  | 'all-scopes'
  | 'missing-mode'
  | 'override-orphan'
  | 'override-shadowed'
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
const modeName = (mode: string) => (mode === SINGLE_MODE ? 'all modes' : modeDisplayName(mode));

const isPalette = (t: LogicalToken) => t.tier === 'brand' && t.path.startsWith('palette.');
const isRawColor = (t: LogicalToken) => t.tier === 'primitive' && t.type === 'color';

/** Why `owner` (in `tier`) may not alias `target`, or undefined when the alias is allowed. */
function aliasRule(owner: { tier: Tier; type: string }, target: LogicalToken): string | undefined {
  switch (owner.tier) {
    case 'primitive':
    case 'base':
    case 'brand':
    case 'density':
      return target.tier === 'primitive' ? undefined : `${TIER_NAMES[owner.tier]} tokens point to primitives only`;
    case 'semantic':
      if (owner.type === 'color') {
        if (isPalette(target)) return undefined;
        if (target.tier === 'primitive' && target.path.startsWith('color.alpha.')) return undefined;
        return 'Semantic colors point to a Brand palette role (palette.*) so every brand can re-map them';
      }
      return target.tier === 'primitive' || target.tier === 'brand' ? undefined : 'Semantic tokens point to a Brand role or a primitive';
    case 'component':
      if (isPalette(target) || isRawColor(target)) return 'Component tokens point to semantic tokens, never to a palette role or a raw color';
      return target.tier === 'component' ? 'Component tokens point to semantic tokens, not to other component tokens' : undefined;
  }
}

/** Tiers whose values must be aliases. */
const MUST_ALIAS: Tier[] = ['brand', 'semantic', 'density', 'component'];

function checkValue(set: TokenSet, owner: { path: string; tier: Tier; type: string }, value: unknown, mode: string, where: string, issues: Issue[]): void {
  if (!isAlias(value)) {
    if (MUST_ALIAS.includes(owner.tier) && value !== undefined) {
      issues.push({
        code: 'raw-value',
        severity: 'error',
        path: owner.path,
        mode,
        message: `${owner.path} uses a raw value in ${where}. ${TIER_NAMES[owner.tier]} tokens must point to another variable (pick one instead of typing a value).`,
      });
    }
    return;
  }
  const target = set.byPath.get(aliasTarget(value));
  if (!target) return; // reported as a broken reference
  const why = aliasRule(owner, target);
  if (why) {
    issues.push({
      code: 'alias-tier',
      severity: 'error',
      path: owner.path,
      mode,
      message: `${owner.path} points to ${target.path} (${TIER_NAMES[target.tier]}) in ${where}. ${why}.`,
    });
  }
}

/** All rule violations in a token set. */
export function validateSet(set: TokenSet, pairs: ContrastPair[]): { issues: Issue[]; contrast: ContrastResult[] } {
  const issues: Issue[] = [];
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
    const modes = modesOf(set.layout, t.tier);
    for (const mode of modes) {
      const v = t.values[mode];
      if (v === undefined) {
        if (isMultiMode(t.tier)) {
          issues.push({
            code: 'missing-mode',
            severity: 'error',
            path: t.path,
            mode,
            message: `${t.path} has no value in ${modeName(mode)}. ${TIER_NAMES[t.tier]} tokens must exist in every ${TIER_AXIS[t.tier]}.`,
          });
        }
        continue;
      }
      checkValue(set, t, v, mode, modeName(mode), issues);
    }
  }

  for (const o of set.overrides) {
    const mode = `${o.brand}.${o.theme}`;
    const where = `${modeDisplayName(o.brand)} ${o.theme} (${o.file})`;
    const base = set.byPath.get(o.path);
    if (!base || base.tier !== 'semantic') {
      issues.push({
        code: 'override-orphan',
        severity: 'error',
        path: o.path,
        mode,
        message: `${o.file} overrides ${o.path}, which is not a semantic token. Remove the override or restore the token.`,
      });
      continue;
    }
    checkValue(set, { path: o.path, tier: 'semantic', type: base.type }, o.value, mode, where, issues);
    for (const ref of collectRefs(o.value)) {
      if (!set.byPath.has(ref)) issues.push({ code: 'broken-reference', severity: 'error', path: o.path, mode, message: `${o.path} points to ${ref}, which does not exist (${where}).` });
    }
  }

  const axes = { brand: modesOf(set.layout, 'brand'), theme: modesOf(set.layout, 'semantic'), density: modesOf(set.layout, 'density') };
  for (const p of findReferenceProblems(set.byPath, axes)) {
    issues.push(
      p.kind === 'broken'
        ? {
            code: 'broken-reference',
            severity: 'error',
            path: p.path,
            mode: p.mode,
            message: `${p.path} points to ${p.target}, which does not exist (${modeName(p.mode)}).`,
          }
        : {
            code: 'alias-cycle',
            severity: 'error',
            path: p.path,
            mode: p.mode,
            message: `${p.path} is part of a loop of references: ${p.chain.join(' -> ')} (${modeName(p.mode)}).`,
          },
    );
  }

  const contrast = evaluatePairs(set.byPath, pairs, contrastScope(set));
  for (const r of contrast) {
    const path = `${r.pair.foreground} on ${r.pair.background}`;
    const mode = `${r.brand ?? ''}.${r.theme}`;
    if (r.error) {
      issues.push({ code: 'contrast-unresolved', severity: 'warning', path, mode, message: `Contrast of ${path} in ${contextLabel(r)} cannot be checked: ${r.error}.` });
    } else if (r.level === 'fail') {
      issues.push({
        code: 'contrast',
        severity: 'error',
        path,
        mode,
        message: `${path} is ${r.ratio}:1 in ${contextLabel(r)}; contrast.checks.json needs ${r.pair.min}:1 (WCAG AA ${r.pair.kind === 'ui' ? 'for interface elements' : 'for text'}).`,
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
 * Semantic edits that some brand does not see because it overrides that token for the theme
 * (brands/<brand>.<theme>.tokens.json). Not an error: a heads-up that the edit is partial.
 */
export function shadowedEdits(set: TokenSet, edits: { path: string; tier: Tier; modes: string[] }[]): Issue[] {
  const out: Issue[] = [];
  for (const e of edits) {
    if (e.tier !== 'semantic') continue;
    for (const o of set.overrides) {
      if (o.path !== e.path || !e.modes.includes(o.theme)) continue;
      out.push({
        code: 'override-shadowed',
        severity: 'warning',
        path: e.path,
        mode: `${o.brand}.${o.theme}`,
        message: `${e.path} is overridden for ${modeDisplayName(o.brand)} in ${o.theme} (${o.file}), so this edit does not change ${modeDisplayName(o.brand)} ${o.theme}. Brand overrides stay code-only.`,
      });
    }
  }
  return out;
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
    else if (existing.has(issueKey(i))) warnings.push({ ...i, severity: 'warning', message: `Already in the design system: ${i.message}` });
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
