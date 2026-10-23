// Team shells (multi-team plan 4.1, PR 3a): the layout and the pages render their Studio links at build time, when the
// team is unknown, so they say /studio/<path>. On a team shell this points each of them at the team in the address
// (studioHref), before anyone can click. Links the islands render go through studioHref already and are left alone.
import { isHosted, repoFromPath, STUDIO_ROOT, studioBase, studioHref } from '../lib/team-path';
import { libraryHref } from '../lib/library-shells';
import { teamDisplayName } from '../lib/demo';
import { siteConfig } from './repo-context';
import { knownTeamName } from '../lib/recent-teams';

/** The sign-in callback is one address for every team (lib/github-signin.ts CALLBACK_PATH). */
const SHARED = `${STUDIO_ROOT}auth/`;

/** Points every build-time Studio link under `root` at the team of this page. A no-op outside a team shell. */
export function pointLinksAtTeam(root: ParentNode = document): number {
  if (!isHosted() || typeof location === 'undefined') return 0;
  const base = studioBase(location.pathname, true);
  if (base === STUDIO_ROOT) return 0;
  let n = 0;
  for (const a of root.querySelectorAll<HTMLAnchorElement>(`a[href^="${STUDIO_ROOT}"]`)) {
    const href = a.getAttribute('href')!;
    if (href.startsWith(base) || href.startsWith(SHARED) || a.hasAttribute('data-demo-link')) continue;
    a.setAttribute('href', studioHref(href));
    n++;
  }
  // The header's Library button opens the team's own Library (/library/<owner>/<repo>/), not Bridge's.
  const team = repoFromPath(location.pathname);
  if (team) for (const a of root.querySelectorAll<HTMLAnchorElement>('a.lib-open')) a.setAttribute('href', libraryHref(team.owner, team.repo));
  return n;
}

/**
 * A team shell's header (components/TeamShell.astro) and the account menu: the name the team goes by (lib/demo.ts
 * teamDisplayName, its bridge.config.json `name` once its settings are read, never owner/repo), and its repository
 * where GitHub is meant (the account menu's Repository link), from the address.
 */
export function fillTeamShell(root: ParentNode = document) {
  const team = typeof location === 'undefined' ? null : repoFromPath(location.pathname);
  if (!team) return;
  const name = `${team.owner}/${team.repo}`;
  const paintName = () => {
    // Before its settings are read, the name this browser already knows (server-kept or read before): no flip later.
    const cfg = siteConfig();
    const shown = teamDisplayName(name, Object.keys(cfg).length ? cfg : { name: knownTeamName(name) });
    for (const el of root.querySelectorAll<HTMLElement>('[data-team-display]')) el.textContent = shown;
  };
  paintName();
  document.addEventListener('bridge:team-model', paintName);
  // A name this browser did not know yet (another browser, an older session): the account's answer brings it.
  if (!knownTeamName(name)) void import('./account-session').then(({ getAccount }) => getAccount().then(paintName));
  for (const el of root.querySelectorAll<HTMLElement>('[data-team-name]')) el.textContent = name;
  for (const a of root.querySelectorAll<HTMLAnchorElement>('a[data-team-github]')) a.href = `https://github.com/${encodeURIComponent(team.owner)}/${encodeURIComponent(team.repo)}`;
}
