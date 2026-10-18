// Roles and their rights: which owner group may approve the design side, approve the tech side and ship (merge a
// pull request, which publishes the change to the products). `governance.rights` in bridge.config.json; each team
// edits it in Studio Settings. Pure functions, shared by Studio Reviews, Settings, the CLI and the MCP server.
//
// Backward compatible: a config without `rights` behaves as before it existed. Approvals follow the owner lists,
// and anyone with write access to the repo may ship. DEFAULT_RIGHTS is what Settings proposes and what new
// configs get: design owners approve design, tech owners approve tech, tech owners ship.
//
// Owner entries may be GitHub teams ("@acme/design", teams.ts). Pass the team states (TeamDirectory.resolve) to the
// functions below and teams count as their members; without them, or for a team that cannot be read, the team keeps
// its "@org/slug" place in the lists so they never turn empty, and no login matches it.

import type { Owners } from './config';
import { entryLabel, expandEntries, expandOwners, unreadableTeams, type TeamState, type TeamStates } from './teams';

/** An owner group from `governance.owners`. */
export type OwnerGroup = 'design' | 'tech';

export const OWNER_GROUPS: readonly OwnerGroup[] = ['design', 'tech'];

/** The three rights, each held by one or more owner groups. */
export interface Rights {
  approveDesign: OwnerGroup[];
  approveTech: OwnerGroup[];
  ship: OwnerGroup[];
}

export type Right = keyof Rights;

export const RIGHTS: readonly Right[] = ['approveDesign', 'approveTech', 'ship'];

/** Plain names of each right, for Settings and the gate messages. "Ship" means publish to the products. */
export const RIGHT_LABEL: Record<Right, string> = {
  approveDesign: 'Approve design',
  approveTech: 'Approve tech',
  ship: 'Ship',
};

export const DEFAULT_RIGHTS: Rights = { approveDesign: ['design'], approveTech: ['tech'], ship: ['tech'] };

const norm = (x: string) => x.trim().toLowerCase().replace(/^@/, '');
const uniq = <T>(xs: T[]) => [...new Set(xs)];

/** Rights with every missing entry filled from DEFAULT_RIGHTS, groups deduplicated in design, tech order. */
export function normalizeRights(input: Partial<Record<Right, readonly string[]>> | null | undefined): Rights {
  const pick = (r: Right): OwnerGroup[] => {
    const v = input?.[r];
    if (!Array.isArray(v)) return [...DEFAULT_RIGHTS[r]];
    return OWNER_GROUPS.filter((g) => v.includes(g));
  };
  return { approveDesign: pick('approveDesign'), approveTech: pick('approveTech'), ship: pick('ship') };
}

/** Problems in a raw `governance.rights` value, in the words loadConfig reports. Empty: valid. */
export function rightsProblems(raw: unknown): string[] {
  if (raw === undefined) return [];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return ['"governance.rights" must be { "approveDesign": [groups], "approveTech": [groups], "ship": [groups] }'];
  const out: string[] = [];
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!(RIGHTS as readonly string[]).includes(k)) out.push(`"governance.rights.${k}" is not a right (${RIGHTS.join(', ')})`);
    else if (!Array.isArray(v) || v.length === 0 || !v.every((g) => (OWNER_GROUPS as readonly unknown[]).includes(g)))
      out.push(`"governance.rights.${k}" must list one or more of "design", "tech"`);
  }
  return out;
}

/** The entries (people and teams) holding a right: the union of the owner lists of its groups. Empty when those lists are empty. */
export function holdersOf(right: Right, owners: Owners, rights: Rights | null | undefined): string[] {
  const groups = (rights ?? DEFAULT_RIGHTS)[right];
  return uniq(groups.flatMap((g) => owners[g] ?? []));
}

/**
 * Owner lists to count approvals against (summarizeApprovals): who may approve design, who may approve tech.
 * Without `rights`, the owner lists as they are.
 */
export function approverLists(owners: Owners, rights: Rights | null | undefined, teams?: TeamStates | null): Owners {
  const entries = approverEntries(owners, rights);
  return teams === undefined ? entries : expandOwners(entries, teams);
}

/** approverLists before team expansion: the entries as the config names them, for sentences. */
export function approverEntries(owners: Owners, rights: Rights | null | undefined): Owners {
  if (!rights) return { design: [...owners.design], tech: [...owners.tech] };
  return { design: holdersOf('approveDesign', owners, rights), tech: holdersOf('approveTech', owners, rights) };
}

/** Who may ship, or null when nobody is singled out (no `rights`, or its groups list no logins): anyone with write access. */
export interface ShipPolicy {
  /** Logins allowed to ship: people, and team members once read. A team not read keeps its "@org/slug" key. */
  logins: string[];
  /** Owner groups holding the right, for the sentence ("the tech owner", "a design or tech owner"). */
  groups: OwnerGroup[];
  /** The entries as the config names them (people and teams), for the sentence. Absent: `logins`. */
  entries?: string[];
  /** Team states known when the policy was built, for the sentence ("@acme/design (4 people)"). */
  teams?: TeamStates;
}

/**
 * Who may ship. With `teams` (TeamDirectory.resolve), team members count; a team that cannot be read still holds
 * the right, so the policy is never dropped to "anyone with write access" because a team was not read.
 */
export function shipPolicy(owners: Owners, rights: Rights | null | undefined, teams?: TeamStates | null): ShipPolicy | null {
  if (!rights) return null;
  const entries = holdersOf('ship', owners, rights);
  if (!entries.length) return null;
  const logins = expandEntries(entries, teams);
  return { logins, groups: [...rights.ship], entries, ...(teams ? { teams } : {}) };
}

/** Teams in a ship policy that could not be read: the gate names them with the fix. */
export function unreadableShipTeams(policy: ShipPolicy | null | undefined): TeamState[] {
  if (!policy?.teams) return [];
  const keys = new Set((policy.entries ?? []).map((e) => e.trim().toLowerCase().replace(/^@?/, '@')));
  return unreadableTeams(policy.teams).filter((t) => keys.has(t.key));
}

/** Whether `login` may ship. No policy: yes (GitHub write access still decides). */
export function canShip(login: string | null | undefined, policy: ShipPolicy | null | undefined): boolean {
  if (!policy) return true;
  // A login never holds a "/": the "@org/slug" place of a team not read cannot be matched.
  if (!login || login.includes('/')) return false;
  return policy.logins.map(norm).includes(norm(login));
}

/** "the tech owner", "the design owner", "a design or tech owner". */
export function groupsPhrase(groups: readonly OwnerGroup[]): string {
  const g = OWNER_GROUPS.filter((x) => groups.includes(x));
  if (g.length === 1) return `the ${g[0]} owner`;
  return `a ${g.join(' or ')} owner`;
}

/** The sentence a blocked viewer reads: "Only the tech owner can ship this." */
/** Teams are named as teams, with their size when known: "Only the tech owner can ship this (@acme/web (4 people))." */
export function whoCanShipSentence(policy: ShipPolicy): string {
  const names = (policy.entries ?? policy.logins).map((l) => entryLabel(l, policy.teams)).join(', ');
  return `Only ${groupsPhrase(policy.groups)} can ship this${names ? ` (${names})` : ''}.`;
}

/** Visual before and after: on every pull request that touches tokens or components, or only when asked. */
export type VisualImpactMode = 'auto' | 'on-demand';

export interface VisualImpactConfig {
  mode: VisualImpactMode;
}

export const DEFAULT_VISUAL_IMPACT: VisualImpactConfig = { mode: 'auto' };

/** Label that asks the visual impact workflow to run in on-demand mode. */
export const VISUAL_CHECK_LABEL = 'visual-check';

export function visualImpactProblems(raw: unknown): string[] {
  if (raw === undefined) return [];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return ['"visualImpact" must be { "mode": "auto" | "on-demand" }'];
  const out: string[] = [];
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (k !== 'mode') out.push(`"visualImpact.${k}" is not a setting (mode)`);
    else if (v !== 'auto' && v !== 'on-demand') out.push('"visualImpact.mode" must be "auto" or "on-demand"');
  }
  return out;
}
