// Try 2 to 4 token branches together, the reads and the rules shared by Bridge Studio, the MCP server and the CLI:
// which branches can be combined (token files only: code would need a real combined build), each branch's own token
// edits read from GitHub (its start against its current version, token-combine changeEdits), and where the
// combination opens (the admin demo with the Bridge toolbar, `?bridge=101,118`). Nothing is written anywhere.
import type { GitHubClient } from './github-client';
import { changeEdits, encodePicks, type ChangeEdits, type CombinePicks, type CombineSource } from './token-combine';

export const MIN_TOGETHER = 2;

export const MAX_TOGETHER = 4;

/**
 * Whether a change only edits tokens: token files under the tokens root, the contrast gate and release notes
 * (changesets). Anything else is code. No file read yet (or none) is not a token change.
 */
export function onlyTokens(files: string[], tokensRoot: string): boolean {
  const root = `${tokensRoot.replace(/^\/+|\/+$/g, '')}/`;
  return files.length > 0 && files.every((f) => (f.startsWith(root) && f.endsWith('.tokens.json')) || /contrast\.checks\.json$/.test(f) || f.startsWith('.changeset/'));
}

/** Token files a change edits, relative to the tokens root. */
export function tokenFilesOf(files: string[], tokensRoot: string): string[] {
  const root = `${tokensRoot.replace(/^\/+|\/+$/g, '')}/`;
  return files.filter((f) => f.startsWith(root) && f.endsWith('.tokens.json')).map((f) => f.slice(root.length));
}

/** A list of changes in an address: "101,118,120" (commas stay readable). */
export const changeList = (numbers: number[]) => numbers.join(',');

/**
 * The admin demo with the Bridge toolbar on the combination: production (no preview holds all of them), the tokens
 * applied live. `bridge-use` carries the picks.
 */
export function tryTogetherUrl(admin: string, numbers: number[], picks: CombinePicks): string {
  const url = new URL(admin);
  url.pathname = '/';
  url.hash = '';
  const use = encodePicks(picks);
  url.search = `?bridge=${changeList(numbers)}${use ? `&bridge-use=${encodeURIComponent(use)}` : ''}`;
  return url.href;
}

/** GitHub lists at most 300 files per compare: past that, a branch cannot be read whole, so it is not combined. */
export const COMBINE_COMPARE_LIMIT = 300;

export interface CombineBranch {
  number: number;
  title: string;
  /** Only token files (and release notes): it can be combined. */
  tokens: boolean;
  /** Its own token edits; null for a code change. */
  edits: ChangeEdits | null;
}

/**
 * One branch as the combination needs it: one compare against the default branch (the files it edits since it
 * started, and where it started), then its token files at its start and now. Without a token the client reads the
 * public raw host, so visitors spend no API read on file contents.
 */
export async function readCombineBranch(gh: GitHubClient, pull: { number: number; title: string; headSha: string }, opts: { base: string; tokensRoot: string }): Promise<CombineBranch> {
  const compare = await gh.compareDetailed(opts.base, pull.headSha);
  const files = compare.files;
  const names = files.flatMap((f) => (f.previous_filename ? [f.filename, f.previous_filename] : [f.filename]));
  const start = compare.mergeBase;
  if (!start || files.length >= COMBINE_COMPARE_LIMIT || !onlyTokens(names, opts.tokensRoot)) return { number: pull.number, title: pull.title, tokens: false, edits: null };
  const root = opts.tokensRoot.replace(/^\/+|\/+$/g, '');
  const tokenFiles = files.filter((f) => tokenFilesOf([f.filename], root).length);
  const source: CombineSource = { number: pull.number, base: {}, head: {}, files: tokenFiles.map((f) => tokenFilesOf([f.filename], root)[0]!) };
  await Promise.all(
    tokenFiles.map(async (f) => {
      const rel = tokenFilesOf([f.filename], root)[0]!;
      source.base[rel] = f.status === 'added' ? undefined : await gh.readFile(f.previous_filename ?? f.filename, start);
      source.head[rel] = f.status === 'removed' ? undefined : await gh.readFile(f.filename, pull.headSha);
    }),
  );
  return { number: pull.number, title: pull.title, tokens: true, edits: changeEdits(source) };
}
