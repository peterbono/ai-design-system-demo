// Studio Settings: the plain words behind two rows. Pure helpers, covered by settings-view.test.ts.
//
// - Approvals as a rule list without tier numbers, built from the Risk tiers table of docs/GOVERNANCE.md (the same
//   rows the tier table under "For developers" shows), so the plain list never drifts from the rules.
// - The one terminal command that connects a designer's own Claude to this repository through the MCP server.
import type { TierSummary } from './governance';

export interface ApprovalRule {
  tier: number;
  /** What kind of change, in plain words ("Token changes"). */
  what: string;
  /** Who approves it ("design owner + tech owner"). */
  who: string;
}

/**
 * Plain names for the kinds of change, matched against the Examples cell of each tier. A rewrite applies only while
 * its pattern still matches the governance text; otherwise the row falls back to the governance example itself.
 */
const PLAIN_WHAT: { match: RegExp; what: string }[] = [
  { match: /^token\b/i, what: 'Token changes' },
  { match: /^new component\b/i, what: 'New component or variant' },
  { match: /^docs\b/i, what: 'Docs fixes' },
];

const NUMBER_WORD: Record<number, string> = { 1: 'one', 2: 'two', 3: 'three' };

/** "Design owner **and** tech owner, mandatory" -> "design owner + tech owner"; "1 code owner" -> "one owner". */
export function plainApprovals(markdown: string): string {
  const text = markdown
    .replace(/\*\*|__|`/g, '')
    .replace(/,\s*mandatory\b/i, '')
    .replace(/\s+(?:and|\+)\s+/gi, ' + ')
    .replace(/(\d+)\s+code\s+owners?/gi, (_, n: string) => `${NUMBER_WORD[Number(n)] ?? n} ${Number(n) === 1 ? 'owner' : 'owners'}`)
    .trim();
  return text.charAt(0).toLowerCase() + text.slice(1);
}

/** One rule per tier, the riskiest first (token changes lead, docs fixes close the list). */
export function approvalRules(tiers: Pick<TierSummary, 'tier' | 'approvals' | 'example'>[]): ApprovalRule[] {
  return [...tiers]
    .sort((a, b) => b.tier - a.tier)
    .map((t) => ({
      tier: t.tier,
      what: PLAIN_WHAT.find((p) => p.match.test(t.example.trim()))?.what ?? t.example,
      who: plainApprovals(t.approvals),
    }))
    .filter((r) => r.what && r.who);
}

/** The rule as one sentence: "Token changes: design owner + tech owner." */
export const ruleSentence = (r: ApprovalRule) => `${r.what}: ${r.who}.`;

/** Placeholder the person replaces with their own GitHub token. Bridge never fills it in. */
export const TOKEN_PLACEHOLDER = '<your token>';

/** The one command that adds Bridge to Claude Code for this repository (user scope, token from the environment). */
export function mcpAddCommand(repo: string): string {
  return `claude mcp add bridge -s user -e GITHUB_TOKEN=${TOKEN_PLACEHOLDER} -- npx -y @bridge-ds/mcp --repo ${repo}`;
}
