// What a pull request changes, read in the browser for Studio's verdict (lib/review-rules studioVerdict), like the MCP
// server and the CLI: the Figma push facts (core figmaPushOf, docs/BUILD-REQUESTS.md: a push from the Figma plugin
// counts as design-approved, token values only also as tech-approved) and whether it only changes token values (core
// isTokenValueChange, decision TV-1: the design approval is then all it needs, whoever opened it). Reads its files
// (when not read yet) and the before and after text of its token files, from raw.githubusercontent.com (no API
// budget), only when the answer depends on them. An email member reads those texts by blob sha in Bridge's batch
// (scripts/blob-reads.ts), shared with the home's token cards of the same changes. Unreadable token files leave the changes unknown: the change then
// waits for a developer, never ships by mistake.
import { figmaPushOf, isFigmaPush, isTokenValueChange, mayBeTokenValueChange, tokenFileChanges, type FigmaPush, type LabelLike } from '@bridge-ds/core';
import { isContribAuth } from '../lib/contribute';
import { SHA40 } from '../lib/blob-batch';
import { blobText, treeAt } from './blob-reads';
import { getToken, ghGet, readRepo } from './github-session';

const isTokenFile = (path: string) => path.endsWith('.tokens.json');

export interface PushPull {
  number: number;
  body?: string | null;
  labels?: LabelLike[] | readonly ({ name?: string } | string)[];
  head: { sha: string };
  base?: { sha?: string; ref?: string } | null;
}

async function rawAt(ref: string, path: string): Promise<string | null> {
  const { owner, repo } = readRepo();
  try {
    return (await ghGet<string>(`https://raw.githubusercontent.com/${owner}/${repo}/${encodeURIComponent(ref)}/${path.split('/').map(encodeURIComponent).join('/')}`, { raw: true })).data;
  } catch {
    return null;
  }
}

type Files = { filename: string; status?: string; sha?: string | null }[];
type Changes = ReturnType<typeof tokenFileChanges> | null;

const filesCache = new Map<string, Promise<Files>>();
const tokensCache = new Map<string, Promise<Changes>>();
const pushCache = new Map<string, Promise<FigmaPush | null>>();
const valuesCache = new Map<string, Promise<boolean>>();
const keyOf = (pull: PushPull) => `${pull.number}@${pull.head.sha}`;

function filesOf(pull: PushPull, known: Files | null): Promise<Files> {
  if (known) return Promise.resolve(known);
  const key = keyOf(pull);
  let p = filesCache.get(key);
  if (!p) {
    const { owner, repo } = readRepo();
    p = ghGet<Files>(`/repos/${owner}/${repo}/pulls/${pull.number}/files?per_page=100`).then((r) => r.data);
    filesCache.set(key, p);
  }
  return p;
}

/** The token changes of a pull request, read once per head commit; null when a token file could not be read. */
function tokenChangesOf(pull: PushPull, files: Files): Promise<Changes> {
  const key = keyOf(pull);
  let p = tokensCache.get(key);
  if (!p) {
    p = readTokenChanges(pull, files);
    tokensCache.set(key, p);
  }
  return p;
}

/**
 * A token file's text before and after: by blob sha for an email member (the after's blob is in the file list, the
 * before's in the base commit's tree, both read once per page), else from the raw host as before. null: not read.
 */
async function textsOf(pull: PushPull, before: string, f: Files[number]): Promise<{ b: string | null; a: string | null }> {
  const { owner, repo } = readRepo();
  const byBlob = isContribAuth(getToken());
  const at = (ref: string, blob: string | null | undefined) => (byBlob && blob && SHA40.test(blob) ? blobText(owner, repo, ref, f.filename, blob).catch(() => null) : rawAt(ref, f.filename));
  const baseBlob = byBlob && f.status !== 'added' && SHA40.test(before) ? await treeAt(owner, repo, before).then((t) => t.get(f.filename), () => undefined) : undefined;
  const [b, a] = await Promise.all([f.status === 'added' ? null : at(before, baseBlob), f.status === 'removed' ? null : at(pull.head.sha, f.sha)]);
  return { b, a };
}

async function readTokenChanges(pull: PushPull, files: Files): Promise<Changes> {
  const { defaultBranch } = readRepo();
  const before = pull.base?.sha ?? pull.base?.ref ?? defaultBranch;
  try {
    const texts = await Promise.all(
      files
        .filter((f) => isTokenFile(f.filename))
        .map(async (f) => {
          const { b, a } = await textsOf(pull, before, f);
          if ((f.status !== 'added' && b === null) || (f.status !== 'removed' && a === null)) throw new Error('unread');
          return { before: b, after: a };
        }),
    );
    return tokenFileChanges(texts);
  } catch {
    return null;
  }
}

/** The Figma push facts of a pull request, or null when it is not one. `files`: its changed files when already read. */
export function figmaPushFor(pull: PushPull, files: Files | null): Promise<FigmaPush | null> {
  if (!isFigmaPush({ labels: pull.labels as LabelLike[], body: pull.body })) return Promise.resolve(null);
  const key = keyOf(pull);
  let p = pushCache.get(key);
  if (!p) {
    p = (async () => {
      const all = await filesOf(pull, files);
      const tokenChanges = await tokenChangesOf(pull, all);
      return figmaPushOf({ labels: pull.labels as LabelLike[], body: pull.body }, { files: all.map((f) => ({ path: f.filename, status: f.status })), tokenChanges });
    })().catch(() => null);
    pushCache.set(key, p);
  }
  return p;
}

/**
 * Whether a pull request only changes token values (core isTokenValueChange, decision TV-1), whoever opened it: the
 * design approval is then all it needs, as in the MCP server and the CLI. Reads the token files only when its files
 * could be one (core mayBeTokenValueChange); false when unsure, so the tech approval is never skipped by mistake.
 */
export function tokenValuesFor(pull: PushPull, files: Files | null): Promise<boolean> {
  const key = keyOf(pull);
  let p = valuesCache.get(key);
  if (!p) {
    p = (async () => {
      const all = await filesOf(pull, files);
      const changed = all.map((f) => ({ path: f.filename, status: f.status }));
      if (!mayBeTokenValueChange(changed)) return false;
      return isTokenValueChange({ files: changed, tokenChanges: await tokenChangesOf(pull, all), labels: pull.labels as LabelLike[] });
    })().catch(() => false);
    valuesCache.set(key, p);
  }
  return p;
}
