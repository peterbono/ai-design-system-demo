import { describe, expect, it } from 'vitest';
import { CLAUDE_CONNECT_WORDS as W, connectClaudeStep, readQuery } from './connect-claude';

const info = { client: 'Claude', redirectHost: 'claude.ai', sameBrowser: true };
const teams = [
  { repo: 'acme/web', name: 'Web', role: 'edit', via: 'email' },
  { repo: 'acme/design', name: 'Acme Design', role: 'edit', via: 'github' },
];

describe('Use Bridge in Claude: the steps', () => {
  it('reads only a request id it can trust, and the no-access answer', () => {
    expect(readQuery('?request=abcdefghijklmnopqrstuvwx')).toEqual({ request: 'abcdefghijklmnopqrstuvwx', error: null });
    expect(readQuery('?request=<script>')).toEqual({ request: null, error: null });
    expect(readQuery('?error=no_access').error).toBe('no_access');
  });

  it('walks: no request, expired, another browser, sign in, no team, pick a team (sorted)', () => {
    const q = { request: 'abcdefghijklmnopqrstuvwx', error: null };
    expect(connectClaudeStep({ request: null, error: null }, null, null).kind).toBe('no-request');
    expect(connectClaudeStep({ request: null, error: 'no_access' }, null, null).kind).toBe('no-access');
    expect(connectClaudeStep(q, null, null).kind).toBe('expired');
    expect(connectClaudeStep(q, { ...info, sameBrowser: false }, null).kind).toBe('other-browser');
    expect(connectClaudeStep(q, info, null).kind).toBe('signin');
    expect(connectClaudeStep(q, info, { teams: [] }).kind).toBe('no-teams');
    const pick = connectClaudeStep(q, info, { teams });
    expect(pick.kind === 'pick' && pick.teams.map((t) => t.repo)).toEqual(['acme/design', 'acme/web']);
  });

  it('is true: Claude works as you, a person approves, no em dash', () => {
    expect(W.what).toContain('Nothing reaches the library until someone on your team approves it.');
    expect(Object.values(W).filter((v) => typeof v === 'string').join(' ')).not.toMatch(/—/);
  });
});
