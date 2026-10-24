// A stand-in GitHub for the fixture teams of `npm run dev:scenario` (dev/scenarios.ts), `npm run dev:full` only.
//
// A scenario team (acme/acme-design, lumen/studio-ds...) does not exist on GitHub, so its Studio and Library pages
// would fail to load. Locally, the server-side functions reach GitHub through one fetch (dev/local-api.ts): this file
// answers the calls for a fixture team, read-only, with this repository's own files at the commit checked out when
// the server started (the same shape as the sample team: bridge.config.json, tokens, component docs). Its
// bridge.config.json carries the fixture team's name and address. Every other call goes to the real GitHub.
//
// What it answers (GET, under /repos/<fixture>): the repository (private, default branch main), branches, refs,
// commits, the recursive tree, blobs (raw or base64), contents; empty lists for pull requests, issues, collaborators,
// checks, deployments, tags and rulesets (a team seeded with build requests, S19, gets the sample ones instead); 404 for anything else. Any write answers 403 with a sentence that says why.
// A writable fixture (S20) is served by dev/local-repo.ts instead: reads and writes, with the local GitHub personas.
// Plus the installation token calls of the Bridge app for a fixture repository, so real GitHub App keys in .env.local
// do not stop fixture teams from loading.
//
// Never part of the build: loaded by dev/local-api.ts only (BRIDGE_LOCAL=1).

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import type { AppTokens } from '../api/_lib/github-app.js';
import type { FetchLike } from '../api/_lib/http.js';
import type { Redis } from '../api/_lib/redis.js';
import { callerOf, draftMutation, PERSONAS, pullOfNode, writableRepo } from './local-repo.js';

/** The fixture teams, lower case "owner/repo", and each one's record { name }. Written by dev/scenarios.ts. */
export const FIXTURES_KEY = 'bridge:local:fixtures';
export const fixtureKey = (repo: string) => `bridge:local:fixture:${repo.trim().toLowerCase()}`;

export interface Fixture {
  repo: string;
  name: string;
  /** Serve sample build requests (lib/building-sample.ts) as its issues and pull requests (Being built). */
  builds?: boolean;
  /**
   * Writable (dev/local-repo.ts): branches, commits, pull requests, reviews, merges and issues are kept locally, and
   * the GitHub personas (dana, malik) are its owners, so the change lifecycle runs with no GitHub.
   */
  writable?: boolean;
}

export async function putFixture(redis: Redis, f: Fixture): Promise<void> {
  const repo = f.repo.trim().toLowerCase();
  await redis.pipe([
    ['SADD', FIXTURES_KEY, repo],
    ['SET', fixtureKey(repo), JSON.stringify({ repo, name: f.name, ...(f.builds ? { builds: true } : {}), ...(f.writable ? { writable: true } : {}) })],
  ]);
}

export async function getFixture(redis: Redis, repo: string): Promise<Fixture | null> {
  const raw = await redis.cmd('GET', fixtureKey(repo));
  if (typeof raw !== 'string') return null;
  try {
    const v = JSON.parse(raw) as Fixture;
    return v && typeof v.repo === 'string' && typeof v.name === 'string' ? v : null;
  } catch {
    return null;
  }
}

/** The local files a fixture team is made of: git objects of one commit of a repository on this computer. */
export interface FixtureFiles {
  commit: string;
  /** Path, blob sha, size, for every file of the commit. */
  files: { path: string; sha: string; size: number }[];
  read(sha: string): Buffer | null;
}

export function gitFiles(repoRoot: string): FixtureFiles {
  const git = (...args: string[]) => execFileSync('git', ['-C', repoRoot, ...args], { maxBuffer: 64 * 1024 * 1024 });
  const commit = git('rev-parse', 'HEAD').toString().trim();
  const files = git('ls-tree', '-r', '-l', commit)
    .toString()
    .split('\n')
    .flatMap((line) => {
      // <mode> blob <sha> <size>\t<path>
      const m = /^\d+ blob ([0-9a-f]{40})\s+(\d+)\t(.+)$/.exec(line);
      return m ? [{ path: m[3]!, sha: m[1]!, size: Number(m[2]) }] : [];
    });
  const known = new Set(files.map((f) => f.sha));
  return {
    commit,
    files,
    read(sha) {
      if (!known.has(sha)) return null;
      try {
        return git('cat-file', 'blob', sha);
      } catch {
        return null;
      }
    },
  };
}

const API = 'https://api.github.com';
const INSTALLATION_ID = 4_242_424;
export const FIXTURE_TOKEN = 'ghs_bridgelocalfixture000000000000000000';
export const READ_ONLY = 'This is a local fixture team: it is read-only. Writes need a real repository and a GitHub App.';
const CONFIG = 'bridge.config.json';

const blobSha = (body: Buffer) => createHash('sha1').update(`blob ${body.length}\0`).update(body).digest('hex');
const treeSha = (commit: string, repo: string) => createHash('sha1').update(`tree:${commit}:${repo}`).digest('hex');

/** A JSON request body (string or bytes), or null. */
function parseBody(b: unknown): unknown {
  if (b === undefined || b === null) return null;
  try {
    const text = typeof b === 'string' ? b : b instanceof Uint8Array ? Buffer.from(b).toString('utf8') : b instanceof ArrayBuffer ? Buffer.from(b).toString('utf8') : String(b);
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}

const jsonRes = (status: number, data: unknown) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
const notFound = () => jsonRes(404, { message: 'Not Found', documentation_url: 'https://docs.github.com/rest' });

/** bridge.config.json of the fixture: the team's name and its address, the rest as in the source. */
function configFor(source: Buffer | null, f: Fixture): Buffer | null {
  if (!source) return null;
  try {
    const c = JSON.parse(source.toString('utf8')) as Record<string, any>;
    const [owner, name] = f.repo.split('/');
    c.name = f.name;
    c.repo = { ...(c.repo ?? {}), owner, name, defaultBranch: 'main' };
    // A writable fixture: its GitHub people are the local personas (dev/local-repo.ts), one design and one tech owner,
    // so the review gate asks the people a reviewer can sign in as.
    if (f.writable) {
      const g = (c.governance ?? {}) as Record<string, any>;
      c.governance = { ...g, owners: { design: ['dana'], tech: ['malik'] }, soloOwnerCanApproveBoth: false, override: { ...(g.override ?? {}), allowed: ['malik'] } };
    }
    return Buffer.from(`${JSON.stringify(c, null, 2)}\n`);
  } catch {
    return source;
  }
}

/** The files of one fixture team: the source files, with its own bridge.config.json. */
function teamFiles(src: FixtureFiles, f: Fixture) {
  const conf = src.files.find((x) => x.path === CONFIG);
  const body = configFor(conf ? src.read(conf.sha) : null, f);
  const confSha = body ? blobSha(body) : null;
  const files = src.files.map((x) => (x.path === CONFIG && body && confSha ? { ...x, sha: confSha, size: body.length } : x));
  const read = (sha: string) => (sha === confSha ? body : src.read(sha));
  return { files, read };
}

/**
 * A fetch that answers GitHub calls for fixture teams and passes every other call to `next`. `files` is read once,
 * on the first fixture call (a git command), so a server without scenarios never runs git.
 */
/** The sample build requests module (lib/building-sample.ts), loaded only when a team seeded with them asks. */
export type SampleBuilds = () => Promise<Pick<typeof import('../src/lib/building-sample.js'), 'sampleBuildData'>>;

/**
 * `samples`: never a static import. This file loads with astro.config.mjs, where workspace packages resolve to their
 * built dist (absent on a fresh checkout, so `npm run dev:full` would not start); the dev server passes its own loader,
 * which reads @bridge-ds/core from source like every page.
 */
export function fixtureGithub(redis: Redis, files: () => FixtureFiles, next: FetchLike, now: () => number = Date.now, samples: SampleBuilds = () => import('../src/lib/building-sample.js')): FetchLike {
  let src: FixtureFiles | null = null;
  const source = () => (src ??= files());
  return async (url, init) => {
    if (!url.startsWith(`${API}/`)) return next(url, init);
    const u = new URL(url);
    const method = (init?.method ?? 'GET').toUpperCase();
    // The Bridge app's installation token for a fixture repository (real GitHub App keys in .env.local).
    const tok = /^\/app\/installations\/(\d+)\/access_tokens$/.exec(u.pathname);
    if (tok && Number(tok[1]) === INSTALLATION_ID) {
      return jsonRes(201, { token: FIXTURE_TOKEN, expires_at: new Date(now() + 3_600_000).toISOString(), permissions: { contents: 'write', pull_requests: 'write', issues: 'write', administration: 'write', metadata: 'read' } });
    }
    const auth = new Headers(init?.headers).get('authorization');
    const caller = callerOf(auth, FIXTURE_TOKEN);
    // GraphQL: draft and ready for review of a writable fixture's pull request (core markReadyForReview, convertToDraft).
    if (u.pathname === '/graphql' && method === 'POST') {
      const q = parseBody(init?.body) as { query?: string; variables?: { id?: unknown } } | null;
      const target = pullOfNode(q?.variables?.id);
      const fx = target ? await getFixture(redis, target.repo) : null;
      if (target && fx?.writable && caller) return draftMutation(redis, fx.repo, target.number, /convertPullRequestToDraft/.test(q?.query ?? ''), now);
      if (target) return jsonRes(200, { data: null, errors: [{ message: 'Could not resolve to a PullRequest.' }] });
      return next(url, init);
    }
    // A local GitHub persona (dev/local-repo.ts PERSONAS): who they are. Their other calls outside fixtures go out
    // without the local token.
    if (caller && PERSONAS[caller] && !u.pathname.startsWith('/repos/')) {
      if (u.pathname === '/user') return jsonRes(200, { login: caller, id: 1000 + Object.keys(PERSONAS).indexOf(caller), name: PERSONAS[caller]!.name, avatar_url: '', type: 'User', html_url: `https://github.com/${caller}` });
      const who = /^\/users\/([^/]+)$/.exec(u.pathname);
      if (who && PERSONAS[decodeURIComponent(who[1]!)]) {
        const l = decodeURIComponent(who[1]!);
        return jsonRes(200, { login: l, name: PERSONAS[l]!.name, avatar_url: '', type: 'User', html_url: `https://github.com/${l}` });
      }
    }
    const m = /^\/repos\/([^/]+)\/([^/]+)(\/.*)?$/.exec(u.pathname);
    if (!m) return next(url, init);
    const repo = `${decodeURIComponent(m[1]!)}/${decodeURIComponent(m[2]!)}`.toLowerCase();
    const f = await getFixture(redis, repo);
    if (!f) return next(url, init);
    const rest = m[3] ?? '';
    if (f.writable) {
      const s = source();
      const team = teamFiles(s, f);
      const raw = /raw/i.test(new Headers(init?.headers).get('accept') ?? '');
      return writableRepo(redis, { repo: f.repo, commit: s.commit, tree: treeSha(s.commit, f.repo), files: team.files, read: team.read }, { method, rest, url: u, body: parseBody(init?.body), raw, caller }, now);
    }
    if (method !== 'GET' && method !== 'HEAD') return jsonRes(403, { message: READ_ONLY });
    const s = source();
    const team = teamFiles(s, f);
    const [owner, name] = f.repo.split('/') as [string, string];
    const date = new Date(0).toISOString();
    const tree = treeSha(s.commit, f.repo);
    const commit = { sha: s.commit, node_id: 'local', commit: { message: 'Local fixture', tree: { sha: tree }, author: { name: 'Bridge local', email: 'local@bridge.invalid', date }, committer: { name: 'Bridge local', email: 'local@bridge.invalid', date } }, parents: [], author: null, committer: null, html_url: '' };
    const raw = /raw/i.test(new Headers(init?.headers).get('accept') ?? '');
    const isRef = (r: string) => r === 'main' || r === s.commit || r === 'heads/main' || r === 'refs/heads/main';

    if (rest === '' || rest === '/') {
      return jsonRes(200, {
        id: 1, name, full_name: f.repo, private: true, visibility: 'private', default_branch: 'main', fork: false, archived: false,
        owner: { login: owner, id: 1, type: 'Organization', avatar_url: '' },
        permissions: { admin: false, maintain: false, push: true, triage: true, pull: true },
        html_url: `https://github.com/${f.repo}`, pushed_at: date, updated_at: date,
      });
    }
    if (rest === '/installation') return jsonRes(200, { id: INSTALLATION_ID, app_slug: 'bridge-local' });
    let p: RegExpExecArray | null;
    if (rest === '/branches') return jsonRes(200, [{ name: 'main', commit: { sha: s.commit }, protected: false }]);
    if ((p = /^\/branches\/(.+?)(\/protection)?$/.exec(rest))) {
      if (!isRef(decodeURIComponent(p[1]!)) || p[2]) return notFound();
      return jsonRes(200, { name: 'main', commit, protected: false });
    }
    if ((p = /^\/git\/refs?\/(.+)$/.exec(rest))) {
      return isRef(decodeURIComponent(p[1]!)) ? jsonRes(200, { ref: 'refs/heads/main', object: { sha: s.commit, type: 'commit' } }) : notFound();
    }
    if ((p = /^\/(?:git\/)?commits\/([^/]+)$/.exec(rest))) {
      return isRef(decodeURIComponent(p[1]!)) ? jsonRes(200, { ...commit, tree: { sha: tree } }) : notFound();
    }
    if ((p = /^\/commits\/([^/]+)\/status$/.exec(rest))) return jsonRes(200, { state: 'success', statuses: [], total_count: 0, sha: s.commit });
    if (rest === '/commits') return jsonRes(200, [commit]);
    if ((p = /^\/git\/trees\/(.+)$/.exec(rest))) {
      const ref = decodeURIComponent(p[1]!);
      if (!isRef(ref) && ref !== tree) return notFound();
      return jsonRes(200, { sha: tree, truncated: false, tree: team.files.map((x) => ({ path: x.path, mode: '100644', type: 'blob', sha: x.sha, size: x.size })) });
    }
    if ((p = /^\/git\/blobs\/([0-9a-f]{40})$/.exec(rest))) {
      const body = team.read(p[1]!);
      if (!body) return notFound();
      if (raw) return new Response(new Uint8Array(body), { status: 200, headers: { 'Content-Type': 'application/vnd.github.raw' } });
      return jsonRes(200, { sha: p[1], size: body.length, encoding: 'base64', content: body.toString('base64') });
    }
    if ((p = /^\/contents(?:\/(.*))?$/.exec(rest))) {
      const ref = u.searchParams.get('ref');
      if (ref && !isRef(ref)) return notFound();
      const path = decodeURIComponent(p[1] ?? '').replace(/\/+$/, '');
      const file = team.files.find((x) => x.path === path);
      if (file) {
        const body = team.read(file.sha);
        if (!body) return notFound();
        if (raw) return new Response(new Uint8Array(body), { status: 200, headers: { 'Content-Type': 'application/vnd.github.raw' } });
        return jsonRes(200, { type: 'file', name: path.split('/').pop(), path, sha: file.sha, size: body.length, encoding: 'base64', content: body.toString('base64') });
      }
      const prefix = path ? `${path}/` : '';
      const below = team.files.filter((x) => x.path.startsWith(prefix));
      if (!below.length) return notFound();
      const seen = new Map<string, { type: 'file' | 'dir'; name: string; path: string; sha: string; size: number }>();
      for (const x of below) {
        const [head, ...tail] = x.path.slice(prefix.length).split('/');
        const entry = tail.length ? { type: 'dir' as const, name: head!, path: `${prefix}${head}`, sha: treeSha(x.path, head!), size: 0 } : { type: 'file' as const, name: head!, path: x.path, sha: x.sha, size: x.size };
        if (!seen.has(head!)) seen.set(head!, entry);
      }
      return jsonRes(200, [...seen.values()]);
    }
    // Build requests (Being built): the sample ones, for a fixture team seeded with them (S19).
    if (f.builds && (rest === '/issues' || rest === '/pulls')) {
      const data = (await samples()).sampleBuildData(now(), f.repo);
      if (rest === '/pulls') return jsonRes(200, data.pulls);
      const want = (u.searchParams.get('labels') ?? '').split(',').filter(Boolean);
      const state = u.searchParams.get('state') ?? 'open';
      return jsonRes(
        200,
        data.issues.filter((i) => (state === 'all' || i.state === state) && want.every((l) => i.labels.some((x) => (typeof x === 'string' ? x : x.name) === l))),
      );
    }
    if (/^\/(pulls|issues|check-runs|deployments|tags|rulesets|collaborators|commits\/[^/]+\/(statuses|pulls))(\?|$|\/?$)/.test(rest)) {
      return jsonRes(200, rest.startsWith('/check-runs') ? { total_count: 0, check_runs: [] } : []);
    }
    return notFound();
  };
}

/**
 * The Bridge app for fixture teams when this computer has no GitHub App keys: an installation token for a fixture
 * repository, none for any other (the usual "not available yet" answers). With keys, the functions build the real app
 * and the fixture fetch answers its installation calls for fixture repositories.
 */
export function fixtureApp(redis: Redis): AppTokens {
  return {
    async installationToken(owner, repo) {
      return (await getFixture(redis, `${owner}/${repo}`)) ? FIXTURE_TOKEN : null;
    },
  };
}
