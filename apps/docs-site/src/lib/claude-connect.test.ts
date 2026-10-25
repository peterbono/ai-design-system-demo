import { describe, expect, it } from 'vitest';
import { CLAUDE_CONNECT_WORDS as W, cleanKey, connectedDate, looksLikeKey } from './claude-connect';

describe('Settings, Claude words', () => {
  it('says who connected it and when, in one sentence', () => {
    expect(W.connected('Dana Kim', connectedDate('2026-10-25T10:00:00.000Z'))).toBe('Connected, added by Dana Kim on Oct 25, 2026.');
    expect(W.connected('', 'Oct 25, 2026')).toBe('Connected on Oct 25, 2026.');
    expect(connectedDate('nope')).toBe('nope');
  });

  it('cleans a pasted key and checks its shape the way the server does', () => {
    expect(cleanKey(' sk-ant-abc\n123 ')).toBe('sk-ant-abc123');
    expect(looksLikeKey(`sk-ant-api03-${'a'.repeat(20)}`)).toBe(true);
    expect(looksLikeKey('sk-proj-123')).toBe(false);
  });

  it('is true: Claude proposes, a person reviews, the team pays; never that Claude ships on its own', () => {
    const all = (Object.values(W) as unknown[]).filter((v): v is string => typeof v === 'string').join(' ');
    expect(all).toContain('someone on your team reviews it');
    expect(all).toContain("billed to your team's Anthropic account");
    expect(all).not.toMatch(/\u2014/);
    expect(all).not.toMatch(/ships|merges|adds it to the library/i);
  });
});
