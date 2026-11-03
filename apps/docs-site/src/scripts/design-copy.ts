// The design team's copy of a product (bridge.config.json products[].design) from Studio, with the viewer's GitHub
// sign-in: read where it stands, make it ("Make my copy": GitHub's fork, built in the background), and bring it up to
// date ("Get the latest": GitHub's "Sync fork"). The core calls are @bridge-ds/core's design-copy-github.ts; the words
// are lib/design-copy.ts. Designers never see a GitHub error here, only what to do next.
import {
  designCopyOf,
  designCopyStateOnGitHub,
  getLatestDesignCopyOnGitHub,
  makeDesignCopyOnGitHub,
  productCodeRepoOf,
  waitForDesignCopy,
  type ProductConfig,
} from '@bridge-ds/core';
import { copyAccessTarget, copyListed, type CopyAccess, type CopyInstallation, type CopyView } from '../lib/design-copy';
import { githubBusy } from '../lib/github-busy';
import { explorationsConfig } from './exploration-start';
import { getToken, ghGet, ghWrite, GitHubError, RateLimitError, sessionMode, studioClient, type Fetched } from './github-session';

/** The copy and the developers' repository of a product, when the team set a design copy for it. */
export function copyRepos(p: ProductConfig | null | undefined): { copy: string; code: string } | null {
  const cfg = explorationsConfig();
  const ds = `${cfg.owner}/${cfg.repo}`;
  const copy = designCopyOf(p, ds);
  const code = productCodeRepoOf(p, ds);
  return copy && code ? { copy, code } : null;
}

/**
 * Where the copy stands: none (no design copy set), missing, ready with how far behind, or busy (GitHub busy for the
 * viewer: when it is back, never "missing"). Null when GitHub could not say for another reason.
 */
export async function readCopyView(p: ProductConfig | null | undefined): Promise<CopyView | null> {
  const at = copyRepos(p);
  if (!at) return { kind: 'none' };
  try {
    const s = await designCopyStateOnGitHub(studioClient(at.copy), studioClient(at.code));
    return s.kind === 'missing' ? { kind: 'missing' } : { kind: 'ready', behind: s.behind };
  } catch (err) {
    const busy = githubBusy(err);
    return busy ? { kind: 'busy', busy } : null;
  }
}

export type MakeCopyResult = 'ready' | 'slow' | 'turned-off' | 'no-access' | 'failed' | CopyAccess;

/**
 * "Make my copy": asks GitHub for it, then waits until it is built (about a minute at most). Signed in with the Bridge
 * app on an account where Bridge sees only the ticked products, GitHub does not tick the new copy: Bridge (and the
 * viewer's own sign-in) could not open it, so the answer is the access step (CopyAccess), and finishCopy goes on once
 * copyVisible says it is ticked.
 */
export async function makeCopy(p: ProductConfig, opts: { sleep?: (ms: number) => Promise<void> } = {}): Promise<MakeCopyResult> {
  const at = copyRepos(p);
  if (!at) return 'failed';
  try {
    const r = await makeDesignCopyOnGitHub(studioClient(at.code, getToken() ?? ''), at.copy);
    if (!r.ok) return r.reason;
    const access = await copyAccessNeeded(at.copy, opts);
    if (access) return access;
    return await finishCopy(p);
  } catch (err) {
    console.warn('Bridge: the copy could not be made.', err);
    return 'failed';
  }
}

/** Waits until GitHub has built the copy (after the access step too). */
export async function finishCopy(p: ProductConfig): Promise<'ready' | 'slow' | 'failed'> {
  const at = copyRepos(p);
  if (!at) return 'failed';
  try {
    return (await waitForDesignCopy(studioClient(at.copy, getToken() ?? ''))) ? 'ready' : 'slow';
  } catch (err) {
    console.warn('Bridge: the copy could not be made.', err);
    return 'failed';
  }
}

/** A read GitHub answered from this browser's copy because it refused it: busy, never an answer. */
function live<T>(r: Fetched<T>): T {
  if (r.stale) throw new RateLimitError(r.resetAt ?? null);
  return r.data;
}

/**
 * Whether the installation lists the copy: its products, asked again (never the browser's copy), page by page. Throws
 * RateLimitError when GitHub is busy.
 */
export async function copyVisible(access: Pick<CopyAccess, 'copy' | 'installation'>): Promise<boolean> {
  const id = access.installation.id;
  for (let page = 1; page <= 10; page++) {
    const data = live(await ghGet<{ repositories?: { full_name?: string }[]; total_count?: number }>(`/user/installations/${id}/repositories?per_page=100&page=${page}`, { fresh: true }));
    const repos = data.repositories ?? [];
    if (copyListed(repos, access.copy)) return true;
    if (repos.length < 100 || page * 100 >= (data.total_count ?? 0)) return false;
  }
  return false;
}

/**
 * After GitHub took the request: null when Bridge will open the copy (it sees every product of that account), when a
 * tick would not help (Bridge is not on that account, the viewer signed in with a token of their own) or when GitHub
 * could not say; else the access step. GitHub may tick a new product itself: three looks two seconds apart first.
 */
async function copyAccessNeeded(copy: string, opts: { sleep?: (ms: number) => Promise<void> } = {}): Promise<CopyAccess | null> {
  if (sessionMode() !== 'app') return null;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  try {
    const list = live(await ghGet<{ installations?: CopyInstallation[] }>('/user/installations?per_page=100', { fresh: true })).installations ?? [];
    const target = copyAccessTarget(list, copy);
    // Bridge not on that account at all: not something a tick fixes, the page goes on as before.
    if (target.kind !== 'selected') return null;
    const access: CopyAccess = { kind: 'needs-access', copy, name: copy.split('/')[1] ?? copy, installation: target.installation };
    for (let i = 0; i < 3; i++) {
      if (i) await sleep(2000);
      if (await copyVisible(access)) return null;
    }
    return access;
  } catch (err) {
    // GitHub could not say: go on as before (the wait tells "still being made" if Bridge cannot open it).
    console.warn('Bridge: could not check that Bridge can open the copy.', err);
    return null;
  }
}

/** "Get the latest": brings the copy up to date with the product. */
export async function getLatest(p: ProductConfig): Promise<'ok' | 'conflict' | 'failed'> {
  const at = copyRepos(p);
  if (!at) return 'failed';
  try {
    const r = await getLatestDesignCopyOnGitHub(studioClient(at.copy, getToken() ?? ''));
    return r.ok ? 'ok' : 'conflict';
  } catch (err) {
    console.warn('Bridge: the copy could not be brought up to date.', err);
    return 'failed';
  }
}

/**
 * How many changes of the copy's main a running exploration does not have yet (the product moved after it started):
 * 0 when it is up to date, null when GitHub could not say. One or two reads.
 */
export async function explorationBehind(copy: string, branch: string): Promise<number | null> {
  try {
    const c = studioClient(copy);
    const main = (await c.getRepo()).defaultBranch;
    return (await c.compare(branch, main)).aheadBy;
  } catch {
    return null;
  }
}

/** "Bring it in": merges the copy's main into the exploration's branch (GitHub's merges API). Conflict: a developer. */
export async function bringLatestIntoExploration(copy: string, branch: string): Promise<'ok' | 'conflict' | 'failed'> {
  try {
    const main = (await studioClient(copy, getToken() ?? '').getRepo()).defaultBranch;
    await ghWrite('POST', `/repos/${copy}/merges`, { base: branch, head: main, commit_message: `Bring the latest ${main} into ${branch}` });
    return 'ok';
  } catch (err) {
    if (err instanceof GitHubError && err.status === 409) return 'conflict';
    console.warn('Bridge: the latest could not be brought into the exploration.', err);
    return 'failed';
  }
}
