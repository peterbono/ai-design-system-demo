// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { buildSnapshot, GitHubClient, loadRepoModel, recordingSource, type FetchLike, type RepoModel, type RepoSnapshot } from '@bridge-ds/core';
import { FALLBACK_REPO, loadTeamModel, repoContext, repoFromPath, siteConfig, type ModelCache } from './repo-context';
import { planEviction } from './repo-cache';
import type { TeamLoadEvent } from '../lib/load-progress';

const SHA = 'a'.repeat(40);

const page = (opts: { json?: string | null; hosted?: boolean; path?: string } = {}) => {
  document.body.innerHTML = opts.json == null ? '' : `<script type="application/json" id="bridge-repo">${opts.json}</script>`;
  document.documentElement.toggleAttribute('data-hosted', Boolean(opts.hosted));
  history.replaceState(null, '', opts.path ?? '/studio/');
};

describe('repoFromPath', () => {
  it('reads owner and repo from a team address', () => {
    expect(repoFromPath('/studio/acme/design-system/')).toEqual({ owner: 'acme', repo: 'design-system' });
    expect(repoFromPath('/studio/acme/ds.v2/changes/')).toEqual({ owner: 'acme', repo: 'ds.v2' });
    expect(repoFromPath('/studio/~/components/storybook/tokens/')).toEqual({ owner: 'components', repo: 'storybook' });
  });

  it('refuses anything that is not a team address or a valid GitHub name', () => {
    expect(repoFromPath('/studio/')).toBeNull();
    expect(repoFromPath('/studio/changes/')).toBeNull();
    expect(repoFromPath('/library/acme/ds/')).toBeNull();
    expect(repoFromPath('/studio/-acme/ds/')).toBeNull();
    expect(repoFromPath('/studio/acme/../')).toBeNull();
    expect(repoFromPath('/studio/acme/a%2Fb/')).toBeNull();
    expect(repoFromPath(`/studio/${'a'.repeat(40)}/ds/`)).toBeNull();
  });
});

describe('repoContext and siteConfig', () => {
  afterEach(() => page());

  it('self-hosted: the layout config, exactly as readRepo read it', () => {
    page({ json: JSON.stringify({ owner: 'peterbono', repo: 'ai-design-system-demo', defaultBranch: 'main', changes: 'direct' }) });
    expect(repoContext()).toEqual({ owner: 'peterbono', repo: 'ai-design-system-demo', defaultBranch: 'main', hosted: false });
    expect(siteConfig().changes).toBe('direct');
  });

  it('self-hosted: a path that looks like a team does not count without a team shell', () => {
    page({ json: JSON.stringify({ owner: 'me', repo: 'mine', defaultBranch: 'trunk' }), path: '/studio/components/storybook/' });
    expect(repoContext()).toEqual({ owner: 'me', repo: 'mine', defaultBranch: 'trunk', hosted: false });
  });

  it('self-hosted without config: the demo repository and no settings', () => {
    page({ json: '{not json' });
    expect(repoContext()).toEqual({ ...FALLBACK_REPO, hosted: false });
    expect(siteConfig()).toEqual({});
  });

  it('team shell: the address names the repository; settings wait for the team config', () => {
    page({ json: JSON.stringify({ owner: 'peterbono', repo: 'ai-design-system-demo', changes: 'direct' }), hosted: true, path: '/studio/Acme/ds/tokens/' });
    expect(repoContext()).toEqual({ owner: 'Acme', repo: 'ds', defaultBranch: 'main', hosted: true });
    // Never the build checkout's settings on another team's page.
    expect(siteConfig()).toEqual({});
  });
});

/** A fake GitHub for one public repository read anonymously (API for the repo, ref and tree; raw host for bodies). */
function fakeRepo(files: Record<string, string>, opts: { private?: boolean } = {}) {
  const calls: string[] = [];
  const tree = Object.keys(files).map((path, i) => ({ path, type: 'blob', sha: String(i).padStart(40, 'b'), size: files[path]!.length }));
  const routes: Record<string, unknown> = {
    '/repos/acme/ds': { full_name: 'acme/ds', default_branch: 'trunk', private: opts.private ?? false, permissions: { pull: true } },
    '/repos/acme/ds/git/ref/heads/trunk': { object: { sha: SHA } },
    [`/repos/acme/ds/git/trees/${SHA}?recursive=1`]: { tree, truncated: false },
  };
  const fetchImpl = (async (url: string) => {
    calls.push(url);
    const rawPrefix = `https://raw.githubusercontent.com/acme/ds/${SHA}/`;
    if (url.startsWith(rawPrefix)) {
      const path = decodeURIComponent(url.slice(rawPrefix.length));
      const hit = path in files;
      return { ok: hit, status: hit ? 200 : 404, headers: { get: () => null }, json: async () => null, text: async () => (hit ? files[path] : '404') };
    }
    const key = url.replace('https://api.github.com', '');
    const hit = key in routes;
    return { ok: hit, status: hit ? 200 : 404, headers: { get: () => null }, json: async () => (hit ? routes[key] : { message: 'Not Found' }), text: async () => '' };
  }) as unknown as FetchLike;
  return { client: new GitHubClient('acme/ds', '', fetchImpl, { attempts: 1, baseDelayMs: 0, sleep: async () => {} }), calls };
}

function memoryCache(): ModelCache & { models: Map<string, RepoModel>; blobs_: Map<string, string> } {
  const models = new Map<string, RepoModel>();
  const blobs_ = new Map<string, string>();
  return {
    models,
    blobs_,
    get: async (repo, sha) => models.get(`${repo}@${sha}`),
    put: async (repo, sha, model) => void models.set(`${repo}@${sha}`, model),
    blobs: () => ({ get: (sha) => blobs_.get(sha), set: (sha, text) => void blobs_.set(sha, text) }),
  };
}

const CONFIG = JSON.stringify({ repo: { owner: 'acme', name: 'ds' }, changes: 'direct', tokens: { root: 'tokens' }, components: { dir: 'src/components' } });

describe('loadTeamModel', () => {
  afterEach(() => page());

  it('reads the model at the default branch head anonymously, then serves it from the cache', async () => {
    const files = { 'bridge.config.json': CONFIG, 'tokens/color.json': JSON.stringify({ color: { ink: { $type: 'color', $value: '#000000' } } }) };
    const { client, calls } = fakeRepo(files);
    const cache = memoryCache();
    const first = await loadTeamModel(client, { cache, components: false });
    expect(first).toMatchObject({ sha: SHA, defaultBranch: 'trunk', private: false, cached: false });
    expect(first.model.site.changes).toBe('direct');
    expect(calls.some((u) => u.startsWith('https://raw.githubusercontent.com/acme/ds/'))).toBe(true);
    expect(cache.models.has(`acme/ds@${SHA}`)).toBe(true);

    calls.length = 0;
    const again = await loadTeamModel(client, { cache, components: false });
    expect(again.cached).toBe(true);
    // Warm: GET /repos and the branch head only.
    expect(calls).toEqual(['https://api.github.com/repos/acme/ds', 'https://api.github.com/repos/acme/ds/git/ref/heads/trunk']);
  });

  it('reports its steps: the head, then real file counts, then the cache on the next read', async () => {
    const files = { 'bridge.config.json': CONFIG, 'tokens/color.json': JSON.stringify({ color: { ink: { $type: 'color', $value: '#000000' } } }) };
    const { client } = fakeRepo(files);
    const cache = memoryCache();
    const steps: TeamLoadEvent[] = [];
    await loadTeamModel(client, { cache, components: false, onProgress: (e) => steps.push(e) });
    expect(steps[0]).toEqual({ step: 'head' });
    const counts = steps.flatMap((e) => (e.step === 'files' ? [e.progress] : []));
    expect(counts.length).toBeGreaterThan(1);
    expect(counts.at(-1)!.filesDone).toBe(counts.at(-1)!.filesTotal);
    expect(steps.some((e) => e.step === 'snapshot' || e.step === 'cache')).toBe(false);

    steps.length = 0;
    await loadTeamModel(client, { cache, components: false, onProgress: (e) => steps.push(e) });
    expect(steps).toEqual([{ step: 'head' }, { step: 'cache' }]);
  });

  it('gives a team shell its settings and default branch', async () => {
    page({ hosted: true, path: '/studio/acme/ds/' });
    const { client } = fakeRepo({ 'bridge.config.json': CONFIG });
    await loadTeamModel(client, { cache: memoryCache(), components: false });
    expect(repoContext()).toEqual({ owner: 'acme', repo: 'ds', defaultBranch: 'trunk', hosted: true });
    expect(siteConfig()).toMatchObject({ owner: 'acme', repo: 'ds', defaultBranch: 'trunk', changes: 'direct' });
  });
});

describe('loadTeamModel with a snapshot', () => {
  const files = { 'bridge.config.json': CONFIG, 'tokens/color.json': JSON.stringify({ color: { ink: { $type: 'color', $value: '#000000' } } }) };
  // The snapshot bridge snapshot would publish for these files at `sha`.
  async function snapshotAt(sha: string): Promise<RepoSnapshot> {
    const rec = recordingSource({ ref: { owner: 'acme', repo: 'ds', sha }, list: async (prefix) => Object.keys(files).filter((p) => !prefix || p.startsWith(`${prefix}/`)), text: async (p) => files[p as keyof typeof files] ?? null });
    const model = await loadRepoModel(rec.source, { components: false });
    return buildSnapshot({ model, paths: rec.paths, files: rec.files, version: 'test', branch: 'trunk' });
  }

  it('reads a fresh snapshot instead of the tree and the bodies', async () => {
    const { client, calls } = fakeRepo(files);
    const snap = await snapshotAt(SHA);
    const read = await loadTeamModel(client, { cache: memoryCache(), components: false, snapshot: async () => snap });
    expect(read).toMatchObject({ source: 'snapshot', cached: false, sha: SHA });
    const steps: TeamLoadEvent[] = [];
    await loadTeamModel(fakeRepo(files).client, { cache: memoryCache(), components: false, snapshot: async () => snap, onProgress: (e) => steps.push(e) });
    expect(steps.slice(0, 2)).toEqual([{ step: 'head' }, { step: 'snapshot' }]);
    expect(read.snapshot).toBe(snap);
    expect(read.model.site.changes).toBe('direct');
    // The same model a live read gives.
    const live = await loadTeamModel(fakeRepo(files).client, { cache: memoryCache(), components: false });
    expect(read.model.tokens).toEqual(live.model.tokens);
    expect(read.model.config).toEqual(live.model.config);
    // GET /repos and the branch head only: no tree, no body.
    expect(calls).toEqual(['https://api.github.com/repos/acme/ds', 'https://api.github.com/repos/acme/ds/git/ref/heads/trunk']);
  });

  it('completes a snapshot written before global stylesheets were read, with those files only', async () => {
    const styled = { ...files, 'src/styles/base.css': 'body { color: var(--color-ink); }' };
    const rec = recordingSource({ ref: { owner: 'acme', repo: 'ds', sha: SHA }, list: async (prefix) => Object.keys(files).filter((p) => !prefix || p.startsWith(`${prefix}/`)), text: async (p) => files[p as keyof typeof files] ?? null });
    const { styles: _globs, ...older } = buildSnapshot({ model: await loadRepoModel(rec.source, { components: false }), paths: rec.paths, files: rec.files, version: '0.11.0', branch: 'trunk' });
    const { client, calls } = fakeRepo(styled);
    const read = await loadTeamModel(client, { cache: memoryCache(), components: false, snapshot: async () => older });
    expect(read.source).toBe('snapshot');
    expect(read.model.styles.vars).toEqual({ 'src/styles/base.css': ['--color-ink'] });
    expect(calls.filter((u) => u.includes('/git/trees/'))).toHaveLength(1);
    // A current snapshot says which globs it read: nothing more to read, even with no stylesheet.
    const current = await snapshotAt(SHA);
    expect(current.styles).toEqual(['src/styles/**/*.css', 'src/theme/**/*.css']);
  });

  it('reads the repository live when the snapshot is older than the head, missing or broken', async () => {
    const old = await snapshotAt('c'.repeat(40));
    for (const reader of [async () => old, async () => null, async () => Promise.reject(new Error('boom'))]) {
      const { client, calls } = fakeRepo(files);
      const read = await loadTeamModel(client, { cache: memoryCache(), components: false, snapshot: reader });
      expect(read.source).toBe('live');
      expect(calls.some((u) => u.includes('/git/trees/'))).toBe(true);
    }
  });

  it('serves the cache before asking for the snapshot', async () => {
    const { client } = fakeRepo(files);
    const cache = memoryCache();
    await loadTeamModel(client, { cache, components: false });
    let asked = 0;
    const read = await loadTeamModel(client, { cache, components: false, snapshot: async () => (asked++, null) });
    expect(read.source).toBe('cache');
    expect(asked).toBe(0);
  });
});

describe('repo cache eviction', () => {
  it('keeps two shas per repository and five repositories, most recently used first', () => {
    const entries = [
      { key: 'a@1', repo: 'a', at: 1 },
      { key: 'a@2', repo: 'a', at: 2 },
      { key: 'a@3', repo: 'a', at: 3 },
      ...['b', 'c', 'd', 'e', 'f'].map((r, i) => ({ key: `${r}@1`, repo: r, at: 10 + i })),
    ];
    // "a" is the least recently used of six repositories: all of it goes, bodies included.
    expect(planEviction(entries)).toEqual({ models: ['a@3', 'a@2', 'a@1'], repos: ['a'] });
    expect(planEviction(entries.slice(0, 3))).toEqual({ models: ['a@1'], repos: [] });
  });
});
