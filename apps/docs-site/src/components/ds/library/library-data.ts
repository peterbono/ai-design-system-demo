// What every Library view (components/ds/library/views/) reads: a repo model, the team it belongs to and the extras
// only some sources carry. Bridge's own Library passes its build-time model with `team: null` (pages/*.astro, rendered
// statically); a team's Library shell passes the model it read in the browser (LibraryTeamPage.tsx). The views are
// pure functions of this data, so both render the same sections. Browser-safe: no Node API.
import type { ChangelogReleaseRow, MotionDocs, RepoModel } from '@bridge-ds/core';
import type { AgentRule, MdTable, RuleHeading, UsePackage } from '../../../lib/library/use-pages';
import type { VersionMenuProps } from '../VersionMenu';
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
  /** The Storybook the component previews load from (https, no trailing slash); absent: a notice says how to add it. */
  storybook?: string;
  /** Releases, newest first (the snapshot's `releases`): a component page lists the notes that name it. */
  releases?: ChangelogReleaseRow[];
  /** Motion docs per component name (the snapshot's `motion`); absent: read from the model's specs file. */
  motion?: Record<string, MotionDocs>;
  /** Where a repository file opens, with the file path appended ("https://github.com/<o>/<r>/blob/main/"). */
  sourceBase?: string;
  /** What the Use pages show (Install, Agents, How review works, Changelog). */
  use?: UseExtras;
}

/**
 * What the Use pages read. `bridge` holds the facts of the Bridge tools every Library documents the same way (its
 * CLI, MCP server and Figma plugin), from this site's build; the rest is the design system's own.
 */
export interface UseExtras {
  bridge: BridgeTools;
  /** The design system's packages (snapshot `packages`, public ones). Absent: an older snapshot. */
  packages?: UsePackage[];
  /** The Bridge Library's own code samples (React setup, pages without React, install from a clone). */
  samples?: { app: string; html: string; dom: string; clone: string; add: string };
  /** The design system's llms.txt and where it opens; null when it has none. Absent: not read yet. */
  llms?: { text: string; href: string } | null;
  /** Governance read from the design system's own Markdown (docs/GOVERNANCE.md, AGENTS.md); fields it lacks stay out. */
  governance?: {
    tiers?: MdTable | null;
    approvals?: MdTable | null;
    gates?: string[];
    agentPrs?: string[];
    rules?: { heading: RuleHeading; rules: AgentRule[] }[];
  };
  /** The version picker of the Changelog (Bridge's own build: its git branch and versions). */
  versionMenu?: VersionMenuProps;
}

/** The Bridge tools, as this site's build knows them. Inline Markdown where it says so. */
export interface BridgeTools {
  cliPackage: string;
  mcpPackage: string;
  /** MCP tools, `use` in inline Markdown. */
  tools: { name: string; use: string }[];
  prompts: { name: string; text: string }[];
  safety: { title: string; text: string }[];
  /** The DS Bridge Figma plugin: where its guide is, Bridge's repository and its plugin README. */
  pluginUrl: string;
  repoUrl: string;
  pluginReadmeUrl: string;
  /** Bridge's AI guide (docs/AI.md) and where it opens. */
  aiDoc: { label: string; href: string };
  /** Bridge's own risk tiers (docs/GOVERNANCE.md): what Bridge computes for every team. */
  tiers: MdTable | null;
  /** What a reviewer checks on an agent's pull request, from Bridge's governance. */
  agentPrs: string[];
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
  if (comp) return pageHref(data, componentRoute(comp[1]!, comp[2]));
  if (/^\/(foundations\/[a-z-]+\/|tokens\/|components\/|install\/|agents\/|how-review-works\/|changelog\/)/.test(href) || href === '/') return pageHref(data, href);
  return href;
}

/** The Library route of a component page ('components/button/'), with an optional hash ('#tokens'). */
export const componentRoute = (slug: string, hash = ''): string => `components/${encodeURIComponent(slug.toLowerCase())}/${hash}`;

/** A component page of this Library. */
export const componentHref = (data: Pick<LibraryData, 'team'>, slug: string, hash = ''): string => pageHref(data, componentRoute(slug, hash));

/** A repository file of this Library's design system on GitHub, or undefined when the source is unknown. */
export const sourceHref = (data: Pick<LibraryData, 'extras'>, path: string): string | undefined =>
  data.extras.sourceBase ? `${data.extras.sourceBase}${path.split('/').map(encodeURIComponent).join('/')}` : undefined;

/** Where a page is edited: the team's Studio on a team page, else this site's (studioHref). */
export function studioLink(data: Pick<LibraryData, 'team'>, route: string): string {
  return data.team ? studioHrefAt(teamHref(data.team.owner, data.team.repo, null), route) : studioHref(route);
}

/** The name the design system goes by: Bridge for the site's own Library, else the team's (lib/demo.ts). */
export function systemName(data: Pick<LibraryData, 'team' | 'model'>): string {
  return data.team ? teamDisplayName(`${data.team.owner}/${data.team.repo}`, data.model.site) : 'Bridge';
}

/** What a team's Library view reads: its model and team, and whether the reader may open its Studio to edit. */
export const teamLibraryData = (data: Pick<TeamData, 'model' | 'owner' | 'repo' | 'canEdit'>): LibraryData => ({
  model: data.model,
  team: { owner: data.owner, repo: data.repo },
  // A member with an edit right only (scripts/team-data editRight), never any signed-in GitHub account.
  extras: { canEdit: Boolean(data.canEdit) },
});
