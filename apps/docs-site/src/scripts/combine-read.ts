// Try several changes together, the reads (rules and words: lib/combine-changes.ts, the combination: @bridge-ds/core
// token-combine). For each change: one compare against the library (the files it edits since it started, and where
// it started), then its token files at its start and now, from raw.githubusercontent.com for visitors (no API read) or
// the API when signed in. The latest library is this build's own token files (/studio/library-files.json). Kept in
// memory per version of each change, so checking and unchecking never reads GitHub twice. Nothing is written.
import { changeEdits, layoutOptions, loadConfig, parseContrastChecks, type ChangeEdits, type CombineSource, type ContrastPair, type LayoutOptions } from '@bridge-ds/core';
import { onlyTokens, tokenFilesOf } from '../lib/combine-changes';
import type { CompareLike } from '../lib/library-sync';
import { ghGet, hasWorkingToken, readRepo } from './github-session';

export interface TogetherPull {
  number: number;
  title: string;
  head: { sha: string };
}

export interface TogetherSource {
  number: number;
  title: string;
  /** Only token files (and release notes): it can be combined here. */
  tokens: boolean;
  /** Its own token edits; null for a code change. */
  edits: ChangeEdits | null;
}

export interface LatestLibrary {
  files: Record<string, string>;
  options: LayoutOptions;
  tokensRoot: string;
  pairs: ContrastPair[];
}

/** GitHub lists at most 300 files per compare: past that, the change cannot be read whole, so it is not combined. */
const COMPARE_LIMIT = 300;

const rawText = (sha: string, path: string): Promise<string> => {
  const { owner, repo } = readRepo();
  const enc = path.split('/').map(encodeURIComponent).join('/');
  return hasWorkingToken()
    ? ghGet<string>(`/repos/${owner}/${repo}/contents/${enc}?ref=${sha}`, { accept: 'application/vnd.github.raw', raw: true }).then((r) => r.data)
    : ghGet<string>(`https://raw.githubusercontent.com/${owner}/${repo}/${sha}/${enc}`, { raw: true }).then((r) => r.data);
};

const sources = new Map<string, Promise<TogetherSource>>();

/** One change, as the combination needs it. Throws (RateLimitError, GitHubError) when GitHub cannot be read. */
export function readTogetherSource(pull: TogetherPull, tokensRoot: string): Promise<TogetherSource> {
  const key = `${pull.number}@${pull.head.sha}`;
  const memo = sources.get(key);
  if (memo) return memo;
  const p = (async (): Promise<TogetherSource> => {
    const { owner, repo, defaultBranch } = readRepo();
    const compare = (await ghGet<CompareLike>(`/repos/${owner}/${repo}/compare/${defaultBranch}...${pull.head.sha}`)).data;
    const files = compare.files ?? [];
    const names = files.flatMap((f) => (f.previous_filename ? [f.filename, f.previous_filename] : [f.filename]));
    const start = compare.merge_base_commit?.sha;
    if (!start || files.length >= COMPARE_LIMIT || !onlyTokens(names, tokensRoot)) return { number: pull.number, title: pull.title, tokens: false, edits: null };
    const root = tokensRoot.replace(/^\/+|\/+$/g, '');
    const tokenFiles = files.filter((f) => tokenFilesOf([f.filename], root).length);
    const source: CombineSource = { number: pull.number, base: {}, head: {}, files: tokenFiles.map((f) => tokenFilesOf([f.filename], root)[0]!) };
    await Promise.all(
      tokenFiles.map(async (f) => {
        const rel = tokenFilesOf([f.filename], root)[0]!;
        const before = f.status === 'added' ? undefined : await rawText(start, f.previous_filename ?? f.filename);
        const after = f.status === 'removed' ? undefined : await rawText(pull.head.sha, f.filename);
        source.base[rel] = before;
        source.head[rel] = after;
      }),
    );
    return { number: pull.number, title: pull.title, tokens: true, edits: changeEdits(source) };
  })();
  sources.set(key, p);
  p.catch(() => sources.delete(key));
  return p;
}

let latest: Promise<LatestLibrary> | null = null;

/** This build's token files, layout and contrast pairs: the latest library the changes are combined on. */
export function readLatestLibrary(): Promise<LatestLibrary> {
  latest ??= fetch('/studio/library-files.json')
    .then((r) => {
      if (!r.ok) throw new Error('The latest library could not be read. Reload the page to try again.');
      return r.json() as Promise<{ files: Record<string, string>; config: string; tokensRoot: string }>;
    })
    .then((body) => {
      const config = loadConfig(body.config);
      const checks = document.getElementById('bridge-contrast')?.textContent || document.getElementById('xp-checks')?.textContent || undefined;
      return { files: body.files, options: layoutOptions(config), tokensRoot: body.tokensRoot, pairs: parseContrastChecks(checks) };
    });
  latest.catch(() => (latest = null));
  return latest;
}
