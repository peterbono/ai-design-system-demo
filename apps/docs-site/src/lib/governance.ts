// Governance data, read from docs/GOVERNANCE.md and AGENTS.md so the human page never drifts from the rules
// the agent and the reviewers actually follow.
import { section, table } from './markdown';
import { agentPrChecksOf, agentRulesOf, approvalsOf, reviewGatesOf, riskTiersOf, type AgentRule, type PlainRules } from './library/use-pages';
import { readJson, readText } from './repo';

export const GOVERNANCE_FILE = 'docs/GOVERNANCE.md';
export const AGENTS_FILE = 'AGENTS.md';
export const PLAIN_RULES_FILE = 'apps/docs-site/src/content/agent-rules-plain.json';

export const riskTiers = () => riskTiersOf(readText(GOVERNANCE_FILE));

export const approvals = () => approvalsOf(readText(GOVERNANCE_FILE));

export const reviewGates = () => reviewGatesOf(readText(GOVERNANCE_FILE));

export const reviewingAgentPrs = () => agentPrChecksOf(readText(GOVERNANCE_FILE));

export type { AgentRule };

/**
 * Always / Ask before / Never rules from AGENTS.md. Each rule is shown in plain language when
 * agent-rules-plain.json has a rewrite whose `match` text still appears in the rule. If AGENTS.md changes and
 * the rewrite no longer matches, the page falls back to the original wording instead of showing stale prose.
 */
export const agentRules = () => agentRulesOf(readText(AGENTS_FILE), readJson<PlainRules>(PLAIN_RULES_FILE));

export interface TierSummary {
  tier: 1 | 2 | 3;
  /** "low", "medium", "high". */
  level: string;
  /** Inline markdown, as written in docs/GOVERNANCE.md. */
  approvals: string;
  /** A short example: the first one or two items of the Examples cell. */
  example: string;
}

/**
 * The first example of a tier, short enough for one table cell: the first one or two comma items of the Examples
 * cell, stopping at a semicolon. A one-word item continues the previous one ("Token added, changed, renamed or
 * removed"), so it is kept whole.
 */
export function shortExample(cell: string): string {
  const head = cell.split(';')[0]!.trim();
  const items = head.split(/,\s*/);
  if (items.length < 2) return head;
  if (!/\s/.test(items[1]!.trim())) return head;
  return `${items[0]}, ${items[1]}`;
}

/** One line per risk tier for the Settings approvals table, from the Risk tiers table of docs/GOVERNANCE.md. */
export function tierSummaries(source: string = readText(GOVERNANCE_FILE)): TierSummary[] {
  const t = table(section(source, 'Risk tiers'));
  if (!t) return [];
  const col = (name: string) => t.head.findIndex((h) => h.toLowerCase().startsWith(name));
  const ex = col('examples');
  const ap = col('required approvals');
  return t.rows
    .map((row) => {
      const [num, level = ''] = (row[0] ?? '').split(',').map((s) => s.trim());
      const tier = Number(num);
      return { tier: tier as 1 | 2 | 3, level, approvals: row[ap] ?? '', example: shortExample(row[ex] ?? '') };
    })
    .filter((x) => x.tier === 1 || x.tier === 2 || x.tier === 3);
}

/** Whether the Figma Community listing of the plugin is still in review, read from apps/figma-plugin/README.md. */
export function pluginListing(readme: string): { url: string | null; inReview: boolean } {
  const line = readme.split('\n').find((l) => l.includes('figma.com/community/plugin/')) ?? '';
  const url = line.match(/https:\/\/www\.figma\.com\/community\/plugin\/\d+/)?.[0] ?? null;
  return { url, inReview: /\bin review\b/i.test(line) };
}
