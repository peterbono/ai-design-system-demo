// Studio Settings: approvals in plain words and the Claude connect command.
import { describe, expect, it } from 'vitest';
import { tierSummaries } from './governance';
import { approvalRules, mcpAddCommand, plainApprovals, ruleSentence } from './settings-view';

const GOVERNANCE = `# Governance

## Risk tiers

| Tier | Examples | PR state | Required approvals | Changeset |
| ---- | -------- | -------- | ------------------ | --------- |
| 1, low | Docs, story fixes, a11y fixes with no visual change | Ready for review | 1 code owner | none |
| 2, medium | New component, new variant or prop, visual tweak using existing tokens | Draft | Design owner + tech owner | \`minor\` |
| 3, high | Token added, changed, renamed or removed; breaking prop change | Draft | Design owner **and** tech owner, mandatory | \`minor\` |

## Review gates
`;

describe('approval rules', () => {
  it('turns the governance tiers into plain rules, riskiest first, without tier numbers', () => {
    const rules = approvalRules(tierSummaries(GOVERNANCE));
    expect(rules.map(ruleSentence)).toEqual([
      'Token changes: design owner + tech owner.',
      'New component or variant: design owner + tech owner.',
      'Docs fixes: one owner.',
    ]);
    expect(rules.map(ruleSentence).join(' ')).not.toMatch(/tier/i);
  });

  it('falls back to the governance example when a kind has no plain name', () => {
    expect(approvalRules([{ tier: 2, approvals: '2 code owners', example: 'Icon swaps' }])).toEqual([{ tier: 2, what: 'Icon swaps', who: 'two owners' }]);
  });

  it('reads markdown emphasis and conjunctions as plain text', () => {
    expect(plainApprovals('Design owner **and** tech owner, mandatory')).toBe('design owner + tech owner');
    expect(plainApprovals('1 code owner')).toBe('one owner');
    expect(plainApprovals('Design owner + tech owner')).toBe('design owner + tech owner');
  });

  it('reads the real docs/GOVERNANCE.md', () => {
    const rules = approvalRules(tierSummaries());
    expect(rules).toHaveLength(3);
    expect(rules[0]!.what).toBe('Token changes');
  });
});

describe('connect your Claude', () => {
  it('builds the one command for the repository and never fills the token in', () => {
    expect(mcpAddCommand('acme/ds')).toBe('claude mcp add bridge -s user -e GITHUB_TOKEN=<your token> -- npx -y @bridge-ds/mcp --repo acme/ds');
    expect(mcpAddCommand('acme/ds')).not.toMatch(/gh[pousr]_|github_pat_/);
  });
});
