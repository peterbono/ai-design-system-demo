import { describe, expect, it } from 'vitest';
import { askedAgo, CREATE_TEAM_HREF, discoveryLine, emailDomain, ENTRY_WORDS, parseDiscovery, parseEntry, parseRequests, routeEntry, sortDomainTeams, splitDomainTeams, teamHome, teamNameFromDomain, yourRole, type Entry } from './entry';

const team = (repo: string, name: string, role = 'edit') => ({ repo, name, role, via: 'email' });

describe('parseEntry: the /api/entry answer', () => {
  it('reads each kind and drops malformed rows', () => {
    expect(parseEntry({ kind: 'teams', teams: [team('acme/ds', 'Acme Design', 'admin'), { repo: 'not a repo' }, null] })).toEqual({ kind: 'teams', teams: [{ repo: 'acme/ds', name: 'Acme Design', role: 'admin', via: 'email' }] });
    expect(parseEntry({ kind: 'invites', invites: [{ id: 'a1', team: 'Acme', repo: 'acme/ds', role: 'reviewer', invitedBy: 'Sam' }, { repo: 'acme/ds' }] })).toEqual({ kind: 'invites', invites: [{ id: 'a1', team: 'Acme', repo: 'acme/ds', role: 'reviewer', invitedBy: 'Sam' }] });
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
    const e = parseEntry({ kind: 'domain', domain: 'acme.com', teams: [{ repo: 'a/b', name: 'B', memberCount: 2 }, { repo: 'a/c', name: 'C', memberCount: 12, adminName: 'Sam', requested: true }, { repo: 'a/a', name: 'A', memberCount: 2 }] });
    expect(e).toEqual({
      kind: 'domain',
      domain: 'acme.com',
      teams: [
        { repo: 'a/c', name: 'C', memberCount: 12, adminName: 'Sam', requested: true },
        { repo: 'a/a', name: 'A', memberCount: 2, adminName: '', requested: false },
        { repo: 'a/b', name: 'B', memberCount: 2, adminName: '', requested: false },
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
    const inv = { id: 'i', team: 'Acme', repo: 'acme/ds', role: 'edit', invitedBy: 'Sam' };
    expect(routeEntry({ kind: 'invites', invites: [inv, { ...inv, id: 'j' }] })).toEqual({ to: 'invite', invite: inv, more: 1 });
    expect(routeEntry({ kind: 'domain', domain: 'acme.com', teams: [] })).toEqual({ to: 'domain', domain: 'acme.com', teams: [] });
    expect(routeEntry({ kind: 'create' })).toEqual({ to: 'create', href: CREATE_TEAM_HREF });
    expect(CREATE_TEAM_HREF).toBe('/studio/workspace/?setup=create');
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
