// What every Library view (components/ds/library/views/) reads: a repo model, the team it belongs to and the extras
// only some sources carry. Bridge's own Library passes its build-time model with `team: null` (pages/*.astro, rendered
// statically); a team's Library shell passes the model it read in the browser (LibraryTeamPage.tsx). The views are
// pure functions of this data, so both render the same sections. Browser-safe: no Node API.
import type { RepoModel } from '@bridge-ds/core';
import type { TeamData } from '../../../scripts/team-data';
import { libraryHref } from '../../../lib/library-shells';
import { studioHref, studioHrefAt, teamHref } from '../../../lib/team-path';
import { teamDisplayName } from '../../../lib/demo';

export interface LibraryTeam {
  owner: string;
  repo: string;
}

/** One release note line of the Library home ("What changed"), already worded. */
export interface LibraryChange {
  kind: string;
  /** The headline, as plain text. */
  headline: string;
  /** The full title as plain text, for the hover title. */
  title: string;
  /** "Oct 20", or "Next release". */
  date: string;
}

/** What only some sources know. Every field is optional: a view leaves out what it is not given. */
export interface LibraryExtras {
  /** The released version the Library shows ("1.6.0"). */
  version?: string;
  /** Usage note of a token group ("color.bg"), from the site's content (token-usage.json). */
  groupNotes?: Record<string, string>;
  /** Library home: the latest changes, newest first, and whether they are all from this week. */
  changes?: { recent: LibraryChange[]; thisWeek: boolean };
  /** Accessibility page: pairs evaluated on top of the gated ones (the dev failing fixture). */
  extraPairs?: { fg: string; bg: string; min: number; usage: 'text' | 'ui' }[];
  /** Signed in on a team's Library: show its "Edit in Studio" door (Bridge's own Library uses data-maintainer). */
  canEdit?: boolean;
}

export interface LibraryData {
  model: RepoModel;
  /** The team whose Library this is; null for the site's own Library (Bridge). */
  team: LibraryTeam | null;
  extras: LibraryExtras;
}

/** The address of a Library page (route relative to the Library root: 'foundations/color/', 'tokens/?q=x', ''). */
export function pageHref(data: Pick<LibraryData, 'team'>, route: string): string {
  const r = route.replace(/^\/+/, '');
  return data.team ? libraryHref(data.team.owner, data.team.repo, r) : `/${r}`;
}

/**
 * A link the Library libs build for the site's own Library ('/components/button/', '/foundations/color/#id',
 * '/tokens/?q=x'), pointed at the team's Library on a team page. Other links are returned as they are.
 */
export function libraryLink(data: Pick<LibraryData, 'team'>, href: string): string {
  if (!data.team || !href.startsWith('/') || href.startsWith('//')) return href;
  const comp = /^\/components\/([a-z0-9][a-z0-9-]*)\/(#.*)?$/i.exec(href);
  if (comp) return pageHref(data, `components/?c=${encodeURIComponent(comp[1]!.toLowerCase())}${comp[2] ?? ''}`);
  if (/^\/(foundations\/[a-z-]+\/|tokens\/|components\/)/.test(href) || href === '/') return pageHref(data, href);
  return href;
}

/** Where a page is edited: the team's Studio on a team page, else this site's (studioHref). */
export function studioLink(data: Pick<LibraryData, 'team'>, route: string): string {
  return data.team ? studioHrefAt(teamHref(data.team.owner, data.team.repo, null), route) : studioHref(route);
}

/** The name the design system goes by: Bridge for the site's own Library, else the team's (lib/demo.ts). */
export function systemName(data: Pick<LibraryData, 'team' | 'model'>): string {
  return data.team ? teamDisplayName(`${data.team.owner}/${data.team.repo}`, data.model.site) : 'Bridge';
}

/** What a team's Library view reads: its model and team, and whether the reader may open its Studio to edit. */
export const teamLibraryData = (data: Pick<TeamData, 'model' | 'owner' | 'repo' | 'client'>): LibraryData => ({
  model: data.model,
  team: { owner: data.owner, repo: data.repo },
  extras: { canEdit: data.client.canWrite },
});
