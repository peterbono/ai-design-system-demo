// Roles by team in the Studio: governance.owners may name GitHub teams ("@acme/design"). This module reads them once
// per page with the viewer's token (core TeamDirectory: cached, typed "cannot read" states) and hands the states to
// every place that evaluates a role: approvals, who acts, the ship gate, Settings. With only people in the config
// (the demo repo), nothing is read and every answer is immediate.
import { approverEntries, approverLists, shipPolicy, soloOwnerOf, TeamDirectory, teamsIn, type ApprovalRules, type Owners, type Rights, type ShipPolicy, type TeamStates } from '@bridge-ds/core';
import { readRepo, studioClient } from './github-session';

interface SiteRoles {
  owners: Owners;
  rights: Rights | null;
  soloOwnerCanApproveBoth: boolean;
}

/** governance.owners and governance.rights as the layout embeds them (#bridge-repo). */
export function siteRoles(): SiteRoles {
  try {
    const site = JSON.parse(document.getElementById('bridge-repo')?.textContent || '{}') as { owners?: Owners; rights?: Rights | null; soloOwnerCanApproveBoth?: boolean };
    return { owners: site.owners ?? { design: [], tech: [] }, rights: site.rights ?? null, soloOwnerCanApproveBoth: site.soloOwnerCanApproveBoth === true };
  } catch {
    return { owners: { design: [], tech: [] }, rights: null, soloOwnerCanApproveBoth: false };
  }
}

let directory: TeamDirectory | null = null;
let states: TeamStates | null = null;
let pending: Promise<TeamStates> | null = null;

/** The one directory of the page, rebuilt when the viewer connects or disconnects (the token decides what it may read). */
export function teamDirectory(): TeamDirectory {
  if (!directory) {
    const r = readRepo();
    directory = new TeamDirectory(studioClient(`${r.owner}/${r.repo}`));
  }
  return directory;
}

if (typeof document !== 'undefined')
  document.addEventListener('bridge:auth', () => {
    directory = null;
    states = null;
    pending = null;
  });

/** Whether the config names a team at all. False: nothing to read. */
export const hasTeams = (): boolean => teamsIn(siteRoles().owners).length > 0;

/**
 * The teams of governance.owners, read once per page (and again after the viewer connects). Resolves at once with
 * no team in the config. Never rejects: a team that cannot be read is a state with its reason.
 */
export function loadTeams(): Promise<TeamStates> {
  if (states) return Promise.resolve(states);
  if (!hasTeams()) return Promise.resolve((states = {}));
  pending ??= teamDirectory()
    .resolve(siteRoles().owners)
    .then((s) => (states = s))
    .catch(() => (states = {}));
  return pending;
}

/** The team states read so far: undefined before loadTeams resolves (teams then hold their place, matching nobody). */
export const teamSnapshot = (): TeamStates | undefined => states ?? (hasTeams() ? undefined : {});

/** Who counts as the design and the tech approver, teams expanded once read. */
export function siteApprovers(): Owners {
  const { owners, rights } = siteRoles();
  return approverLists(owners, rights, teamSnapshot() ?? null);
}

/** governance.soloOwnerCanApproveBoth, for summarizeApprovals: the only owner's approval covers design and tech. */
export const siteApprovalRules = (): ApprovalRules => ({ soloOwnerCanApproveBoth: siteRoles().soloOwnerCanApproveBoth });

/** The only owner whose approval covers design and tech (core soloOwnerOf), or null when the rule is off or does not apply. */
export function siteSoloOwner(): string | null {
  return soloOwnerOf(siteRoles(), teamSnapshot() ?? null);
}

/** The approver entries as the config names them (people and teams), for sentences. */
export function siteApproverEntries(): Owners {
  const { owners, rights } = siteRoles();
  return approverEntries(owners, rights);
}

/** Who may ship, teams expanded once read. Null: anyone with write access. */
export function siteShipPolicy(): ShipPolicy | null {
  const { owners, rights } = siteRoles();
  return shipPolicy(owners, rights, teamSnapshot() ?? null);
}
