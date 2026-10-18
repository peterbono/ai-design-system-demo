// Studio Settings > Roles: the pure rules behind the Roles section. Who holds each right (approve design, approve
// tech, ship), the one summary sentence, and the format-preserving edit of bridge.config.json the Settings form
// proposes as a pull request (same approach as withIntegrations in requests-view.ts). No DOM, no fetch.
// Owners are people or GitHub teams ("@acme/design"): the picker helpers below build the options and read what
// someone types.
import { DEFAULT_RIGHTS, formatOwnerEntry, fromPlain, getEntry, holdersOf, parseJson, parseOwnerEntry, plainEqual, RIGHT_LABEL, RIGHTS, serializeJson, teamKeyOf, toPlain, type JsonObject, type OwnerGroup, type Owners, type Right, type Rights, type TeamUnreadableReason, type VisualImpactMode } from '@bridge-ds/core';
import { ghAction } from './gh-wording';

/** One choice per right in the form: design owners, tech owners, or both. */
export type RightChoice = 'design' | 'tech' | 'both';

export const CHOICE_LABEL: Record<RightChoice, string> = { design: 'Design owners', tech: 'Tech owners', both: 'Both' };

export const choiceOf = (groups: readonly OwnerGroup[]): RightChoice => (groups.includes('design') && groups.includes('tech') ? 'both' : groups.includes('design') ? 'design' : 'tech');

export const groupsOf = (c: RightChoice): OwnerGroup[] => (c === 'both' ? ['design', 'tech'] : [c]);

/** What each right means, in plain words. "Ship" publishes the change to the products. */
export const RIGHT_HELP: Record<Right, string> = {
  approveDesign: 'Says the change looks right.',
  approveTech: 'Says the code is sound.',
  ship: 'Publishes the change to the products.',
};

export interface RoleRow {
  right: Right;
  label: string;
  help: string;
  /** "Design owners", "Tech owners", "Design and tech owners", or for an unset ship right "Anyone with write access". */
  who: string;
  /** Logins holding the right; empty when nobody is listed. */
  logins: string[];
  /** Choice selected in the form. null for a ship right the team has not set: no segment matches "anyone with write access". */
  choice: RightChoice | null;
}

const WHO: Record<RightChoice, string> = { design: 'Design owners', tech: 'Tech owners', both: 'Design and tech owners' };

/** The three rows of the Roles section, from the owner lists and `governance.rights` (null: not set yet). */
export function roleRows(owners: Owners, rights: Rights | null): RoleRow[] {
  const effective = rights ?? DEFAULT_RIGHTS;
  return RIGHTS.map((right) => {
    const choice = choiceOf(effective[right]);
    // Without rights, shipping is not limited to an owner group: anyone with write access may ship.
    const unsetShip = !rights && right === 'ship';
    return {
      right,
      label: RIGHT_LABEL[right],
      help: RIGHT_HELP[right],
      who: unsetShip ? 'Anyone with write access' : WHO[choice],
      logins: unsetShip ? [] : holdersOf(right, owners, effective),
      choice: unsetShip ? null : choice,
    };
  });
}

/** One sentence that says the whole rule, first thing in the section. */
export function rolesSummary(owners: Owners, rights: Rights | null): string {
  const [d, t, s] = roleRows(owners, rights);
  const lower = (x: string) => x.charAt(0).toLowerCase() + x.slice(1);
  const ship = s!.who === 'Anyone with write access' ? 'anyone with write access ships' : `${lower(s!.who)} ship`;
  return `${d!.who} approve design, ${lower(t!.who)} approve tech, ${ship}.`;
}

export const VISUAL_MODE_LABEL: Record<VisualImpactMode, string> = { auto: 'Automatic', 'on-demand': 'On demand' };

export const VISUAL_MODE_HELP: Record<VisualImpactMode, string> = {
  auto: 'Runs on every change to tokens or components.',
  'on-demand': 'Runs when someone asks from the change. Saves GitHub minutes on private repositories.',
};

// ---------------------------------------------------------------------------------------------------------------
// Owners: people and teams

export const OWNER_GROUP_LABEL: Record<OwnerGroup, string> = { design: 'Design owners', tech: 'Tech owners' };

export const OWNER_GROUP_HELP: Record<OwnerGroup, string> = {
  design: 'People or GitHub teams who answer for how it looks.',
  tech: 'People or GitHub teams who answer for the code.',
};

/** Same entry, whatever its case or leading @. */
export const sameEntry = (a: string, b: string): boolean => a.trim().toLowerCase().replace(/^@/, '') === b.trim().toLowerCase().replace(/^@/, '');

/** What someone typed in the picker, as an entry to save ("dana", "@acme/design"), or why it is not one. */
export function ownerFromInput(text: string): { entry: string } | { error: string } | null {
  const t = text.trim();
  if (!t) return null;
  const e = parseOwnerEntry(t);
  if (!e) return { error: `"${t}" is not a GitHub login or team. Type a person as @login, a team as @org/team.` };
  return { entry: formatOwnerEntry(e) };
}

export interface OwnerOption {
  value: string;
  label: string;
  description?: string;
  group?: string;
}

/**
 * Picker options: the org's teams (when GitHub lists them), the repository's people, and what is typed when it
 * reads as a person or team not in the list. Entries already chosen stay in the list (the picker marks them).
 */
export function ownerOptions(input: { teams?: { slug: string; name: string }[]; people?: string[]; org: string; query: string }): OwnerOption[] {
  const teams: OwnerOption[] = (input.teams ?? []).map((t) => ({ value: `@${input.org}/${t.slug}`, label: `@${input.org}/${t.slug}`, description: t.name, group: 'Teams' }));
  const people: OwnerOption[] = (input.people ?? []).map((l) => ({ value: l, label: `@${l}`, group: 'People' }));
  const out = [...teams, ...people];
  const typed = ownerFromInput(input.query);
  if (typed && 'entry' in typed && !out.some((o) => sameEntry(o.value, typed.entry))) {
    const team = Boolean(teamKeyOf(typed.entry));
    out.unshift({ value: typed.entry, label: team ? typed.entry : `@${typed.entry}`, description: team ? 'Add this team' : 'Add this person', group: 'Add' });
  }
  // Without groups to show, no group headings.
  return out.some((o) => o.group !== out[0]?.group) ? out : out.map(({ group: _g, ...o }) => o);
}

/** The sentence under the picker when the org's teams cannot be suggested, with what to do. Null: teams are listed. */
export function teamsPickerHint(reason: TeamUnreadableReason | null, org: string, signIn = false): string | null {
  switch (reason) {
    case null:
      return null;
    case 'personal-account':
      return `Teams are not available: ${org} is a personal GitHub account. Add people here, or move the repository to an organization to use teams.`;
    case 'no-token':
      return `${ghAction('pick a team', signIn)}. You can still type @org/team.`;
    case 'missing-permission':
    case 'not-found':
      return `Your GitHub token cannot list the ${org} teams. Give it read:org (classic) or Members: Read (fine-grained) to pick one, or type @${org}/team.`;
    case 'unreachable':
      return 'GitHub did not answer, so teams cannot be suggested right now. You can still type @org/team.';
  }
}

/** Owner lists equal, ignoring case and a leading @. */
export function sameOwners(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((x, i) => sameEntry(x, b[i]!));
}

/**
 * bridge.config.json with `governance.rights`, `visualImpact.mode` and, when given, `governance.owners` set,
 * everything else byte for byte. A new `rights` copies the one-line layout of `owners`. `visualImpact` is only
 * written when it differs from what the file says (absent means auto), so an unchanged mode adds no line; owners
 * likewise.
 */
export function withRoles(configText: string, next: { rights: Rights; visualMode: VisualImpactMode; owners?: Owners }): string {
  const doc = parseJson(configText);
  if (doc.root.kind !== 'object') throw new Error('bridge.config.json is not a JSON object.');
  const root = doc.root as JsonObject;
  let govEntry = getEntry(root, 'governance');
  if (!govEntry) {
    govEntry = { key: 'governance', value: { kind: 'object', inline: false, entries: [] } };
    root.entries.push(govEntry);
    root.raw = undefined;
  }
  if (govEntry.value.kind !== 'object') throw new Error('"governance" in bridge.config.json is not an object.');
  const gov = govEntry.value as JsonObject;
  if (next.owners) {
    const ownersEntry = getEntry(gov, 'owners');
    const current = ownersEntry ? (toPlain(ownersEntry.value) as Partial<Owners>) : {};
    const plain = { design: next.owners.design, tech: next.owners.tech };
    if (!sameOwners(current.design ?? [], plain.design) || !sameOwners(current.tech ?? [], plain.tech)) {
      const node = fromPlain(plain, ownersEntry?.value, true);
      if (ownersEntry) ownersEntry.value = node;
      else gov.entries.push({ key: 'owners', value: node });
      gov.raw = undefined;
      root.raw = undefined;
    }
  }
  const rightsPlain = { approveDesign: next.rights.approveDesign, approveTech: next.rights.approveTech, ship: next.rights.ship };
  const existing = getEntry(gov, 'rights');
  if (!existing || !plainEqual(toPlain(existing.value), rightsPlain)) {
    const node = fromPlain(rightsPlain, existing?.value ?? getEntry(gov, 'owners')?.value, true);
    if (existing) existing.value = node;
    else gov.entries.push({ key: 'rights', value: node });
    gov.raw = undefined;
    root.raw = undefined;
  }
  const vi = getEntry(root, 'visualImpact');
  const currentMode = vi?.value.kind === 'object' ? (toPlain(vi.value) as { mode?: string }).mode ?? 'auto' : 'auto';
  if (currentMode !== next.visualMode) {
    const node = fromPlain({ mode: next.visualMode }, vi?.value, true);
    if (vi) vi.value = node;
    else root.entries.push({ key: 'visualImpact', value: node });
    root.raw = undefined;
  }
  return serializeJson(doc);
}

export interface RolesProposal {
  branch: string;
  title: string;
  body: string;
  message: string;
}

/** Branch, title, body and commit message of the pull request that edits the roles and the visual mode. */
export function rolesProposal(
  rows: { label: string; who: string }[],
  mode: VisualImpactMode,
  opts: { date: Date; prefix?: string; tierLabel: string; owners?: Owners },
): RolesProposal {
  const stamp = opts.date.toISOString().slice(0, 10).replace(/-/g, '');
  const title = 'chore(config): set who approves and ships, and when visual checks run';
  const names = (xs: string[]) => (xs.length ? xs.map((x) => (teamKeyOf(x) ? `${x} (team)` : `@${x.replace(/^@/, '')}`)).join(', ') : 'nobody listed');
  const body = [
    '## Roles',
    '',
    `Edits ${opts.owners ? '`governance.owners`, ' : ''}\`governance.rights\` and \`visualImpact\` in \`bridge.config.json\`.`,
    '',
    ...(opts.owners ? [`- Design owners: ${names(opts.owners.design)}.`, `- Tech owners: ${names(opts.owners.tech)}.`] : []),
    ...rows.map((r) => `- ${r.label}: ${r.who}.`),
    `- Visual before and after: ${VISUAL_MODE_LABEL[mode]}. ${VISUAL_MODE_HELP[mode]}`,
    '',
    `**Risk:** ${opts.tierLabel}. Configuration only: no token, component or package changes.`,
    '',
    '---',
    'Proposed from Bridge Studio Settings.',
  ].join('\n');
  return { branch: `${opts.prefix ?? ''}roles-${stamp}`, title, body, message: `${title}\n\nProposed from Bridge Studio Settings.` };
}
