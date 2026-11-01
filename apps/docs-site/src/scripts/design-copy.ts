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
import type { CopyView } from '../lib/design-copy';
import { explorationsConfig } from './exploration-start';
import { getToken, ghWrite, GitHubError, studioClient } from './github-session';

/** The copy and the developers' repository of a product, when the team set a design copy for it. */
export function copyRepos(p: ProductConfig | null | undefined): { copy: string; code: string } | null {
  const cfg = explorationsConfig();
  const ds = `${cfg.owner}/${cfg.repo}`;
  const copy = designCopyOf(p, ds);
  const code = productCodeRepoOf(p, ds);
  return copy && code ? { copy, code } : null;
}

/** Where the copy stands: none (no design copy set), missing, or ready with how far behind. Null when GitHub could not say. */
export async function readCopyView(p: ProductConfig | null | undefined): Promise<CopyView | null> {
  const at = copyRepos(p);
  if (!at) return { kind: 'none' };
  try {
    const s = await designCopyStateOnGitHub(studioClient(at.copy), studioClient(at.code));
    return s.kind === 'missing' ? { kind: 'missing' } : { kind: 'ready', behind: s.behind };
  } catch {
    return null;
  }
}

/** "Make my copy": asks GitHub for it, then waits until it is built (about a minute at most). */
export async function makeCopy(p: ProductConfig): Promise<'ready' | 'slow' | 'turned-off' | 'no-access' | 'failed'> {
  const at = copyRepos(p);
  if (!at) return 'failed';
  try {
    const r = await makeDesignCopyOnGitHub(studioClient(at.code, getToken() ?? ''), at.copy);
    if (!r.ok) return r.reason;
    return (await waitForDesignCopy(studioClient(at.copy, getToken() ?? ''))) ? 'ready' : 'slow';
  } catch (err) {
    console.warn('Bridge: the copy could not be made.', err);
    return 'failed';
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
