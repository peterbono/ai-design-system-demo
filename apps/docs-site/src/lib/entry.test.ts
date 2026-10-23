import { describe, expect, it } from 'vitest';
import { PEOPLE_SHOWN, invitedOn, teamAvatars, askedAgo, CREATE_TEAM_HREF, discoveryLine, emailDomain, ENTRY_WORDS, inviteRole, inviteTokenFromHash, parseDiscovery, parseInviteLink, parseEntry, parseRequests, routeEntry, sortDomainTeams, splitDomainTeams, teamHome, teamNameFromDomain, yourRole, type Entry } from './entry';

const team = (repo: string, name: string, role = 'edit') => ({ repo, name, role, via: 'email' });

describe('parseEntry: the /api/entry answer', () => {
  it('reads each kind and drops malformed rows', () => {
    expect(parseEntry({ kind: 'teams', teams: [team('acme/ds', 'Acme Design', 'admin'), { repo: 'not a repo' }, null] })).toEqual({ kind: 'teams', teams: [{ repo: 'acme/ds', name: 'Acme Design', role: 'admin', via: 'email' }] });
    expect(parseEntry({ kind: 'invites', invites: [{ id: 'a1', team: 'Acme', repo: 'acme/ds', role: 'reviewer', invitedBy: 'Sam' }, { repo: 'acme/ds' }] })).toEqual({ kind: 'invites', invites: [{ id: 'a1', team: 'Acme', repo: 'acme/ds', role: 'reviewer', invitedBy: 'Sam', invitedAt: '', memberCount: 0, people: [] }] });
    const full = parseEntry({ kind: 'invites', invites: [{ id: 'a1', repo: 'acme/ds', invitedAt: '2026-10-21T09:00:00Z', memberCount: 12.7, people: ['Sam Rivera', 'leak@acme.com', 3, '', 'Lea', 'Kim', 'Ola', 'Six'] }] });
    expect(full?.kind === 'invites' && full.invites[0]).toMatchObject({ invitedAt: '2026-10-21T09:00:00Z', memberCount: 12, people: ['Sam Rivera', 'Lea', 'Kim', 'Ola'] });
    const bad = parseEntry({ kind: 'invites', invites: [{ id: 'a1', repo: 'acme/ds', invitedAt: 'yesterday', memberCount: -3, people: 'Sam' }] });
    expect(bad?.kind === 'invites' && bad.invites[0]).toMatchObject({ invitedAt: '', memberCount: 0, people: [] });
    expect(parseEntry({ kind: 'create' })).toEqual({ kind: 'create' });
    expect(parseEntry({ kind: 'nope' })).toBeNull();
    expect(parseEntry(null)).toBeNull();
  });

  it('turns an empty list into Create your team, and an unknown role into Can edit', () => {
    expect(parseEntry({ kind: 'teams', teams: [] })).toEqual({ kind: 'create' });
    expect(parseEntry({ kind: 'invites', invites: [] })).toEqual({ kind: 'create' });
    expect(parseEntry({ kind: 'domain', domain: 'acme.com', teams: [] })).toEqual({ kind: 'create' });
    expect(parseEntry({ kind: 'teams', teams: [{ repo: 'acme/ds', role: 'owner' }] })).toEqual({ kind: 'teams', teams: [{ repo: 'acme/ds', name: 'acme/ds', role: 'edit', via: 'email' }] });
  });

  it('keeps every domain team, largest first', () => {
    const e = parseEntry({ kind: 'domain', domain: 'acme.com', teams: [{ repo: 'a/b', name: 'B', memberCount: 2 }, { repo: 'a/c', name: 'C', memberCount: 12, people: ['Sam Rivera'], adminName: 'Sam', requested: true }, { repo: 'a/a', name: 'A', memberCount: 2 }] });
    expect(e).toEqual({
      kind: 'domain',
      domain: 'acme.com',
      teams: [
        { repo: 'a/c', name: 'C', memberCount: 12, people: ['Sam Rivera'], adminName: 'Sam', requested: true },
        { repo: 'a/a', name: 'A', memberCount: 2, people: [], adminName: '', requested: false },
        { repo: 'a/b', name: 'B', memberCount: 2, people: [], adminName: '', requested: false },
      ],
    });
  });
});

describe('routeEntry: first match wins', () => {
  it('opens the one team', () => {
    expect(routeEntry({ kind: 'teams', teams: [{ repo: 'acme/ds', name: 'Acme', role: 'edit', via: 'email' }] })).toEqual({ to: 'go', href: '/studio/~/acme/ds/' });
  });

  it('reopens the most recent of 2+ teams, else the picker by name', () => {
    const e: Entry = { kind: 'teams', teams: [{ repo: 'acme/ds', name: 'Acme Design', role: 'edit', via: 'email' }, { repo: 'Acme/Brand', name: 'Acme Brand', role: 'admin', via: 'github' }] };
    expect(routeEntry(e, ['other/x', 'acme/brand'])).toEqual({ to: 'go', href: '/studio/~/Acme/Brand/' });
    const pick = routeEntry(e, ['other/x']);
    expect(pick.to).toBe('pick');
    expect(pick.to === 'pick' && pick.teams.map((t) => t.name)).toEqual(['Acme Brand', 'Acme Design']);
  });

  it('shows the first invite, the domain teams, or Create your team', () => {
    const inv = { id: 'i', team: 'Acme', repo: 'acme/ds', role: 'edit', invitedBy: 'Sam', invitedAt: '', memberCount: 0, people: [] };
    expect(routeEntry({ kind: 'invites', invites: [inv, { ...inv, id: 'j' }] })).toEqual({ to: 'invite', invite: inv, more: 1 });
    expect(routeEntry({ kind: 'domain', domain: 'acme.com', teams: [] })).toEqual({ to: 'domain', domain: 'acme.com', teams: [] });
    expect(routeEntry({ kind: 'create' })).toEqual({ to: 'create', href: CREATE_TEAM_HREF });
    expect(CREATE_TEAM_HREF).toBe('/studio/workspace/?setup=create');
  });
});

describe('team cards', () => {
  it('shows up to four avatars, then +N for everyone else counted', () => {
    expect(teamAvatars(['Sam', 'Ada', 'Lea', 'Kim'], 12)).toEqual({ names: ['Sam', 'Ada', 'Lea', 'Kim'], more: 8 });
    expect(teamAvatars(['Sam', 'Ada'], 2)).toEqual({ names: ['Sam', 'Ada'], more: 0 });
    expect(teamAvatars(['A', 'B', 'C', 'D', 'E'], 5)).toEqual({ names: ['A', 'B', 'C', 'D'], more: 1 });
    expect(teamAvatars([], 3)).toEqual({ names: [], more: 3 });
    expect(teamAvatars(['Sam', 'Ada'], 1)).toEqual({ names: ['Sam', 'Ada'], more: 0 });
    expect(PEOPLE_SHOWN).toBe(4);
  });

  it('says the invite day like "21 October", with the year only when it is not this year', () => {
    const now = Date.parse('2026-10-23T10:00:00Z');
    expect(invitedOn('2026-10-21T12:00:00Z', now)).toBe('21 October');
    expect(invitedOn('2025-12-03T12:00:00Z', now)).toBe('3 December 2025');
    expect(invitedOn('', now)).toBe('');
    expect(ENTRY_WORDS.invitedOn('21 October')).toBe(' on 21 October');
    expect(ENTRY_WORDS.invitedOn('')).toBe('');
  });
});

describe('the words and small rules', () => {
  it('shows three domain teams, then N more', () => {
    expect(splitDomainTeams([1, 2, 3])).toEqual({ shown: [1, 2, 3], more: 0 });
    expect(splitDomainTeams([1, 2, 3, 4, 5])).toEqual({ shown: [1, 2, 3], more: 2 });
    expect(splitDomainTeams([1, 2, 3, 4, 5], true)).toEqual({ shown: [1, 2, 3, 4, 5], more: 0 });
    expect(ENTRY_WORDS.showMore(1)).toBe('Show 1 more team');
    expect(sortDomainTeams([{ name: 'b', memberCount: 1 }, { name: 'a', memberCount: 1 }, { name: 'c', memberCount: 5 }]).map((t) => t.name)).toEqual(['c', 'a', 'b']);
  });

  it('says the role from the person side, and names the team from the domain', () => {
    expect(['edit', 'reviewer', 'admin'].map(yourRole)).toEqual(['You can edit', 'You review design', 'You are admin']);
    expect(teamNameFromDomain('lumen.studio')).toBe('Lumen');
    expect(teamNameFromDomain(null)).toBe('');
    expect(emailDomain('Jo@Acme.com')).toBe('acme.com');
    expect(teamHome('acme/ds')).toBe('/studio/~/acme/ds/');
  });

  it('says when a request was made, and who the request waits for', () => {
    const now = Date.parse('2026-10-23T12:00:00Z');
    expect(askedAgo('2026-10-23T11:30:00Z', now)).toBe('just now');
    expect(askedAgo('2026-10-23T11:00:00Z', now)).toBe('1 h ago');
    expect(askedAgo('2026-10-21T11:00:00Z', now)).toBe('2 days ago');
    expect(ENTRY_WORDS.waitingFor('Sam Rivera')).toBe('Waiting for Sam');
    expect(ENTRY_WORDS.sentLead('')).toBe("We asked an admin to let you in. You'll get an email.");
    expect(ENTRY_WORDS.foundWith('acme.com', '1 h ago')).toBe('Found the team with @acme.com · asked 1 h ago');
  });

  it('never uses an em dash', () => {
    const all = JSON.stringify(ENTRY_WORDS) + Object.values(ENTRY_WORDS).filter((v) => typeof v === 'function').map((f) => (f as (...a: unknown[]) => unknown)('x', 'y')).join(' ');
    expect(all).not.toMatch(/\u2014/);
  });
});

describe('admin side', () => {
  it('reads join requests and discovery', () => {
    expect(parseRequests({ requests: [{ id: 'r1', name: 'Jordan Lee', email: 'jordan.lee@acme.com', createdAt: 'c', expiresAt: 'e' }, { id: 'x' }] })).toEqual([{ id: 'r1', name: 'Jordan Lee', email: 'jordan.lee@acme.com', createdAt: 'c', expiresAt: 'e' }]);
    expect(parseRequests(null)).toEqual([]);
    expect(parseDiscovery({ domain: 'acme.com', enabled: true, configured: true, eligible: true })).toEqual({ domain: 'acme.com', enabled: true, configured: true, eligible: true });
  });

  it('shows the Settings line when the team is open, was, or could be', () => {
    expect(discoveryLine({ domain: 'acme.com', enabled: true, configured: true, eligible: true })).toEqual({ on: true, domain: 'acme.com', canTurnOn: false });
    expect(discoveryLine({ domain: 'acme.com', enabled: false, configured: false, eligible: true })).toEqual({ on: false, domain: 'acme.com', canTurnOn: true });
    expect(discoveryLine({ domain: 'acme.com', enabled: false, configured: true, eligible: false })).toEqual({ on: false, domain: 'acme.com', canTurnOn: false });
    expect(discoveryLine({ domain: null, enabled: false, configured: false, eligible: false })).toBeNull();
    expect(discoveryLine(null)).toBeNull();
  });
});

describe('invite links', () => {
  it('reads the token from the fragment only', () => {
    const t = 'A'.repeat(43);
    expect(inviteTokenFromHash(`#t=${t}`)).toBe(t);
    expect(inviteTokenFromHash(`#x=1&t=${t}`)).toBe(t);
    expect(inviteTokenFromHash('#t=short')).toBeNull();
    expect(inviteTokenFromHash('')).toBeNull();
  });

  it('parses each state and keeps the E3 card only with a valid repository', () => {
    expect(parseInviteLink({ state: 'unknown', signedIn: true })).toEqual({ state: 'unknown', signedIn: true });
    expect(parseInviteLink({ state: 'gone', team: 'Acme', invitedBy: 'Sam', member: true, repo: 'acme/ds', signedIn: true })).toEqual({ state: 'gone', team: 'Acme', invitedBy: 'Sam', signedIn: true, member: true, repo: 'acme/ds' });
    // A member without a repository to open is not one.
    expect(parseInviteLink({ state: 'gone', member: true })).toMatchObject({ member: false });
    const l = parseInviteLink({ state: 'live', team: 'Acme', invitedBy: 'Sam', role: 'reviewer', reviewAs: 'design', sentTo: 'm•••@acme.com', signedIn: true, mine: true, invite: { id: 'i1', repo: 'acme/ds', role: 'reviewer', reviewAs: 'design' } });
    expect(l).toMatchObject({ state: 'live', mine: true, reviewAs: 'design', invite: { id: 'i1', repo: 'acme/ds', reviewAs: 'design' } });
    expect(parseInviteLink({ state: 'live', mine: true, invite: { id: 'i1', repo: 'not a repo' } })).toMatchObject({ mine: false });
    expect(parseInviteLink({ state: 'weird' })).toBeNull();
    expect(parseInviteLink(null)).toBeNull();
  });

  it('names the role like the role picker', () => {
    expect(inviteRole({ role: 'reviewer', reviewAs: 'design' })).toBe('Reviewer: design');
    expect(inviteRole({ role: 'reviewer' })).toBe('Reviewer: design');
    expect(inviteRole({ role: 'admin' })).toBe('Admin');
    expect(inviteRole({ role: 'edit' })).toBe('Can edit');
  });

  it('never writes an em dash in the invite link words', () => {
    const words = [ENTRY_WORDS.githubWhy('Admin'), ENTRY_WORDS.githubOff('Admin', 'Sam'), ENTRY_WORDS.goneLead('Sam', 'Acme'), ENTRY_WORDS.otherLead('Acme'), ENTRY_WORDS.alreadyInLead, ENTRY_WORDS.missingLead];
    for (const w of words) expect(w).not.toContain(String.fromCharCode(0x2014));
  });
});
