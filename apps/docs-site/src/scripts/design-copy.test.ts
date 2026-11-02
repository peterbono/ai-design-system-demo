// Where the design team's copy stands while GitHub is busy for the viewer: a wait (busy), never "missing", so the
// product page never offers "Make my copy" for a copy that exists.
import { describe, expect, it, vi } from 'vitest';
import { GitHubClient, type FetchLike, type ProductConfig } from '@bridge-ds/core';

const s = vi.hoisted(() => ({ answer: null as null | { status: number; headers: Record<string, string>; body: unknown } }));

const fetchImpl = (async () => {
  const a = s.answer!;
  return { ok: a.status < 300, status: a.status, headers: { get: (n: string) => a.headers[n.toLowerCase()] ?? null }, json: async () => a.body, text: async () => JSON.stringify(a.body) };
}) as unknown as FetchLike;

vi.mock('./github-session', () => ({
  studioClient: (repo: string) => new GitHubClient(repo, 't', fetchImpl, { attempts: 1, baseDelayMs: 0, sleep: async () => {} }, { etags: false }),
  getToken: () => 't',
  ghWrite: async () => undefined,
  GitHubError: Error,
}));
vi.mock('./exploration-start', () => ({ explorationsConfig: () => ({ owner: 'acme', repo: 'ds' }) }));

import { readCopyView } from './design-copy';

const ADMIN: ProductConfig = { key: 'admin-app', name: 'Product admin', repo: 'acme/product-admin', design: { repo: 'acme/product-admin-design' } };
const reset = Math.floor(Date.parse('2026-11-02T12:52:00Z') / 1000);

describe('readCopyView while GitHub is busy', () => {
  it('no reads left on the account (403, remaining 0): busy with the reset, never missing', async () => {
    s.answer = { status: 403, headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(reset) }, body: { message: 'API rate limit exceeded for user ID 1.' } };
    expect(await readCopyView(ADMIN)).toEqual({ kind: 'busy', busy: { resetsAt: new Date(reset * 1000), source: 'github' } });
  });

  it('a 403 in GitHub’s limit words without the headers: busy, never missing', async () => {
    s.answer = { status: 403, headers: {}, body: { message: 'API rate limit exceeded for user ID 1.' } };
    expect(await readCopyView(ADMIN)).toEqual({ kind: 'busy', busy: { resetsAt: null, source: 'github' } });
  });

  it('a copy GitHub says is not there is still missing', async () => {
    s.answer = { status: 404, headers: {}, body: { message: 'Not Found' } };
    expect(await readCopyView(ADMIN)).toEqual({ kind: 'missing' });
  });
});
