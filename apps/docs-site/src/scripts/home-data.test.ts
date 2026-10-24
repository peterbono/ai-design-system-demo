// @vitest-environment jsdom
// Studio Home paints what Bridge itself knows (join requests, api/entry) without waiting for GitHub: before the open
// branches are read, and when GitHub cannot be read at all.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const s = vi.hoisted(() => ({
  pulls: null as null | (() => Promise<unknown>),
  requests: vi.fn(),
  account: { email: 'sam@acme.com' } as null | { email: string },
}));

vi.mock('./github-session', () => ({
  currentAccess: () => ({ state: 'admin', write: true, admin: true, reach: true }),
  currentContributor: () => null,
  currentViewer: () => ({ login: 'sam', avatar_url: '' }),
  hasWorkingToken: () => true,
  readRepo: () => ({ owner: 'acme', repo: 'product', defaultBranch: 'main' }),
  resolveAccess: async () => null,
  RateLimitError: class extends Error {},
  ghGet: (path: string) => (path.includes('/pulls?') && s.pulls ? s.pulls() : Promise.reject(new Error('not in this test'))),
}));
vi.mock('./entry-session', () => ({ listJoinRequests: s.requests }));
vi.mock('./repo-context', () => ({ siteConfig: () => ({ name: 'Acme Product' }) }));
vi.mock('../lib/team-path', async (orig) => ({ ...(await orig<object>()), isHosted: () => true }));
vi.mock('./teams', () => ({ loadTeams: async () => undefined }));
vi.mock('./pr-status', () => ({ loadStatuses: async () => undefined, owners: () => ({ design: [], tech: [] }), shippers: () => [], rowWho: () => null }));
vi.mock('./suggestions', () => ({ loadSuggestionNeeds: async () => [], loadOwnSuggestions: async () => [] }));
vi.mock('./account-session', () => ({ getAccount: async () => ({ available: true, account: s.account }) }));

import { loadHome, type HomeData } from './home-data';

const REQUEST = { id: 'r1', repo: 'acme/product', email: 'taylor@acme.com', name: 'Taylor Kim', createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 864e5).toISOString() };
const STAT = { guidance: [], contrastFail: 0 };
const joinRows = (d: HomeData | undefined) => (d?.needs ?? []).filter((r) => r.request);

beforeEach(() => {
  s.account = { email: 'sam@acme.com' };
  s.requests.mockReset();
  s.requests.mockResolvedValue([REQUEST]);
});

describe('loadHome and join requests', () => {
  it('paints the requests before GitHub answered for the branches', async () => {
    s.pulls = () => new Promise(() => undefined); // GitHub never answers
    const seen: HomeData[] = [];
    void loadHome(STAT, (d) => seen.push(d));
    await vi.waitFor(() => expect(joinRows(seen.at(-1))).toHaveLength(1));
    expect(seen.at(-1)!.loading).toBe(true);
  });

  it('keeps the requests when GitHub cannot be read', async () => {
    s.pulls = () => Promise.reject(new Error('down'));
    let release: (rows: unknown[]) => void = () => undefined;
    s.requests.mockReturnValue(new Promise((r) => (release = r)));
    const seen: HomeData[] = [];
    await loadHome(STAT, (d) => seen.push(d));
    expect(seen.at(-1)!.failed).toBeTruthy();
    release([REQUEST]);
    await vi.waitFor(() => expect(joinRows(seen.at(-1))).toHaveLength(1));
    expect(seen.at(-1)!.failed).toBeTruthy();
  });

  it('takes in repo facts read later through the repaint it hands back, without reading GitHub again', async () => {
    s.pulls = () => new Promise(() => undefined);
    s.requests.mockResolvedValue([]);
    let facts = { guidance: [] as { name: string; href: string; since: string | null }[], contrastFail: 0 };
    let repaint: () => void = () => undefined;
    const seen: HomeData[] = [];
    void loadHome(() => facts, (d) => seen.push(d), (fn) => (repaint = fn));
    await vi.waitFor(() => expect(seen.length).toBeGreaterThan(0));
    facts = { guidance: [], contrastFail: 2 };
    repaint();
    expect(seen.at(-1)!.needs.length).toBeGreaterThan(0);
  });
  it('never asks for join requests without a Bridge account (a GitHub-only admin: the server would answer 401)', async () => {
    s.account = null;
    s.pulls = () => Promise.reject(new Error('offline'));
    const seen: HomeData[] = [];
    await loadHome(STAT, (d) => seen.push(d));
    await vi.waitFor(() => expect(seen.at(-1)?.settled).toBe(true));
    expect(s.requests).not.toHaveBeenCalled();
    expect(joinRows(seen.at(-1))).toHaveLength(0);
  });
});
