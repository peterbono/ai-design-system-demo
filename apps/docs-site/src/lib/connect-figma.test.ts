import { describe, expect, it } from 'vitest';
import type { Account } from './account';
import { CONNECT_WORDS, codeFrom, connectStep, teamLabel } from './connect-figma';

const account = (teams: Account['teams']): Account => ({ email: 'ana@acme.com', name: 'Ana', github: { login: 'ana', id: 1 }, teams });
const team = (repo: string, name: string | null = null) => ({ repo, name, role: 'edit', via: 'email' });

describe('Connect Figma (Studio side of Sign in with Bridge)', () => {
  it('reads only a well-formed code from the address', () => {
    expect(codeFrom('?code=abcdefgh23')).toBe('ABCDEFGH23');
    expect(codeFrom('?code=short')).toBeNull();
    expect(codeFrom('?code=ABCDEFGH01')).toBeNull();
    expect(codeFrom('')).toBeNull();
  });

  it('walks the steps: code, Bridge sign-in, GitHub, a team', () => {
    expect(connectStep(null, account([team('acme/ds')]), true).kind).toBe('no-code');
    expect(connectStep('ABCDEFGH23', null, false).kind).toBe('signin');
    expect(connectStep('ABCDEFGH23', account([team('acme/ds')]), false).kind).toBe('github');
    expect(connectStep('ABCDEFGH23', account([]), true).kind).toBe('no-teams');
    const pick = connectStep('ABCDEFGH23', account([team('zeta/ds', 'Zeta'), team('acme/ds', 'Acme DS')]), true);
    expect(pick.kind === 'pick' && pick.teams.map(teamLabel)).toEqual(['Acme DS', 'Zeta']);
  });

  it('never shows a token or an em dash', () => {
    const all = Object.values(CONNECT_WORDS).map((w) => (typeof w === 'function' ? w('Acme') : w)).join(' ');
    expect(all).not.toMatch(/token|—/i);
  });
});
