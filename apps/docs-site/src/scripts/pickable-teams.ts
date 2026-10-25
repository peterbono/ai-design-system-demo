// The teams this person can pick on this browser (lib/pickable-teams.ts): the site's own design system when their GitHub
// sign-in can push to it, the teams this browser opened with a role, and their Bridge account's teams. Used by the two
// pickers that hand a team to another app (Connect Figma, Use Bridge in Claude), the same list as the team switcher.
import type { Account } from '../lib/account';
import { ownLibrary } from '../lib/library-shells';
import { pickableTeams, type PickableTeam } from '../lib/pickable-teams';
import { knownTeamName, loadRecentTeams, loadTeamNames, loadTeamRoles } from '../lib/recent-teams';

/** The role this GitHub sign-in has on a repository: "Admin", "Can edit", or null (cannot push, or GitHub did not say). */
export async function githubRole(token: string, repo: string, f: typeof fetch = fetch): Promise<string | null> {
  try {
    const res = await f(`https://api.github.com/repos/${repo}`, { headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}` } });
    if (!res.ok) return null;
    const p = ((await res.json()) as { permissions?: { admin?: boolean; push?: boolean } }).permissions;
    return p?.admin ? 'Admin' : p?.push ? 'Can edit' : null;
  } catch {
    return null;
  }
}

export async function loadPickableTeams(account: Pick<Account, 'teams'> | null, githubToken: string | null): Promise<PickableTeam[]> {
  const own = ownLibrary();
  const siteRepo = own ? `${own.owner}/${own.repo}` : null;
  // The name the switcher shows for it: kept by this browser, else the site's own settings (bridge.config.json `name`).
  const siteName = siteRepo ? (knownTeamName(siteRepo) ?? (await import('./repo-context').then((m) => (typeof m.siteConfig().name === 'string' ? m.siteConfig().name! : null)).catch(() => null))) : null;
  const site = siteRepo && githubToken ? { repo: siteRepo, role: await githubRole(githubToken, siteRepo), name: siteName } : null;
  return pickableTeams({ account: account?.teams ?? [], recent: loadRecentTeams(), roles: loadTeamRoles(), names: loadTeamNames(), site, needsRepository: true });
}
