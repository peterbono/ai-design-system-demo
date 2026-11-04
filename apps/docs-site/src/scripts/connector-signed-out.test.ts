// The connector's views (api/mcp ?view=) need someone signed in. A visitor's page asks nothing: no refused call on
// every page they open. Signed in (GitHub, an email member or a Bridge account), the view is read as before.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const s = vi.hoisted(() => ({ github: false, contributor: false, account: null as null | { email: string } }));

vi.mock('./github-session', () => ({
  signedInWithGitHub: () => s.github,
  currentContributor: () => (s.contributor ? { email: 'ann@acme.design' } : null),
  getToken: () => (s.github ? 'ghu_test' : null),
  noteWrite: () => undefined,
}));
vi.mock('./account-session', () => ({ getAccount: async () => ({ account: s.account }) }));

import { listConnections, listFixSessions, setConnectorFetch } from './connector-api';

const fetchMock = vi.fn(async () => new Response(JSON.stringify({ connections: [], sessions: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } }));

beforeEach(() => {
  fetchMock.mockClear();
  setConnectorFetch(fetchMock);
  s.github = false;
  s.contributor = false;
  s.account = null;
});

describe('connector views for a visitor', () => {
  it('asks nothing when nobody is signed in, and says so like the server would', async () => {
    await expect(listConnections('acme/ds')).rejects.toMatchObject({ status: 401 });
    await expect(listFixSessions('acme/ds')).rejects.toMatchObject({ status: 401 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reads the view for a GitHub sign-in, an email member or a Bridge account', async () => {
    s.github = true;
    await listConnections('acme/ds');
    s.github = false;
    s.contributor = true;
    await listFixSessions('acme/ds');
    s.contributor = false;
    s.account = { email: 'ann@acme.design' };
    await listConnections('acme/ds');
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
