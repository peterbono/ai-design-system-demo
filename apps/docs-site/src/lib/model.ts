// The repo model of this build: @bridge-ds/core loadRepoModel over the local checkout (fsSource), loaded once per
// build process and shared by every page and lib (tokens, components, contrast, config, sign-in). The same function
// reads a team's repo from GitHub in the browser, so the build and Studio see one model.
// Nothing here imports another site lib, so libs can import it without a cycle (top-level await).
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { loadRepoModel, type RepoModel, type TokenRowTier } from '@bridge-ds/core';
import { fsSource } from '@bridge-ds/core/node';

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

/** Anchor id used across pages: the CSS variable name without the leading dashes. */
export const anchorOf = (cssVar: string) => cssVar.replace(/^--/, '');

const NON_FOUNDATION = /^(palette|button|control|input|table|dialog|card|badge|tag|avatar|tooltip|menu|popover|toast|alert|tabs|drawer|accordion|layout|field|checkbox|radio|switch|slider|progress|skeleton|spinner|sidebar|pagination|breadcrumb|kbd|divider|empty|link|select|combobox|data|display|overlay|surface-tier|font-role)-/;

/**
 * Where a token's CSS variable is documented. `tier` and `path` are the token's when it is a brand, semantic,
 * density or component token; a primitive (or an unknown variable) is routed by its name and type.
 */
export function tokenHref(cssVar: string, type?: string, tier?: TokenRowTier, path?: string): string {
  const id = anchorOf(cssVar);
  if (path && (tier === 'brand' || tier === 'component' || tier === 'density')) return `/tokens/?t=${encodeURIComponent(path)}`;
  if (NON_FOUNDATION.test(id)) return `/tokens/?q=${encodeURIComponent(id)}`;
  if (id.startsWith('color-') || id === 'focus-ring-color') return `/foundations/color/#${id}`;
  if (id.startsWith('space-')) return `/foundations/spacing/#${id}`;
  if (id.startsWith('radius-') || id.startsWith('border-') || id === 'focus-ring-width') return `/foundations/radius/#${id}`;
  if (id.startsWith('font-')) return `/foundations/typography/#${id}`;
  if (id.startsWith('shadow-') || id.startsWith('elevation-') || type === 'shadow') return `/foundations/elevation/#${id}`;
  if (type === 'color') return `/foundations/color/#${id}`;
  return `/tokens/?q=${encodeURIComponent(id)}`;
}

async function load(): Promise<RepoModel> {
  const model = await loadRepoModel(fsSource(ROOT), { href: tokenHref });
  // The build documents what it enforces: a config, token file, contrast pair or docs.json it cannot read fails it.
  if (model.problems.length) throw new Error(`docs-site: the repo model has problems:\n- ${model.problems.join('\n- ')}`);
  return model;
}

/** The model of this checkout, read once per build. */
export const repoModel: RepoModel = await load();
