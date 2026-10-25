// @vitest-environment jsdom
// A signed-out visitor of a team's hosted Studio reads the team's published activity.json instead of the GitHub API,
// and every anonymous read is shared and kept for a moment in the tab.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { activityKey, getSuggestionOnGitHub, listSuggestionsOnGitHub, trimGitHub, type RepoActivity } from '@bridge-ds/core';
import { ghGet, RateLimitError, studioClient } from './github-session';
import { clearGuestReads, guestHistory, onActivityUsed, resetGuestActivity } from './guest-activity';
import { pullStatus } from './pr-status';
import { updatedLine } from '../lib/activity-view';

const HEAD = 'a'.repeat(40);
const PR_HEAD = 'b'.repeat(40);
const R = '/repos/acme/ds';
const user = { login: 'ana', avatar_url: 'https://avatars.githubusercontent.com/ana', type: 'User' };
const pull = { number: 7, title: 'Darker primary', html_url: 'https://github.com/acme/ds/pull/7', state: 'open', draft: false, body: '', user, labels: [{ name: 'tier: 1' }], head: { ref: 'bridge/darker', sha: PR_HEAD }, base: { ref: 'main', sha: HEAD }, created_at: '2026-10-20T10:00:00Z', updated_at: '2026-10-21T10:00:00Z', merged_at: null, mergeable: true };
const issue = { number: 8, title: 'Tokens: darker primary', body: 'No block.', html_url: 'https://github.com/acme/ds/issues/8', state: 'open', state_reason: null, labels: [{ name: 'bridge-suggestion' }], user, created_at: '2026-10-21T09:00:00Z', updated_at: '2026-10-21T09:00:00Z' };

/** The reads the Branches list, a branch, a row status and a suggestion page make, as the CI recorded them. */
const recorded: Record<string, unknown> = {
  [R]: { full_name: 'acme/ds', default_branch: 'main', private: false },
  [`${R}/git/ref/heads/main`]: { object: { sha: HEAD } },
  [`${R}/pulls?state=open&per_page=100`]: [pull],
  [`${R}/pulls?state=all&per_page=50&sort=updated&direction=desc`]: [pull],
  [`${R}/pulls/7`]: pull,
  [`${R}/pulls/7/files?per_page=100`]: [{ filename: 'README.md', status: 'modified' }],
  [`${R}/pulls/7/reviews?per_page=100`]: [],
  [`${R}/commits/${PR_HEAD}/check-runs?per_page=100`]: { total_count: 1, check_runs: [{ name: 'test', status: 'completed', conclusion: 'success' }] },
  [`${R}/commits/${PR_HEAD}/status`]: { state: 'success', statuses: [] },
  [`${R}/issues?state=open&per_page=50&sort=created&direction=desc&labels=bridge-suggestion`]: [issue],
  [`${R}/issues/8`]: issue,
  [`${R}/issues/8/comments?per_page=100`]: [],
};

const activity = (generatedAt: string): RepoActivity => ({
  kind: 'bridge-activity',
  schemaVersion: 1,
  tool: { name: 'bridge', version: '9.9.9' },
  generatedAt,
  repo: { owner: 'acme', name: 'ds', branch: 'main' },
  headSha: HEAD,
  branches: [],
  suggestions: [],
  requests: [],
  merged: [],
  history: { source: 'github', label: 'acme/ds@main', ref: 'main', entries: [], releases: [], timeline: [], truncated: false },
  responses: Object.fromEntries(Object.entries(recorded).map(([k, v]) => [activityKey(k)!, { status: 200, body: trimGitHub(v) }])),
  truncated: [],
  problems: [],
});

let published: RepoActivity | null;
let api: string[];
let limited: boolean;
const live: Record<string, unknown> = { [`${R}/pulls/9`]: { ...pull, number: 9 } };

beforeEach(() => {
  document.documentElement.setAttribute('data-hosted', '');
  history.replaceState(null, '', '/studio/acme/ds/changes/');
  localStorage.clear();
  sessionStorage.clear();
  clearGuestReads();
  resetGuestActivity();
  published = activity(new Date(Date.now() - 5 * 60_000).toISOString());
  api = [];
  limited = false;
  vi.stubGlobal('fetch', async (input: string) => {
    const url = String(input);
    if (url === 'https://raw.githubusercontent.com/acme/ds/bridge-data/activity.json') return published ? new Response(JSON.stringify(published)) : new Response('404: Not Found', { status: 404 });
    if (url.startsWith('https://raw.githubusercontent.com/')) return new Response('404: Not Found', { status: 404 });
    if (url.startsWith('https://api.github.com/')) {
      api.push(url.replace('https://api.github.com', ''));
      if (limited) return new Response(JSON.stringify({ message: 'API rate limit exceeded' }), { status: 403, headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1900000000' } });
      const body = live[url.replace('https://api.github.com', '')];
      return body ? new Response(JSON.stringify(body), { status: 200 }) : new Response(JSON.stringify({ message: 'Not Found' }), { status: 404 });
    }
    throw new TypeError(`unexpected fetch ${url}`);
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.documentElement.removeAttribute('data-hosted');
});

describe('a guest with the team activity', () => {
  it('reads the team, its branches, a row status and a suggestion with no GitHub API request', async () => {
    const used = vi.fn();
    onActivityUsed(used);
    const client = studioClient('acme/ds', null);
    expect((await client.getRepo()).defaultBranch).toBe('main');
    expect(await client.getBranchSha('main')).toBe(HEAD);
    // Branches: the open list, then a branch page.
    const open = (await ghGet<{ number: number }[]>(`${R}/pulls?state=open&per_page=100`)).data;
    expect(open.map((p) => p.number)).toEqual([7]);
    expect((await ghGet<{ title: string }>(`${R}/pulls/7`)).data.title).toBe('Darker primary');
    // A row status: checks, reviews, files.
    const st = await pullStatus(pull as never, { lean: true });
    expect(st.kind).not.toBe('unknown');
    // Suggestions: the list Branches shows, and one suggestion page.
    const items = await listSuggestionsOnGitHub(client, { state: 'open' });
    expect(items.map((i) => i.number)).toEqual([8]);
    const d = await getSuggestionOnGitHub(client, 8, { owners: { design: [], tech: [] } });
    expect(d.issue.title).toBe('Tokens: darker primary');
    expect(api).toEqual([]);
    expect(used).toHaveBeenCalledWith(expect.objectContaining({ headSha: HEAD }));
  });

  it('reads the token history from the activity', async () => {
    expect((await guestHistory())?.label).toBe('acme/ds@main');
    expect(api).toEqual([]);
  });

  it('reads live what the activity did not record', async () => {
    expect((await ghGet<{ number: number }>(`${R}/pulls/9`)).data.number).toBe(9);
    expect(api).toEqual([`${R}/pulls/9`]);
  });

  it('reads live while the activity is over a day old, and falls back to it when GitHub refuses for the limit', async () => {
    published = activity(new Date(Date.now() - 2 * 24 * 3600_000).toISOString());
    limited = true;
    const f = await ghGet<{ number: number }[]>(`${R}/pulls?state=open&per_page=100`);
    expect(f.data.map((p) => p.number)).toEqual([7]);
    expect(api).toEqual([`${R}/pulls?state=open&per_page=100`]);
    // Nothing recorded and nothing kept: the hourly limit, as a RateLimitError the pages word.
    await expect(ghGet(`${R}/pulls/9`)).rejects.toBeInstanceOf(RateLimitError);
  });
});

describe('a guest without activity', () => {
  it('asks GitHub once for the same read in flight and within two minutes', async () => {
    published = null;
    const client = studioClient('acme/ds', null);
    await Promise.all([ghGet(`${R}/pulls/9`), ghGet(`${R}/pulls/9`), client.getRepo().catch(() => null)]);
    await ghGet(`${R}/pulls/9`);
    await client.getRepo().catch(() => null);
    expect(api).toEqual([`${R}/pulls/9`, R]);
  });
});

describe('updatedLine', () => {
  it('says how recent the activity is', () => {
    const now = Date.parse('2026-10-22T12:00:00Z');
    expect(updatedLine('2026-10-22T11:59:40Z', now)).toBe('Updated just now');
    expect(updatedLine('2026-10-22T11:55:00Z', now)).toBe('Updated 5 min ago');
    expect(updatedLine('2026-10-22T09:00:00Z', now)).toBe('Updated 3 h ago');
    expect(updatedLine('2026-10-20T09:00:00Z', now)).toBe('Updated Oct 20');
  });
});
