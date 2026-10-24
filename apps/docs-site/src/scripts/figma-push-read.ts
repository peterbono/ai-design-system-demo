// The Figma push facts of a pull request in the browser (core figmaPushOf, docs/BUILD-REQUESTS.md): a push from the
// Figma plugin counts as design-approved, and token values only also as tech-approved, so it ships after the checks.
// Studio's verdict (lib/review-rules studioVerdict) reads them, like the MCP server and the CLI. Reads nothing for a
// pull request that is not a Figma push; for one, its files (when not read yet) and the before and after text of its
// token files, from raw.githubusercontent.com (no API budget). Unreadable token files leave the changes unknown: the
// push then waits for a developer, never ships by mistake.
import { figmaPushOf, isFigmaPush, tokenFileChanges, type FigmaPush, type LabelLike } from '@bridge-ds/core';
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

const cache = new Map<string, Promise<FigmaPush | null>>();

/** The Figma push facts of a pull request, or null when it is not one. `files`: its changed files when already read. */
export function figmaPushFor(pull: PushPull, files: { filename: string; status?: string }[] | null): Promise<FigmaPush | null> {
  if (!isFigmaPush({ labels: pull.labels as LabelLike[], body: pull.body })) return Promise.resolve(null);
  const key = `${pull.number}@${pull.head.sha}`;
  let p = cache.get(key);
  if (!p) {
    p = read(pull, files).catch(() => null);
    cache.set(key, p);
  }
  return p;
}

async function read(pull: PushPull, known: { filename: string; status?: string }[] | null): Promise<FigmaPush | null> {
  const { owner, repo, defaultBranch } = readRepo();
  const files = known ?? (await ghGet<{ filename: string; status: string }[]>(`/repos/${owner}/${repo}/pulls/${pull.number}/files?per_page=100`)).data;
  const before = pull.base?.sha ?? pull.base?.ref ?? defaultBranch;
  let tokenChanges: ReturnType<typeof tokenFileChanges> | null = null;
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
    tokenChanges = tokenFileChanges(texts);
  } catch {
    tokenChanges = null;
  }
  return figmaPushOf({ labels: pull.labels as LabelLike[], body: pull.body }, { files: files.map((f) => ({ path: f.filename, status: f.status })), tokenChanges });
}
