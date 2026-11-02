// A fake api.github.com for the quota load test (docs/QUOTA-LOADTEST.md). It never reaches the network: it answers
// the reads Bridge's server read path makes (api/_lib/team-read.ts) with bodies in GitHub's recorded shapes, an ETag
// on every answer, 304 on a matching If-None-Match, and counts every call by kind. GitHub's docs: a 304 to a correctly
// authorized conditional request does not count against the primary rate limit; everything else does.

import { createHash } from 'node:crypto';
import type { FetchLike } from '../../api/_lib/http';

/** One open change of the fake team: its pull request number, head commit and check state. */
export interface FakeChange {
  number: number;
  sha: string;
  /** Bumped when a check finishes or a review lands (the head stays). */
  rev: number;
  checks: 'queued' | 'success';
  reviews: number;
  /** The commit a later push builds on (for compare and commits reads). */
  base: string;
}

export interface FakeWorld {
  owner: string;
  repo: string;
  /** The default branch head (moves when a change merges; not in these scenarios). */
  main: string;
  changes: FakeChange[];
  /** Product repositories the team lists, read with the same installation. */
  products: string[];
  /** Files on the default branch the Library reads (components, token files). */
  files: number;
}

export interface Call {
  at: number;
  path: string;
  /** 'counted' (any answer but a 304: GitHub's limit), 'free' (a 304 on If-None-Match). */
  kind: 'counted' | 'free';
  status: number;
  /** A counted answer GitHub had already given with the same ETag: a kept ETag would have made it a free 304. */
  unchanged: boolean;
  /** Another call for the same path was in flight: concurrent misses of one answer. */
  overlapping: boolean;
}

const sha = (s: string) => createHash('sha1').update(s).digest('hex');
const etagOf = (body: string) => `W/"${createHash('sha256').update(body).digest('hex').slice(0, 32)}"`;

/** A 40 hex sha for a label (deterministic). */
export const shaOf = (label: string) => sha(label);

export function fakeWorld(changes: number, o: { owner?: string; repo?: string; products?: number; files?: number } = {}): FakeWorld {
  const owner = o.owner ?? 'acme';
  const repo = o.repo ?? 'design';
  return {
    owner,
    repo,
    main: shaOf('main-0'),
    changes: Array.from({ length: changes }, (_, i) => ({ number: 100 + i, sha: shaOf(`head-${100 + i}-0`), rev: 0, checks: 'success' as const, reviews: i % 3, base: shaOf('main-0') })),
    products: Array.from({ length: o.products ?? 1 }, (_, i) => `${owner}/product-${i + 1}`),
    files: o.files ?? 60,
  };
}

/** A new commit on a change: a new head sha, checks queued again. */
export function pushCommit(w: FakeWorld, number: number, n: number): FakeChange | null {
  const c = w.changes.find((x) => x.number === number);
  if (!c) return null;
  c.sha = shaOf(`head-${number}-${n}`);
  c.checks = 'queued';
  c.rev += 1;
  return c;
}

/** The checks of a change's head finish. */
export function finishChecks(w: FakeWorld, number: number): void {
  const c = w.changes.find((x) => x.number === number);
  if (c && c.checks !== 'success') {
    c.checks = 'success';
    c.rev += 1;
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Recorded shapes (the fields Studio reads; GitHub sends more, the size is in the same range)

const user = (login: string) => ({ login, id: login.length * 1000 + 7, type: 'User', avatar_url: `https://avatars.githubusercontent.com/u/${login.length}?v=4`, site_admin: false });

function pull(w: FakeWorld, c: FakeChange) {
  return {
    number: c.number,
    state: 'open',
    draft: c.number % 4 === 0,
    title: `Change ${c.number}`,
    body: `Opened from Bridge.\n\n<!-- bridge:change ${c.number} -->`,
    user: user(`designer-${c.number % 7}`),
    labels: [{ name: c.number % 2 ? 'tokens' : 'component' }],
    requested_reviewers: [user('lead-1')],
    head: { ref: `bridge/change-${c.number}`, sha: c.sha, repo: { full_name: `${w.owner}/${w.repo}` } },
    base: { ref: 'main', sha: w.main },
    created_at: '2026-10-20T09:00:00Z',
    updated_at: `2026-11-02T10:${String(c.rev % 60).padStart(2, '0')}:00Z`,
    mergeable_state: 'clean',
    html_url: `https://github.com/${w.owner}/${w.repo}/pull/${c.number}`,
  };
}

const files = (c: FakeChange) =>
  Array.from({ length: 3 + (c.number % 4) }, (_, i) => ({ sha: shaOf(`f-${c.number}-${c.rev}-${i}`), filename: `packages/tokens/src/semantic/light/${i}.json`, status: 'modified', additions: 4, deletions: 2, changes: 6, patch: `@@ -1,2 +1,4 @@\n-  "old": 1\n+  "new": ${c.rev}\n` }));

const checkRuns = (c: FakeChange) => ({
  total_count: 4,
  check_runs: ['typecheck', 'test', 'build-storybook', 'visual'].map((name, i) => ({ id: c.number * 10 + i, name, head_sha: c.sha, status: c.checks === 'success' ? 'completed' : 'queued', conclusion: c.checks === 'success' ? 'success' : null, started_at: '2026-11-02T10:00:00Z', completed_at: c.checks === 'success' ? '2026-11-02T10:04:00Z' : null })),
});

const combined = (c: FakeChange) => ({ state: c.checks === 'success' ? 'success' : 'pending', sha: c.sha, total_count: 1, statuses: [{ context: 'vercel', state: c.checks === 'success' ? 'success' : 'pending', target_url: 'https://example.vercel.app' }] });

const reviews = (c: FakeChange) => Array.from({ length: c.reviews }, (_, i) => ({ id: c.number * 100 + i, user: user(`lead-${i + 1}`), state: i ? 'COMMENTED' : 'APPROVED', commit_id: c.sha, submitted_at: '2026-11-02T09:00:00Z' }));

const tree = (w: FakeWorld, at: string) => ({ sha: at, truncated: false, tree: Array.from({ length: w.files }, (_, i) => ({ path: `packages/react/src/components/C${i}/C${i}.docs.json`, mode: '100644', type: 'blob', sha: shaOf(`blob-${i}`), size: 1800 })) });

/** What GitHub answers for `path` (under api.github.com) in `w`: status and body text. */
function answer(w: FakeWorld, path: string, search: URLSearchParams): { status: number; body: string; type?: string } {
  const ok = (v: unknown) => ({ status: 200, body: JSON.stringify(v) });
  const u = /^\/users\/([^/]+)$/.exec(path);
  if (u) return ok({ ...user(decodeURIComponent(u[1]!)), name: `Person ${u[1]}` });
  const m = /^\/repos\/([^/]+)\/([^/]+)(\/.*)?$/.exec(path);
  if (!m) return { status: 404, body: '{"message":"Not Found"}' };
  const full = `${m[1]}/${m[2]}`.toLowerCase();
  const rest = m[3] ?? '';
  const isTeam = full === `${w.owner}/${w.repo}`.toLowerCase();
  const product = !isTeam;
  if (rest === '') return ok({ full_name: full, private: true, default_branch: 'main', permissions: { pull: true } });
  if (rest === '/contents/bridge.config.json') return { status: 200, body: JSON.stringify({ products: w.products.map((r) => ({ name: r.split('/')[1], repo: r })) }), type: 'application/vnd.github.raw' };
  if (rest === '/pulls') {
    const list = product ? [] : w.changes.map((c) => pull(w, c));
    return ok(list);
  }
  const p = /^\/pulls\/(\d+)(?:\/(reviews|files|commits|comments))?$/.exec(rest);
  if (p) {
    const c = w.changes.find((x) => x.number === Number(p[1]));
    if (!c) return { status: 404, body: '{"message":"Not Found"}' };
    if (!p[2]) return ok(pull(w, c));
    if (p[2] === 'reviews') return ok(reviews(c));
    if (p[2] === 'files') return ok(files(c));
    if (p[2] === 'commits') return ok([{ sha: c.sha, commit: { message: `Change ${c.number}`, author: { name: 'Mia', date: '2026-11-02T09:00:00Z' } } }]);
    return ok([]);
  }
  const ck = /^\/commits\/([0-9a-f]{40})\/(check-runs|status)$/.exec(rest);
  if (ck) {
    const c = w.changes.find((x) => x.sha === ck[1]) ?? { number: 0, sha: ck[1]!, rev: 0, checks: 'success' as const, reviews: 0, base: w.main };
    return ok(ck[2] === 'status' ? combined(c) : checkRuns(c));
  }
  const iss = /^\/issues\/(\d+)\/comments$/.exec(rest);
  if (iss) return ok([{ id: Number(iss[1]) * 7, user: user('lead-1'), body: 'Looks good.', created_at: '2026-11-02T09:00:00Z' }]);
  if (rest === '/issues') return ok(Array.from({ length: 4 }, (_, i) => ({ number: 300 + i, title: `Request ${i}`, state: 'open', labels: [{ name: 'design-request' }], user: user('designer-1') })));
  const tr = /^\/git\/trees\/([^/]+)$/.exec(rest);
  if (tr) return ok(tree(w, /^[0-9a-f]{40}$/.test(tr[1]!) ? tr[1]! : w.main));
  if (/^\/git\/blobs\/[0-9a-f]{40}$/.test(rest)) return { status: 200, body: `{"summary":"A component.","rest":"${'x'.repeat(1500)}"}`, type: 'application/vnd.github.raw' };
  if (/^\/git\/(ref|refs|matching-refs)\//.test(rest)) return ok({ ref: 'refs/heads/main', object: { sha: w.main, type: 'commit' } });
  if (rest === '/branches') return ok([{ name: 'main', commit: { sha: w.main } }, ...w.changes.map((c) => ({ name: `bridge/change-${c.number}`, commit: { sha: c.sha } }))]);
  if (rest.startsWith('/branches/')) return ok({ name: 'main', commit: { sha: w.main }, protected: true });
  if (rest === '/commits') return ok([{ sha: w.main, commit: { message: 'Release', author: { name: 'Dana', date: '2026-11-01T09:00:00Z' } } }]);
  if (rest.startsWith('/commits/')) return ok({ sha: rest.slice(9), commit: { message: 'x' } });
  if (rest.startsWith('/compare/')) return ok({ status: 'ahead', ahead_by: 1, behind_by: 0, files: [] });
  if (rest.startsWith('/contents/')) {
    const ref = search.get('ref') ?? 'main';
    if (rest.startsWith('/contents/snapshot.json') && ref === 'nope') return { status: 404, body: '{"message":"Not Found"}' };
    const raw = `{"path":"${rest.slice(10)}","ref":"${ref === 'main' ? w.main : ref}","items":${JSON.stringify(Array.from({ length: 20 }, (_, i) => `token-${i}`))}}`;
    return { status: 200, body: raw, type: 'application/vnd.github.raw' };
  }
  if (rest === '/labels' || rest === '/tags' || rest === '/releases' || rest === '/deployments' || rest === '/rulesets' || rest === '/collaborators') return ok([]);
  if (rest === '/releases/latest') return ok({ tag_name: 'v0.26.14', name: '0.26.14' });
  return ok({ path: rest });
}

/**
 * The fake GitHub: `fetch` for ContribDeps, the call log, in-flight concurrency. `tokenBoundEtags`: the ETag also
 * depends on the token that asked (the pessimistic reading of GitHub's docs: a new installation token, minted by
 * another warm function or every 30 minutes, then misses the kept ETag once).
 */
export function fakeGitHub(w: FakeWorld, now: () => number, o: { latencyTurns?: number; tokenBoundEtags?: boolean } = {}) {
  const calls: Call[] = [];
  const served = new Map<string, string>();
  const flying = new Map<string, number>();
  let inFlight = 0;
  let peakInFlight = 0;
  const turns = o.latencyTurns ?? 3;
  const fetch: FetchLike = async (url, init) => {
    const u = new URL(url);
    if (u.origin !== 'https://api.github.com') throw new Error(`fake GitHub: unexpected ${u.origin}`);
    if (init.method !== 'GET') throw new Error(`fake GitHub: unexpected ${init.method} ${u.pathname}`);
    const path = u.pathname + u.search;
    const overlapping = (flying.get(path) ?? 0) > 0;
    flying.set(path, (flying.get(path) ?? 0) + 1);
    inFlight += 1;
    peakInFlight = Math.max(peakInFlight, inFlight);
    try {
      // A few turns of the event loop: requests fired together are in flight together (no answer before all start).
      for (let i = 0; i < turns; i++) await new Promise((r) => setImmediate(r));
      const a = answer(w, u.pathname, u.searchParams);
      const etag = etagOf(`${init.headers.Accept ?? ''} ${o.tokenBoundEtags ? init.headers.Authorization : ''} ${a.body}`);
      const inm = init.headers['If-None-Match'];
      if (a.status === 200 && inm && inm === etag) {
        calls.push({ at: now(), path, kind: 'free', status: 304, unchanged: true, overlapping });
        return new Response(null, { status: 304, headers: { ETag: etag } });
      }
      calls.push({ at: now(), path, kind: 'counted', status: a.status, unchanged: served.get(path) === etag, overlapping });
      served.set(path, etag);
      return new Response(a.body, { status: a.status, headers: { ETag: etag, 'Content-Type': a.type ?? 'application/json; charset=utf-8' } });
    } finally {
      inFlight -= 1;
      flying.set(path, flying.get(path)! - 1);
    }
  };
  return {
    fetch,
    calls,
    peak: () => peakInFlight,
    resetPeak: () => {
      peakInFlight = inFlight;
    },
  };
}
