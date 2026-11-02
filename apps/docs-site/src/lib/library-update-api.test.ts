// The server side of the library update (api/_lib/library-update.ts): the write policy, the registry check, and the
// pull request opened, then updated in place, against an in-memory GitHub of one product repository.
import { describe, expect, it } from 'vitest';
import { latestManifest, newScope, npmLatest, parseNpmNames, sendLibraryUpdate, updateCallAllowed, isUpdateFile, type UpdateScope } from '../../api/_lib/library-update';
import { codeProductsFrom, libraryPackagesFrom } from '../../api/contribute/index';
import type { Redis } from '../../api/_lib/redis';
import { LOCK, LOCK_TEXT, PKG_TEXT, REACT_184 } from './library-update.fixture';
import { UPDATE_MARKER } from './library-update';

const REPO = 'art-print-shop-co/art-print-shop';
const sha = (n: number) => n.toString(16).padStart(40, '0');

function scope(over: Partial<UpdateScope> = {}): UpdateScope {
  return { ...newScope(REPO), defaultBranch: 'main', files: new Set(['package.json', 'package-lock.json']), trees: new Set([sha(1)]), commits: new Set([sha(2)]), pull: 7, ...over };
}

describe('the write policy', () => {
  const at = (rest: string) => `/repos/${REPO}/${rest}`;
  it('allows exactly the update: its files, its branch, its pull request', () => {
    const s = scope();
    expect(updateCallAllowed(s, 'GET', `/repos/${REPO}`, undefined)).toBeNull();
    expect(updateCallAllowed(s, 'GET', at('contents/package-lock.json?ref=main'), undefined)).toBeNull();
    expect(updateCallAllowed(s, 'POST', at('git/trees'), { base_tree: sha(9), tree: [{ path: 'package-lock.json', mode: '100644', type: 'blob', content: '{}' }] })).toBeNull();
    expect(updateCallAllowed(s, 'POST', at('git/commits'), { message: 'm', tree: sha(1), parents: [sha(9)] })).toBeNull();
    expect(updateCallAllowed(s, 'POST', at('git/refs'), { ref: 'refs/heads/bridge/update-library-1.8.4', sha: sha(2) })).toBeNull();
    expect(updateCallAllowed(s, 'PATCH', at('git/refs/heads/bridge/update-library-1.8.4'), { sha: sha(2), force: false })).toBeNull();
    expect(updateCallAllowed(s, 'POST', at('pulls'), { title: 't', head: 'bridge/update-library-1.8.4', base: 'main', body: `${UPDATE_MARKER} x`, maintainer_can_modify: true })).toBeNull();
    expect(updateCallAllowed(s, 'PATCH', at('pulls/7'), { title: 't', body: `${UPDATE_MARKER} x` })).toBeNull();
  });

  it('denies everything else', () => {
    const s = scope();
    const deny = (m: string, path: string, body?: unknown) => expect(updateCallAllowed(s, m, path, body)).not.toBeNull();
    // Another repository, the default branch, a forced move, a merge, a delete.
    deny('GET', '/repos/acme/other/contents/package.json');
    deny('POST', at('git/refs'), { ref: 'refs/heads/main', sha: sha(2) });
    deny('PATCH', at('git/refs/heads/main'), { sha: sha(2) });
    deny('PATCH', at('git/refs/heads/bridge/update-library-1.8.4'), { sha: sha(2), force: true });
    deny('PATCH', at('git/refs/heads/bridge/update-library-1.8.4'), { sha: sha(3) });
    deny('PUT', at('pulls/7/merge'), {});
    deny('POST', at('merges'), { base: 'main', head: 'bridge/update-library-1.8.4' });
    deny('DELETE', at('git/refs/heads/bridge/update-library-1.8.4'));
    deny('PUT', at('contents/package.json'), { message: 'x', content: 'e30=' });
    // Files other than the computed package files, CI, a symlink, a tree without its base.
    deny('POST', at('git/trees'), { base_tree: sha(9), tree: [{ path: '.github/workflows/ci.yml', mode: '100644', type: 'blob', content: 'x' }] });
    deny('POST', at('git/trees'), { base_tree: sha(9), tree: [{ path: 'src/index.ts', mode: '100644', type: 'blob', content: 'x' }] });
    deny('POST', at('git/trees'), { base_tree: sha(9), tree: [{ path: 'package.json', mode: '120000', type: 'blob', content: 'x' }] });
    deny('POST', at('git/trees'), { tree: [{ path: 'package.json', mode: '100644', type: 'blob', content: 'x' }] });
    deny('POST', at('git/trees'), { base_tree: sha(9), tree: [{ path: 'apps/web/package.json', mode: '100644', type: 'blob', content: 'x' }] });
    // A commit of a tree it did not make, a branch at a commit it did not make, another branch name.
    deny('POST', at('git/commits'), { message: 'm', tree: sha(5), parents: [sha(9)] });
    deny('POST', at('git/refs'), { ref: 'refs/heads/bridge/update-library-1.8.4', sha: sha(5) });
    deny('POST', at('git/refs'), { ref: 'refs/heads/explore/x', sha: sha(2) });
    // A pull request to another base, without the marker, another pull request, labels or reviewers.
    deny('POST', at('pulls'), { title: 't', head: 'bridge/update-library-1.8.4', base: 'release', body: UPDATE_MARKER });
    deny('POST', at('pulls'), { title: 't', head: 'bridge/update-library-1.8.4', base: 'main', body: 'no marker' });
    deny('PATCH', at('pulls/8'), { title: 't' });
    deny('PATCH', at('pulls/7'), { state: 'closed' });
    deny('POST', at('issues/7/labels'), { labels: ['x'] });
    deny('POST', at('pulls/7/requested_reviewers'), { reviewers: ['x'] });
    deny('GET', at('hooks'));
  });

  it('names the files it may write: package files at the root or in a workspace, never a dot folder', () => {
    expect(isUpdateFile('package.json')).toBe(true);
    expect(isUpdateFile('apps/web/package-lock.json')).toBe(true);
    expect(isUpdateFile('.github/package.json')).toBe(false);
    expect(isUpdateFile('node_modules/x/package.json')).toBe(false);
    expect(isUpdateFile('../package.json')).toBe(false);
    expect(isUpdateFile('pnpm-lock.yaml')).toBe(false);
  });
});

describe('settings', () => {
  it('reads the products with their own repository and the library packages', () => {
    const config = { products: [{ key: 'admin-app', name: 'Art print shop', repo: REPO }, { key: 'library', name: 'Library', default: true }, { key: 'self', name: 'Self', repo: 'peterbono/ds' }], previews: { packages: ['@bridge-ds/react', 'Not A Name'] } };
    expect(codeProductsFrom(config, 'peterbono/ds')).toEqual([{ key: 'admin-app', name: 'Art print shop', repo: REPO }]);
    expect(libraryPackagesFrom(config)).toEqual(['@bridge-ds/react']);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// An in-memory GitHub of one repository, and the registry

interface Commit {
  tree: Map<string, string>;
  parent: string | null;
}

function fakeWorld(opts: { manifests?: Record<string, unknown> } = {}) {
  let n = 100;
  const commits = new Map<string, Commit>();
  const trees = new Map<string, Map<string, string>>();
  const refs = new Map<string, string>();
  const pulls: { number: number; title: string; body: string; head: { ref: string; sha: string; repo: { full_name: string } }; base: { ref: string }; html_url: string; state: string }[] = [];
  const calls: string[] = [];
  const root = sha(n++);
  commits.set(root, { tree: new Map([['package.json', PKG_TEXT], ['package-lock.json', LOCK_TEXT], ['src/main.tsx', 'x']]), parent: null });
  const rootTree = sha(n++);
  trees.set(rootTree, commits.get(root)!.tree);
  refs.set('main', root);
  const treeOf = (c: string) => [...trees].find(([, t]) => t === commits.get(c)!.tree)?.[0] ?? (() => {
    const s = sha(n++);
    trees.set(s, commits.get(c)!.tree);
    return s;
  })();
  const manifests = opts.manifests ?? {
    '@bridge-ds/react': REACT_184,
    '@bridge-ds/tokens': { name: '@bridge-ds/tokens', version: '1.6.0', dist: { tarball: 'https://registry.npmjs.org/@bridge-ds/tokens/-/tokens-1.6.0.tgz', integrity: 'sha512-tokens' } },
    '@bridge-ds/toolbar': { name: '@bridge-ds/toolbar', version: '0.7.0', dist: { tarball: 'https://registry.npmjs.org/@bridge-ds/toolbar/-/toolbar-0.7.0.tgz', integrity: 'sha512-toolbar' } },
  };
  const res = (status: number, body: unknown, raw = false) => new Response(raw ? (body as string) : JSON.stringify(body), { status, headers: { 'content-type': raw ? 'text/plain' : 'application/json' } });
  const f = async (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => {
    const method = init.method;
    if (url.startsWith('https://registry.npmjs.org/')) {
      const name = url.slice('https://registry.npmjs.org/'.length).replace(/\/latest$/, '');
      calls.push(`npm ${name}`);
      return manifests[name] ? res(200, manifests[name]) : res(404, {});
    }
    const u = new URL(url);
    const rest = u.pathname.replace(`/repos/${REPO}`, '').replace(/^\//, '');
    const body = init.body ? JSON.parse(init.body) : undefined;
    calls.push(`${method} ${rest}${u.search}`);
    const raw = init.headers.Accept === 'application/vnd.github.raw';
    if (method === 'GET' && rest === '') return res(200, { default_branch: 'main' });
    if (method === 'GET' && rest === 'contents') return res(200, [...commits.get(refs.get('main')!)!.tree.keys()].filter((p) => !p.includes('/')).map((name) => ({ name, type: 'file' })));
    if (method === 'GET' && rest.startsWith('contents/')) {
      const ref = u.searchParams.get('ref') ?? 'main';
      const c = refs.get(ref);
      const text = c ? commits.get(c)!.tree.get(decodeURIComponent(rest.slice('contents/'.length))) : undefined;
      return text === undefined ? res(404, {}) : res(200, raw ? text : { content: text }, raw);
    }
    if (method === 'GET' && rest.startsWith('git/ref/heads/')) {
      const s = refs.get(decodeURIComponent(rest.slice('git/ref/heads/'.length)));
      return s ? res(200, { object: { sha: s } }) : res(404, {});
    }
    if (method === 'GET' && rest.startsWith('git/commits/')) return res(200, { tree: { sha: treeOf(rest.slice('git/commits/'.length)) } });
    if (method === 'GET' && rest === 'pulls') return res(200, pulls.filter((p) => p.state === 'open'));
    if (method === 'POST' && rest === 'git/trees') {
      const t = new Map(trees.get(body.base_tree));
      for (const e of body.tree) t.set(e.path, e.content);
      const s = sha(n++);
      trees.set(s, t);
      return res(201, { sha: s });
    }
    if (method === 'POST' && rest === 'git/commits') {
      const s = sha(n++);
      commits.set(s, { tree: trees.get(body.tree)!, parent: body.parents[0] });
      return res(201, { sha: s });
    }
    if (method === 'POST' && rest === 'git/refs') {
      const b = body.ref.replace('refs/heads/', '');
      if (refs.has(b)) return res(422, {});
      refs.set(b, body.sha);
      return res(201, {});
    }
    if (method === 'PATCH' && rest.startsWith('git/refs/heads/')) {
      const b = decodeURIComponent(rest.slice('git/refs/heads/'.length));
      // Never forced: the new commit must sit on top of the branch.
      if (commits.get(body.sha)!.parent !== refs.get(b)) return res(422, { message: 'not a fast forward' });
      refs.set(b, body.sha);
      for (const p of pulls) if (p.head.ref === b) p.head.sha = body.sha;
      return res(200, {});
    }
    if (method === 'POST' && rest === 'pulls') {
      const number = pulls.length + 7;
      pulls.push({ number, title: body.title, body: body.body, head: { ref: body.head, sha: refs.get(body.head)!, repo: { full_name: REPO } }, base: { ref: body.base }, html_url: `https://github.com/${REPO}/pull/${number}`, state: 'open' });
      return res(201, { number, html_url: `https://github.com/${REPO}/pull/${number}` });
    }
    if (method === 'PATCH' && rest.startsWith('pulls/')) {
      const p = pulls.find((x) => x.number === Number(rest.slice('pulls/'.length)))!;
      Object.assign(p, body);
      return res(200, p);
    }
    return res(404, { message: `fake GitHub has no ${method} ${rest}` });
  };
  const fileAt = (ref: string, path: string) => commits.get(refs.get(ref)!)!.tree.get(path);
  return { f, calls, refs, pulls, fileAt, manifests };
}

const input = (w: ReturnType<typeof fakeWorld>) => ({ f: w.f, token: 't', repo: REPO, product: 'Art print shop', changelog: 'https://bridge.example/library/peterbono/ds/changelog/', requestedBy: 'Florian', redis: null });

describe('sendLibraryUpdate', () => {
  it('opens one pull request: the update branch, the lockfile entry patched, package.json left alone', async () => {
    const w = fakeWorld();
    const r = await sendLibraryUpdate(input(w));
    expect(r).toEqual({ state: 'opened', pr: { number: 7, url: `https://github.com/${REPO}/pull/7`, version: '1.8.4' }, lockfile: 'patched' });
    expect(w.refs.get('main')).toBe(sha(100));
    const lock = JSON.parse(w.fileAt('bridge/update-library-1.8.4', 'package-lock.json')!);
    expect(lock.packages['node_modules/@bridge-ds/react']).toMatchObject({ version: '1.8.4', integrity: 'sha512-new' });
    expect(lock.packages['node_modules/@bridge-ds/toolbar']).toEqual(LOCK.packages['node_modules/@bridge-ds/toolbar']);
    expect(w.fileAt('bridge/update-library-1.8.4', 'package.json')).toBe(PKG_TEXT);
    expect(w.pulls[0]).toMatchObject({ title: 'Update the Bridge library to 1.8.4', base: { ref: 'main' } });
    expect(w.pulls[0]!.body).toContain(UPDATE_MARKER);
    expect(w.pulls[0]!.body).toContain('Requested by Florian through Bridge.');
    // Never a merge, a delete, a contents write or a forced move.
    expect(w.calls.filter((c) => /merge|DELETE|PUT /.test(c))).toEqual([]);
  });

  it('is idempotent: the same version again changes nothing', async () => {
    const w = fakeWorld();
    await sendLibraryUpdate(input(w));
    const before = w.calls.length;
    const r = await sendLibraryUpdate(input(w));
    expect(r.state).toBe('unchanged');
    expect(w.calls.slice(before).filter((c) => !c.startsWith('GET') && !c.startsWith('npm'))).toEqual([]);
    expect(w.pulls).toHaveLength(1);
  });

  it('updates the open pull request in place when a newer version lands (a new commit on top, never forced)', async () => {
    const w = fakeWorld();
    await sendLibraryUpdate(input(w));
    const firstHead = w.refs.get('bridge/update-library-1.8.4');
    w.manifests['@bridge-ds/react'] = { ...REACT_184, version: '1.8.5', dist: { tarball: 'https://registry.npmjs.org/@bridge-ds/react/-/react-1.8.5.tgz', integrity: 'sha512-newer' } };
    const r = await sendLibraryUpdate(input(w));
    expect(r).toMatchObject({ state: 'updated', pr: { number: 7, version: '1.8.5' } });
    expect(w.pulls).toHaveLength(1);
    expect(w.pulls[0]!.title).toBe('Update the Bridge library to 1.8.5');
    expect(w.refs.get('bridge/update-library-1.8.4')).not.toBe(firstHead);
    expect(JSON.parse(w.fileAt('bridge/update-library-1.8.4', 'package-lock.json')!).packages['node_modules/@bridge-ds/react'].version).toBe('1.8.5');
    expect(w.calls.some((c) => c.startsWith('PATCH git/refs/heads/bridge/update-library-1.8.4'))).toBe(true);
  });

  it('falls back to package.json only when the dependencies changed, and says so', async () => {
    const w = fakeWorld();
    w.manifests['@bridge-ds/react'] = { ...REACT_184, dependencies: { ...REACT_184.dependencies, '@base-ui/react': '1.10.0' } };
    const r = await sendLibraryUpdate(input(w));
    expect(r.lockfile).toBe('install');
    expect(w.fileAt('bridge/update-library-1.8.4', 'package-lock.json')).toBe(LOCK_TEXT);
    expect(JSON.parse(w.fileAt('bridge/update-library-1.8.4', 'package.json')!).dependencies['@bridge-ds/react']).toBe('^1.8.4');
    expect(w.pulls[0]!.body).toContain('Run `npm install` on this branch');
  });

  it('sends nothing when the product is up to date', async () => {
    const w = fakeWorld();
    w.manifests['@bridge-ds/react'] = { ...REACT_184, version: '1.8.3' };
    expect(await sendLibraryUpdate(input(w))).toEqual({ state: 'current', pr: null, lockfile: null });
    expect(w.calls.filter((c) => !c.startsWith('GET') && !c.startsWith('npm'))).toEqual([]);
  });
});

describe('the registry', () => {
  function memRedis(): Redis & { data: Map<string, string> } {
    const data = new Map<string, string>();
    return {
      data,
      async cmd(...a) {
        if (a[0] === 'GET') return data.get(String(a[1])) ?? null;
        if (a[0] === 'SET') data.set(String(a[1]), String(a[2]));
        return 'OK';
      },
      async pipe() {
        return [];
      },
    };
  }

  it('keeps the latest manifest, so the second read costs the registry nothing', async () => {
    const w = fakeWorld();
    const redis = memRedis();
    expect(await npmLatest(w.f, redis, ['@bridge-ds/react', '@bridge-ds/nope'])).toEqual({ '@bridge-ds/react': '1.8.4', '@bridge-ds/nope': null });
    const n = w.calls.length;
    expect((await latestManifest(w.f, redis, '@bridge-ds/react'))?.dist.integrity).toBe('sha512-new');
    expect(w.calls.length).toBe(n);
  });

  it('takes valid package names only', () => {
    expect(parseNpmNames('@bridge-ds/react,@bridge-ds/tokens')).toEqual(['@bridge-ds/react', '@bridge-ds/tokens']);
    expect(() => parseNpmNames('../../etc')).toThrow();
    expect(() => parseNpmNames('')).toThrow();
  });
});
