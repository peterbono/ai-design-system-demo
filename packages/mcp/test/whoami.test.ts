// bridge_whoami: which person a session acts as. Locally GitHub says who owns the token and the repository and the
// governance say the role; the hosted connector passes the grant's identity (api/mcp); never a whole email address.
import { describe, expect, it } from 'vitest';
import { BridgeContext, maskEmail, whoami, whoamiLine } from '../dist/lib.js';
import { fakeGitHub, readTree, REAL_PATHS, REPO } from './helpers.js';

const tree = () => readTree(REPO, REAL_PATHS);

describe('bridge_whoami', () => {
  it('locally: the GitHub account behind the token, its role from the repository, and that it writes with its own access', async () => {
    const ds = fakeGitHub('acme', 'ds', tree());
    const w = await whoami(await BridgeContext.create({ repo: 'acme/ds', token: 't', fetch: ds.fetch as typeof fetch }));
    expect(w).toMatchObject({ login: 'owner', role: 'Admin', via: 'github', team: 'acme/ds', writes: 'own' });
    expect(w.means).toBe('You write with your own GitHub access (@owner).');
  });

  it('locally without a token: read only, and says what saving needs', async () => {
    const ds = fakeGitHub('acme', 'ds', tree());
    const w = await whoami(await BridgeContext.create({ repo: 'acme/ds', fetch: ds.fetch as typeof fetch }));
    expect(w).toMatchObject({ role: 'Reader', writes: 'none' });
    expect(w.means).toMatch(/saving needs a GitHub token/);
  });

  it('hosted: the identity the grant gives, as is, with the line for a save through Bridge', async () => {
    const ds = fakeGitHub('acme', 'ds', tree());
    const identity = async () => ({ name: 'Dino', email: maskEmail('dinosolo@yopmail.com'), role: 'Can edit' as const, via: 'email' as const, team: 'Bridge DS', writes: 'bridge' as const });
    const w = await whoami(await BridgeContext.create({ repo: 'acme/ds', token: 'bridge-email-member', fetch: ds.fetch as typeof fetch, identity }));
    expect(w).toEqual({ name: 'Dino', email: 'd***@yopmail.com', role: 'Can edit', via: 'email', team: 'Bridge DS', writes: 'bridge', means: 'Your saves go through Bridge as Dino.' });
  });

  it('masks an email to its first letter and domain', () => {
    expect(maskEmail('dinosolo@yopmail.com')).toBe('d***@yopmail.com');
    expect(maskEmail('nope')).toBe('***');
    expect(whoamiLine({ name: 'Ana', writes: 'own' })).toBe('You write with your own GitHub access.');
  });
});
