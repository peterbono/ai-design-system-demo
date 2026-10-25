// bridge snapshot --activity: activity.json next to snapshot.json, read with the given fetch (a fake GitHub here).
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseActivity, type FetchLike } from '@bridge-ds/core';
import { snapshotLines, writeSnapshot } from '../src/snapshot.js';
import { REPO } from '../../mcp/test/helpers.js';

const HEAD = 'a'.repeat(40);

/** api.github.com with a repository, its head and one open branch; every other read is a 404. */
function fake(): { fetchImpl: FetchLike; calls: string[] } {
  const calls: string[] = [];
  const routes: Record<string, unknown> = {
    '/repos/acme/ds': { full_name: 'acme/ds', default_branch: 'main', private: false },
    '/repos/acme/ds/git/ref/heads/main': { object: { sha: HEAD } },
    '/repos/acme/ds/pulls?state=open&per_page=100': [{ number: 3, title: 'Tighter corners', html_url: 'https://github.com/acme/ds/pull/3', state: 'open', draft: false, body: '', user: { login: 'ana', type: 'User' }, labels: [], head: { ref: 'bridge/corners', sha: 'b'.repeat(40) }, base: { ref: 'main', sha: HEAD }, created_at: '2026-10-21T10:00:00Z', updated_at: '2026-10-21T10:00:00Z' }],
  };
  const fetchImpl: FetchLike = async (url) => {
    const path = url.replace('https://api.github.com', '');
    calls.push(path);
    const body = routes[path];
    const status = body === undefined ? 404 : 200;
    const text = JSON.stringify(body ?? { message: 'Not Found' });
    return { ok: status === 200, status, headers: { get: () => null }, json: async () => JSON.parse(text), text: async () => text };
  };
  return { fetchImpl, calls };
}

describe('bridge snapshot --activity', () => {
  it('writes activity.json from GitHub, with what it could not read noted', async () => {
    const out = mkdtempSync(join(tmpdir(), 'bridge-test-activity-'));
    const gh = fake();
    const r = await writeSnapshot({ root: REPO, out, version: '9.9.9', generatedAt: '2026-10-22T10:00:00.000Z', activity: { token: 't', repo: 'acme/ds', fetch: gh.fetchImpl } });
    expect(r.written).toEqual(['snapshot.json', 'llms.txt', 'activity.json']);
    const a = parseActivity(readFileSync(join(out, 'activity.json'), 'utf8'));
    expect(a.repo).toEqual({ owner: 'acme', name: 'ds', branch: 'main' });
    expect(a.headSha).toBe(HEAD);
    expect(a.branches.map((b) => [b.number, b.title, b.author])).toEqual([[3, 'Tighter corners', 'ana']]);
    expect(a.responses['/repos/acme/ds/pulls?per_page=100&state=open']).toBeDefined();
    expect(r.activity?.bytes).toBeGreaterThan(0);
    // The last published activity is asked for first (to keep its history), then the repository.
    expect(gh.calls[0]).toBe('/repos/acme/ds/contents/activity.json?ref=bridge-data');
    const lines = snapshotLines(r, out).join('\n');
    expect(lines).toMatch(/Wrote .*activity\.json \(\d+ KB\): \d+ GitHub reads recorded for signed-out visitors\./);
    expect(lines).toMatch(/branches\s+1 open/);
    expect(lines).not.toContain('—');
  });
});
