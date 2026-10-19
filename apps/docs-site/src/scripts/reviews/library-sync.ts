// Bring in the latest library, for one change: reads how far it is behind (compare API), what the library and the
// change both touched since they parted, and the token files on the three sides; then writes either GitHub's
// update-branch (no conflict) or a merge commit with the designer's token choices (a pure token-file conflict).
// The rules live in lib/library-sync.ts and @bridge-ds/core token-merge; this file only reads and writes GitHub.
import {
  DEFAULT_TOKEN_PATHS,
  applyTokenMerge,
  buildTokenSet,
  layoutOptions,
  loadConfig,
  parseContrastChecks,
  planTokenMerge,
  type BridgeConfig,
  type ContrastPair,
  type LayoutOptions,
  type MergeChoices,
  type TokenMergeInput,
  type TokenMergePlan,
  type TokenSet,
} from '@bridge-ds/core';
import { COMPARE_FILE_LIMIT, conflictRoute, dismissStaleFrom, guardrail, overlap, resolutionMessage, type BranchRuleLike, type CompareFile, type CompareLike, type ConflictRoute, type Guardrail } from '../../lib/library-sync';
import { reviewTokenChange } from '../../lib/token-review';
import { ghGet, ghWrite } from '../github-session';

export interface SyncPull {
  number: number;
  html_url: string;
  head: { ref: string; sha: string; repo?: { full_name?: string } | null };
  base: { ref: string; sha: string };
}

interface TreeEntry {
  path: string;
  mode: string;
  type: string;
  sha: string;
}

const siteRoot = (): string | undefined => {
  try {
    return (JSON.parse(document.getElementById('bridge-repo')?.textContent || '{}') as { tokensRoot?: string }).tokensRoot;
  } catch {
    return undefined;
  }
};

const raw = (owner: string, repo: string, sha: string, path: string) =>
  ghGet<string>(`https://raw.githubusercontent.com/${owner}/${repo}/${sha}/${path}`, { raw: true }).then((r) => r.data);

async function treeAt(owner: string, repo: string, sha: string): Promise<Map<string, TreeEntry>> {
  const t = (await ghGet<{ tree: TreeEntry[]; truncated?: boolean }>(`/repos/${owner}/${repo}/git/trees/${sha}?recursive=1`)).data;
  if (t.truncated) throw new Error('This repository is too big for Bridge to read in one go. A developer resolves the conflict on GitHub.');
  return new Map(t.tree.filter((e) => e.type === 'blob').map((e) => [e.path, e]));
}

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

export interface ConflictData {
  route: ConflictRoute;
  /** Present for a pure token-file conflict. */
  tokens?: {
    root: string;
    plan: TokenMergePlan;
    input: TokenMergeInput;
    sets: { base: TokenSet; mine: TokenSet; theirs: TokenSet };
    /** Every token file of each side, relative to the tokens root. */
    mineFiles: Record<string, string>;
    theirsFiles: Record<string, string>;
    pairs: ContrastPair[];
    options: LayoutOptions;
  };
  /** What the commit needs: the library tip and its tree, the change's head tree and its own files. */
  write?: { mainSha: string; mainTree: string; headSha: string; headTree: Map<string, TreeEntry>; changeFiles: CompareFile[] };
}

const withoutRoot = (root: string, p: string) => (root && p.startsWith(`${root}/`) ? p.slice(root.length + 1) : p);

async function tokenFilesAt(owner: string, repo: string, sha: string, root: string, tree: Map<string, TreeEntry>): Promise<Record<string, string>> {
  const prefix = root ? `${root}/` : '';
  const paths = [...tree.keys()].filter((p) => p.startsWith(prefix) && p.endsWith('.tokens.json'));
  return Object.fromEntries(await Promise.all(paths.map(async (p) => [withoutRoot(root, p), await raw(owner, repo, sha, p)] as const)));
}

async function configAt(owner: string, repo: string, sha: string, tree: Map<string, TreeEntry>): Promise<BridgeConfig | null> {
  if (!tree.has('bridge.config.json')) return null;
  try {
    return loadConfig(await raw(owner, repo, sha, 'bridge.config.json'));
  } catch {
    return null;
  }
}

/**
 * What conflicts and who resolves it. Reads the files the library changed since the change started (one compare),
 * then, for a pure token-file conflict, the token files at the shared start, in the change and in the library.
 */
export async function readConflicts(owner: string, repo: string, compare: CompareLike, headSha: string): Promise<ConflictData> {
  const mergeBase = compare.merge_base_commit?.sha;
  const mainSha = compare.base_commit?.sha;
  const mainTree = compare.base_commit?.commit?.tree?.sha;
  const changeFiles = compare.files ?? [];
  if (!mergeBase || !mainSha || !mainTree) return { route: conflictRoute({ tokenFiles: [], codeFiles: [] }) };
  const library = (await ghGet<CompareLike>(`/repos/${owner}/${repo}/compare/${mergeBase}...${mainSha}`)).data.files ?? [];
  const truncated = changeFiles.length >= COMPARE_FILE_LIMIT || library.length >= COMPARE_FILE_LIMIT;
  // The tokens root from the site config first: the head config below confirms it before anything is written.
  const guess = siteRoot() ?? DEFAULT_TOKEN_PATHS.root;
  const route = conflictRoute(
    overlap(changeFiles, library, (p) => p.endsWith('.tokens.json') && p.startsWith(`${guess}/`)),
    { truncated },
  );
  if (route.kind !== 'tokens') return { route };

  const [baseTree, headTree, theirsTree] = await Promise.all([treeAt(owner, repo, mergeBase), treeAt(owner, repo, headSha), treeAt(owner, repo, mainSha)]);
  const config = (await configAt(owner, repo, mainSha, theirsTree)) ?? (await configAt(owner, repo, mergeBase, baseTree));
  const root = config?.tokens.root ?? guess;
  const options = config ? layoutOptions(config) : {};
  const checksPath = `${root}/${config?.tokens.contrastChecks ?? DEFAULT_TOKEN_PATHS.contrastChecks}`;
  const [baseFiles, mineFiles, theirsFiles, checks] = await Promise.all([
    tokenFilesAt(owner, repo, mergeBase, root, baseTree),
    tokenFilesAt(owner, repo, headSha, root, headTree),
    tokenFilesAt(owner, repo, mainSha, root, theirsTree),
    theirsTree.has(checksPath) ? raw(owner, repo, mainSha, checksPath) : Promise.resolve(''),
  ]);
  const fallback = document.getElementById('bridge-contrast')?.textContent || undefined;
  const input: TokenMergeInput = { base: baseFiles, mine: mineFiles, theirs: theirsFiles, files: route.files.map((f) => withoutRoot(root, f)) };
  return {
    route,
    tokens: {
      root,
      plan: planTokenMerge(input),
      input,
      sets: { base: buildTokenSet(baseFiles, options), mine: buildTokenSet(mineFiles, options), theirs: buildTokenSet(theirsFiles, options) },
      mineFiles,
      theirsFiles,
      pairs: parseContrastChecks(checks || fallback),
      options,
    },
    write: { mainSha, mainTree, headSha: headSha, headTree, changeFiles },
  };
}

/**
 * Every token file once resolved, relative to the tokens root: the library's files, the change's own token files
 * where only the change touched them, and the merged files where both did.
 */
export function resolvedTokenFiles(data: ConflictData, choices: MergeChoices): { all: Record<string, string>; merged: Record<string, string | null> } {
  const t = data.tokens!;
  const merged = applyTokenMerge(t.input, choices).files;
  const all: Record<string, string> = { ...t.theirsFiles };
  for (const f of data.write!.changeFiles) {
    for (const p of [f.previous_filename, f.filename]) {
      if (!p || !p.endsWith('.tokens.json') || !p.startsWith(`${t.root}/`)) continue;
      const rel = withoutRoot(t.root, p);
      if (rel in merged) continue;
      if (t.mineFiles[rel] === undefined) delete all[rel];
      else all[rel] = t.mineFiles[rel]!;
    }
  }
  for (const [rel, text] of Object.entries(merged)) {
    if (text === null) delete all[rel];
    else all[rel] = text;
  }
  return { all, merged };
}

/** The contrast guardrail of the resolved tokens against the latest library, before anything is sent. */
export function checkGuardrail(data: ConflictData, choices: MergeChoices): Guardrail {
  const t = data.tokens!;
  return guardrail(reviewTokenChange(t.theirsFiles, resolvedTokenFiles(data, choices).all, t.pairs, t.options));
}

/**
 * Commits the resolution to the change: a merge commit of the latest library and the change, whose tree is the
 * library plus the change's own files plus the merged token files. Fast-forward only: when the change moved meanwhile,
 * GitHub refuses and nothing is lost.
 */
export async function commitResolution(owner: string, repo: string, pull: SyncPull, data: ConflictData, choices: MergeChoices, who: string | null): Promise<string> {
  const t = data.tokens!;
  const w = data.write!;
  if (w.headSha !== pull.head.sha) throw new Error('The branch moved while you were choosing. Close this, reload the page and resolve again.');
  const { merged } = resolvedTokenFiles(data, choices);
  const shared = new Set(data.route.files);
  type Entry = { path: string; mode: string; type: 'blob'; sha: string | null } | { path: string; mode: string; type: 'blob'; content: string };
  const tree: Entry[] = [];
  for (const f of w.changeFiles) {
    if (shared.has(f.filename)) continue;
    if (f.previous_filename && !shared.has(f.previous_filename)) tree.push({ path: f.previous_filename, mode: '100644', type: 'blob', sha: null });
    if (f.status === 'removed') {
      tree.push({ path: f.filename, mode: '100644', type: 'blob', sha: null });
      continue;
    }
    const e = w.headTree.get(f.filename);
    if (!e) throw new Error(`Bridge could not read ${f.filename} in the change. Reload the page and try again.`);
    tree.push({ path: e.path, mode: e.mode, type: 'blob', sha: e.sha });
  }
  for (const [rel, text] of Object.entries(merged)) {
    const path = t.root ? `${t.root}/${rel}` : rel;
    const mode = w.headTree.get(path)?.mode ?? '100644';
    tree.push(text === null ? { path, mode, type: 'blob', sha: null } : { path, mode, type: 'blob', content: text });
  }
  const R = `/repos/${owner}/${repo}`;
  const newTree = await ghWrite<{ sha: string }>('POST', `${R}/git/trees`, { base_tree: w.mainTree, tree });
  const message = resolutionMessage({ library: pull.base.ref, conflicts: t.plan.conflicts, choices, who });
  const commit = await ghWrite<{ sha: string }>('POST', `${R}/git/commits`, { message, tree: newTree.sha, parents: [w.headSha, w.mainSha] });
  await ghWrite('PATCH', `${R}/git/refs/heads/${pull.head.ref}`, { sha: commit.sha, force: false });
  return commit.sha;
}

/** GitHub's "Update branch": merges the latest library into the change. Only when nothing conflicts. */
export async function bringInLatest(owner: string, repo: string, pull: SyncPull): Promise<void> {
  await ghWrite('PUT', `/repos/${owner}/${repo}/pulls/${pull.number}/update-branch`, { expected_head_sha: pull.head.sha });
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
