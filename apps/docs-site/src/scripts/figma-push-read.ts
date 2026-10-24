// What a pull request changes, read in the browser for Studio's verdict (lib/review-rules studioVerdict), like the MCP
// server and the CLI: the Figma push facts (core figmaPushOf, docs/BUILD-REQUESTS.md: a push from the Figma plugin
// counts as design-approved, token values only also as tech-approved) and whether it only changes token values (core
// isTokenValueChange, decision TV-1: the design approval is then all it needs, whoever opened it). Reads its files
// (when not read yet) and the before and after text of its token files, from raw.githubusercontent.com (no API
// budget), only when the answer depends on them. Unreadable token files leave the changes unknown: the change then
// waits for a developer, never ships by mistake.
import { figmaPushOf, isFigmaPush, isTokenValueChange, mayBeTokenValueChange, tokenFileChanges, type FigmaPush, type LabelLike } from '@bridge-ds/core';
import { ghGet, readRepo } from './github-session';

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

type Files = { filename: string; status?: string }[];
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

async function readTokenChanges(pull: PushPull, files: Files): Promise<Changes> {
  const { defaultBranch } = readRepo();
  const before = pull.base?.sha ?? pull.base?.ref ?? defaultBranch;
  try {
    const texts = await Promise.all(
      files
        .filter((f) => isTokenFile(f.filename))
        .map(async (f) => {
          const b = f.status === 'added' ? null : await rawAt(before, f.filename);
          const a = f.status === 'removed' ? null : await rawAt(pull.head.sha, f.filename);
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
