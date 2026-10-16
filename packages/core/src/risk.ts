// Risk tier of a change, following docs/GOVERNANCE.md ("If a PR spans tiers, the highest tier applies").
// The one classifier: the Figma plugin, the docs site editor and reviews, the CLI and the MCP server all
// call classifyRisk, so a change gets the same tier and semver bump wherever it is proposed.
//
// Rules, highest first:
//   Tier 3 (high): any token added, changed (value, type, scopes), renamed or removed, in any tier or in a
//          brand theme override. Renames and removals are breaking ("major"); additions and changes are
//          "minor". Also any guardrail file: governance.guardrails from bridge.config.json (default: the
//          contrast checks, bridge.config.json, AGENTS.md, CLAUDE.md, docs/GOVERNANCE.md, .stylelintrc.json,
//          anything under .github/). A *.tokens.json file counts as Tier 3 when the token changes inside it
//          are not known.
//   Tier 2 (medium): code component source under the components directory that is not a story, docs or test
//          file, and unknown source files ("When in doubt about the tier, choose the higher one").
//   Tier 1 (low): a token whose description is the only thing that changed ("patch"), documentation
//          (*.md, docs/**), stories, *.docs.json, tests, changesets.

import type { AcceptedChange } from './compose';
import { type BridgeConfig, CONFIG_FILE, DEFAULT_GOVERNANCE } from './config';
import { fieldChanges } from './diff-engine';

export type RiskTier = 1 | 2 | 3;
export type SemverBump = 'patch' | 'minor' | 'major';
export type TokenChangeKind = 'added' | 'changed' | 'renamed' | 'removed';

export interface ChangedFile {
  /** Path relative to the repository root. */
  path: string;
  status?: 'added' | 'modified' | 'removed' | 'renamed' | string;
}

/** A token change described by kind, for callers that do not hold LogicalTokens (CLI, MCP). */
export interface TokenChangeSummary {
  kind: TokenChangeKind;
  path: string;
  /** For "changed": true when only the description moved. */
  descriptionOnly?: boolean;
}

export interface RiskInput {
  /** Token changes (from a diff or a push). */
  tokenChanges?: (AcceptedChange | TokenChangeSummary)[];
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
  bump?: SemverBump | undefined;
}

export const RISK_LABELS: Record<RiskTier, string> = {
  1: 'Tier 1: low risk, one code owner',
  2: 'Tier 2: medium risk, design review then design + tech approval',
  3: 'Tier 3: token change, needs design + tech approval',
};

const BUMP_RANK: Record<SemverBump, number> = { patch: 0, minor: 1, major: 2 };
const LOW = [/\.md$/, /^docs\//, /\.stories\.tsx?$/, /\.docs\.json$/, /\.test\.tsx?$/, /^\.changeset\//];

const isSummary = (c: AcceptedChange | TokenChangeSummary): c is TokenChangeSummary => 'kind' in c;

/** Kind and description-only flag of any token change. */
export function summarizeTokenChange(c: AcceptedChange | TokenChangeSummary): TokenChangeSummary {
  if (isSummary(c)) return c;
  const path = (c.target ?? c.current)!.path;
  if (!c.target) return { kind: 'removed', path };
  if (!c.current) return { kind: 'added', path };
  if (c.current.path !== c.target.path) return { kind: 'renamed', path };
  const fields = fieldChanges(c.current, c.target);
  return { kind: 'changed', path, descriptionOnly: fields.length > 0 && fields.every((f) => f.field === 'description') };
}

/** Semver bump of a set of token changes: renames and removals major, other changes minor, descriptions patch. */
export function tokenBump(changes: (AcceptedChange | TokenChangeSummary)[]): SemverBump | undefined {
  let bump: SemverBump | undefined;
  for (const c of changes.map(summarizeTokenChange)) {
    const b: SemverBump = c.kind === 'removed' || c.kind === 'renamed' ? 'major' : c.kind === 'changed' && c.descriptionOnly ? 'patch' : 'minor';
    if (!bump || BUMP_RANK[b] > BUMP_RANK[bump]) bump = b;
  }
  return bump;
}

/** Whether a repo-relative path is a guardrail file under this config (or the defaults). */
export function isGuardrail(path: string, config?: BridgeConfig): boolean {
  const list = config ? [...config.governance.guardrails, CONFIG_FILE, ...(config.contrast ? [config.contrast.path] : [])] : DEFAULT_GOVERNANCE.guardrails;
  return list.some((g) => (g.endsWith('/') ? path.startsWith(g) : path === g)) || path.startsWith('.github/') || path.endsWith('/contrast.checks.json') || path === 'contrast.checks.json';
}

export function classifyRisk(input: RiskInput): RiskResult {
  const reasons: { tier: RiskTier; text: string }[] = [];
  const tokenChanges = (input.tokenChanges ?? []).map(summarizeTokenChange);
  for (const c of tokenChanges) {
    if (c.kind === 'changed' && c.descriptionOnly) reasons.push({ tier: 1, text: `Token description changed: ${c.path}` });
    else reasons.push({ tier: 3, text: `Token ${c.kind}: ${c.path}` });
  }
  const bump = tokenBump(tokenChanges);
  const componentsDir = input.config?.components?.dir;
  for (const f of input.files ?? []) {
    const p = f.path.replace(/^\/+/, '');
    if (p.endsWith('.tokens.json')) {
      // Known token changes already decided the tier of token files.
      if (!input.tokenChanges) reasons.push({ tier: 3, text: `Token file ${f.status ?? 'changed'}: ${p}` });
    } else if (isGuardrail(p, input.config)) reasons.push({ tier: 3, text: `Guardrail file changed: ${p}` });
    else if (LOW.some((r) => r.test(p))) reasons.push({ tier: 1, text: `Docs, story or test: ${p}` });
    else if (componentsDir && p.startsWith(`${componentsDir}/`)) reasons.push({ tier: 2, text: `Component source ${f.status ?? 'changed'}: ${p}` });
    else reasons.push({ tier: 2, text: `Source file changed: ${p}` });
  }
  reasons.sort((a, b) => b.tier - a.tier);
  const tier = (reasons[0]?.tier ?? 1) as RiskTier;
  return { tier, label: RISK_LABELS[tier], reasons: reasons.map((r) => r.text), bump };
}
