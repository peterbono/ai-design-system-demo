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
