// Roles by team: an owner entry in `governance.owners` is a person (`peterbono`, `@peterbono`) or a GitHub team
// (`@acme/design`). Membership is managed in GitHub; Bridge reads it, never stores it. Still no database.
//
// Parsing and the pure helpers below need no network. TeamDirectory expands teams to logins through any client
// with the TeamReader methods (GitHubClient has them), with a cache. A team it cannot read is a typed
// "unreadable" state with the reason and the fix, never an empty list: an empty owner list means "any reviewer
// counts", so silently emptying a team would open the gate. An unreadable team keeps its "@org/slug" key in the
// expanded lists instead: it holds the place, and no login ever matches it (logins have no "/").

import type { Owners } from './config';

export type OwnerEntry = { kind: 'person'; login: string } | { kind: 'team'; org: string; slug: string };

// GitHub logins: letters, digits and single hyphens, no leading or trailing hyphen, 39 characters at most.
const LOGIN = /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/;
// Team slugs: lowercase letters, digits, hyphens, underscores and dots as GitHub generates them; case-insensitive here.
const SLUG = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;

/** A person or a team, or null when `raw` is neither. Accepts a leading @ on both. */
export function parseOwnerEntry(raw: string): OwnerEntry | null {
  if (typeof raw !== 'string') return null;
  const s = raw.trim().replace(/^@/, '');
  const slash = s.indexOf('/');
  if (slash < 0) return LOGIN.test(s) ? { kind: 'person', login: s } : null;
  const org = s.slice(0, slash);
  const slug = s.slice(slash + 1);
  return LOGIN.test(org) && SLUG.test(slug) ? { kind: 'team', org, slug } : null;
}

/** "@acme/design" for a team, "peterbono" for a person: the form Bridge writes back to bridge.config.json. */
export function formatOwnerEntry(e: OwnerEntry): string {
  return e.kind === 'team' ? `@${e.org}/${e.slug}` : e.login;
}

/** Whether a raw entry names a team. */
export const isTeamEntry = (raw: string): boolean => parseOwnerEntry(raw)?.kind === 'team';

/** Case-insensitive key of a team: "@acme/design". */
export const teamKey = (org: string, slug: string): string => `@${org.toLowerCase()}/${slug.toLowerCase()}`;

/** Key of a raw team entry, undefined for a person or a malformed entry. */
export function teamKeyOf(raw: string): string | undefined {
  const e = parseOwnerEntry(raw);
  return e?.kind === 'team' ? teamKey(e.org, e.slug) : undefined;
}

/**
 * Problems in the raw owner lists, in the words loadConfig reports. Each malformed entry is named with the two
 * accepted forms, so the fix is in the message.
 */
export function ownerEntryProblems(raw: unknown): string[] {
  if (raw === undefined) return [];
  const isObj = (x: unknown): x is Record<string, unknown> => Boolean(x) && typeof x === 'object' && !Array.isArray(x);
  if (!isObj(raw)) return ['"governance.owners" must be { "design": [people or teams], "tech": [people or teams] }'];
  const out: string[] = [];
  for (const [k, v] of Object.entries(raw)) {
    if (k !== 'design' && k !== 'tech') {
      out.push(`"governance.owners.${k}" is not an owner group (design, tech)`);
      continue;
    }
    if (!Array.isArray(v)) {
      out.push(`"governance.owners.${k}" must be a list of people or teams`);
      continue;
    }
    v.forEach((x, i) => {
      if (typeof x !== 'string' || !parseOwnerEntry(x))
        out.push(`"governance.owners.${k}[${i}]" (${JSON.stringify(x)}) is not a GitHub login or team. Write a person as "peterbono" or "@peterbono", a team as "@org/team-slug".`);
    });
  }
  return out;
}

/** Why a team's members cannot be read, each with its own fix (teamUnreadableMessage). */
export type TeamUnreadableReason =
  /** The repository owner (or the org named) is a personal account: GitHub teams only exist in organizations. */
  | 'personal-account'
  /** The token works but may not read the organization's teams (classic: read:org; fine-grained: Members, read). */
  | 'missing-permission'
  /** No token, or GitHub refused it: GitHub never shows team members anonymously. */
  | 'no-token'
  /** GitHub says the team does not exist, or hides it from this token. */
  | 'not-found'
  /** GitHub did not answer (network, rate limit, server error). */
  | 'unreachable';

export interface TeamRef {
  /** "@acme/design", lowercase. */
  key: string;
  org: string;
  slug: string;
}

export type TeamState =
  | (TeamRef & { status: 'ok'; members: string[] })
  | (TeamRef & { status: 'unreadable'; reason: TeamUnreadableReason; message: string });

/** Team states by key ("@acme/design"). */
export type TeamStates = Record<string, TeamState>;

/** The one sentence that says why a team cannot be read and how to fix it. */
export function teamUnreadableMessage(team: { org: string; slug: string }, reason: TeamUnreadableReason): string {
  const name = `@${team.org}/${team.slug}`;
  switch (reason) {
    case 'personal-account':
      return `${name} cannot be used: ${team.org} is a personal GitHub account, and teams only exist in organizations. List people instead, or move the repository to an organization.`;
    case 'missing-permission':
      return `The members of ${name} cannot be read: the GitHub token needs read:org (classic token) or Members: Read on the ${team.org} organization (fine-grained token).`;
    case 'no-token':
      return `The members of ${name} cannot be read without a working GitHub token. Connect GitHub with a token that has read:org.`;
    case 'not-found':
      return `${name} was not found. Check the team slug on GitHub, or give the token read:org so it can see the team.`;
    case 'unreachable':
      return `The members of ${name} cannot be read right now: GitHub did not answer. Try again in a moment.`;
  }
}

/** Distinct teams named in the owner lists, in order. */
export function teamsIn(owners: Partial<Owners> | readonly string[]): TeamRef[] {
  const all = Array.isArray(owners) ? (owners as string[]) : [...((owners as Partial<Owners>).design ?? []), ...((owners as Partial<Owners>).tech ?? [])];
  const out = new Map<string, TeamRef>();
  for (const raw of all) {
    const e = parseOwnerEntry(raw);
    if (e?.kind === 'team') out.set(teamKey(e.org, e.slug), { key: teamKey(e.org, e.slug), org: e.org, slug: e.slug });
  }
  return [...out.values()];
}

const norm = (x: string) => x.trim().toLowerCase().replace(/^@/, '');

/**
 * Logins of a list of entries: people as they are, a readable team as its members. An unreadable team, or one not
 * resolved yet, stays as its "@org/slug" key: never empty, never matching a login.
 */
export function expandEntries(entries: readonly string[], teams?: TeamStates | null): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (x: string) => {
    const k = norm(x);
    if (k && !seen.has(k)) {
      seen.add(k);
      out.push(x.replace(/^@(?=[^/]+$)/, ''));
    }
  };
  for (const raw of entries) {
    const e = parseOwnerEntry(raw);
    if (!e) continue;
    if (e.kind === 'person') add(e.login);
    else {
      const state = teams?.[teamKey(e.org, e.slug)];
      if (state?.status === 'ok') state.members.forEach(add);
      else add(teamKey(e.org, e.slug));
    }
  }
  return out;
}

/** Both owner lists expanded (expandEntries). */
export function expandOwners(owners: Owners, teams?: TeamStates | null): Owners {
  return { design: expandEntries(owners.design, teams), tech: expandEntries(owners.tech, teams) };
}

const people = (n: number) => `${n} ${n === 1 ? 'person' : 'people'}`;

/** How an entry reads in a sentence: "@peterbono", "@acme/design (4 people)", "@acme/design" while unknown. */
export function entryLabel(raw: string, teams?: TeamStates | null): string {
  const e = parseOwnerEntry(raw);
  if (!e) return raw;
  if (e.kind === 'person') return `@${e.login}`;
  const state = teams?.[teamKey(e.org, e.slug)];
  const name = `@${e.org}/${e.slug}`;
  return state?.status === 'ok' ? `${name} (${people(state.members.length)})` : name;
}

/**
 * The entries to name for a set of logins (someone who can still act): each person among them, each team with a
 * member among them, and each team whose members are unknown (it may hold one). Labels as entryLabel.
 */
export function entriesFor(entries: readonly string[], logins: readonly string[], teams?: TeamStates | null): string[] {
  const want = new Set(logins.map(norm));
  const out: string[] = [];
  for (const raw of entries) {
    const e = parseOwnerEntry(raw);
    if (!e) continue;
    if (e.kind === 'person') {
      if (want.has(norm(e.login))) out.push(entryLabel(raw, teams));
      continue;
    }
    const state = teams?.[teamKey(e.org, e.slug)];
    if (state?.status !== 'ok' || state.members.some((m) => want.has(norm(m)))) out.push(entryLabel(raw, teams));
  }
  return [...new Set(out)];
}

/** Teams that could not be read, in order. */
export function unreadableTeams(teams: TeamStates | null | undefined): Extract<TeamState, { status: 'unreadable' }>[] {
  return Object.values(teams ?? {}).filter((t): t is Extract<TeamState, { status: 'unreadable' }> => t.status === 'unreadable');
}

// ---------------------------------------------------------------------------------------------------------------
// Reading teams from GitHub

/** What TeamDirectory needs from a GitHub client. GitHubClient implements it. */
export interface TeamReader {
  /** Whether a token is sent: GitHub never lists team members anonymously. */
  readonly hasToken: boolean;
  /** Every member login of a team (GET /orgs/{org}/teams/{slug}/members, all pages). */
  listTeamMembers(org: string, slug: string): Promise<string[]>;
  /** A user's membership of a team (GET /orgs/{org}/teams/{slug}/memberships/{user}): "active", "pending", or null when not a member. */
  getTeamMembership(org: string, slug: string, login: string): Promise<'active' | 'pending' | null>;
  /** "User" or "Organization" (GET /users/{login}), null when unknown. */
  getAccountType(login: string): Promise<'User' | 'Organization' | null>;
  /** The organization's teams the token can see (GET /orgs/{org}/teams, all pages). */
  listOrgTeams(org: string): Promise<{ slug: string; name: string }[]>;
}

/** The parts of a GitHub error TeamDirectory reads (GitHubError has them). */
interface ErrorLike {
  status?: number;
  auth?: string;
}

export interface TeamDirectoryOptions {
  /** How long a team read is kept, in ms. Default 5 minutes. */
  ttlMs?: number;
  now?: () => number;
}

/** Whether one person may act through a list of entries, and which teams could not be checked. */
export interface MembershipResult {
  member: boolean;
  /** Teams whose membership could not be read: when `member` is false, the answer may be wrong for them. */
  unreadable: Extract<TeamState, { status: 'unreadable' }>[];
}

/**
 * Expands teams to logins through a TeamReader, with a cache: each team is read once per `ttlMs`, concurrent reads
 * of one team share the request. Every failure becomes an "unreadable" state with its reason.
 */
export class TeamDirectory {
  private readonly teams = new Map<string, { at: number; value: Promise<TeamState> }>();
  private readonly accounts = new Map<string, Promise<'User' | 'Organization' | null>>();
  private readonly memberships = new Map<string, { at: number; value: Promise<boolean | TeamState> }>();
  private readonly ttl: number;
  private readonly now: () => number;

  constructor(
    private readonly reader: TeamReader,
    opts: TeamDirectoryOptions = {},
  ) {
    this.ttl = opts.ttlMs ?? 5 * 60_000;
    this.now = opts.now ?? Date.now;
  }

  private accountType(org: string): Promise<'User' | 'Organization' | null> {
    const k = org.toLowerCase();
    let p = this.accounts.get(k);
    if (!p) {
      p = this.reader.getAccountType(org).catch(() => null);
      this.accounts.set(k, p);
    }
    return p;
  }

  /** The reason a read of `org` failed, as a state. A 404 on a personal account says so; a 403 is a missing permission. */
  private async failure(ref: TeamRef, err: unknown): Promise<TeamState> {
    const e = (err ?? {}) as ErrorLike;
    let reason: TeamUnreadableReason;
    if (!this.reader.hasToken) reason = (await this.accountType(ref.org)) === 'User' ? 'personal-account' : 'no-token';
    else if (e.status === 401) reason = 'no-token';
    else if (e.status === 403 || e.auth === 'missing-permission') reason = 'missing-permission';
    else if (e.status === 404) reason = (await this.accountType(ref.org)) === 'User' ? 'personal-account' : 'not-found';
    else reason = 'unreachable';
    return { ...ref, status: 'unreadable', reason, message: teamUnreadableMessage(ref, reason) };
  }

  /** Members of one team, or why they cannot be read. Cached. */
  team(org: string, slug: string): Promise<TeamState> {
    const ref: TeamRef = { key: teamKey(org, slug), org, slug };
    const hit = this.teams.get(ref.key);
    if (hit && this.now() - hit.at < this.ttl) return hit.value;
    const value = (async (): Promise<TeamState> => {
      if (!this.reader.hasToken) return this.failure(ref, undefined);
      try {
        const members = await this.reader.listTeamMembers(org, slug);
        return { ...ref, status: 'ok', members };
      } catch (err) {
        return this.failure(ref, err);
      }
    })();
    this.teams.set(ref.key, { at: this.now(), value });
    // A failure GitHub may fix in a moment is not kept.
    void value.then((s) => {
      if (s.status === 'unreadable' && s.reason === 'unreachable') this.teams.delete(ref.key);
    });
    return value;
  }

  /** Every team named in the owner lists, read in parallel. Empty object when no team is named (no request). */
  async resolve(owners: Partial<Owners> | readonly string[]): Promise<TeamStates> {
    const refs = teamsIn(owners);
    const states = await Promise.all(refs.map((r) => this.team(r.org, r.slug)));
    return Object.fromEntries(states.map((s) => [s.key, s]));
  }

  /**
   * Whether `login` is an active member of one team: from the cached member list when there is one, else one
   * membership read (GET /orgs/{org}/teams/{slug}/memberships/{user}). An unreadable team returns its state.
   */
  async isMember(org: string, slug: string, login: string): Promise<boolean | TeamState> {
    const ref: TeamRef = { key: teamKey(org, slug), org, slug };
    const cached = this.teams.get(ref.key);
    if (cached && this.now() - cached.at < this.ttl) {
      const s = await cached.value;
      if (s.status === 'ok') return s.members.some((m) => norm(m) === norm(login));
    }
    const k = `${ref.key}#${norm(login)}`;
    const hit = this.memberships.get(k);
    if (hit && this.now() - hit.at < this.ttl) return hit.value;
    const value = (async (): Promise<boolean | TeamState> => {
      if (!this.reader.hasToken) return this.failure(ref, undefined);
      try {
        return (await this.reader.getTeamMembership(org, slug, login)) === 'active';
      } catch (err) {
        return this.failure(ref, err);
      }
    })();
    this.memberships.set(k, { at: this.now(), value });
    return value;
  }

  /**
   * Whether `login` holds a right given to `entries` (people and teams): a person entry matches directly, a team
   * through its membership. Teams are only read when no person entry matches.
   */
  async memberOfAny(entries: readonly string[], login: string): Promise<MembershipResult> {
    const unreadable: MembershipResult['unreadable'] = [];
    const parsed = entries.map(parseOwnerEntry).filter((e): e is OwnerEntry => Boolean(e));
    if (parsed.some((e) => e.kind === 'person' && norm(e.login) === norm(login))) return { member: true, unreadable };
    for (const e of parsed) {
      if (e.kind !== 'team') continue;
      const r = await this.isMember(e.org, e.slug, login);
      if (r === true) return { member: true, unreadable };
      if (typeof r === 'object' && r.status === 'unreadable') unreadable.push(r);
    }
    return { member: false, unreadable };
  }

  /** The organization's teams for a picker, or why they cannot be listed (a personal account has none). */
  async orgTeams(org: string): Promise<{ status: 'ok'; teams: { slug: string; name: string }[] } | { status: 'unreadable'; reason: TeamUnreadableReason }> {
    if ((await this.accountType(org)) === 'User') return { status: 'unreadable', reason: 'personal-account' };
    if (!this.reader.hasToken) return { status: 'unreadable', reason: 'no-token' };
    try {
      return { status: 'ok', teams: await this.reader.listOrgTeams(org) };
    } catch (err) {
      const s = await this.failure({ key: teamKey(org, '*'), org, slug: '*' }, err);
      return { status: 'unreadable', reason: s.status === 'unreadable' ? s.reason : 'unreachable' };
    }
  }

  /** Drops every cached read (after the token changes). */
  clear(): void {
    this.teams.clear();
    this.accounts.clear();
    this.memberships.clear();
  }
}
