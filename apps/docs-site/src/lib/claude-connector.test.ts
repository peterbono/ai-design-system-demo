import { describe, expect, it } from 'vitest';
import { CONNECTOR_WORDS as W, connectionSentence, connectorUrl, developerSnippets, elapsedLabel, fixRows, parseSession, reviewOf, type Session } from './claude-connector';
import { matchesBuildFilter } from '@bridge-ds/core';

const c = (by: string, lastUsedAt: string) => ({ id: by, client: 'Claude', by, createdAt: lastUsedAt, lastUsedAt, mine: false });

describe('Settings, Claude', () => {
  it('says who connected Bridge in Claude, and when it was last used; otherwise not connected yet', () => {
    expect(connectionSentence([])).toBe('Not connected yet.');
    expect(connectionSentence([c('Dana Kim', '2026-10-24T10:00:00Z'), c('Malik', '2026-10-25T09:00:00Z'), c('Dana Kim', '2026-10-20T10:00:00Z')])).toBe('Connected in Claude by Dana Kim and Malik, last used Oct 25, 2026.');
  });

  it('gives the address and the developer snippets, with no secret in them', () => {
    const url = connectorUrl('https://bridge.floriangouloubi.com/');
    expect(url).toBe('https://bridge.floriangouloubi.com/mcp');
    const s = developerSnippets(url, 'acme/design');
    expect(s.claudeCode).toBe('claude mcp add --transport http bridge https://bridge.floriangouloubi.com/mcp');
    expect(JSON.parse(s.local).mcpServers.bridge.args).toEqual(['-y', '@bridge-ds/mcp', '--repo', 'acme/design']);
    expect(W.step1).toContain('Add custom connector');
    expect(W.step1).toContain('name it Bridge');
    expect(W.orgAdmins).toContain('Team or Enterprise');
  });
});

describe("Being built, Claude's fixes as rows of the one list", () => {
  const NOW = Date.parse('2026-10-30T12:00:00Z');
  const steps = [
    { kind: 'read', text: 'Claude read the differences (3)', at: '2026-10-28T10:00:00Z', by: 'peterbono' },
    { kind: 'proposed', text: 'Claude opened its fix for review', at: '2026-10-28T10:03:00Z', by: 'peterbono', review: 'changes/?pr=598' },
  ];
  const ready = parseSession({ component: 'Button', state: 'ready', startedAt: steps[0]!.at, updatedAt: steps[1]!.at, elapsed: 180, steps, percent: 80 })!;
  const names = (l: string) => (l === 'peterbono' ? 'Florian' : l);
  const pull = (extra: Record<string, unknown>) => ({ number: 598, state: 'open', merged_at: null, updated_at: '2026-10-28T10:03:00Z', ...extra });

  it('reads a session, keeps only Studio review paths, and no percentage', () => {
    expect(ready).not.toHaveProperty('percent');
    expect(reviewOf(ready)).toBe('changes/?pr=598');
    expect(parseSession({ component: 'X', state: 'ready', steps: [{ text: 't', at: 'a', review: 'https://evil.example' }] })!.steps[0]).not.toHaveProperty('review');
    expect(elapsedLabel(30)).toBe('under a minute');
    expect(elapsedLabel(3900)).toBe('1 h 5 min');
  });

  it('a merged fix reads Shipped on its merge date and counts in Shipped this week, asked by a name, never the login', () => {
    const [r] = fixRows([ready], [pull({ state: 'closed', merged_at: '2026-10-28T13:27:44Z' })], NOW, names);
    expect(r!.status).toBe('shipped');
    expect(r!.label).toBe('Shipped');
    expect(r!.shippedAt).toBe('2026-10-28T13:27:44Z');
    expect(r!.fix.line).toBe("Claude's fix from Figma, asked by Florian · Shipped 1 day ago");
    expect(r!.fix.line).not.toContain('peterbono');
    expect(r!.fix.href).toBe('changes/?pr=598');
    expect(r!.builders).toEqual(['claude']);
    expect(matchesBuildFilter(r!, 'shipped-this-week', NOW)).toBe(true);
    expect(matchesBuildFilter(r!, 'in-progress', NOW)).toBe(false);
  });

  it('an open fix is In review, a closed one Not planned; without the pull request read, the session decides', () => {
    const open = fixRows([ready], [pull({})], NOW, names)[0]!;
    expect(open.status).toBe('in-review');
    expect(open.fix.line).toBe("Claude's fix from Figma, asked by Florian · Ready for your team to review, took 3 min");
    expect(matchesBuildFilter(open, 'in-progress', NOW)).toBe(true);
    const closed = fixRows([ready], [pull({ state: 'closed', updated_at: '2026-10-29T09:00:00Z' })], NOW, names)[0]!;
    expect(closed.status).toBe('not-planned');
    expect(closed.label).toBe('Not planned');
    expect(closed.fix.line).toContain('Your team closed it without keeping it');
    expect(matchesBuildFilter(closed, 'all', NOW)).toBe(true);
    expect(fixRows([ready], [], NOW, names)[0]!.status).toBe('in-review');
  });

  it('while Claude works: In progress with the last real step; went quiet is flagged; stopped is Not planned with the reason', () => {
    const working: Session = { ...ready, state: 'working', elapsed: 240, steps: [{ ...steps[0]!, text: 'Claude tried a fix (round 2): closer', kind: 'try' }] };
    const w = fixRows([working], [], NOW, names)[0]!;
    expect(w.status).toBe('in-progress');
    expect(w.fix.working).toBe(true);
    expect(w.fix.href).toBe('components/?c=button');
    expect(w.fix.line).toBe("Claude's fix from Figma, asked by Florian · Claude tried a fix (round 2): closer, for 4 min");
    expect(w.fix.line).not.toMatch(/%/);
    const quiet = fixRows([{ ...working, steps: [...working.steps, { kind: 'quiet', text: 'Claude went quiet', at: 'x', by: 'peterbono' }] }], [], NOW, names)[0]!;
    expect(quiet.stale).toBe(true);
    expect(quiet.fix.line).toContain('Claude went quiet after 4 min');
    const stopped = fixRows([{ ...working, state: 'stopped', steps: [{ ...steps[0]!, kind: 'stopped', text: 'Claude stopped: no fix brought it closer to the code.' }] }], [], NOW, names)[0]!;
    expect(stopped.status).toBe('not-planned');
    expect(stopped.fix.line).toContain('Claude stopped: no fix brought it closer to the code');
  });
});
