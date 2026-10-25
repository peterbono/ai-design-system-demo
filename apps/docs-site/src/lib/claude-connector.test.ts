import { describe, expect, it } from 'vitest';
import { CONNECTOR_WORDS as W, connectionSentence, connectorUrl, developerSnippets, elapsedLabel, parseSession, reviewOf, sessionLine, sessionTag } from './claude-connector';

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
    expect(W.orgAdmins).toContain('Team or Enterprise');
  });
});

describe("Being built, Claude's fixes", () => {
  const steps = [
    { kind: 'read', text: 'Claude read the differences (3)', at: '2026-10-25T10:00:00Z', by: 'Dana Kim' },
    { kind: 'proposed', text: 'Claude opened its fix for review', at: '2026-10-25T10:04:00Z', by: 'Dana Kim', review: 'changes/?pr=91' },
  ];

  it('reads a session, keeps only Studio review paths, and no percentage', () => {
    const s = parseSession({ component: 'TextInput', state: 'ready', startedAt: steps[0]!.at, updatedAt: steps[1]!.at, elapsed: 240, steps, percent: 80 })!;
    expect(s).not.toHaveProperty('percent');
    expect(reviewOf(s)).toBe('changes/?pr=91');
    expect(parseSession({ component: 'X', state: 'ready', steps: [{ text: 't', at: 'a', review: 'https://evil.example' }] })!.steps[0]).not.toHaveProperty('review');
    expect(sessionLine(s)).toBe('Claude opened its fix for review. Took 4 min. Asked by Dana Kim.');
  });

  it('one tag per state, and Went quiet when Claude stopped answering', () => {
    expect(sessionTag({ state: 'working', steps: [] })).toEqual({ label: 'Claude is working', tone: 'info' });
    expect(sessionTag({ state: 'ready', steps: [] }).label).toBe('Ready for review');
    expect(sessionTag({ state: 'working', steps: [{ kind: 'quiet', text: '', at: '', by: '' }] })).toEqual({ label: 'Went quiet', tone: 'warning' });
    expect(sessionTag({ state: 'stopped', steps: [{ kind: 'stopped', text: '', at: '', by: '' }] }).label).toBe('Stopped');
    expect(elapsedLabel(30)).toBe('under a minute');
    expect(elapsedLabel(3900)).toBe('1 h 5 min');
  });
});
