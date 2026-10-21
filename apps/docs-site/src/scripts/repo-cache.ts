// The browser cache of team repositories (multi-team plan, section 2.2): one IndexedDB database, "bridge-repo-cache",
// with the repo model keyed by `<owner>/<repo>@<sha>` and the file bodies keyed by blob sha. A commit sha and a blob
// sha never change meaning, so nothing here is ever revalidated: a new head sha is a new key. At most MAX_REPOS
// repositories and MAX_SHAS models per repository are kept (least recently used goes first). Bodies of a private
// repository must not outlive the session that read them: github-session.ts clears them on sign-out.
//
// Every call is best effort. Without IndexedDB (private window, blocked storage, a test runner) reads miss and writes
// do nothing; the caller then reads from GitHub as if the cache were cold.

import type { BlobCache, RepoModel } from '@bridge-ds/core';

export const CACHE_DB = 'bridge-repo-cache';
const DB_VERSION = 1;
const MODELS = 'models';
const BLOBS = 'blobs';

/** Repositories kept at once. */
export const MAX_REPOS = 5;
/** Models (head shas) kept per repository. */
export const MAX_SHAS = 2;

/** "Owner/Repo" -> "owner/repo": GitHub names are case-insensitive, the cache key is not. */
export const repoKey = (repo: string) => repo.toLowerCase();
export const modelKey = (repo: string, sha: string) => `${repoKey(repo)}@${sha}`;
const blobKey = (repo: string, sha: string) => `${repoKey(repo)}:${sha}`;

/** One cached model, as stored. */
export interface ModelEntry {
  key: string;
  repo: string;
  sha: string;
  /** Epoch ms of the last read or write (LRU order). */
  at: number;
  /** Read from a private repository: removed on sign-out. */
  private: boolean;
  model: RepoModel;
}

interface BlobEntry {
  key: string;
  repo: string;
  private: boolean;
  text: string;
}

/**
 * Which cached models to drop so that at most `maxRepos` repositories and `maxShas` models per repository remain,
 * the most recently used first. Pure, so the order is testable without IndexedDB.
 */
export function planEviction(
  entries: Pick<ModelEntry, 'key' | 'repo' | 'at'>[],
  maxRepos = MAX_REPOS,
  maxShas = MAX_SHAS,
): { models: string[]; repos: string[] } {
  const byRepo = new Map<string, Pick<ModelEntry, 'key' | 'repo' | 'at'>[]>();
  for (const e of [...entries].sort((a, b) => b.at - a.at)) {
    const k = repoKey(e.repo);
    byRepo.set(k, [...(byRepo.get(k) ?? []), e]);
  }
  const models: string[] = [];
  const repos: string[] = [];
  [...byRepo.entries()].forEach(([repo, list], i) => {
    if (i >= maxRepos) {
      repos.push(repo);
      models.push(...list.map((e) => e.key));
    } else models.push(...list.slice(maxShas).map((e) => e.key));
  });
  return { models, repos };
}

let opening: Promise<IDBDatabase | null> | undefined;

/** The database, or null where IndexedDB is missing or blocked. Opened once per page. */
function db(): Promise<IDBDatabase | null> {
  opening ??= new Promise<IDBDatabase | null>((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') return resolve(null);
      const req = indexedDB.open(CACHE_DB, DB_VERSION);
      req.onupgradeneeded = () => {
        const d = req.result;
        if (!d.objectStoreNames.contains(MODELS)) d.createObjectStore(MODELS, { keyPath: 'key' }).createIndex('repo', 'repo');
        if (!d.objectStoreNames.contains(BLOBS)) d.createObjectStore(BLOBS, { keyPath: 'key' }).createIndex('repo', 'repo');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return opening;
}

const done = <T>(req: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

const committed = (tx: IDBTransaction) =>
  new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });

/** Runs `fn` on the open database; any failure (quota, blocked, closed) is a miss. */
async function withDb<T>(fallback: T, fn: (d: IDBDatabase) => Promise<T>): Promise<T> {
  try {
    const d = await db();
    return d ? await fn(d) : fallback;
  } catch {
    return fallback;
  }
}

/** The cached model of `repo` at commit `sha`, if any. A hit counts as a use for the LRU order. */
export function getCachedModel(repo: string, sha: string): Promise<RepoModel | undefined> {
  return withDb(undefined, async (d) => {
    const tx = d.transaction(MODELS, 'readwrite');
    const store = tx.objectStore(MODELS);
    const hit = (await done(store.get(modelKey(repo, sha)))) as ModelEntry | undefined;
    if (hit) store.put({ ...hit, at: Date.now() });
    await committed(tx);
    // A model cached before the model read global stylesheets has no `styles`: read the repository again.
    return hit?.model && 'styles' in hit.model ? hit.model : undefined;
  });
}

/** Keeps `model` for `repo` at `sha`, then drops what is over the limits (with the bodies of dropped repositories). */
export function putCachedModel(repo: string, sha: string, model: RepoModel, opts: { private: boolean }): Promise<void> {
  return withDb(undefined, async (d) => {
    const tx = d.transaction([MODELS, BLOBS], 'readwrite');
    const models = tx.objectStore(MODELS);
    const entry: ModelEntry = { key: modelKey(repo, sha), repo: repoKey(repo), sha, at: Date.now(), private: opts.private, model };
    models.put(entry);
    const all = (await done(models.getAll())) as ModelEntry[];
    const drop = planEviction(all);
    for (const k of drop.models) models.delete(k);
    for (const r of drop.repos) await deleteByRepo(tx.objectStore(BLOBS), r);
    await committed(tx);
  });
}

async function deleteByRepo(store: IDBObjectStore, repo: string) {
  const keys = await done(store.index('repo').getAllKeys(IDBKeyRange.only(repoKey(repo))));
  for (const k of keys) store.delete(k);
}

/**
 * The blob body cache for core's gitHubSource, scoped to one repository (bodies of a private repository are tagged
 * so that sign-out removes them).
 */
export function blobCacheFor(repo: string, opts: { private: boolean }): BlobCache {
  return {
    get: (sha) =>
      withDb(undefined, async (d) => {
        const hit = (await done(d.transaction(BLOBS).objectStore(BLOBS).get(blobKey(repo, sha)))) as BlobEntry | undefined;
        return hit?.text;
      }),
    set: (sha, text) =>
      withDb(undefined, async (d) => {
        const tx = d.transaction(BLOBS, 'readwrite');
        const entry: BlobEntry = { key: blobKey(repo, sha), repo: repoKey(repo), private: opts.private, text };
        tx.objectStore(BLOBS).put(entry);
        await committed(tx);
      }),
  };
}

/** Removes everything cached for one repository (models and bodies). */
export function clearRepoCache(repo: string): Promise<void> {
  return withDb(undefined, async (d) => {
    const tx = d.transaction([MODELS, BLOBS], 'readwrite');
    await deleteByRepo(tx.objectStore(MODELS), repo);
    await deleteByRepo(tx.objectStore(BLOBS), repo);
    await committed(tx);
  });
}

/** Removes every repository read privately (sign-out: private bodies must not outlive the session). */
export function clearPrivateRepoCaches(): Promise<void> {
  return withDb(undefined, async (d) => {
    const tx = d.transaction([MODELS, BLOBS], 'readwrite');
    for (const name of [MODELS, BLOBS]) {
      const store = tx.objectStore(name);
      const all = (await done(store.getAll())) as { key: string; private: boolean }[];
      for (const e of all) if (e.private) store.delete(e.key);
    }
    await committed(tx);
  });
}
