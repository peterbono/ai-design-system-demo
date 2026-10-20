import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
export const FIXTURE = join(REPO, 'packages/mcp/test/fixtures/mini-ds');
export const MCP_DIST = join(REPO, 'packages/mcp/dist');
export const CLI = join(REPO, 'packages/cli/dist/index.js');

/** A throwaway git repo holding copies of `paths` (relative to `from`) with the PINNED values, committed on main (removed by global-setup). */
export function tempGitRepo(from: string, paths: string[]): string {
  const dir = mkdtempSync(join(tmpdir(), 'bridge-test-'));
  for (const p of paths) {
    mkdirSync(dirname(join(dir, p)), { recursive: true });
    cpSync(join(from, p), join(dir, p), { recursive: true });
  }
  for (const pin of PINNED) {
    const f = join(dir, pin.file);
    if (existsSync(f)) writeFileSync(f, pinValue(readFileSync(f, 'utf8'), pin.keys, pin.value));
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

/**
 * Starting values the tests edit away from (muted text 600 -> 700, menu highlight -> surface.hover). A copy of the
 * real tokens starts from these, so a designer changing them in Studio never turns a test edit into a no-op.
 */
export const PINNED: { file: string; keys: string[]; value: string }[] = [
  { file: 'packages/tokens/src/semantic/light.tokens.json', keys: ['color', 'text', 'muted'], value: '{palette.neutral.600}' },
  { file: 'packages/tokens/src/components/overlays.tokens.json', keys: ['menu', 'item', 'bg-highlight'], value: '{color.surface.hover-raised}' },
];

/** Set the `$value` of the token at `keys` in a token file's text, keeping every other byte. */
export function pinValue(text: string, keys: string[], value: string): string {
  let i = 0;
  for (const k of keys) {
    i = text.indexOf(`"${k}"`, i);
    if (i < 0) throw new Error(`pinValue: no ${keys.join('.')}`);
  }
  return text.slice(0, i) + text.slice(i).replace(/"\$value": "[^"]*"/, `"$value": "${value}"`);
}

/** The real files with the PINNED starting values. */
export function pinStart(files: Record<string, string>): Record<string, string> {
  const out = { ...files };
  for (const pin of PINNED) if (out[pin.file] !== undefined) out[pin.file] = pinValue(out[pin.file]!, pin.keys, pin.value);
  return out;
}

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
  // Issues share GitHub's numbering with pull requests; here they start at 100 so tests read clearly.
  const issues: Record<string, any>[] = [];
  const comments = new Map<number, string[]>();
  // Commit statuses by sha (Vercel reports each project as "Vercel – <project>").
  const statuses = new Map<string, { context: string; state: string; target_url?: string }[]>();
  const issueAt = (k: number) => issues.find((i) => i.number === k);
  const log: { method: string; path: string; body?: any }[] = [];
  // Who the token belongs to (GET /user); reviews are posted as them.
  const viewer = { login: 'owner' };
  // Comment ids, so a comment can be edited (PATCH /issues/comments/:id); line comments of pull requests.
  const commentIds = new Map<number, { issue: number; index: number }>();
  let commentSeq = 0;
  const lineComments = new Map<number, { id: number; body: string; user: { login: string }; path: string; line: number; in_reply_to_id?: number; html_url: string; created_at: string }[]>();
  /** Every commit reachable from `sha`, nearest first. */
  const ancestors = (sha: string): string[] => {
    const out: string[] = [];
    const queue = [sha];
    while (queue.length) {
      const c = queue.shift()!;
      if (out.includes(c)) continue;
      out.push(c);
      queue.push(...(commits.get(c)?.parents ?? []));
    }
    return out;
  };
  const mergeBaseOf = (a: string, b: string) => {
    const of = new Set(ancestors(a));
    return ancestors(b).find((c) => of.has(c)) ?? root;
  };
  const changed = (from: string, to: string) => {
    const x = commits.get(from)!.files;
    const y = commits.get(to)!.files;
    return [...new Set([...x.keys(), ...y.keys()])].filter((p) => x.get(p) !== y.get(p)).sort();
  };
  /** Whether a pull request merges cleanly: no file changed on both sides since they parted. */
  const mergeableOf = (pr: Record<string, any>) => {
    const head = refs.get(pr.head.ref) ?? pr.head.sha;
    const base = refs.get(pr.base.ref)!;
    const mb = mergeBaseOf(base, head);
    const mine = new Set(changed(mb, head));
    return !changed(mb, base).some((p) => mine.has(p) && commits.get(head)!.files.get(p) !== commits.get(base)!.files.get(p));
  };

  const resolveRef = (ref: string) => refs.get(ref) ?? (commits.has(ref) ? ref : undefined);
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const api = `https://api.github.com/repos/${owner}/${repo}`;

  const f = async (input: string | URL | Request, init: RequestInit = {}): Promise<Response> => {
    const url = String(input);
    const method = (init.method ?? 'GET').toUpperCase();
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    const headers = Object.fromEntries(Object.entries((init.headers ?? {}) as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v]));
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
    if (url === 'https://api.github.com/graphql' && method === 'POST') {
      log.push({ method, path: 'graphql', body });
      if (!headers.authorization) return json(401, { message: 'Requires authentication' });
      const pr = pulls.find((p) => p.node_id === body.variables?.id);
      if (!pr) return json(200, { errors: [{ message: 'Could not resolve to a node' }] });
      pr.draft = false;
      return json(200, { data: { markPullRequestReadyForReview: { pullRequest: { number: pr.number, isDraft: false } } } });
    }
    if (url === 'https://api.github.com/user') {
      log.push({ method, path: 'user' });
      return headers.authorization ? json(200, { login: viewer.login }) : json(401, { message: 'Requires authentication' });
    }
    if (!url.startsWith(api)) return json(404, { message: `unexpected ${url}` });
    const u = new URL(url);
    const path = u.pathname.slice(`/repos/${owner}/${repo}`.length);
    log.push({ method, path, body });
    const authed = Boolean(headers.authorization);
    if (method !== 'GET' && !authed) return json(401, { message: 'Requires authentication' });
    let m: RegExpExecArray | null;
    if (method === 'GET' && path === '') return json(200, { default_branch: 'main', allow_squash_merge: true, allow_merge_commit: true, allow_rebase_merge: true, permissions: authed ? { admin: true, push: true } : undefined });
    if (method === 'GET' && (m = /^\/git\/trees\/(.+)$/.exec(path))) {
      const sha = resolveRef(decodeURIComponent(m[1]!));
      if (!sha) return json(404, {});
      return json(200, { tree: [...commits.get(sha)!.files.keys()].map((p) => ({ path: p, type: 'blob', mode: '100644', sha: `blob:${sha}:${p}` })), truncated: false });
    }
    if (method === 'GET' && (m = /^\/contents\/(.+)$/.exec(path))) {
      const sha = resolveRef(u.searchParams.get('ref') ?? 'main');
      const c = sha ? commits.get(sha)!.files.get(decodeURIComponent(m[1]!)) : undefined;
      if (c === undefined) return json(404, {});
      return headers.accept?.includes('raw') ? new Response(c, { status: 200 }) : json(200, { type: 'file', encoding: 'base64', content: Buffer.from(c).toString('base64') });
    }
    if (method === 'PUT' && (m = /^\/contents\/(.+)$/.exec(path))) {
      const head = refs.get(body.branch);
      if (!head) return json(404, { message: 'Branch not found' });
      const files = new Map(commits.get(head)!.files);
      files.set(decodeURIComponent(m[1]!), Buffer.from(body.content, 'base64').toString('utf8'));
      const c = id();
      commits.set(c, { files, parents: [head] });
      refs.set(body.branch, c);
      return json(200, { commit: { sha: c } });
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
        else if (typeof e.sha === 'string' && e.sha.startsWith('blob:')) {
          const [, c, ...rest] = e.sha.split(':');
          base.set(e.path, commits.get(c!)!.files.get(rest.join(':'))!);
        } else base.set(e.path, e.content);
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
    if (method === 'PATCH' && (m = /^\/git\/refs\/heads\/(.+)$/.exec(path))) {
      const name = decodeURIComponent(m[1]!);
      if (!refs.has(name)) return json(422, { message: 'Reference does not exist' });
      refs.set(name, body.sha);
      return json(200, { ref: `refs/heads/${name}` });
    }
    if (method === 'POST' && path === '/git/refs') {
      const name = String(body.ref).replace(/^refs\/heads\//, '');
      if (refs.has(name)) return json(422, { message: 'Reference already exists' });
      refs.set(name, body.sha);
      return json(201, { ref: body.ref });
    }
    if (method === 'POST' && path === '/pulls') {
      const number = pulls.length + 1;
      const pr = { number, node_id: `PR_node_${number}`, title: body.title, body: body.body, state: 'open', draft: body.draft, user: { login: 'agent' }, head: { ref: body.head, sha: refs.get(body.head) }, base: { ref: body.base }, labels: [], html_url: `https://github.com/${owner}/${repo}/pull/${number}`, updated_at: '2026-10-16T00:00:00Z' };
      pulls.push(pr);
      return json(201, pr);
    }
    if (method === 'GET' && path === '/pulls') {
      // state=open hides closed and merged ones; head=owner:branch filters by branch, like GitHub.
      const state = u.searchParams.get('state');
      const head = u.searchParams.get('head')?.split(':')[1];
      return json(200, pulls.filter((p) => (!state || state === 'all' || p.state === state) && (!head || p.head.ref === head)));
    }
    if ((m = /^\/pulls\/(\d+)$/.exec(path)) && (method === 'GET' || method === 'PATCH')) {
      const pr = pulls[Number(m[1]) - 1];
      if (pr && method === 'PATCH') Object.assign(pr, body);
      if (pr && pr.state === 'open' && refs.has(pr.head.ref)) {
        pr.head.sha = refs.get(pr.head.ref);
        pr.mergeable = mergeableOf(pr);
      }
      return pr ? json(200, pr) : json(404, {});
    }
    if (method === 'PUT' && (m = /^\/pulls\/(\d+)\/merge$/.exec(path))) {
      const pr = pulls[Number(m[1]) - 1];
      if (!pr || pr.state !== 'open') return json(405, { message: 'Pull Request is not mergeable' });
      if (body.sha && body.sha !== refs.get(pr.head.ref)) return json(409, { message: 'Head branch was modified. Review and try the merge again.' });
      const c = id();
      commits.set(c, { files: new Map(commits.get(refs.get(pr.head.ref)!)!.files), parents: [refs.get(pr.base.ref)!] });
      refs.set(pr.base.ref, c);
      Object.assign(pr, { state: 'closed', merged: true, merged_at: '2026-10-20T00:00:00Z', merge_method: body.merge_method, commit_message: body.commit_message });
      return json(200, { sha: c, merged: true, message: 'Pull Request successfully merged' });
    }
    if (method === 'PUT' && (m = /^\/pulls\/(\d+)\/update-branch$/.exec(path))) {
      const pr = pulls[Number(m[1]) - 1]!;
      const head = refs.get(pr.head.ref)!;
      if (body.expected_head_sha && body.expected_head_sha !== head) return json(422, { message: 'expected_head_sha does not match' });
      if (!mergeableOf(pr)) return json(422, { message: 'merge conflict between base and head' });
      const base = refs.get(pr.base.ref)!;
      const mb = mergeBaseOf(base, head);
      const files = new Map(commits.get(base)!.files);
      for (const p of changed(mb, head)) {
        const v = commits.get(head)!.files.get(p);
        if (v === undefined) files.delete(p);
        else files.set(p, v);
      }
      const c = id();
      commits.set(c, { files, parents: [head, base] });
      refs.set(pr.head.ref, c);
      return json(202, { message: 'Updating pull request branch.' });
    }
    if (method === 'POST' && path === '/merges') {
      // GitHub's merges API: head into the branch base, 204 when base already has it, 409 on a conflict.
      const base = refs.get(body.base);
      const head = resolveRef(body.head);
      if (!base || !head) return json(404, { message: 'Base or head does not exist' });
      if (ancestors(base).includes(head)) return new Response(null, { status: 204 });
      const mb = mergeBaseOf(base, head);
      const mine = changed(mb, base);
      const theirs = changed(mb, head);
      if (theirs.some((p) => mine.includes(p) && commits.get(base)!.files.get(p) !== commits.get(head)!.files.get(p))) return json(409, { message: 'Merge conflict' });
      const files = new Map(commits.get(base)!.files);
      for (const p of theirs) {
        const v = commits.get(head)!.files.get(p);
        if (v === undefined) files.delete(p);
        else files.set(p, v);
      }
      const c = id();
      commits.set(c, { files, parents: [base, head] });
      refs.set(body.base, c);
      return json(201, { sha: c });
    }
    if (method === 'PATCH' && (m = /^\/issues\/(\d+)$/.exec(path)) && issueAt(Number(m[1]))) {
      const issue = issueAt(Number(m[1]))!;
      Object.assign(issue, body);
      return json(200, issue);
    }
    if (method === 'GET' && (m = /^\/compare\/(.+)\.\.\.(.+)$/.exec(path))) {
      const base = resolveRef(decodeURIComponent(m[1]!));
      const head = resolveRef(decodeURIComponent(m[2]!));
      if (!base || !head) return json(404, { message: 'Not Found' });
      const mb = mergeBaseOf(base, head);
      const fromHead = new Set(ancestors(head));
      const fromBase = new Set(ancestors(base));
      const files = changed(mb, head).map((filename) => ({ filename, status: commits.get(mb)!.files.has(filename) ? (commits.get(head)!.files.has(filename) ? 'modified' : 'removed') : 'added' }));
      return json(200, {
        ahead_by: [...fromHead].filter((c) => !fromBase.has(c)).length,
        behind_by: [...fromBase].filter((c) => !fromHead.has(c)).length,
        merge_base_commit: { sha: mb },
        base_commit: { sha: base, commit: { tree: { sha: base } } },
        files,
      });
    }
    if ((method === 'POST' || method === 'DELETE') && (m = /^\/pulls\/(\d+)\/requested_reviewers$/.exec(path))) {
      const pr = pulls[Number(m[1]) - 1]!;
      const now: { login: string }[] = pr.requested_reviewers ?? [];
      pr.requested_reviewers = method === 'POST' ? [...now, ...body.reviewers.filter((l: string) => !now.some((x) => x.login === l)).map((login: string) => ({ login }))] : now.filter((x) => !body.reviewers.includes(x.login));
      return json(method === 'POST' ? 201 : 200, pr);
    }
    if (method === 'GET' && (m = /^\/pulls\/(\d+)\/comments$/.exec(path))) return json(200, lineComments.get(Number(m[1])) ?? []);
    if (method === 'POST' && (m = /^\/pulls\/(\d+)\/comments\/(\d+)\/replies$/.exec(path))) {
      const k = Number(m[1]);
      const list = lineComments.get(k) ?? [];
      const parent = list.find((c) => c.id === Number(m![2]));
      if (!parent) return json(404, { message: 'Not Found' });
      const c = { id: 5000 + ++commentSeq, body: body.body, user: { login: viewer.login }, path: parent.path, line: parent.line, in_reply_to_id: parent.id, html_url: `https://github.com/${owner}/${repo}/pull/${k}#discussion_r${commentSeq}`, created_at: '2026-10-20T00:00:00Z' };
      lineComments.set(k, [...list, c]);
      return json(201, c);
    }
    if (method === 'PATCH' && (m = /^\/issues\/comments\/(\d+)$/.exec(path))) {
      const at = commentIds.get(Number(m[1]));
      if (!at) return json(404, { message: 'Not Found' });
      comments.get(at.issue)![at.index] = body.body;
      return json(200, { id: Number(m[1]), body: body.body });
    }
    if ((m = /^\/pulls\/(\d+)\/files$/.exec(path))) {
      const pr = pulls[Number(m[1]) - 1]!;
      const head = commits.get(refs.get(pr.head.ref) ?? pr.head.sha)!.files;
      const base = commits.get(refs.get(pr.base.ref)!)!.files;
      const changed = [...new Set([...head.keys(), ...base.keys()])].filter((p) => head.get(p) !== base.get(p));
      return json(200, changed.map((filename) => ({ filename, status: base.has(filename) ? (head.has(filename) ? 'modified' : 'removed') : 'added' })));
    }
    if (/^\/commits\/.+\/status$/.test(path)) return json(200, { state: 'success', statuses: [{ context: 'ci/guardrails', state: 'success' }] });
    if (/^\/commits\/.+\/check-runs$/.test(path)) return json(200, { check_runs: [{ name: 'Guardrails', status: 'completed', conclusion: 'success' }] });
    if ((m = /^\/pulls\/(\d+)\/reviews$/.exec(path))) {
      const k = Number(m[1]);
      if (method === 'GET') return json(200, reviews.get(k) ?? []);
      const r = { id: 900 + (reviews.get(k)?.length ?? 0), user: { login: viewer.login }, commit_id: body.commit_id, state: body.event === 'APPROVE' ? 'APPROVED' : body.event === 'REQUEST_CHANGES' ? 'CHANGES_REQUESTED' : 'COMMENTED', body: body.body, submitted_at: '2026-10-16T00:00:00Z' };
      reviews.set(k, [...(reviews.get(k) ?? []), r]);
      return json(200, r);
    }
    if (method === 'POST' && path === '/issues') {
      const number = 100 + issues.length;
      const issue = { number, title: body.title, body: body.body, state: 'open', state_reason: null, labels: (body.labels ?? []).map((name: string) => ({ name })), assignees: body.assignees ?? [], user: { login: 'agent' }, html_url: `https://github.com/${owner}/${repo}/issues/${number}`, created_at: '2026-10-16T00:00:00Z', updated_at: '2026-10-16T00:00:00Z' };
      issues.push(issue);
      return json(201, issue);
    }
    if (method === 'GET' && path === '/issues') {
      const state = u.searchParams.get('state') ?? 'open';
      const label = u.searchParams.get('labels');
      const list = issues.filter((i) => (state === 'all' || i.state === state) && (!label || i.labels.some((l: any) => l.name === label)));
      return json(200, [...list].reverse());
    }
    if (method === 'GET' && (m = /^\/issues\/(\d+)$/.exec(path))) {
      const issue = issueAt(Number(m[1]));
      return issue ? json(200, issue) : json(404, { message: 'Not Found' });
    }
    if (method === 'GET' && (m = /^\/issues\/(\d+)\/comments$/.exec(path))) {
      return json(200, (comments.get(Number(m[1])) ?? []).map((b, i) => ({ id: i + 1, body: b, user: { login: 'bot' }, updated_at: '' })));
    }
    if (method === 'GET' && (m = /^\/commits\/([^/]+)\/statuses$/.exec(path))) return json(200, statuses.get(m[1]!) ?? []);
    if (method === 'GET' && path === '/deployments') return json(200, []);
    if (method === 'POST' && (m = /^\/issues\/(\d+)\/comments$/.exec(path))) {
      const k = Number(m[1]);
      comments.set(k, [...(comments.get(k) ?? []), body.body]);
      const cid = 7000 + ++commentSeq;
      commentIds.set(cid, { issue: k, index: comments.get(k)!.length - 1 });
      return json(201, { id: cid, body: body.body, html_url: `https://github.com/${owner}/${repo}/pull/${k}#issuecomment-${cid}` });
    }
    if ((m = /^\/issues\/(\d+)\/labels$/.exec(path)) && method === 'POST' && issueAt(Number(m[1]))) {
      const issue = issueAt(Number(m[1]))!;
      for (const name of body.labels) if (!issue.labels.some((l: any) => l.name === name)) issue.labels.push({ name });
      return json(200, issue.labels);
    }
    if ((m = /^\/issues\/(\d+)\/labels$/.exec(path)) && method === 'POST') {
      const pr = pulls[Number(m[1]) - 1]!;
      for (const name of body.labels) if (!pr.labels.some((l: any) => l.name === name)) pr.labels.push({ name });
      return json(200, pr.labels);
    }
    if ((m = /^\/issues\/(\d+)\/labels\/(.+)$/.exec(path)) && method === 'DELETE') {
      const k = Number(m[1]);
      const item = issueAt(k) ?? pulls[k - 1];
      const name = decodeURIComponent(m[2]!);
      if (!item || !item.labels.some((l: any) => l.name === name)) return json(404, { message: 'Label does not exist' });
      item.labels = item.labels.filter((l: any) => l.name !== name);
      return json(200, item.labels);
    }
    return json(404, { message: `fake GitHub: no route ${method} ${path}` });
  };
  return { fetch: f as typeof fetch, refs, commits, pulls, reviews, issues, comments, statuses, log, viewer, lineComments, id, fileAt: (ref: string, p: string) => commits.get(resolveRef(ref)!)?.files.get(p) };
}
