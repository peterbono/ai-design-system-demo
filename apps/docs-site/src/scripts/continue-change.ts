// Continue a change, the GitHub side: which changes the viewer can add token edits to, the token files of a change,
// and the save itself. The save re-reads the change, runs the 3-way token check of the Figma plugin (base = what the
// editor loaded, ours = the draft, theirs = the change now), and on a clean result commits the draft on top of the
// change's current head with a fast-forward only update: a concurrent push fails the save, it never overwrites.
// Rules and words: lib/continue-change.ts. The editor (scripts/token-editor.ts) owns the draft and the dialog.
import {
  buildTokenSet,
  composeChangeset,
  GitHubClient,
  GitHubError,
  layoutOptions,
  loadRepoFiles,
  parseContrastChecks,
  validateProposal,
  type BridgeConfig,
  type FetchLike,
  type TokenSet,
} from '@bridge-ds/core';
import { applyDraft, type Draft } from '../lib/editor-model';
import {
  addableChanges,
  addedComment,
  addedCommitMessage,
  canAddTo,
  ChangeConflictError,
  changeTitle,
  isTokenChange,
  mergeChangeset,
  mergeCheck,
  type ChangePullLike,
  type ChangeTarget,
} from '../lib/continue-change';
import { currentViewer, getToken, ghGet, onAccess, prefersSignIn, readRepo, studioFetch } from './github-session';
import { ghVerb } from '../lib/gh-wording';

export interface ChangePull extends ChangePullLike {
  html_url: string;
  base: { ref: string; sha: string };
}

let write = false;
onAccess((a) => (write = Boolean(a?.write)));

/** Whether the signed-in account may write to the repository, as last read. */
export const viewerCanWrite = () => write;

function repoName(config: BridgeConfig) {
  if (config.repo) return { owner: config.repo.owner, name: config.repo.name };
  const r = readRepo();
  return { owner: r.owner, name: r.repo };
}

// Reads that must see the change as it is now: the browser may keep a GitHub answer for a minute otherwise.
const freshFetch: FetchLike = (url, init) => studioFetch(url, { ...(init ?? {}), cache: 'no-store' } as Parameters<FetchLike>[1]);
const freshClient = (config: BridgeConfig) => {
  const { owner, name } = repoName(config);
  return new GitHubClient(`${owner}/${name}`, getToken() ?? '', freshFetch);
};

/** One change, as GitHub has it now. */
export async function readChange(config: BridgeConfig, n: number): Promise<ChangePull> {
  const { owner, name } = repoName(config);
  const res = await freshFetch(`https://api.github.com/repos/${owner}/${name}/pulls/${n}`, {
    headers: { Accept: 'application/vnd.github+json', ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {}) },
  });
  if (res.status === 404) throw new Error(`Change #${n} was not found. It may have been deleted.`);
  if (!res.ok) throw new GitHubError(res.status, `GitHub answered ${res.status} for change #${n}.`);
  return (await res.json()) as ChangePull;
}

/** The open token changes the signed-in viewer may add to, theirs first. Empty when signed out. */
export async function readTargets(config: BridgeConfig): Promise<ChangeTarget[]> {
  const viewer = currentViewer()?.login;
  if (!viewer) return [];
  const { owner, name } = repoName(config);
  const pulls = (await ghGet<ChangePullLike[]>(`/repos/${owner}/${name}/pulls?state=open&per_page=100`)).data;
  return addableChanges(pulls, { repo: `${owner}/${name}`, viewer, write });
}

/** The token files of a change at one version, as the editor needs them. */
export async function loadChangeTokens(config: BridgeConfig, sha: string): Promise<{ config: BridgeConfig; originals: Record<string, string>; head: TokenSet; pairs: ReturnType<typeof parseContrastChecks> }> {
  const files = await loadRepoFiles(freshClient(config), sha, config.tokens.root);
  const cfg = files.config ?? config;
  return { config: cfg, originals: files.files, head: buildTokenSet(files.files, layoutOptions(cfg)), pairs: parseContrastChecks(files.contrastChecks) };
}

export interface AddResult {
  number: number;
  title: string;
  /** Tokens the draft changed in the change. */
  added: string[];
  /** Tokens the change had moved since the editor loaded it, kept as they are. */
  upstream: number;
}

/**
 * Commits the draft's token edits on top of change `n`. `base` is the token set the draft was made on; `ours` the
 * draft applied to it; `scoped` when the draft was made inside the change (its edits, not main). Throws ChangeConflictError when the same token changed in both.
 */
export async function addToChange(input: { n: number; config: BridgeConfig; base: TokenSet; ours: TokenSet; draft: Draft; scoped: boolean }): Promise<AddResult> {
  if (!getToken()) throw new Error(`${ghVerb(prefersSignIn())} first.`);
  const { n, config, base, ours } = input;
  const draft: Draft = { edits: input.draft.edits.filter((e) => e.kind !== 'docs') };
  const viewer = currentViewer()?.login ?? null;
  const pull = await readChange(config, n);
  const { owner, name } = repoName(config);
  const title = changeTitle(pull.title);
  if (!isTokenChange(pull, `${owner}/${name}`)) throw new Error(`${title} no longer takes edits: it shipped, closed or is not a token change. Start a new change instead.`);
  if (!canAddTo(pull, viewer, write)) throw new Error(`Only ${pull.user?.login ?? 'the author'} or someone with write access can add to ${title}. Start a new change instead.`);

  const client = freshClient(config);
  const branch = pull.head.ref;
  const headSha = await client.getBranchSha(branch);
  if (!headSha) throw new Error(`${title} lost its saved edits on GitHub. Start a new change instead.`);
  const latest = await loadRepoFiles(client, headSha, config.tokens.root);
  const cfg = latest.config ?? config;
  const opts = layoutOptions(cfg);
  const theirs = buildTokenSet(latest.files, opts);

  // The 3-way check: never overwrite an edit made in the change after the editor loaded it.
  const merge = mergeCheck(base, ours, theirs);
  if (merge.conflicts.length) throw new ChangeConflictError(merge.conflicts, n, input.scoped);

  const applied = applyDraft(theirs, latest.files, draft, opts);
  if (!applied.changes.length) throw new Error(`${title} already has these values. Nothing to add.`);
  const validation = validateProposal(applied.proposed, theirs, parseContrastChecks(latest.contrastChecks));
  if (validation.blocking.length) throw new Error(`Guardrails block these edits on ${title}: ${validation.blocking[0]!.message}`);

  const paths = applied.changes.map((c) => (c.target ?? c.current)!.path);
  const files: { path: string; sha: string }[] = [];
  for (const [rel, text] of Object.entries(applied.files)) files.push({ path: `${latest.tokensPath}/${rel}`, sha: await client.createBlob(text) });
  if (cfg.changeset) {
    // The change's changeset keeps listing everything it does (same file name as when it was opened).
    const path = composeChangeset(applied.changes, { title, branch, packageName: cfg.changeset.package }).path;
    const tree = await client.getTree(latest.treeSha, true);
    const entry = tree.entries.find((e) => e.path === path && e.type === 'blob');
    const existing = entry ? await client.getBlobText(entry.sha) : null;
    const text = mergeChangeset(existing, applied.changes, { title, branch, packageName: cfg.changeset.package, source: 'from the Bridge web editor' });
    if (text !== existing) files.push({ path, sha: await client.createBlob(text) });
  }
  const tree = await client.createTree(latest.treeSha, files);
  const commit = await client.createCommit(addedCommitMessage(pull.title, paths), tree, [headSha]);
  try {
    await client.updateBranch(branch, commit);
  } catch (err) {
    // Someone saved to the change between the read and the write: nothing was overwritten.
    if (err instanceof GitHubError && err.status === 422) throw new Error(`${title} changed while saving, so nothing was saved. Add to it again: Bridge rereads it first.`);
    throw err;
  }
  await client.addComment(n, addedComment(paths, viewer)).catch(() => undefined);
  return { number: n, title, added: paths, upstream: input.scoped ? merge.upstream.length : 0 };
}
