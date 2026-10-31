// @vitest-environment jsdom
// Has the viewer connected Bridge in their own Claude: one read of api/mcp ?view=connections per session, 'no' only
// when the read succeeded with none of theirs from Claude, 'unknown' when it failed or does not apply.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const session = vi.hoisted(() => ({ login: 'dana' as string | null, member: null as { email: string; name: string; role: 'edit' } | null, repo: 'acme/design' }));
vi.mock('./github-session', () => ({
  signedInWithGitHub: () => Boolean(session.login),
  currentViewer: () => (session.login ? { login: session.login } : null),
  currentContributor: () => session.member,
  getToken: () => (session.login ? 'ghu_token_0000000000000' : null),
}));
vi.mock('./repo-context', () => ({ repoContext: () => ({ owner: session.repo.split('/')[0], repo: session.repo.split('/')[1] }) }));

import { setConnectorFetch } from './connector-api';
import { forgetClaudeLink, knownClaudeLink, viewerClaudeLink } from './claude-link';
import { connectedInOwnClaude } from '../lib/claude-connector';

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const conn = (over: Partial<{ client: string; mine: boolean }>) => ({ id: 'g1', client: 'Claude', by: 'Dana', createdAt: '', lastUsedAt: '', mine: true, ...over });

beforeEach(() => {
  sessionStorage.clear();
  session.login = 'dana';
  session.member = null;
  session.repo = 'acme/design';
});
afterEach(() => {
  setConnectorFetch(null);
  forgetClaudeLink();
});

describe('connectedInOwnClaude', () => {
  it('needs a connection of the viewer, from Claude', () => {
    expect(connectedInOwnClaude([conn({})])).toBe(true);
    expect(connectedInOwnClaude([conn({ client: 'Claude Code' })])).toBe(true);
    expect(connectedInOwnClaude([conn({ mine: false })])).toBe(false);
    expect(connectedInOwnClaude([conn({ client: 'Cursor' })])).toBe(false);
    expect(connectedInOwnClaude([])).toBe(false);
  });
});

describe('viewerClaudeLink', () => {
  it('connected: yes, read once for the session', async () => {
    const f = vi.fn(async () => json(200, { connections: [conn({})], canManage: false }));
    setConnectorFetch(f);
    expect(await viewerClaudeLink()).toBe('yes');
    expect(await viewerClaudeLink()).toBe('yes');
    expect(knownClaudeLink()).toBe('yes');
    expect(f).toHaveBeenCalledTimes(1);
    expect((f.mock.calls[0] as unknown as [string])[0]).toBe('/api/mcp?view=connections&repo=acme%2Fdesign');
  });

  it("someone else's connection only: no; I've connected it forgets the answer", async () => {
    const f = vi.fn(async () => json(200, { connections: [conn({ mine: false })] }));
    setConnectorFetch(f);
    expect(await viewerClaudeLink()).toBe('no');
    forgetClaudeLink();
    expect(knownClaudeLink()).toBe('unknown');
    await viewerClaudeLink();
    expect(f).toHaveBeenCalledTimes(2);
  });

  it('a failed read: unknown (the page keeps opening Claude directly), and is asked again later', async () => {
    const f = vi.fn(async () => json(500, { message: 'down' }));
    setConnectorFetch(f);
    expect(await viewerClaudeLink()).toBe('unknown');
    setConnectorFetch(async () => {
      throw new TypeError('offline');
    });
    expect(await viewerClaudeLink()).toBe('unknown');
    expect(knownClaudeLink()).toBe('unknown');
  });

  it('signed out, or on the sample team: never asked', async () => {
    const f = vi.fn(async () => json(200, { connections: [] }));
    setConnectorFetch(f);
    session.login = null;
    expect(await viewerClaudeLink()).toBe('unknown');
    session.login = 'dana';
    const { SAMPLE_REPO } = await import('../lib/demo');
    session.repo = SAMPLE_REPO;
    expect(await viewerClaudeLink()).toBe('unknown');
    expect(f).not.toHaveBeenCalled();
  });

  it('an email member is asked too', async () => {
    session.login = null;
    session.member = { email: 'lee@acme.design', name: 'Lee', role: 'edit' };
    setConnectorFetch(async () => json(200, { connections: [] }));
    expect(await viewerClaudeLink()).toBe('no');
  });
});
