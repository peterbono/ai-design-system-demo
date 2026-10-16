// Risk tier of a change, following docs/GOVERNANCE.md ("If a PR spans tiers, the highest tier applies").
//
// Rules, highest first:
//   Tier 3 (high): any token added, changed, renamed or removed, in any tier (primitive, brand,
//          base, semantic, density, component) or in a brand theme override; any *.tokens.json
//          file; a guardrail file: the contrast checks, bridge.config.json, AGENTS.md, CLAUDE.md,
//          docs/GOVERNANCE.md, .stylelintrc.json, anything under .github/.
//          Removals and renames are breaking (changeset "major"); the rest is "minor".
//   Tier 2 (medium): code component source (.tsx, .ts, .css) under the components directory that is
//          not a story, docs or test file: a new component, variant or prop, or a visual tweak.
//          Unknown source files also land here ("When in doubt about the tier, choose the higher one").
//   Tier 1 (low): documentation (*.md, docs/**), stories, *.docs.json, tests, changesets.

import type { AcceptedChange } from './compose';
import type { BridgeConfig } from './config';
import { CONFIG_FILE } from './config';

export type RiskTier = 1 | 2 | 3;

export interface ChangedFile {
  /** Path relative to the repository root. */
  path: string;
  status?: 'added' | 'modified' | 'removed' | 'renamed' | string;
}

export interface RiskInput {
  /** Token changes (from a diff or a push). */
  tokenChanges?: AcceptedChange[];
  /** Changed files (from a PR or a commit). */
  files?: ChangedFile[];
  config?: BridgeConfig | undefined;
}

export interface RiskResult {
  tier: RiskTier;
  /** PR-template label, for example "Tier 3: token change, needs design + tech approval". */
  label: string;
  /** One line per rule that fired, highest tier first. */
  reasons: string[];
  /** Semver bump for the changeset of a token change: undefined when no token changed. */
  bump?: 'minor' | 'major' | undefined;
}

export const RISK_LABELS: Record<RiskTier, string> = {
  1: 'Tier 1: low risk, one code owner',
  2: 'Tier 2: medium risk, design review then design + tech approval',
  3: 'Tier 3: token change, needs design + tech approval',
};

const GUARDRAIL_FILES = ['AGENTS.md', 'CLAUDE.md', 'docs/GOVERNANCE.md', '.stylelintrc.json', CONFIG_FILE];
const LOW = [/\.md$/, /^docs\//, /\.stories\.tsx?$/, /\.docs\.json$/, /\.test\.tsx?$/, /^\.changeset\//];

export function classifyRisk(input: RiskInput): RiskResult {
  const reasons: { tier: RiskTier; text: string }[] = [];
  let bump: RiskResult['bump'];
  for (const c of input.tokenChanges ?? []) {
    const path = (c.target ?? c.current)!.path;
    const kind = !c.target ? 'removed' : !c.current ? 'added' : c.current.path !== c.target.path ? 'renamed' : 'changed';
    reasons.push({ tier: 3, text: `Token ${kind}: ${path}` });
    bump = kind === 'removed' || kind === 'renamed' ? 'major' : (bump ?? 'minor');
  }
  const contrast = input.config ? `${input.config.tokens.root}/${input.config.tokens.contrastChecks}` : undefined;
  const componentsDir = input.config?.components?.dir;
  for (const f of input.files ?? []) {
    const p = f.path.replace(/^\/+/, '');
    if (p.endsWith('.tokens.json')) reasons.push({ tier: 3, text: `Token file ${f.status ?? 'changed'}: ${p}` });
    else if (GUARDRAIL_FILES.includes(p) || p.startsWith('.github/') || p === contrast || p.endsWith('/contrast.checks.json'))
      reasons.push({ tier: 3, text: `Guardrail file changed: ${p}` });
    else if (LOW.some((r) => r.test(p))) reasons.push({ tier: 1, text: `Docs, story or test: ${p}` });
    else if (componentsDir && p.startsWith(`${componentsDir}/`)) reasons.push({ tier: 2, text: `Component source ${f.status ?? 'changed'}: ${p}` });
    else reasons.push({ tier: 2, text: `Source file changed: ${p}` });
  }
  reasons.sort((a, b) => b.tier - a.tier);
  const tier = (reasons[0]?.tier ?? 1) as RiskTier;
  return { tier, label: RISK_LABELS[tier], reasons: reasons.map((r) => r.text), bump };
}
