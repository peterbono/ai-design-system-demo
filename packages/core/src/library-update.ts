// Update a branch from main ("bring in the latest library"), shared by Bridge Studio, the MCP server and the CLI.
// Reads how far a branch is behind and what both sides touched since they parted; when nothing conflicts, GitHub's
// update-branch; when only token files conflict, a merge commit with the person's token choices ("keep mine" or
// "use main's", core token-merge); anything in code stays with a developer. One implementation over the core
// GitHub client: Studio passes its own client (studioClient), the MCP server and the CLI theirs.
import { loadConfig, DEFAULT_TOKEN_PATHS, type BridgeConfig } from './config';
import type { GitHubClient, TreeEntry } from './github-client';
import { buildTokenSet, layoutOptions, type LayoutOptions, type TokenSet } from './token-set';
import { parseContrastChecks, type ContrastPair } from './wcag';
import { applyTokenMerge, choiceFor, planTokenMerge, type MergeChoices, type TokenMergeConflict, type TokenMergeInput, type TokenMergePlan } from './token-merge';

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** A file of a compare (GET /repos/{o}/{r}/compare/{base}...{head}). */
export interface CompareFile {
  filename: string;
  status: string;
  previous_filename?: string | undefined;
  sha?: string | null | undefined;
}

/** Every path a compare file names: a renamed file counts under its old name too. */
const names = (files: CompareFile[]) => files.flatMap((f) => (f.previous_filename ? [f.filename, f.previous_filename] : [f.filename]));

/** Files both the branch and main changed since they parted, split into token files and the rest (code). */
export function overlap(changeFiles: CompareFile[], libraryFiles: CompareFile[], isTokenFile: (path: string) => boolean): { tokenFiles: string[]; codeFiles: string[] } {
  const lib = new Set(names(libraryFiles));
  const both = [...new Set(names(changeFiles).filter((f) => lib.has(f)))].sort();
  return { tokenFiles: both.filter(isTokenFile), codeFiles: both.filter((f) => !isTokenFile(f)) };
}

/** GitHub lists at most 300 files per compare: past that, Bridge cannot know what both sides touched. */
export const COMPARE_FILE_LIMIT = 300;

export type ConflictRoute = { kind: 'tokens'; files: string[] } | { kind: 'code'; alsoTokens: boolean; files: string[] };

/**
 * Who resolves the conflict. Only token files on both sides: the designer, in Bridge. Any code file on both sides, a
 * file list GitHub cut short, or no shared file at all (GitHub saw a conflict Bridge cannot explain): a developer.
 */
export function conflictRoute(o: { tokenFiles: string[]; codeFiles: string[] }, opts: { truncated?: boolean } = {}): ConflictRoute {
  if (opts.truncated || (!o.tokenFiles.length && !o.codeFiles.length)) return { kind: 'code', alsoTokens: false, files: [] };
  if (o.codeFiles.length) return { kind: 'code', alsoTokens: o.tokenFiles.length > 0, files: o.codeFiles };
  return { kind: 'tokens', files: o.tokenFiles };
}

/** A rule from GET /repos/{o}/{r}/rules/branches/{branch}. */
export interface BranchRuleLike {
  type: string;
  parameters?: { dismiss_stale_reviews_on_push?: boolean } | null;
}

/**
 * Whether GitHub dismisses approvals when new commits arrive, from the rules that apply to the library branch. True
 * or false when a pull request rule says so; null when no rule says (classic branch protection is not readable
 * without admin rights).
 */
export function dismissStaleFrom(rules: BranchRuleLike[] | null | undefined): boolean | null {
  const pr = (rules ?? []).filter((r) => r.type === 'pull_request');
  if (!pr.length) return null;
  return pr.some((r) => r.parameters?.dismiss_stale_reviews_on_push === true);
}

/** The commit message of the resolution, so History and the branch say what the person chose. */
export function resolutionMessage(input: { library: string; conflicts: TokenMergeConflict[]; choices: MergeChoices; who?: string | null | undefined }): string {
  const lines = input.conflicts.map((c) => `- ${c.path} (${c.file}): ${choiceFor(c, input.choices) === 'theirs' ? `used the ${input.library} value` : 'kept this change'}`);
  const title = input.conflicts.length ? `Bring in the latest ${input.library} and resolve ${plural(input.conflicts.length, 'token conflict')}` : `Bring in the latest ${input.library}`;
  const by = input.who ? `\n\nResolved in Bridge by @${input.who.replace(/^@/, '')}.` : '\n\nResolved in Bridge.';
  return `${title}${lines.length ? `\n\n${lines.join('\n')}` : ''}${by}`;
}

export type LibraryState = 'current' | 'behind' | 'conflict' | 'unknown';

export interface Freshness {
  state: LibraryState;
  /** Library updates (commits on the library branch) since the change started; null when not read. */
  behindBy: number | null;
  /** The commit the change and the library share. */
  mergeBase: string | null;
}

/**
 * How the change stands against the latest library. A conflict (mergeable false) wins: GitHub cannot combine them.
 * Otherwise it is behind when the library has commits the change has not. A shipped or closed change has nothing to
 * bring in. A compare that could not be read says unknown, never "up to date".
 */
export function freshness<C extends { behind_by?: number | undefined; merge_base_commit?: { sha: string } | null | undefined }>(input: { compare: C | null | undefined; mergeable: boolean | null | undefined; open: boolean }): Freshness {
  const behindBy = typeof input.compare?.behind_by === 'number' ? input.compare.behind_by : null;
  const mergeBase = input.compare?.merge_base_commit?.sha ?? null;
  if (!input.open) return { state: 'current', behindBy, mergeBase };
  if (input.mergeable === false) return { state: 'conflict', behindBy, mergeBase };
  if (behindBy === null) return { state: 'unknown', behindBy, mergeBase };
  return { state: behindBy > 0 ? 'behind' : 'current', behindBy, mergeBase };
}

// ---------------------------------------------------------------------------------------------------------------
// Reads and writes over the core GitHub client

/** The compare of main and a branch head, in the shape the conflict reader needs (client.compareDetailed). */
export interface LibraryCompare {
  mergeBase: string | null;
  baseSha: string | null;
  baseTree: string | null;
  files: CompareFile[];
}

export interface LibraryConflicts {
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
  /** What the commit needs: main's tip and its tree, the branch head tree and its own files. */
  write?: { mainSha: string; mainTree: string; headSha: string; headTree: Map<string, TreeEntry>; changeFiles: CompareFile[] };
}

const withoutRoot = (root: string, p: string) => (root && p.startsWith(`${root}/`) ? p.slice(root.length + 1) : p);

async function treeAt(gh: GitHubClient, sha: string): Promise<Map<string, TreeEntry>> {
  const t = await gh.getTree(await gh.getCommitTree(sha));
  if (t.truncated) throw new Error('This repository is too big for Bridge to read in one go. A developer resolves the conflict on GitHub.');
  return new Map(t.entries.filter((e) => e.type === 'blob').map((e) => [e.path, e]));
}

async function textAt(gh: GitHubClient, sha: string, path: string): Promise<string> {
  return (await gh.readFile(path, sha)) ?? '';
}

async function tokenFilesAt(gh: GitHubClient, sha: string, root: string, tree: Map<string, TreeEntry>): Promise<Record<string, string>> {
  const prefix = root ? `${root}/` : '';
  const paths = [...tree.keys()].filter((p) => p.startsWith(prefix) && p.endsWith('.tokens.json'));
  return Object.fromEntries(await Promise.all(paths.map(async (p) => [withoutRoot(root, p), await textAt(gh, sha, p)] as const)));
}

async function configAt(gh: GitHubClient, sha: string, tree: Map<string, TreeEntry>): Promise<BridgeConfig | null> {
  if (!tree.has('bridge.config.json')) return null;
  try {
    return loadConfig(await textAt(gh, sha, 'bridge.config.json'));
  } catch {
    return null;
  }
}

/**
 * What conflicts and who resolves it. Reads the files main changed since the branch started (one compare), then, for
 * a pure token-file conflict, the token files at the shared start, in the branch and in main. `tokensRoot` is the
 * best guess before the config is read (Studio: its site config); `contrastFallback` the contrast checks to use when
 * main has none.
 */
export async function readLibraryConflicts(
  gh: GitHubClient,
  compare: LibraryCompare,
  headSha: string,
  opts: { tokensRoot?: string | undefined; contrastFallback?: string | undefined } = {},
): Promise<LibraryConflicts> {
  const { mergeBase, baseSha: mainSha, baseTree: mainTree } = compare;
  const changeFiles = compare.files;
  if (!mergeBase || !mainSha || !mainTree) return { route: conflictRoute({ tokenFiles: [], codeFiles: [] }) };
  const library = (await gh.compareDetailed(mergeBase, mainSha)).files;
  const truncated = changeFiles.length >= COMPARE_FILE_LIMIT || library.length >= COMPARE_FILE_LIMIT;
  // The tokens root guess first: the config of main confirms it before anything is written.
  const guess = opts.tokensRoot ?? DEFAULT_TOKEN_PATHS.root;
  const route = conflictRoute(
    overlap(changeFiles, library, (p) => p.endsWith('.tokens.json') && p.startsWith(`${guess}/`)),
    { truncated },
  );
  if (route.kind !== 'tokens') return { route };

  const [baseTree, headTree, theirsTree] = await Promise.all([treeAt(gh, mergeBase), treeAt(gh, headSha), treeAt(gh, mainSha)]);
  const config = (await configAt(gh, mainSha, theirsTree)) ?? (await configAt(gh, mergeBase, baseTree));
  const root = config?.tokens.root ?? guess;
  const options = config ? layoutOptions(config) : {};
  const checksPath = `${root}/${config?.tokens.contrastChecks ?? DEFAULT_TOKEN_PATHS.contrastChecks}`;
  const [baseFiles, mineFiles, theirsFiles, checks] = await Promise.all([
    tokenFilesAt(gh, mergeBase, root, baseTree),
    tokenFilesAt(gh, headSha, root, headTree),
    tokenFilesAt(gh, mainSha, root, theirsTree),
    theirsTree.has(checksPath) ? textAt(gh, mainSha, checksPath) : Promise.resolve(''),
  ]);
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
      pairs: parseContrastChecks(checks || opts.contrastFallback),
      options,
    },
    write: { mainSha, mainTree, headSha, headTree, changeFiles },
  };
}

/**
 * Every token file once resolved, relative to the tokens root: main's files, the branch's own token files where only
 * the branch touched them, and the merged files where both did.
 */
export function resolvedTokenFiles(data: LibraryConflicts, choices: MergeChoices): { all: Record<string, string>; merged: Record<string, string | null> } {
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

/**
 * Commits the resolution to the branch: a merge commit of main and the branch, whose tree is main plus the branch's
 * own files plus the merged token files. Fast-forward only: when the branch moved meanwhile, GitHub refuses and
 * nothing is lost.
 */
export async function commitLibraryResolution(
  gh: GitHubClient,
  pull: { head: { ref: string; sha: string }; base: { ref: string } },
  data: LibraryConflicts,
  choices: MergeChoices,
  who: string | null | undefined,
): Promise<string> {
  const t = data.tokens;
  const w = data.write;
  if (!t || !w) throw new Error('Only a token conflict can be resolved in Bridge. A developer resolves code conflicts on GitHub.');
  if (w.headSha !== pull.head.sha) throw new Error('The branch moved while you were choosing. Read it again and resolve again.');
  const { merged } = resolvedTokenFiles(data, choices);
  const shared = new Set(data.route.files);
  type Entry = { path: string; mode: string; sha: string | null } | { path: string; mode: string; content: string };
  const tree: Entry[] = [];
  for (const f of w.changeFiles) {
    if (shared.has(f.filename)) continue;
    if (f.previous_filename && !shared.has(f.previous_filename)) tree.push({ path: f.previous_filename, mode: '100644', sha: null });
    if (f.status === 'removed') {
      tree.push({ path: f.filename, mode: '100644', sha: null });
      continue;
    }
    const e = w.headTree.get(f.filename);
    if (!e) throw new Error(`Bridge could not read ${f.filename} in the branch. Read it again and try again.`);
    tree.push({ path: e.path, mode: e.mode, sha: e.sha });
  }
  for (const [rel, text] of Object.entries(merged)) {
    const path = t.root ? `${t.root}/${rel}` : rel;
    const mode = w.headTree.get(path)?.mode ?? '100644';
    tree.push(text === null ? { path, mode, sha: null } : { path, mode, content: text });
  }
  const newTree = await gh.createTreeEntries(w.mainTree, tree);
  const message = resolutionMessage({ library: pull.base.ref, conflicts: t.plan.conflicts, choices, who });
  const commit = await gh.createCommit(message, newTree, [w.headSha, w.mainSha]);
  await gh.updateBranch(pull.head.ref, commit);
  return commit;
}
