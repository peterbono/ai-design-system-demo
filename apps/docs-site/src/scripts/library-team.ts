// A team's Library shell in the browser (multi-team PR 4a, lib/library-shells.ts). The layout renders its links at
// build time, when the team is unknown: the nav says /library-shell/<route>, Open Studio says /studio/. This points
// each at the team in the address before anyone can click, names the team, and decides indexing.
//
// Indexing: a team page shows content Bridge does not control under the Bridge domain, so it is noindex unless the
// team's bridge.config.json says "library": { "public": true } (and the repository is public). The robots tag is
// added here first thing, then removed once the team's config opts in. The server lock comes first: vercel.json answers
// X-Robots-Tag: noindex on every team Library not in hosted/public-libraries.json (lib/library-shells.ts).
import { libraryIsPublic } from '@bridge-ds/core';
import { LIBRARY_SHELL_ROOT, libraryFromPath, libraryHref } from '../lib/library-shells';
import { RESERVED_PATHS_URL, STUDIO_ROOT, teamHref, type ReservedPaths } from '../lib/team-path';
import { llmsTxtUrl } from '../lib/library/published';
import { teamDisplayName } from '../lib/demo';
import { loadTeamData, loadTeamLlms, whenLibraryOpen } from './team-data';
import { libraryFileUrl } from './library-access-api';
import { refreshSpaceSwitch } from './space-switch';

const ROBOTS = 'meta[name="robots"][data-library-robots]';

/** Adds <meta name="robots" content="noindex"> (idempotent). */
export function markNoindex(doc: Document = document) {
  if (doc.head.querySelector(ROBOTS)) return;
  const meta = doc.createElement('meta');
  meta.name = 'robots';
  meta.content = 'noindex';
  meta.setAttribute('data-library-robots', '');
  doc.head.prepend(meta);
}

/** Removes the noindex tag when the team opted in and its repository is public; keeps it otherwise. */
export function applyIndexing(opts: { public: boolean; private: boolean }, doc: Document = document) {
  if (opts.public && !opts.private) doc.head.querySelector(ROBOTS)?.remove();
  else markNoindex(doc);
}

/** Points the build-time links of a Library shell at the team: the nav, the brand, and the team's Studio. */
export function pointLibraryLinks(team: { owner: string; repo: string }, reserved: ReservedPaths | null, root: ParentNode = document) {
  for (const a of root.querySelectorAll<HTMLAnchorElement>(`a[href^="${LIBRARY_SHELL_ROOT}"]`)) {
    const href = a.getAttribute('href')!;
    a.setAttribute('href', libraryHref(team.owner, team.repo, href.slice(LIBRARY_SHELL_ROOT.length)));
  }
  const studio = teamHref(team.owner, team.repo, reserved);
  for (const a of root.querySelectorAll<HTMLAnchorElement>(`a[href="${STUDIO_ROOT}"]:not([data-space-switch]), a[data-team-studio]`)) {
    a.setAttribute('href', studio);
    a.setAttribute('data-team-studio', '');
  }
  // The header switch carries the page's item across (scripts/space-switch.ts): it gets the team's Studio as its root.
  for (const a of root.querySelectorAll<HTMLAnchorElement>('a[data-space-switch]')) a.setAttribute('data-studio-root', studio);
  refreshSpaceSwitch(root);
  const github = `https://github.com/${encodeURIComponent(team.owner)}/${encodeURIComponent(team.repo)}`;
  for (const a of root.querySelectorAll<HTMLAnchorElement>('a[data-team-github]')) a.href = github;
  for (const el of root.querySelectorAll<HTMLElement>('[data-team-name]')) el.textContent = `${team.owner}/${team.repo}`;
  paintTeamName(team, null, root);
}

/** The name the team goes by (lib/demo.ts teamDisplayName) in the account menu and the tab title, never owner/repo. */
export function paintTeamName(team: { owner: string; repo: string }, site: { name?: string } | null, root: ParentNode = document) {
  const shown = teamDisplayName(`${team.owner}/${team.repo}`, site);
  for (const el of root.querySelectorAll<HTMLElement>('[data-team-display]')) el.textContent = shown;
  if (typeof document !== 'undefined' && root === document) document.title = document.title.replace(/\| [^|]+$/, `| ${shown}`);
}

/** The team's llms.txt as the page's alternate (agents find it from any Library page), once it is known to exist. */
function linkLlms(href: string) {
  if (document.head.querySelector('link[rel="alternate"][data-library-llms]')) return;
  const link = document.createElement('link');
  link.rel = 'alternate';
  link.type = 'text/plain';
  link.title = 'llms.txt';
  link.href = href;
  link.setAttribute('data-library-llms', '');
  document.head.append(link);
}

export function initLibraryTeam() {
  markNoindex();
  const team = libraryFromPath(location.pathname);
  if (!team) return;
  pointLibraryLinks(team, null);
  // The reserved list is a static file of this site (no GitHub call): with it, Open Studio uses the plain address.
  fetch(RESERVED_PATHS_URL)
    .then((r) => (r.ok ? (r.json() as Promise<ReservedPaths>) : null))
    .then((reserved) => reserved && pointLibraryLinks(team, reserved))
    .catch(() => {});
  // Nothing is read before the Library gate lets the visitor in (Settings, Library access): a gated page stays noindex.
  whenLibraryOpen()
    .then(() => loadTeamData())
    .then(async (data) => {
      paintTeamName(team, data.model.site);
      applyIndexing({ public: libraryIsPublic(data.model.config) && !data.servedBy, private: data.private });
      if (await loadTeamLlms()) linkLlms(data.servedBy ? libraryFileUrl(`${data.owner}/${data.repo}`, 'llms') : llmsTxtUrl(data.owner, data.repo, data.private));
    })
    .catch(() => markNoindex());
}
