// The repo model of this build: @bridge-ds/core loadRepoModel over the local checkout (fsSource), loaded once per
// build process and shared by every page and lib (tokens, components, contrast, config, sign-in). The same function
// reads a team's repo from GitHub in the browser, so the build and Studio see one model.
// It imports only the pure lib/library/token-href, so libs can import it without a cycle (top-level await).
// The Library libs themselves (lib/library/*) are functions of a RepoModel; the lib/*.ts wrappers pass this one.
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { loadRepoModel, type RepoModel } from '@bridge-ds/core';
import { fsSource } from '@bridge-ds/core/node';
import { anchorOf, tokenHref } from './library/token-href';

function findRoot(start: string): string {
  let dir = resolve(start);
  for (;;) {
    if (existsSync(join(dir, 'AGENTS.md')) && existsSync(join(dir, 'packages'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) throw new Error(`docs-site: could not find the repo root from ${start}`);
    dir = parent;
  }
}

/** The repository checkout this site documents. */
export const ROOT = findRoot(process.cwd());

export { anchorOf, tokenHref };

async function load(): Promise<RepoModel> {
  const model = await loadRepoModel(fsSource(ROOT), { href: tokenHref });
  // The build documents what it enforces: a config, token file, contrast pair or docs.json it cannot read fails it.
  if (model.problems.length) throw new Error(`docs-site: the repo model has problems:\n- ${model.problems.join('\n- ')}`);
  return model;
}

/** The model of this checkout, read once per build. */
export const repoModel: RepoModel = await load();
