// The teams a person belongs to, from every source the Studio team switcher reads (TeamChip "Your teams"), in one place:
//   - the site's own design system (bridge.config.json), when their GitHub sign-in can push to its repository;
//   - the teams this browser opened, with the role it noted there (lib/recent-teams);
//   - their Bridge account's teams (GET /api/account).
// The switcher and the two pickers that hand a team to another app ("Connect Figma", /studio/connect-figma/; "Use
// Bridge in Claude", /studio/connect-claude/) use this list, so a team in the switcher is always a team you can pick.
// The pickers then check push on GitHub when the person confirms (the server does it again). Pure: tests read it.

import { isSampleTeam } from './demo';
import { isTeamKey } from './team-path';

export interface PickableTeam {
  /** owner/repo, or the key of a team made in Bridge (`_team/<id>`) when `needsRepository` is false. */
  repo: string;
  /** The name it goes by. */
  name: string;
  /** The role noted for it ("Admin", "Can edit", an account role), when known. */
  role: string | null;
}

export interface TeamSources {
  /** The Bridge account's teams. */
  account: readonly { repo: string; name?: string | null; role?: string | null }[];
  /** The teams this browser opened, most recent first. */
  recent: readonly string[];
  /** Role noted per team (lower case owner/repo). */
  roles: Readonly<Record<string, string>>;
  /** Name noted per team (lower case owner/repo). */
  names: Readonly<Record<string, string>>;
  /** The site's own design system, with the role GitHub gave this person there (null: they cannot push to it). */
  site?: { repo: string; role: string | null; name?: string | null } | null;
  /** Only teams with a repository (a design system to work on): the pickers. The switcher lists every team. */
  needsRepository?: boolean;
}

const lc = (s: string) => s.trim().toLowerCase();
const repoPart = (repo: string) => repo.split('/')[1] ?? repo;

/** The teams in the switcher's order: the site's own, the ones this browser opened, then the account's. No duplicates. */
export function pickableTeams(x: TeamSources): PickableTeam[] {
  const out: PickableTeam[] = [];
  const seen = new Set<string>();
  const accountName = (repo: string) => x.account.find((t) => lc(t.repo) === lc(repo))?.name?.trim();
  const nameOf = (repo: string, given?: string | null) => given?.trim() || accountName(repo) || x.names[lc(repo)]?.trim() || repoPart(repo);
  const add = (repo: string, role: string | null, name?: string | null) => {
    const k = lc(repo);
    if (!repo || seen.has(k) || isSampleTeam(repo)) return;
    if (x.needsRepository && (isTeamKey(repo) || !/^[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9._-]+$/.test(repo))) return;
    seen.add(k);
    out.push({ repo, name: nameOf(repo, name), role });
  };
  if (x.site?.role) add(x.site.repo, x.site.role, x.site.name);
  for (const t of x.recent) {
    const role = x.roles[lc(t)];
    if (role) add(t, role);
  }
  for (const t of x.account) add(t.repo, t.role ?? null, t.name);
  return out;
}
