// The Library home's lead: what the design system holds, in one sentence, from its repo model. Pure, browser-safe.
import type { RepoModel } from '@bridge-ds/core';

export interface LibraryHome {
  tokens: number;
  semantic: number;
  components: number;
  /** Components with written guidance (a docs.json). */
  documented: number;
  themes: string[];
  /** "24 components and 180 tokens, in light and dark." */
  lead: string;
}

const plural = (n: number, one: string) => `${n} ${n === 1 ? one : `${one}s`}`;
const list = (xs: string[]) => (xs.length <= 1 ? (xs[0] ?? '') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);

export function libraryHome(model: Pick<RepoModel, 'tokens' | 'components'>): LibraryHome {
  const rows = model.tokens.rows;
  const comps = model.components?.list ?? [];
  const tokens = rows.all.length;
  const documented = comps.filter((c) => c.docs).length;
  const parts = [comps.length ? plural(comps.length, 'component') : null, tokens ? plural(tokens, 'token') : null].filter((x): x is string => !!x);
  const lead = parts.length ? `${list(parts)}${rows.themes.length > 1 ? `, in ${list(rows.themes)}` : ''}.` : 'No tokens or components were found yet.';
  return { tokens, semantic: rows.semantic.length, components: comps.length, documented, themes: rows.themes, lead };
}

/**
 * The packages a designer meets in a Library: the tokens and the components. The site, the CLI, the core library and
 * the plugins ship with their own notes; their changesets stay out of the home's "What changed".
 */
export const LIBRARY_PACKAGES: readonly string[] = ['@bridge-ds/tokens', '@bridge-ds/react'];

/**
 * The release notes the Library home shows: entries that change the tokens or the components. Internal entries (no
 * package) and entries that only touch the tooling or the site (an internal API, a Studio board) are left out.
 */
export function libraryNotes<T extends { kind: string; packages: readonly string[] }>(entries: readonly T[], packages: readonly string[] = LIBRARY_PACKAGES): T[] {
  return entries.filter((e) => e.kind !== 'Internal' && e.packages.some((p) => packages.includes(p)));
}
