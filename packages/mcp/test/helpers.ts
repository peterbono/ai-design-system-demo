import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
export const FIXTURE = join(REPO, 'packages/mcp/test/fixtures/mini-ds');
export const MCP_DIST = join(REPO, 'packages/mcp/dist');
export const CLI = join(REPO, 'packages/cli/dist/index.js');

/** A throwaway git repo holding copies of `paths` (relative to `from`), committed on main (removed by global-setup). */
export function tempGitRepo(from: string, paths: string[]): string {
  const dir = mkdtempSync(join(tmpdir(), 'bridge-test-'));
  for (const p of paths) {
    mkdirSync(dirname(join(dir, p)), { recursive: true });
    cpSync(join(from, p), join(dir, p), { recursive: true });
  }
  const g = (...args: string[]) => execFileSync('git', args, { cwd: dir, stdio: 'pipe' });
  g('init', '-q', '-b', 'main');
  g('config', 'user.name', 'Test');
  g('config', 'user.email', 'test@example.com');
  g('add', '-A');
  g('commit', '-q', '-m', 'init');
  return dir;
}

export const git = (dir: string, ...args: string[]) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' });

/** Paths of the real repo a token-only copy needs. */
export const REAL_PATHS = ['bridge.config.json', 'packages/tokens/src', 'AGENTS.md', 'docs/DESIGN-LANGUAGE.md', 'docs/GOVERNANCE.md', '.changeset/config.json', 'packages/react/src/components/Button', 'packages/react/src/components/Switch'];

export function readTree(root: string, paths: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (p: string) => {
    const abs = join(root, p);
    if (!existsSync(abs)) return;
    if (statSync(abs).isDirectory()) for (const e of readdirSync(abs)) walk(join(p, e));
    else out[relative(root, abs)] = readFileSync(abs, 'utf8');
  };
  paths.forEach(walk);
  return out;
}

// --- a fake GitHub (REST + raw) in memory ---------------------------------------------------------------

interface Commit {
  files: Map<string, string>;
  parents: string[];
}

export function fakeGitHub(owner: string, repo: string, initial: Record<string, string>) {
  let n = 0;
  const id = () => `sha${(++n).toString().padStart(6, '0')}`;
  const commits = new Map<string, Commit>();
  const trees = new Map<string, Map<string, string>>();
  const refs = new Map<string, string>();
  const root = id();
  commits.set(root, { files: new Map(Object.entries(initial)), parents: [] });
  trees.set(root, commits.get(root)!.files);
  refs.set('main', root);
  const pulls: Record<string, any>[] = [];
  const reviews = new Map<number, Record<string, any>[]>();
  const log: { method: string; path: string; body?: any }[] = [];

  const resolveRef = (ref: string) => refs.get(ref) ?? (commits.has(ref) ? ref : undefined);
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const api = `https://api.github.com/repos/${owner}/${repo}`;

  const f = async (input: string | URL | Request, init: RequestInit = {}): Promise<Response> => {
    const url = String(input);
    const method = (init.method ?? 'GET').toUpperCase();
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    const headers = (init.headers ?? {}) as Record<string, string>;
    if (url.startsWith('https://raw.githubusercontent.com/')) {
      const rest = url.slice(`https://raw.githubusercontent.com/${owner}/${repo}/`.length);
      // Longest known ref prefix (branch names may contain slashes).
      const candidates = [...refs.keys(), ...commits.keys()].filter((r) => rest.startsWith(`${r}/`)).sort((a, b) => b.length - a.length);
      const ref = candidates[0];
      const path = ref ? decodeURIComponent(rest.slice(ref.length + 1)) : '';
      const content = ref ? commits.get(resolveRef(ref)!)?.files.get(path) : undefined;
      log.push({ method, path: `raw:${path}` });
      return content === undefined ? new Response('404', { status: 404 }) : new Response(content, { status: 200 });
    }
    if (!url.startsWith(api)) return json(404, { message: `unexpected ${url}` });
    const u = new URL(url);
    const path = u.pathname.slice(`/repos/${owner}/${repo}`.length);
    log.push({ method, path, body });
    const authed = Boolean(headers.authorization);
    if (method !== 'GET' && !authed) return json(401, { message: 'Requires authentication' });
    let m: RegExpExecArray | null;
    if (method === 'GET' && path === '') return json(200, { default_branch: 'main' });
    if (method === 'GET' && (m = /^\/git\/trees\/(.+)$/.exec(path))) {
      const sha = resolveRef(decodeURIComponent(m[1]!));
      if (!sha) return json(404, {});
      return json(200, { tree: [...commits.get(sha)!.files.keys()].map((p) => ({ path: p, type: 'blob' })), truncated: false });
    }
    if (method === 'GET' && (m = /^\/contents\/(.+)$/.exec(path))) {
      const sha = resolveRef(u.searchParams.get('ref') ?? 'main');
      const c = sha ? commits.get(sha)!.files.get(decodeURIComponent(m[1]!)) : undefined;
      return c === undefined ? json(404, {}) : new Response(c, { status: 200 });
    }
    if (method === 'GET' && (m = /^\/git\/ref\/heads\/(.+)$/.exec(path))) {
      const sha = refs.get(decodeURIComponent(m[1]!));
      return sha ? json(200, { object: { sha } }) : json(404, {});
    }
    if (method === 'GET' && (m = /^\/git\/commits\/(.+)$/.exec(path))) return json(200, { sha: m[1], tree: { sha: m[1] } });
    if (method === 'POST' && path === '/git/trees') {
      const base = new Map(commits.get(body.base_tree)?.files ?? trees.get(body.base_tree) ?? []);
      for (const e of body.tree) {
        if (e.sha === null) base.delete(e.path);
        else base.set(e.path, e.content);
      }
      const t = id();
      trees.set(t, base);
      return json(201, { sha: t });
    }
    if (method === 'POST' && path === '/git/commits') {
      const c = id();
      commits.set(c, { files: trees.get(body.tree)!, parents: body.parents });
      return json(201, { sha: c });
    }
    if (method === 'POST' && path === '/git/refs') {
      const name = String(body.ref).replace(/^refs\/heads\//, '');
      if (refs.has(name)) return json(422, { message: 'Reference already exists' });
      refs.set(name, body.sha);
      return json(201, { ref: body.ref });
    }
    if (method === 'POST' && path === '/pulls') {
      const number = pulls.length + 1;
      const pr = { number, title: body.title, body: body.body, state: 'open', draft: body.draft, user: { login: 'agent' }, head: { ref: body.head, sha: refs.get(body.head) }, base: { ref: body.base }, labels: [], html_url: `https://github.com/${owner}/${repo}/pull/${number}`, updated_at: '2026-10-16T00:00:00Z' };
      pulls.push(pr);
      return json(201, pr);
    }
    if (method === 'GET' && path === '/pulls') return json(200, pulls);
    if ((m = /^\/pulls\/(\d+)$/.exec(path)) && method === 'GET') {
      const pr = pulls[Number(m[1]) - 1];
      return pr ? json(200, pr) : json(404, {});
    }
    if ((m = /^\/pulls\/(\d+)\/files$/.exec(path))) {
      const pr = pulls[Number(m[1]) - 1]!;
      const head = commits.get(pr.head.sha)!.files;
      const base = commits.get(refs.get(pr.base.ref)!)!.files;
      const changed = [...new Set([...head.keys(), ...base.keys()])].filter((p) => head.get(p) !== base.get(p));
      return json(200, changed.map((filename) => ({ filename, status: base.has(filename) ? (head.has(filename) ? 'modified' : 'removed') : 'added' })));
    }
    if (/^\/commits\/.+\/status$/.test(path)) return json(200, { state: 'success', statuses: [{ context: 'ci/guardrails', state: 'success' }] });
    if (/^\/commits\/.+\/check-runs$/.test(path)) return json(200, { check_runs: [{ name: 'Guardrails', status: 'completed', conclusion: 'success' }] });
    if ((m = /^\/pulls\/(\d+)\/reviews$/.exec(path))) {
      const k = Number(m[1]);
      if (method === 'GET') return json(200, reviews.get(k) ?? []);
      const r = { id: 900 + (reviews.get(k)?.length ?? 0), user: { login: 'owner' }, state: body.event === 'APPROVE' ? 'APPROVED' : body.event === 'REQUEST_CHANGES' ? 'CHANGES_REQUESTED' : 'COMMENTED', body: body.body, submitted_at: '2026-10-16T00:00:00Z' };
      reviews.set(k, [...(reviews.get(k) ?? []), r]);
      return json(200, r);
    }
    if ((m = /^\/issues\/(\d+)\/labels$/.exec(path)) && method === 'POST') {
      const pr = pulls[Number(m[1]) - 1]!;
      pr.labels = body.labels.map((name: string) => ({ name }));
      return json(200, pr.labels);
    }
    return json(404, { message: `fake GitHub: no route ${method} ${path}` });
  };
  return { fetch: f as typeof fetch, refs, commits, pulls, reviews, log, fileAt: (ref: string, p: string) => commits.get(resolveRef(ref)!)?.files.get(p) };
}
