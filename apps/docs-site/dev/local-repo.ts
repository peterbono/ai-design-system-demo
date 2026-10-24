// A writable stand-in GitHub for one fixture team of `npm run dev:full` (dev/local-github.ts serves the read-only
// ones). It holds what Studio, the proxy (api/contribute), the CLI and core github-client.ts write to a repository:
// branches, blobs, trees, commits, contents, pull requests (draft and ready, reviews, requested reviewers, comments,
// labels, merge), issues and their comments, so the change lifecycle (Send for review, Request changes, Approve,
// merge, History) runs on a laptop with no GitHub at all.
//
// State lives in the local store (the Redis of dev/local-api.ts, saved to .bridge-local/redis.json):
//   bridge:local:git:<repo>             { refs, items, next, comments, reviews, reviewComments, seq }
//   bridge:local:git:obj:<repo>:<sha>   one object: { type: 'blob', b64 } | { type: 'tree', base, changes } |
//                                       { type: 'commit', tree, parents, message, author, date }
// The first commit of main is the fixture's source commit (the files of this checkout, its own bridge.config.json):
// its blobs are read from git, never copied. Shas are sha1 of the content (blobs as git computes them).
//
// Who calls: the Authorization token. FIXTURE_TOKEN is the Bridge app (the proxy and the server), shown as
// bridge-design-studio[bot]; `ghp_local_<login>` is a GitHub persona of the browser (dev/local-api.ts serves
// /api/dev/github for them). Writes are refused unless local mode is on (localAdminsOn: BRIDGE_LOCAL=1, no VERCEL,
// NODE_ENV not production), on top of this file being loaded by dev/local-api.ts only.

import { createHash } from 'node:crypto';
import { localAdminsOn } from '../api/_lib/local-admin.js';
import type { Redis } from '../api/_lib/redis.js';

export const APP_LOGIN = 'bridge-design-studio[bot]';
export const PERSONA_PREFIX = 'ghp_local_';

/** The GitHub people of a writable fixture team: a design owner who is admin, and a tech owner who ships. */
export const PERSONAS: Record<string, { name: string; admin: boolean }> = {
  dana: { name: 'Dana Whitfield', admin: true },
  malik: { name: 'Malik Osei', admin: false },
};

/** The token of a persona (fixed, local only). */
export const personaToken = (login: string) => `${PERSONA_PREFIX}${login}`;

/** The login a token stands for: a persona, the Bridge app, or null. */
export function callerOf(auth: string | null | undefined, appToken: string): string | null {
  const t = (auth ?? '').replace(/^(Bearer|token)\s+/i, '').trim();
  if (!t) return null;
  if (t === appToken) return APP_LOGIN;
  if (t.startsWith(PERSONA_PREFIX)) {
    const login = t.slice(PERSONA_PREFIX.length);
    return PERSONAS[login] ? login : null;
  }
  return null;
}

const sha1 = (s: string | Buffer) => createHash('sha1').update(s).digest('hex');
const blobSha = (body: Buffer) => createHash('sha1').update(`blob ${body.length}\0`).update(body).digest('hex');

type Entry = { sha: string; mode: string };
type Obj =
  | { type: 'blob'; b64: string }
  | { type: 'tree'; base: string | null; changes: Record<string, Entry | null> }
  | { type: 'commit'; tree: string; parents: string[]; message: string; author: string; date: string };

interface User {
  login: string;
}
interface Item {
  number: number;
  pull: boolean;
  title: string;
  body: string;
  user: string;
  state: 'open' | 'closed';
  state_reason?: string | null;
  labels: string[];
  assignees: string[];
  created_at: string;
  updated_at: string;
  closed_at: string | null;
  // pull requests
  draft?: boolean;
  head?: string;
  base?: string;
  /** Head sha kept once the pull request is closed or merged. */
  headSha?: string;
  merged_at?: string | null;
  merged_by?: string | null;
  merge_commit_sha?: string | null;
  requested?: string[];
}
interface Comment {
  id: number;
  number: number;
  user: string;
  body: string;
  created_at: string;
  updated_at: string;
}
interface Review {
  id: number;
  number: number;
  user: string;
  state: 'APPROVED' | 'CHANGES_REQUESTED' | 'COMMENTED' | 'DISMISSED';
  body: string;
  commit_id: string;
  submitted_at: string;
}
interface ReviewComment {
  id: number;
  number: number;
  user: string;
  body: string;
  path: string;
  line: number | null;
  in_reply_to_id?: number;
  created_at: string;
}
interface State {
  refs: Record<string, string>;
  items: Item[];
  next: number;
  comments: Comment[];
  reviews: Review[];
  reviewComments: ReviewComment[];
  seq: number;
}

export interface RepoBase {
  /** owner/name as the fixture names it. */
  repo: string;
  commit: string;
  tree: string;
  files: { path: string; sha: string; size: number }[];
  read(sha: string): Buffer | null;
}

const stateKey = (repo: string) => `bridge:local:git:${repo.toLowerCase()}`;
const objKey = (repo: string, sha: string) => `bridge:local:git:obj:${repo.toLowerCase()}:${sha}`;

const jsonRes = (status: number, data: unknown, headers: Record<string, string> = {}) =>
  new Response(status === 204 ? null : JSON.stringify(data), { status, headers: status === 204 ? headers : { 'Content-Type': 'application/json; charset=utf-8', ...headers } });
const notFound = () => jsonRes(404, { message: 'Not Found', documentation_url: 'https://docs.github.com/rest' });
const unprocessable = (message: string) => jsonRes(422, { message, documentation_url: 'https://docs.github.com/rest' });

/** Per repository: one request at a time (a read-modify-write of the state must not interleave). */
const locks = new Map<string, Promise<unknown>>();
function serial<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(key) ?? Promise.resolve();
  const run = prev.then(fn, fn);
  locks.set(
    key,
    run.catch(() => undefined),
  );
  return run;
}

/** Immutable objects read once per process. */
const objCache = new Map<string, Obj>();
const flatCache = new Map<string, Map<string, Entry>>();

export const READ_ONLY_OFF = 'Local writes are on only in npm run dev:full (BRIDGE_LOCAL=1).';

/**
 * The handler of one writable fixture repository. `rest` is the path after /repos/<owner>/<repo> (decoded parts kept
 * encoded), `u` the full URL. Answers like GitHub's REST API for the calls Bridge makes.
 */
export async function writableRepo(
  redis: Redis,
  base: RepoBase,
  req: { method: string; rest: string; url: URL; body: unknown; raw: boolean; caller: string | null },
  now: () => number,
  env: Record<string, string | undefined> = process.env,
): Promise<Response> {
  return serial(base.repo.toLowerCase(), () => handle(redis, base, req, now, env));
}

async function handle(redis: Redis, base: RepoBase, req: { method: string; rest: string; url: URL; body: unknown; raw: boolean; caller: string | null }, now: () => number, env: Record<string, string | undefined>): Promise<Response> {
  const { method, rest, url, raw, caller } = req;
  const body = (req.body ?? {}) as Record<string, any>;
  const repo = base.repo;
  const [owner, name] = repo.split('/') as [string, string];
  const iso = () => new Date(now()).toISOString();
  const pending: (string | number)[][] = [];

  // --- state and objects ------------------------------------------------------------------------------------------
  const rawState = await redis.cmd('GET', stateKey(repo));
  let st: State;
  try {
    st = typeof rawState === 'string' ? (JSON.parse(rawState) as State) : (null as never);
  } catch {
    st = null as never;
  }
  if (!st || typeof st !== 'object' || !st.refs) st = { refs: { main: base.commit }, items: [], next: 1, comments: [], reviews: [], reviewComments: [], seq: 1 };
  let dirty = false;
  const touch = () => (dirty = true);

  const getObj = async (sha: string): Promise<Obj | null> => {
    const k = objKey(repo, sha);
    const hit = objCache.get(k);
    if (hit) return hit;
    if (sha === base.commit) return { type: 'commit', tree: base.tree, parents: [], message: 'Local fixture', author: 'bridge-local', date: new Date(0).toISOString() };
    if (sha === base.tree) return { type: 'tree', base: null, changes: {} };
    const v = await redis.cmd('GET', k);
    if (typeof v === 'string') {
      const o = JSON.parse(v) as Obj;
      objCache.set(k, o);
      return o;
    }
    const src = base.read(sha);
    if (src) return { type: 'blob', b64: src.toString('base64') };
    return null;
  };
  const putObj = (sha: string, o: Obj) => {
    const k = objKey(repo, sha);
    if (objCache.has(k)) return;
    objCache.set(k, o);
    pending.push(['SET', k, JSON.stringify(o)]);
  };
  const blobText = async (sha: string): Promise<Buffer | null> => {
    const o = await getObj(sha);
    return o && o.type === 'blob' ? Buffer.from(o.b64, 'base64') : null;
  };
  const flat = async (treeSha: string): Promise<Map<string, Entry> | null> => {
    const k = `${repo.toLowerCase()}:${treeSha}`;
    const hit = flatCache.get(k);
    if (hit) return hit;
    let out: Map<string, Entry>;
    if (treeSha === base.tree) out = new Map(base.files.map((f) => [f.path, { sha: f.sha, mode: '100644' }]));
    else {
      const o = await getObj(treeSha);
      if (!o || o.type !== 'tree') return null;
      const from = o.base ? await flat(o.base) : new Map<string, Entry>();
      if (!from) return null;
      out = new Map(from);
      for (const [p, e] of Object.entries(o.changes)) {
        if (e) out.set(p, e);
        else {
          out.delete(p);
          // A folder removed: everything below it.
          for (const q of [...out.keys()]) if (q.startsWith(`${p}/`)) out.delete(q);
        }
      }
    }
    flatCache.set(k, out);
    return out;
  };
  const newBlob = (buf: Buffer) => {
    const sha = blobSha(buf);
    if (!base.read(sha)) putObj(sha, { type: 'blob', b64: buf.toString('base64') });
    return sha;
  };
  const newTree = (baseTree: string | null, changes: Record<string, Entry | null>) => {
    const sha = sha1(JSON.stringify({ base: baseTree, changes: Object.entries(changes).sort(([a], [b]) => (a < b ? -1 : 1)) }));
    putObj(sha, { type: 'tree', base: baseTree, changes });
    return sha;
  };
  const newCommit = (tree: string, parents: string[], message: string, author: string) => {
    const date = iso();
    const sha = sha1(JSON.stringify({ tree, parents, message, author, date, n: st.seq++ }));
    touch();
    putObj(sha, { type: 'commit', tree, parents, message, author, date });
    return sha;
  };
  const commitOf = async (sha: string) => {
    const o = await getObj(sha);
    return o && o.type === 'commit' ? o : null;
  };
  /** A branch name, a full sha, refs/heads/x or heads/x: the commit sha, else null. */
  const resolve = async (ref: string | null | undefined): Promise<string | null> => {
    const r = (ref ?? 'main').replace(/^refs\//, '').replace(/^heads\//, '');
    if (st.refs[r]) return st.refs[r]!;
    if (/^[0-9a-f]{40}$/.test(r) && (await commitOf(r))) return r;
    return null;
  };
  const treeOfCommit = async (sha: string) => (await commitOf(sha))?.tree ?? null;
  const ancestors = async (sha: string): Promise<Set<string>> => {
    const seen = new Set<string>();
    const todo = [sha];
    while (todo.length) {
      const s = todo.pop()!;
      if (seen.has(s)) continue;
      seen.add(s);
      const c = await commitOf(s);
      if (c) todo.push(...c.parents);
    }
    return seen;
  };
  /** Commits reachable from `head` and not from `baseSha`, oldest first. */
  const between = async (baseSha: string, head: string): Promise<string[]> => {
    const not = await ancestors(baseSha);
    const out: { sha: string; date: string }[] = [];
    for (const s of await ancestors(head)) if (!not.has(s)) out.push({ sha: s, date: (await commitOf(s))!.date });
    return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)).map((x) => x.sha);
  };
  const mergeBase = async (a: string, b: string): Promise<string> => {
    const left = await ancestors(a);
    // Breadth first from b: the first commit both reach.
    const todo = [b];
    const seen = new Set<string>();
    while (todo.length) {
      const s = todo.shift()!;
      if (seen.has(s)) continue;
      seen.add(s);
      if (left.has(s)) return s;
      const c = await commitOf(s);
      if (c) todo.push(...c.parents);
    }
    return base.commit;
  };
  /** Files that differ between two trees: GitHub's file entries. */
  const diff = async (fromTree: string, toTree: string) => {
    const a = (await flat(fromTree)) ?? new Map<string, Entry>();
    const b = (await flat(toTree)) ?? new Map<string, Entry>();
    const files: { filename: string; status: 'added' | 'removed' | 'modified'; sha: string | null; additions: number; deletions: number; changes: number }[] = [];
    const lines = async (sha: string | undefined) => (sha ? ((await blobText(sha))?.toString('utf8').split('\n').length ?? 0) : 0);
    for (const [p, e] of b) {
      const old = a.get(p);
      if (!old) {
        const n = await lines(e.sha);
        files.push({ filename: p, status: 'added', sha: e.sha, additions: n, deletions: 0, changes: n });
      } else if (old.sha !== e.sha) {
        const [x, y] = await Promise.all([blobText(old.sha), blobText(e.sha)]);
        const before = new Set((x?.toString('utf8') ?? '').split('\n'));
        const after = new Set((y?.toString('utf8') ?? '').split('\n'));
        const add = [...after].filter((l) => !before.has(l)).length;
        const del = [...before].filter((l) => !after.has(l)).length;
        files.push({ filename: p, status: 'modified', sha: e.sha, additions: add, deletions: del, changes: add + del });
      }
    }
    for (const [p, e] of a) if (!b.has(p)) {
      const n = await lines(e.sha);
      files.push({ filename: p, status: 'removed', sha: null, additions: 0, deletions: n, changes: n });
    }
    return files.sort((x, y) => (x.filename < y.filename ? -1 : 1));
  };
  /** Head changes applied on top of the base branch; null on a conflict (both changed one file differently). */
  const mergedTree = async (baseHead: string, head: string): Promise<string | null> => {
    const mb = await mergeBase(baseHead, head);
    const [mbT, baseT, headT] = await Promise.all([treeOfCommit(mb), treeOfCommit(baseHead), treeOfCommit(head)]);
    if (!mbT || !baseT || !headT) return null;
    if (mb === baseHead) return headT;
    const [m0, b0, h0] = await Promise.all([flat(mbT), flat(baseT), flat(headT)]);
    const changes: Record<string, Entry | null> = {};
    const paths = new Set([...m0!.keys(), ...h0!.keys()]);
    for (const p of paths) {
      const was = m0!.get(p)?.sha;
      const theirs = h0!.get(p)?.sha;
      if (was === theirs) continue;
      const ours = b0!.get(p)?.sha;
      if (ours !== was && ours !== theirs) return null;
      changes[p] = h0!.get(p) ?? null;
    }
    return Object.keys(changes).length ? newTree(baseT, changes) : baseT;
  };

  const userOf = (login: string) => {
    const bot = login.endsWith('[bot]');
    return { login, id: Number.parseInt(sha1(login).slice(0, 8), 16), type: bot ? 'Bot' : 'User', avatar_url: '', html_url: `https://github.com/${bot ? `apps/${login.replace(/\[bot\]$/, '')}` : login}`, ...(PERSONAS[login] ? { name: PERSONAS[login]!.name } : {}) };
  };
  const htmlRepo = `https://github.com/${repo}`;
  const commitJson = async (sha: string, withFiles = false) => {
    const c = (await commitOf(sha))!;
    const who = c.author;
    const person = { name: PERSONAS[who]?.name ?? who.replace(/\[bot\]$/, ''), email: `${who.replace(/\[bot\]$/, '')}@bridge.invalid`, date: c.date };
    const out: Record<string, unknown> = {
      sha,
      node_id: `LOCALC:${sha}`,
      commit: { message: c.message, tree: { sha: c.tree }, author: person, committer: person },
      parents: c.parents.map((p) => ({ sha: p })),
      author: who === 'bridge-local' ? null : userOf(who),
      committer: who === 'bridge-local' ? null : userOf(who),
      html_url: `${htmlRepo}/commit/${sha}`,
    };
    if (withFiles) {
      const parentTree = c.parents[0] ? await treeOfCommit(c.parents[0]) : null;
      const files = parentTree ? await diff(parentTree, c.tree) : [];
      out.files = files;
      out.stats = { additions: files.reduce((n, f) => n + f.additions, 0), deletions: files.reduce((n, f) => n + f.deletions, 0), total: files.reduce((n, f) => n + f.changes, 0) };
    }
    return out;
  };
  const headShaOf = (it: Item) => (it.state === 'open' && it.head && st.refs[it.head] ? st.refs[it.head]! : (it.headSha ?? null));
  const pullJson = async (it: Item) => {
    const head = headShaOf(it);
    const baseSha = st.refs[it.base ?? 'main'] ?? base.commit;
    let mergeable: boolean | null = true;
    let mergeableState = it.draft ? 'draft' : 'clean';
    if (it.state === 'open' && head) {
      const t = await mergedTree(baseSha, head);
      if (t === null) {
        mergeable = false;
        mergeableState = 'dirty';
      }
    }
    const files = it.state === 'open' && head ? await diff((await treeOfCommit(await mergeBase(baseSha, head)))!, (await treeOfCommit(head))!) : [];
    return {
      url: `https://api.github.com/repos/${repo}/pulls/${it.number}`,
      id: it.number,
      node_id: `LOCALPR:${repo}:${it.number}`,
      number: it.number,
      html_url: `${htmlRepo}/pull/${it.number}`,
      state: it.state,
      title: it.title,
      body: it.body,
      draft: Boolean(it.draft),
      user: userOf(it.user),
      labels: it.labels.map((n) => ({ name: n })),
      assignees: it.assignees.map(userOf),
      requested_reviewers: (it.requested ?? []).map(userOf),
      requested_teams: [],
      head: { ref: it.head, sha: head, label: `${owner}:${it.head}`, repo: { full_name: repo, name, owner: { login: owner } } },
      base: { ref: it.base, sha: baseSha, label: `${owner}:${it.base}`, repo: { full_name: repo, name, owner: { login: owner } } },
      created_at: it.created_at,
      updated_at: it.updated_at,
      closed_at: it.closed_at,
      merged_at: it.merged_at ?? null,
      merged: Boolean(it.merged_at),
      merged_by: it.merged_by ? userOf(it.merged_by) : null,
      merge_commit_sha: it.merge_commit_sha ?? null,
      mergeable: it.state === 'open' ? mergeable : null,
      mergeable_state: it.state === 'open' ? mergeableState : 'unknown',
      additions: files.reduce((n, f) => n + f.additions, 0),
      deletions: files.reduce((n, f) => n + f.deletions, 0),
      changed_files: files.length,
      author_association: it.user === APP_LOGIN ? 'NONE' : 'MEMBER',
      auto_merge: null,
    };
  };
  const issueJson = (it: Item) => ({
    url: `https://api.github.com/repos/${repo}/issues/${it.number}`,
    id: it.number,
    node_id: `LOCALI:${repo}:${it.number}`,
    number: it.number,
    html_url: `${htmlRepo}/${it.pull ? 'pull' : 'issues'}/${it.number}`,
    state: it.state,
    state_reason: it.state_reason ?? null,
    title: it.title,
    body: it.body,
    user: userOf(it.user),
    labels: it.labels.map((n) => ({ name: n, color: 'ededed' })),
    assignees: it.assignees.map(userOf),
    assignee: it.assignees[0] ? userOf(it.assignees[0]) : null,
    comments: st.comments.filter((c) => c.number === it.number).length,
    created_at: it.created_at,
    updated_at: it.updated_at,
    closed_at: it.closed_at,
    author_association: it.user === APP_LOGIN ? 'NONE' : 'MEMBER',
    ...(it.pull ? { pull_request: { url: `https://api.github.com/repos/${repo}/pulls/${it.number}`, html_url: `${htmlRepo}/pull/${it.number}`, merged_at: it.merged_at ?? null }, draft: Boolean(it.draft) } : {}),
  });
  const commentJson = (c: Comment) => ({ id: c.id, body: c.body, user: userOf(c.user), created_at: c.created_at, updated_at: c.updated_at, html_url: `${htmlRepo}/issues/${c.number}#issuecomment-${c.id}`, author_association: c.user === APP_LOGIN ? 'NONE' : 'MEMBER', issue_url: `https://api.github.com/repos/${repo}/issues/${c.number}` });
  const reviewJson = (r: Review) => ({ id: r.id, node_id: `LOCALR:${r.id}`, user: userOf(r.user), state: r.state, body: r.body, commit_id: r.commit_id, submitted_at: r.submitted_at, html_url: `${htmlRepo}/pull/${r.number}#pullrequestreview-${r.id}`, author_association: 'MEMBER' });
  const item = (n: number) => st.items.find((i) => i.number === n) ?? null;
  const pull = (n: number) => {
    const i = item(n);
    return i && i.pull ? i : null;
  };
  const page = <T,>(list: T[]) => {
    const per = Math.min(100, Number(url.searchParams.get('per_page')) || 30);
    const p = Math.max(1, Number(url.searchParams.get('page')) || 1);
    return list.slice((p - 1) * per, p * per);
  };

  const done = async (res: Response) => {
    if (dirty) pending.push(['SET', stateKey(repo), JSON.stringify(st)]);
    if (pending.length) await redis.pipe(pending);
    return res;
  };
  const write = method !== 'GET' && method !== 'HEAD';
  if (write && !localAdminsOn(env)) return jsonRes(403, { message: READ_ONLY_OFF });
  if (write && !caller) return jsonRes(401, { message: 'Requires authentication', documentation_url: 'https://docs.github.com/rest' });
  const who = caller ?? 'anonymous';
  let p: RegExpExecArray | null;

  // --- repository ----------------------------------------------------------------------------------------------------
  if (rest === '' || rest === '/') {
    const persona = caller ? PERSONAS[caller] : undefined;
    const date = iso();
    return done(
      jsonRes(200, {
        id: 1, name, full_name: repo, private: true, visibility: 'private', default_branch: 'main', fork: false, archived: false,
        owner: { login: owner, id: 1, type: 'Organization', avatar_url: '' },
        permissions: { admin: Boolean(persona?.admin), maintain: Boolean(persona?.admin), push: Boolean(caller), triage: Boolean(caller), pull: true },
        allow_auto_merge: false, allow_merge_commit: true, allow_squash_merge: true, allow_rebase_merge: true, delete_branch_on_merge: false,
        html_url: htmlRepo, pushed_at: date, updated_at: date,
      }),
    );
  }
  if (rest === '/installation') return done(jsonRes(200, { id: 4_242_424, app_slug: 'bridge-local' }));

  // --- branches and refs ---------------------------------------------------------------------------------------------
  if (rest === '/branches' && method === 'GET') {
    return done(jsonRes(200, page(Object.entries(st.refs).map(([b, sha]) => ({ name: b, commit: { sha, url: '' }, protected: b === 'main' })))));
  }
  if ((p = /^\/branches\/(.+?)(\/protection)?$/.exec(rest)) && method === 'GET') {
    const b = decodeURIComponent(p[1]!);
    if (p[2] || !st.refs[b]) return done(notFound());
    return done(jsonRes(200, { name: b, commit: await commitJson(st.refs[b]!), protected: b === 'main' }));
  }
  if ((p = /^\/git\/matching-refs\/heads\/?(.*)$/.exec(rest)) && method === 'GET') {
    const prefix = decodeURIComponent(p[1]!);
    return done(jsonRes(200, Object.entries(st.refs).filter(([b]) => b.startsWith(prefix)).map(([b, sha]) => ({ ref: `refs/heads/${b}`, object: { sha, type: 'commit' } }))));
  }
  if ((p = /^\/git\/refs?\/heads\/(.+)$/.exec(rest))) {
    const b = decodeURIComponent(p[1]!);
    if (method === 'GET') return done(st.refs[b] ? jsonRes(200, { ref: `refs/heads/${b}`, object: { sha: st.refs[b], type: 'commit' } }) : notFound());
    if (method === 'PATCH') {
      if (!st.refs[b]) return done(unprocessable('Reference does not exist'));
      const sha = String(body.sha ?? '');
      if (!(await commitOf(sha))) return done(unprocessable('Object does not exist'));
      if (!body.force && !(await ancestors(sha)).has(st.refs[b]!)) return done(unprocessable('Update is not a fast forward'));
      st.refs[b] = sha;
      touch();
      return done(jsonRes(200, { ref: `refs/heads/${b}`, object: { sha, type: 'commit' } }));
    }
    if (method === 'DELETE') {
      if (!st.refs[b]) return done(unprocessable('Reference does not exist'));
      if (b === 'main') return done(unprocessable('Cannot delete the default branch'));
      delete st.refs[b];
      touch();
      return done(jsonRes(204, null));
    }
  }
  if (rest === '/git/refs' && method === 'POST') {
    const ref = String(body.ref ?? '');
    const sha = String(body.sha ?? '');
    const m = /^refs\/heads\/(.+)$/.exec(ref);
    if (!m) return done(unprocessable('Reference name must start with refs/heads/'));
    if (!(await commitOf(sha))) return done(unprocessable('Object does not exist'));
    if (st.refs[m[1]!]) return done(unprocessable('Reference already exists'));
    st.refs[m[1]!] = sha;
    touch();
    return done(jsonRes(201, { ref, object: { sha, type: 'commit' } }));
  }

  // --- git objects ---------------------------------------------------------------------------------------------------
  if (rest === '/git/blobs' && method === 'POST') {
    const buf = body.encoding === 'base64' ? Buffer.from(String(body.content ?? ''), 'base64') : Buffer.from(String(body.content ?? ''), 'utf8');
    const sha = newBlob(buf);
    return done(jsonRes(201, { sha, url: '' }));
  }
  if ((p = /^\/git\/blobs\/([0-9a-f]{40})$/.exec(rest)) && method === 'GET') {
    const buf = await blobText(p[1]!);
    if (!buf) return done(notFound());
    if (raw) return done(new Response(new Uint8Array(buf), { status: 200, headers: { 'Content-Type': 'application/vnd.github.raw' } }));
    return done(jsonRes(200, { sha: p[1], size: buf.length, encoding: 'base64', content: buf.toString('base64') }));
  }
  if (rest === '/git/trees' && method === 'POST') {
    const changes: Record<string, Entry | null> = {};
    for (const e of (body.tree ?? []) as { path: string; mode?: string; type?: string; sha?: string | null; content?: string }[]) {
      if (typeof e.path !== 'string' || !e.path) return done(unprocessable('tree.path is required'));
      if (e.content !== undefined) changes[e.path] = { sha: newBlob(Buffer.from(String(e.content), 'utf8')), mode: e.mode ?? '100644' };
      else if (e.sha === null) changes[e.path] = null;
      else if (typeof e.sha === 'string') changes[e.path] = { sha: e.sha, mode: e.mode ?? '100644' };
    }
    const bt = typeof body.base_tree === 'string' ? body.base_tree : null;
    if (bt && !(await flat(bt))) return done(unprocessable('base_tree is not a tree'));
    const sha = newTree(bt, changes);
    return done(jsonRes(201, { sha, truncated: false, tree: [] }));
  }
  if ((p = /^\/git\/trees\/(.+)$/.exec(rest)) && method === 'GET') {
    const ref = decodeURIComponent(p[1]!);
    let t: string | null = null;
    let prefix = '';
    const sub = /^LOCALT([0-9a-f]{40})_(.+)$/.exec(ref);
    if (sub) {
      t = sub[1]!;
      prefix = `${Buffer.from(sub[2]!, 'base64url').toString('utf8')}/`;
    } else if (await flat(ref)) t = ref;
    else {
      const c = await resolve(ref);
      t = c ? await treeOfCommit(c) : null;
    }
    const files = t ? await flat(t) : null;
    if (!t || !files) return done(notFound());
    const recursive = url.searchParams.has('recursive');
    const sizes = new Map(base.files.map((f) => [f.sha, f.size]));
    const below = [...files].filter(([path]) => path.startsWith(prefix));
    if (recursive) {
      const dirs = new Set<string>();
      for (const [path] of below) {
        const parts = path.slice(prefix.length).split('/');
        for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join('/'));
      }
      return done(
        jsonRes(200, {
          sha: t,
          truncated: false,
          tree: [
            ...[...dirs].sort().map((d) => ({ path: d, mode: '040000', type: 'tree', sha: `LOCALT${t}_${Buffer.from(prefix + d).toString('base64url')}` })),
            ...below.map(([path, e]) => ({ path: path.slice(prefix.length), mode: e.mode, type: 'blob', sha: e.sha, size: sizes.get(e.sha) ?? 0 })),
          ],
        }),
      );
    }
    const seen = new Map<string, unknown>();
    for (const [path, e] of below) {
      const [head, ...tail] = path.slice(prefix.length).split('/');
      if (seen.has(head!)) continue;
      seen.set(head!, tail.length ? { path: head, mode: '040000', type: 'tree', sha: `LOCALT${t}_${Buffer.from(prefix + head).toString('base64url')}` } : { path: head, mode: e.mode, type: 'blob', sha: e.sha });
    }
    return done(jsonRes(200, { sha: t, truncated: false, tree: [...seen.values()] }));
  }
  if (rest === '/git/commits' && method === 'POST') {
    const tree = String(body.tree ?? '');
    const parents = Array.isArray(body.parents) ? body.parents.map(String) : [];
    if (!(await flat(tree))) return done(unprocessable('Tree SHA does not exist'));
    for (const x of parents) if (!(await commitOf(x))) return done(unprocessable('Parent SHA does not exist or is not a commit object'));
    const sha = newCommit(tree, parents, String(body.message ?? ''), who);
    return done(jsonRes(201, { sha, tree: { sha: tree }, parents: parents.map((s: string) => ({ sha: s })), message: body.message }));
  }
  if ((p = /^\/git\/commits\/([0-9a-f]{40})$/.exec(rest)) && method === 'GET') {
    const c = await commitOf(p[1]!);
    if (!c) return done(notFound());
    const person = { name: c.author, email: 'local@bridge.invalid', date: c.date };
    return done(jsonRes(200, { sha: p[1], tree: { sha: c.tree }, parents: c.parents.map((s) => ({ sha: s })), message: c.message, author: person, committer: person }));
  }

  // --- commits, statuses, compare ------------------------------------------------------------------------------------
  if (rest === '/commits' && method === 'GET') {
    const from = await resolve(url.searchParams.get('sha'));
    if (!from) return done(notFound());
    const path = url.searchParams.get('path');
    const list: { sha: string; date: string }[] = [];
    for (const s of await ancestors(from)) {
      const c = (await commitOf(s))!;
      if (path) {
        const parentTree = c.parents[0] ? await treeOfCommit(c.parents[0]) : null;
        const touched = parentTree
          ? (await diff(parentTree, c.tree)).some((f) => f.filename === path || f.filename.startsWith(`${path.replace(/\/$/, '')}/`))
          : [...((await flat(c.tree)) ?? new Map()).keys()].some((f) => f === path || f.startsWith(`${path.replace(/\/$/, '')}/`));
        if (!touched) continue;
      }
      list.push({ sha: s, date: c.date });
    }
    list.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
    return done(jsonRes(200, await Promise.all(page(list).map((x) => commitJson(x.sha)))));
  }
  if ((p = /^\/commits\/([^/]+)\/(status|statuses|check-runs|check-suites|pulls)$/.exec(rest)) && method === 'GET') {
    const sha = await resolve(decodeURIComponent(p[1]!));
    if (!sha) return done(notFound());
    if (p[2] === 'status') return done(jsonRes(200, { state: 'success', statuses: [], total_count: 0, sha }));
    if (p[2] === 'statuses') return done(jsonRes(200, []));
    if (p[2] === 'check-runs') return done(jsonRes(200, { total_count: 0, check_runs: [] }));
    if (p[2] === 'check-suites') return done(jsonRes(200, { total_count: 0, check_suites: [] }));
    const out = [];
    for (const it of st.items.filter((i) => i.pull)) {
      const head = headShaOf(it);
      if (it.merge_commit_sha === sha || (head && (await ancestors(head)).has(sha) && !(await ancestors(st.refs[it.base ?? 'main'] ?? base.commit)).has(sha)) || head === sha) out.push(await pullJson(it));
    }
    return done(jsonRes(200, out));
  }
  if ((p = /^\/commits\/([^/]+)$/.exec(rest)) && method === 'GET') {
    const sha = await resolve(decodeURIComponent(p[1]!));
    return done(sha ? jsonRes(200, await commitJson(sha, true)) : notFound());
  }
  if ((p = /^\/compare\/(.+)$/.exec(rest)) && method === 'GET') {
    const spec = decodeURIComponent(p[1]!);
    const [a, b] = spec.split('...');
    const [x, y] = [await resolve(a), await resolve(b)];
    if (!x || !y) return done(notFound());
    const mb = await mergeBase(x, y);
    const ahead = await between(x, y);
    const behind = await between(y, x);
    const files = await diff((await treeOfCommit(mb))!, (await treeOfCommit(y))!);
    const status = !ahead.length && !behind.length ? 'identical' : ahead.length && behind.length ? 'diverged' : ahead.length ? 'ahead' : 'behind';
    return done(
      jsonRes(200, {
        status,
        ahead_by: ahead.length,
        behind_by: behind.length,
        total_commits: ahead.length,
        base_commit: await commitJson(x),
        merge_base_commit: await commitJson(mb),
        commits: await Promise.all(ahead.map((s) => commitJson(s))),
        files,
        html_url: `${htmlRepo}/compare/${spec}`,
      }),
    );
  }
  if (rest === '/merges' && method === 'POST') {
    const b = String(body.base ?? '');
    const head = await resolve(String(body.head ?? ''));
    if (!st.refs[b] || !head) return done(notFound());
    if ((await ancestors(st.refs[b]!)).has(head)) return done(jsonRes(204, null));
    const t = await mergedTree(st.refs[b]!, head);
    if (!t) return done(jsonRes(409, { message: 'Merge conflict' }));
    const sha = newCommit(t, [st.refs[b]!, head], String(body.commit_message ?? `Merge ${body.head} into ${b}`), who);
    st.refs[b] = sha;
    return done(jsonRes(201, await commitJson(sha)));
  }

  // --- contents ------------------------------------------------------------------------------------------------------
  if ((p = /^\/contents(?:\/(.*))?$/.exec(rest))) {
    const path = decodeURIComponent(p[1] ?? '').replace(/\/+$/, '');
    if (method === 'GET') {
      const c = await resolve(url.searchParams.get('ref'));
      const t = c ? await treeOfCommit(c) : null;
      const files = t ? await flat(t) : null;
      if (!files) return done(notFound());
      const e = files.get(path);
      if (e) {
        const buf = await blobText(e.sha);
        if (!buf) return done(notFound());
        if (raw) return done(new Response(new Uint8Array(buf), { status: 200, headers: { 'Content-Type': 'application/vnd.github.raw' } }));
        return done(jsonRes(200, { type: 'file', name: path.split('/').pop(), path, sha: e.sha, size: buf.length, encoding: 'base64', content: buf.toString('base64') }));
      }
      const prefix = path ? `${path}/` : '';
      const seen = new Map<string, unknown>();
      for (const [f, x] of files) {
        if (!f.startsWith(prefix)) continue;
        const [head, ...tail] = f.slice(prefix.length).split('/');
        if (!seen.has(head!)) seen.set(head!, tail.length ? { type: 'dir', name: head, path: `${prefix}${head}`, sha: sha1(`${t}:${prefix}${head}`), size: 0 } : { type: 'file', name: head, path: f, sha: x.sha, size: 0 });
      }
      return done(seen.size ? jsonRes(200, [...seen.values()]) : notFound());
    }
    if (method === 'PUT' || method === 'DELETE') {
      const branch = String(body.branch ?? 'main');
      const head = st.refs[branch];
      if (!head) return done(notFound());
      const t = (await treeOfCommit(head))!;
      const files = (await flat(t))!;
      const old = files.get(path);
      if (method === 'DELETE' && !old) return done(notFound());
      if (old && body.sha !== old.sha) return done(jsonRes(409, { message: `${path} does not match ${body.sha ?? 'nothing'}` }));
      if (!old && body.sha) return done(jsonRes(409, { message: `${path} does not exist` }));
      const blob = method === 'PUT' ? newBlob(Buffer.from(String(body.content ?? ''), 'base64')) : null;
      const tree = newTree(t, { [path]: blob ? { sha: blob, mode: '100644' } : null });
      const sha = newCommit(tree, [head], String(body.message ?? ''), who);
      st.refs[branch] = sha;
      return done(jsonRes(method === 'PUT' ? (old ? 200 : 201) : 200, { content: blob ? { path, sha: blob, name: path.split('/').pop() } : null, commit: { sha, message: body.message } }));
    }
  }

  // --- pull requests -------------------------------------------------------------------------------------------------
  if (rest === '/pulls' && method === 'GET') {
    const state = url.searchParams.get('state') ?? 'open';
    const head = url.searchParams.get('head');
    const baseRef = url.searchParams.get('base');
    const list = st.items
      .filter((i) => i.pull && (state === 'all' || i.state === state))
      .filter((i) => !head || `${owner}:${i.head}`.toLowerCase() === head.toLowerCase() || i.head === head)
      .filter((i) => !baseRef || i.base === baseRef)
      .sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1));
    return done(jsonRes(200, await Promise.all(page(list).map(pullJson))));
  }
  if (rest === '/pulls' && method === 'POST') {
    const head = String(body.head ?? '').replace(/^[^:]+:/, '');
    const b = String(body.base ?? 'main');
    if (!st.refs[head]) return done(unprocessable(`Validation Failed: head ${head} does not exist`));
    if (!st.refs[b]) return done(unprocessable(`Validation Failed: base ${b} does not exist`));
    if (!String(body.title ?? '').trim()) return done(unprocessable('Validation Failed: title is missing'));
    if (st.items.some((i) => i.pull && i.state === 'open' && i.head === head && i.base === b)) return done(unprocessable(`A pull request already exists for ${owner}:${head}.`));
    if (!(await between(st.refs[b]!, st.refs[head]!)).length) return done(unprocessable(`No commits between ${b} and ${head}`));
    const at = iso();
    const it: Item = { number: st.next++, pull: true, title: String(body.title), body: String(body.body ?? ''), user: who, state: 'open', labels: [], assignees: [], created_at: at, updated_at: at, closed_at: null, draft: Boolean(body.draft), head, base: b, merged_at: null, merge_commit_sha: null, requested: [] };
    st.items.push(it);
    touch();
    return done(jsonRes(201, await pullJson(it)));
  }
  if ((p = /^\/pulls\/(\d+)(?:\/(.+))?$/.exec(rest))) {
    const it = pull(Number(p[1]));
    if (!it) return done(notFound());
    const sub = p[2] ?? '';
    const at = iso();
    const bump = () => {
      it.updated_at = at;
      touch();
    };
    if (sub === '' && method === 'GET') return done(jsonRes(200, await pullJson(it)));
    if (sub === '' && method === 'PATCH') {
      if (typeof body.title === 'string') it.title = body.title;
      if (typeof body.body === 'string') it.body = body.body;
      if (typeof body.base === 'string' && st.refs[body.base]) it.base = body.base;
      if (body.state === 'closed' && it.state === 'open') {
        it.headSha = headShaOf(it) ?? undefined;
        it.state = 'closed';
        it.closed_at = at;
      } else if (body.state === 'open' && it.state === 'closed' && !it.merged_at) {
        it.state = 'open';
        it.closed_at = null;
      }
      bump();
      return done(jsonRes(200, await pullJson(it)));
    }
    if (sub === 'files' && method === 'GET') {
      const head = headShaOf(it);
      const baseSha = st.refs[it.base ?? 'main'] ?? base.commit;
      if (!head) return done(jsonRes(200, []));
      const mb = it.merged_at && it.merge_commit_sha ? ((await commitOf(it.merge_commit_sha))!.parents[0] ?? baseSha) : await mergeBase(baseSha, head);
      return done(jsonRes(200, page(await diff((await treeOfCommit(await mergeBase(mb, head)))!, (await treeOfCommit(head))!))));
    }
    if (sub === 'commits' && method === 'GET') {
      const head = headShaOf(it);
      if (!head) return done(jsonRes(200, []));
      const baseSha = it.merged_at && it.merge_commit_sha ? (await commitOf(it.merge_commit_sha))!.parents[0]! : (st.refs[it.base ?? 'main'] ?? base.commit);
      return done(jsonRes(200, await Promise.all((await between(baseSha, head)).map((s) => commitJson(s)))));
    }
    if (sub === 'reviews' && method === 'GET') return done(jsonRes(200, st.reviews.filter((r) => r.number === it.number).map(reviewJson)));
    if (sub === 'reviews' && method === 'POST') {
      if (it.state !== 'open') return done(unprocessable('Can not review a closed pull request'));
      const event = String(body.event ?? 'COMMENT').toUpperCase();
      const state = event === 'APPROVE' ? 'APPROVED' : event === 'REQUEST_CHANGES' ? 'CHANGES_REQUESTED' : event === 'COMMENT' ? 'COMMENTED' : null;
      if (!state) return done(unprocessable(`Unknown event ${event}`));
      if (state !== 'COMMENTED' && who === it.user) return done(unprocessable(state === 'APPROVED' ? 'Review Can not approve your own pull request' : 'Review Can not request changes on your own pull request'));
      if (state === 'CHANGES_REQUESTED' && !String(body.body ?? '').trim()) return done(unprocessable('Review body is required to request changes'));
      const r: Review = { id: st.seq++, number: it.number, user: who, state, body: String(body.body ?? ''), commit_id: String(body.commit_id ?? headShaOf(it) ?? ''), submitted_at: at };
      st.reviews.push(r);
      for (const c of (body.comments ?? []) as { path: string; line?: number; body: string }[]) st.reviewComments.push({ id: st.seq++, number: it.number, user: who, body: String(c.body ?? ''), path: String(c.path ?? ''), line: c.line ?? null, created_at: at });
      it.requested = (it.requested ?? []).filter((l) => l !== who);
      bump();
      return done(jsonRes(200, reviewJson(r)));
    }
    if ((p = /^reviews\/(\d+)\/dismissals$/.exec(sub)) && method === 'PUT') {
      const r = st.reviews.find((x) => x.id === Number(p![1]) && x.number === it.number);
      if (!r) return done(notFound());
      r.state = 'DISMISSED';
      bump();
      return done(jsonRes(200, reviewJson(r)));
    }
    if (sub === 'requested_reviewers') {
      const logins = ((body.reviewers ?? []) as string[]).map(String);
      if (method === 'GET') return done(jsonRes(200, { users: (it.requested ?? []).map(userOf), teams: [] }));
      if (method === 'POST') {
        if (logins.includes(it.user)) return done(unprocessable('Review cannot be requested from pull request author.'));
        it.requested = [...new Set([...(it.requested ?? []), ...logins])];
        bump();
        return done(jsonRes(201, await pullJson(it)));
      }
      if (method === 'DELETE') {
        it.requested = (it.requested ?? []).filter((l) => !logins.includes(l));
        bump();
        return done(jsonRes(200, await pullJson(it)));
      }
    }
    if (sub === 'comments' && method === 'GET') {
      return done(jsonRes(200, st.reviewComments.filter((c) => c.number === it.number).map((c) => ({ id: c.id, body: c.body, user: userOf(c.user), path: c.path, line: c.line, ...(c.in_reply_to_id ? { in_reply_to_id: c.in_reply_to_id } : {}), html_url: `${htmlRepo}/pull/${it.number}#discussion_r${c.id}`, created_at: c.created_at }))));
    }
    if ((p = /^comments\/(\d+)\/replies$/.exec(sub)) && method === 'POST') {
      const parent = st.reviewComments.find((c) => c.id === Number(p![1]));
      if (!parent) return done(notFound());
      const c: ReviewComment = { id: st.seq++, number: it.number, user: who, body: String(body.body ?? ''), path: parent.path, line: parent.line, in_reply_to_id: parent.id, created_at: at };
      st.reviewComments.push(c);
      bump();
      return done(jsonRes(201, { id: c.id, html_url: `${htmlRepo}/pull/${it.number}#discussion_r${c.id}` }));
    }
    if (sub === 'merge' && method === 'PUT') {
      if (it.state !== 'open') return done(jsonRes(405, { message: 'Pull Request is not mergeable' }));
      if (it.draft) return done(jsonRes(405, { message: 'Pull Request is still a draft' }));
      const head = headShaOf(it)!;
      if (body.sha && body.sha !== head) return done(jsonRes(409, { message: 'Head branch was modified. Review and try the merge again.' }));
      const b = it.base ?? 'main';
      const t = await mergedTree(st.refs[b]!, head);
      if (!t) return done(jsonRes(405, { message: 'Pull Request is not mergeable' }));
      const how = String(body.merge_method ?? 'merge');
      const title = String(body.commit_title ?? (how === 'squash' ? `${it.title} (#${it.number})` : `Merge pull request #${it.number} from ${owner}/${it.head}`));
      const sha = newCommit(t, how === 'squash' ? [st.refs[b]!] : [st.refs[b]!, head], body.commit_message ? `${title}\n\n${body.commit_message}` : title, who);
      st.refs[b] = sha;
      it.headSha = head;
      it.state = 'closed';
      it.closed_at = at;
      it.merged_at = at;
      it.merged_by = who;
      it.merge_commit_sha = sha;
      bump();
      return done(jsonRes(200, { sha, merged: true, message: 'Pull Request successfully merged' }));
    }
    if (sub === 'update-branch' && method === 'PUT') {
      const head = st.refs[it.head!];
      const b = st.refs[it.base ?? 'main']!;
      if (!head) return done(unprocessable('The head branch is gone'));
      if (body.expected_head_sha && body.expected_head_sha !== head) return done(unprocessable('expected_head_sha does not match the head'));
      if (!(await ancestors(head)).has(b)) {
        const t = await mergedTree(head, b);
        if (!t) return done(unprocessable('merge conflict between base and head'));
        st.refs[it.head!] = newCommit(t, [head, b], `Merge branch '${it.base}' into ${it.head}`, who);
        bump();
      }
      return done(jsonRes(202, { message: 'Updating pull request branch.' }));
    }
  }

  // --- issues (pull requests are issues too) -------------------------------------------------------------------------
  if (rest === '/issues' && method === 'GET') {
    const state = url.searchParams.get('state') ?? 'open';
    const want = (url.searchParams.get('labels') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    const creator = url.searchParams.get('creator');
    const assignee = url.searchParams.get('assignee');
    const list = st.items
      .filter((i) => state === 'all' || i.state === state)
      .filter((i) => want.every((l) => i.labels.includes(l)))
      .filter((i) => !creator || i.user === creator)
      .filter((i) => !assignee || (assignee === 'none' ? !i.assignees.length : i.assignees.includes(assignee)))
      .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
    return done(jsonRes(200, page(list).map(issueJson)));
  }
  if (rest === '/issues' && method === 'POST') {
    if (!String(body.title ?? '').trim()) return done(unprocessable('Validation Failed: title is missing'));
    const at = iso();
    const it: Item = { number: st.next++, pull: false, title: String(body.title), body: String(body.body ?? ''), user: who, state: 'open', labels: ((body.labels ?? []) as unknown[]).map((l) => (typeof l === 'string' ? l : String((l as { name?: string }).name ?? ''))).filter(Boolean), assignees: ((body.assignees ?? []) as string[]).map(String), created_at: at, updated_at: at, closed_at: null };
    st.items.push(it);
    touch();
    return done(jsonRes(201, issueJson(it)));
  }
  if ((p = /^\/issues\/comments\/(\d+)$/.exec(rest))) {
    const c = st.comments.find((x) => x.id === Number(p![1]));
    if (!c) return done(notFound());
    if (method === 'GET') return done(jsonRes(200, commentJson(c)));
    if (method === 'PATCH') {
      c.body = String(body.body ?? c.body);
      c.updated_at = iso();
      touch();
      return done(jsonRes(200, commentJson(c)));
    }
    if (method === 'DELETE') {
      st.comments = st.comments.filter((x) => x !== c);
      touch();
      return done(jsonRes(204, null));
    }
  }
  if ((p = /^\/issues\/(\d+)(?:\/(.+))?$/.exec(rest))) {
    const it = item(Number(p[1]));
    if (!it) return done(notFound());
    const sub = p[2] ?? '';
    const at = iso();
    const bump = () => {
      it.updated_at = at;
      touch();
    };
    if (sub === '' && method === 'GET') return done(jsonRes(200, issueJson(it)));
    if (sub === '' && method === 'PATCH') {
      if (typeof body.title === 'string') it.title = body.title;
      if (typeof body.body === 'string') it.body = body.body;
      if (Array.isArray(body.labels)) it.labels = body.labels.map((l: unknown) => (typeof l === 'string' ? l : String((l as { name?: string }).name ?? ''))).filter(Boolean);
      if (Array.isArray(body.assignees)) it.assignees = body.assignees.map(String);
      if (body.state === 'closed' && it.state === 'open') {
        if (it.pull) it.headSha = headShaOf(it) ?? undefined;
        it.state = 'closed';
        it.closed_at = at;
        it.state_reason = typeof body.state_reason === 'string' ? body.state_reason : 'completed';
      } else if (body.state === 'open' && it.state === 'closed' && !it.merged_at) {
        it.state = 'open';
        it.closed_at = null;
        it.state_reason = 'reopened';
      }
      bump();
      return done(jsonRes(200, issueJson(it)));
    }
    if (sub === 'labels') {
      if (method === 'GET') return done(jsonRes(200, it.labels.map((n) => ({ name: n }))));
      const add = ((body.labels ?? []) as unknown[]).map((l) => (typeof l === 'string' ? l : String((l as { name?: string }).name ?? ''))).filter(Boolean);
      if (method === 'POST') it.labels = [...new Set([...it.labels, ...add])];
      else if (method === 'PUT') it.labels = [...new Set(add)];
      else return done(notFound());
      bump();
      return done(jsonRes(200, it.labels.map((n) => ({ name: n }))));
    }
    if ((p = /^labels\/(.+)$/.exec(sub)) && method === 'DELETE') {
      const l = decodeURIComponent(p[1]!);
      if (!it.labels.includes(l)) return done(notFound());
      it.labels = it.labels.filter((x) => x !== l);
      bump();
      return done(jsonRes(200, it.labels.map((n) => ({ name: n }))));
    }
    if (sub === 'assignees' && (method === 'POST' || method === 'DELETE')) {
      const logins = ((body.assignees ?? []) as string[]).map(String);
      it.assignees = method === 'POST' ? [...new Set([...it.assignees, ...logins])] : it.assignees.filter((l) => !logins.includes(l));
      bump();
      return done(jsonRes(method === 'POST' ? 201 : 200, issueJson(it)));
    }
    if (sub === 'comments' && method === 'GET') return done(jsonRes(200, page(st.comments.filter((c) => c.number === it.number)).map(commentJson)));
    if (sub === 'comments' && method === 'POST') {
      const c: Comment = { id: st.seq++, number: it.number, user: who, body: String(body.body ?? ''), created_at: at, updated_at: at };
      st.comments.push(c);
      bump();
      return done(jsonRes(201, commentJson(c)));
    }
    if ((sub === 'timeline' || sub === 'events') && method === 'GET') return done(jsonRes(200, []));
  }

  // --- people, labels and the rest of what Studio reads --------------------------------------------------------------
  if (rest.startsWith('/collaborators') && method === 'GET') {
    const perm = (login: string) => (PERSONAS[login]?.admin ? 'admin' : 'write');
    if ((p = /^\/collaborators\/([^/]+)\/permission$/.exec(rest))) {
      const login = decodeURIComponent(p[1]!);
      return done(jsonRes(200, { permission: PERSONAS[login] ? perm(login) : 'none', role_name: PERSONAS[login] ? perm(login) : 'none', user: userOf(login) }));
    }
    if ((p = /^\/collaborators\/([^/]+)$/.exec(rest))) return done(PERSONAS[decodeURIComponent(p[1]!)] ? jsonRes(204, null) : notFound());
    const want = url.searchParams.get('permission');
    const people = Object.keys(PERSONAS).filter((l) => !want || want === 'push' || want === 'pull' || want === 'triage' || (want === 'admin' || want === 'maintain' ? PERSONAS[l]!.admin : true));
    return done(jsonRes(200, people.map((l) => ({ ...userOf(l), permissions: { admin: PERSONAS[l]!.admin, maintain: PERSONAS[l]!.admin, push: true, triage: true, pull: true }, role_name: perm(l) }))));
  }
  if (rest === '/labels' && method === 'GET') return done(jsonRes(200, [...new Set(st.items.flatMap((i) => i.labels))].map((n) => ({ name: n, color: 'ededed' }))));
  if (/^\/labels(\/|$)/.test(rest) && method === 'POST') return done(jsonRes(201, { name: body.name, color: body.color ?? 'ededed' }));
  if (/^\/(check-runs|deployments|tags|rulesets|releases|actions\/runs)(\?|$|\/?$)/.test(rest) && method === 'GET') {
    if (rest.startsWith('/check-runs')) return done(jsonRes(200, { total_count: 0, check_runs: [] }));
    if (rest.startsWith('/actions/runs')) return done(jsonRes(200, { total_count: 0, workflow_runs: [] }));
    return done(jsonRes(200, []));
  }
  if (/^\/rules\/branches\//.test(rest) && method === 'GET') return done(jsonRes(200, []));
  if (rest === '/check-runs' && method === 'POST') return done(jsonRes(201, { id: st.seq++, name: body.name, status: body.status ?? 'completed', conclusion: body.conclusion ?? 'success', html_url: '' }));
  return done(write ? jsonRes(404, { message: `Not Found (the local stand-in has no ${method} ${rest})` }) : notFound());
}

/** The pull request of a GraphQL node id this stand-in gave out ("LOCALPR:<repo>:<n>"), else null. */
export function pullOfNode(id: unknown): { repo: string; number: number } | null {
  const m = typeof id === 'string' ? /^LOCALPR:([^:]+\/[^:]+):(\d+)$/.exec(id) : null;
  return m ? { repo: m[1]!, number: Number(m[2]) } : null;
}

/** markPullRequestReadyForReview and convertPullRequestToDraft on a writable fixture pull request. */
export async function draftMutation(redis: Redis, repo: string, number: number, draft: boolean, now: () => number, env: Record<string, string | undefined> = process.env): Promise<Response> {
  if (!localAdminsOn(env)) return jsonRes(403, { message: READ_ONLY_OFF });
  return serial(repo.toLowerCase(), async () => {
    const raw = await redis.cmd('GET', stateKey(repo));
    const st = typeof raw === 'string' ? (JSON.parse(raw) as State) : null;
    const it = st?.items.find((i) => i.pull && i.number === number);
    if (!st || !it) return jsonRes(200, { data: null, errors: [{ message: 'Could not resolve to a PullRequest.' }] });
    if (it.state !== 'open') return jsonRes(200, { data: null, errors: [{ message: 'Pull request is closed.' }] });
    it.draft = draft;
    it.updated_at = new Date(now()).toISOString();
    await redis.cmd('SET', stateKey(repo), JSON.stringify(st));
    const key = draft ? 'convertPullRequestToDraft' : 'markPullRequestReadyForReview';
    return jsonRes(200, { data: { [key]: { pullRequest: { number, isDraft: draft } } } });
  });
}

/** Forgets the objects kept in memory (tests start cold; a scenario reset clears the store). */
export function clearLocalRepoMemory(): void {
  objCache.clear();
  flatCache.clear();
}
