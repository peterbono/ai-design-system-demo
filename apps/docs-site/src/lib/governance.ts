// Governance data, read from docs/GOVERNANCE.md and AGENTS.md so the human page never drifts from the rules
// the agent and the reviewers actually follow.
import { bullets, section, table } from './markdown';
import { readJson, readText } from './repo';

export const GOVERNANCE_FILE = 'docs/GOVERNANCE.md';
export const AGENTS_FILE = 'AGENTS.md';
export const PLAIN_RULES_FILE = 'apps/docs-site/src/content/agent-rules-plain.json';

export function riskTiers() {
  return table(section(readText(GOVERNANCE_FILE), 'Risk tiers'));
}

export function approvals() {
  return table(section(readText(GOVERNANCE_FILE), 'Who approves what'));
}

export function reviewGates() {
  return section(readText(GOVERNANCE_FILE), 'Review gates')
    .filter((l) => /^\d+\.\s/.test(l) || /^\s{2,}\S/.test(l))
    .reduce<string[]>((acc, l) => {
      if (/^\d+\.\s/.test(l)) acc.push(l.replace(/^\d+\.\s+/, ''));
      else if (acc.length) acc[acc.length - 1] += ' ' + l.trim();
      return acc;
    }, []);
}

export function reviewingAgentPrs() {
  return bullets(section(readText(GOVERNANCE_FILE), 'Reviewing an AI-authored PR'));
}

type PlainEntry = { match: string; plain: string };
type PlainFile = Record<'Always' | 'Ask before' | 'Never', PlainEntry[]>;

export interface AgentRule {
  original: string;
  plain: string;
  rewritten: boolean;
}

/**
 * Always / Ask before / Never rules from AGENTS.md. Each rule is shown in plain language when
 * agent-rules-plain.json has a rewrite whose `match` text still appears in the rule. If AGENTS.md changes and
 * the rewrite no longer matches, the page falls back to the original wording instead of showing stale prose.
 */
export function agentRules() {
  const agents = readText(AGENTS_FILE);
  const plain = readJson<PlainFile>(PLAIN_RULES_FILE);
  return (['Always', 'Ask before', 'Never'] as const).map((heading) => {
    const rules: AgentRule[] = bullets(section(agents, heading)).map((original) => {
      const hit = plain[heading]?.find((p) => original.includes(p.match));
      return { original, plain: hit?.plain ?? original, rewritten: Boolean(hit) };
    });
    return { heading, rules };
  });
}

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
