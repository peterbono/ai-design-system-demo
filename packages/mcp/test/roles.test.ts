// bridge_get_review: who holds each role when owners name GitHub teams, with a stubbed GitHub (no network).
import { describe, expect, it } from 'vitest';
import { type FetchLike, GitHubClient, loadConfig } from '@bridge-ds/core';
import { reviewRoles } from '../src/ops.js';

function client(routes: Record<string, { status?: number; body: unknown }>) {
  const fetch: FetchLike = async (url, init) => {
    const path = url.replace('https://api.github.com', '').replace(/[?&]per_page=100&page=\d+$/, '');
    const route = routes[`${init?.method ?? 'GET'} ${path}`];
    const status = route ? (route.status ?? 200) : 404;
    const body = route ? route.body : { message: 'Not Found' };
    return { ok: status < 300, status, json: async () => body, text: async () => JSON.stringify(body) };
  };
  return new GitHubClient('acme/ds', 't', fetch, { attempts: 1, baseDelayMs: 0, sleep: async () => {} });
}

const config = loadConfig({
  repo: 'acme/ds',
  governance: { owners: { design: ['@acme/design'], tech: ['@acme/web'] }, rights: { approveDesign: ['design'], approveTech: ['tech'], ship: ['tech'] } },
});

describe('review roles with teams', () => {
  it('an approval counts when the reviewer is in the team; the team is named with its size', async () => {
    const gh = client({
      'GET /orgs/acme/teams/design/members': { body: [{ login: 'ana' }, { login: 'bo' }] },
      'GET /orgs/acme/teams/web/members': { body: [{ login: 'theo' }, { login: 'tara' }, { login: 'ty' }, { login: 'tom' }] },
    });
    const r = await reviewRoles(gh, config, ['Ana', 'zed']);
    expect(r.design).toEqual({ owners: ['@acme/design (2 people)'], approvedBy: ['Ana'] });
    expect(r.tech).toEqual({ owners: ['@acme/web (4 people)'], approvedBy: [] });
    expect(r.ship).toBe('Only the tech owner can merge this (@acme/web (4 people)).');
    expect(r).not.toHaveProperty('unreadableTeams');
  });

  it('a team it cannot read is named with the fix and counts nobody', async () => {
    const gh = client({
      'GET /orgs/acme/teams/design/members': { status: 403, body: { message: 'Resource not accessible by personal access token' } },
      'GET /orgs/acme/teams/web/members': { body: [{ login: 'theo' }] },
    });
    const r = await reviewRoles(gh, config, ['ana']);
    expect(r.design).toEqual({ owners: ['@acme/design'], approvedBy: [] });
    expect(r.unreadableTeams?.[0]).toMatch(/@acme\/design.*read:org/);
  });
});
