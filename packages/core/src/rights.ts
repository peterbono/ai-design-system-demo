// Roles and their rights: which owner group may approve the design side, approve the tech side and ship (merge a
// pull request, which publishes the change to the products). `governance.rights` in bridge.config.json; each team
// edits it in Studio Settings. Pure functions, shared by Studio Reviews, Settings, the CLI and the MCP server.
//
// Backward compatible: a config without `rights` behaves as before it existed. Approvals follow the owner lists,
// and anyone with write access to the repo may ship. DEFAULT_RIGHTS is what Settings proposes and what new
// configs get: design owners approve design, tech owners approve tech, tech owners ship.

import type { Owners } from './config';

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

/** The logins holding a right: the union of the owner lists of its groups. Empty when those lists are empty. */
export function holdersOf(right: Right, owners: Owners, rights: Rights | null | undefined): string[] {
  const groups = (rights ?? DEFAULT_RIGHTS)[right];
  return uniq(groups.flatMap((g) => owners[g] ?? []));
}

/**
 * Owner lists to count approvals against (summarizeApprovals): who may approve design, who may approve tech.
 * Without `rights`, the owner lists as they are.
 */
export function approverLists(owners: Owners, rights: Rights | null | undefined): Owners {
  if (!rights) return { design: [...owners.design], tech: [...owners.tech] };
  return { design: holdersOf('approveDesign', owners, rights), tech: holdersOf('approveTech', owners, rights) };
}

/** Who may ship, or null when nobody is singled out (no `rights`, or its groups list no logins): anyone with write access. */
export interface ShipPolicy {
  /** Logins allowed to ship. */
  logins: string[];
  /** Owner groups holding the right, for the sentence ("the tech owner", "a design or tech owner"). */
  groups: OwnerGroup[];
}

export function shipPolicy(owners: Owners, rights: Rights | null | undefined): ShipPolicy | null {
  if (!rights) return null;
  const logins = holdersOf('ship', owners, rights);
  return logins.length ? { logins, groups: [...rights.ship] } : null;
}

/** Whether `login` may ship. No policy: yes (GitHub write access still decides). */
export function canShip(login: string | null | undefined, policy: ShipPolicy | null | undefined): boolean {
  if (!policy) return true;
  if (!login) return false;
  return policy.logins.map(norm).includes(norm(login));
}

/** "the tech owner", "the design owner", "a design or tech owner". */
export function groupsPhrase(groups: readonly OwnerGroup[]): string {
  const g = OWNER_GROUPS.filter((x) => groups.includes(x));
  if (g.length === 1) return `the ${g[0]} owner`;
  return `a ${g.join(' or ')} owner`;
}

/** The sentence a blocked viewer reads: "Only the tech owner can ship this." */
export function whoCanShipSentence(policy: ShipPolicy): string {
  const names = policy.logins.map((l) => `@${l.replace(/^@/, '')}`).join(', ');
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
