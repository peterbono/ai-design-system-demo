// Bring in the latest library, for one change: reads how far it is behind (compare API), what the library and the
// change both touched since they parted, and the token files on the three sides; then writes either GitHub's
// update-branch (no conflict) or a merge commit with the designer's token choices (a pure token-file conflict).
// The rules live in lib/library-sync.ts and @bridge-ds/core token-merge; this file only reads and writes GitHub.
// Bring in the latest library, for one change: the Studio side of @bridge-ds/core library-update.ts (the same reads
// and writes the MCP server and the CLI use). This file adapts the page: its GitHub session (studioClient), the
// tokens root and contrast checks the site already has, and the raw compare it painted the row from.
import {
  commitLibraryResolution,
  readLibraryConflicts,
  resolvedTokenFiles as coreResolvedTokenFiles,
  type LibraryConflicts,
  type MergeChoices,
} from '@bridge-ds/core';
import { dismissStaleFrom, guardrail, type BranchRuleLike, type CompareLike, type Guardrail } from '../../lib/library-sync';
import { reviewTokenChange } from '../../lib/token-review';
import { ghGet, studioClient } from '../github-session';
import { siteConfig } from '../repo-context';

export interface SyncPull {
  number: number;
  html_url: string;
  head: { ref: string; sha: string; repo?: { full_name?: string } | null };
  base: { ref: string; sha: string };
}

const siteRoot = (): string | undefined => {
  try {
    return (siteConfig() as { tokensRoot?: string }).tokensRoot;
  } catch {
    return undefined;
  }
};

/** How the change compares with the library branch: behind_by, the shared commit, and the change's own files. */
export async function readCompare(owner: string, repo: string, library: string, headSha: string): Promise<CompareLike | null> {
  return ghGet<CompareLike>(`/repos/${owner}/${repo}/compare/${library}...${headSha}`)
    .then((r) => r.data)
    .catch(() => null);
}

/** Whether GitHub dismisses approvals on new commits to changes into this branch (null: no readable rule says). */
export async function readDismissStale(owner: string, repo: string, branch: string): Promise<boolean | null> {
  return ghGet<BranchRuleLike[]>(`/repos/${owner}/${repo}/rules/branches/${branch}`)
    .then((r) => dismissStaleFrom(r.data))
    .catch(() => null);
}

export type ConflictData = LibraryConflicts;

/**
 * What conflicts and who resolves it (core readLibraryConflicts), from the compare the row was painted from: the
 * tokens root from the site config, the contrast checks of the page when main has none.
 */
export async function readConflicts(owner: string, repo: string, compare: CompareLike, headSha: string): Promise<ConflictData> {
  return readLibraryConflicts(
    studioClient(`${owner}/${repo}`),
    { mergeBase: compare.merge_base_commit?.sha ?? null, baseSha: compare.base_commit?.sha ?? null, baseTree: compare.base_commit?.commit?.tree?.sha ?? null, files: compare.files ?? [] },
    headSha,
    { tokensRoot: siteRoot(), contrastFallback: document.getElementById('bridge-contrast')?.textContent || undefined },
  );
}

/** Every token file once resolved (core resolvedTokenFiles). */
export const resolvedTokenFiles = (data: ConflictData, choices: MergeChoices) => coreResolvedTokenFiles(data, choices);

/** The contrast guardrail of the resolved tokens against the latest library, before anything is sent. */
export function checkGuardrail(data: ConflictData, choices: MergeChoices): Guardrail {
  const t = data.tokens!;
  return guardrail(reviewTokenChange(t.theirsFiles, resolvedTokenFiles(data, choices).all, t.pairs, t.options));
}

/** Commits the resolution to the change (core commitLibraryResolution): a merge commit, fast-forward only. */
export async function commitResolution(owner: string, repo: string, pull: SyncPull, data: ConflictData, choices: MergeChoices, who: string | null): Promise<string> {
  return commitLibraryResolution(studioClient(`${owner}/${repo}`), pull, data, choices, who);
}

/** GitHub's "Update branch": merges the latest library into the change. Only when nothing conflicts. */
export async function bringInLatest(owner: string, repo: string, pull: SyncPull): Promise<void> {
  await studioClient(`${owner}/${repo}`).updatePullRequestBranch(pull.number, pull.head.sha);
}

/** Waits until GitHub reports a new head for the change (update-branch answers before it is done). */
export async function waitForNewHead(owner: string, repo: string, n: number, oldSha: string, tries = 10): Promise<string | null> {
  for (let i = 0; i < tries; i++) {
    await new Promise((r) => setTimeout(r, 1500));
    const sha = await ghGet<{ head: { sha: string } }>(`/repos/${owner}/${repo}/pulls/${n}?t=${Date.now()}`)
      .then((r) => r.data.head.sha)
      .catch(() => null);
    if (sha && sha !== oldSha) return sha;
  }
  return null;
}
