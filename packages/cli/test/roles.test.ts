// bridge check: the roles line when owners name GitHub teams, with a stubbed GitHub (no network).
import { describe, expect, it } from 'vitest';
import type { FetchLike } from '@bridge-ds/core';
import { rolesReport } from '../src/roles.js';

function stub(routes: Record<string, { status?: number; body: unknown }>): { fetch: FetchLike; calls: string[] } {
  const calls: string[] = [];
  const fetch: FetchLike = async (url, init) => {
    const method = init?.method ?? 'GET';
    const path = url.replace('https://api.github.com', '');
    calls.push(`${method} ${path}`);
    const route = routes[`${method} ${path.replace(/[?&]per_page=100&page=\d+$/, '')}`];
    const status = route ? (route.status ?? 200) : 404;
    const body = route ? route.body : { message: 'Not Found' };
    return { ok: status < 300, status, json: async () => body, text: async () => JSON.stringify(body) };
  };
  return { fetch, calls };
}

describe('bridge check: roles by team', () => {
  it('people only: no line, no request', async () => {
    const gh = stub({});
    const r = await rolesReport({ repo: 'peterbono/ds', owners: { design: ['peterbono'], tech: ['peterbono'] }, token: 't', fetch: gh.fetch });
    expect(r).toEqual({ teams: [], lines: [] });
    expect(gh.calls).toEqual([]);
  });

  it('names each team with its size, reads only', async () => {
    const gh = stub({
      'GET /orgs/acme/teams/design/members': { body: [{ login: 'ana' }, { login: 'bo' }, { login: 'cy' }, { login: 'di' }] },
      'GET /orgs/acme/teams/web/members': { body: [{ login: 'theo' }] },
    });
    const r = await rolesReport({ repo: 'acme/ds', owners: { design: ['@acme/design'], tech: ['@acme/web', 'tara'] }, token: 't', fetch: gh.fetch });
    expect(r.lines).toEqual(['roles: design owners @acme/design (4 people); tech owners @acme/web (1 person), @tara']);
    expect(gh.calls.every((c) => c.startsWith('GET '))).toBe(true);
  });

  it('reports a team it cannot read with the fix', async () => {
    const gh = stub({
      'GET /orgs/acme/teams/design/members': { status: 403, body: { message: 'Resource not accessible by integration' } },
    });
    const r = await rolesReport({ repo: 'acme/ds', owners: { design: ['@acme/design'], tech: [] }, token: 't', fetch: gh.fetch });
    expect(r.teams[0]).toMatchObject({ key: '@acme/design', status: 'unreadable', reason: 'missing-permission' });
    expect(r.lines[0]).toBe('roles: design owners @acme/design; tech owners nobody listed');
    expect(r.lines[1]).toMatch(/team-unreadable .*read:org/);
  });

  it('a team on a personal account says teams need an organization', async () => {
    const gh = stub({ 'GET /users/peterbono': { body: { type: 'User' } } });
    const r = await rolesReport({ repo: 'peterbono/ds', owners: { design: ['@peterbono/design'], tech: [] }, token: 't', fetch: gh.fetch });
    expect(r.teams[0]).toMatchObject({ status: 'unreadable', reason: 'personal-account' });
    expect(r.lines[1]).toMatch(/personal GitHub account/);
  });
});
