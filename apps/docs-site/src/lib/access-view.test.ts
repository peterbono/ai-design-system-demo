// The screen, words and messages of each access state on a team's Bridge.
import { describe, expect, it } from 'vitest';
import type { RepoAccessState } from '@bridge-ds/core';
import {
  accessBadge,
  chipIdentity,
  isDemoTeam,
  accessScreen,
  accessSummary,
  askAccessMessage,
  askInstallMessage,
  installUrl,
  manageAccessUrl,
  forgetsTeam,
  isRecentTeamName,
  parseRecentTeams,
  pushRecentTeam,
  remembersTeam,
  removeRecentTeam,
  teamLink,
  viewerRow,
  whoCanDoWhat,
} from './access-view';

const LINK = 'https://bridge.floriangouloubi.com/studio/acme/design-system/';
const base = { owner: 'acme', repo: 'design-system', login: 'ann', link: LINK };
const ALL: RepoAccessState[] = ['anonymous-public', 'anonymous-unknown', 'no-access', 'not-installed', 'outside-contributor', 'reader', 'writer', 'admin'];

describe('access screens', () => {
  it('opens the Studio as usual for the team', () => {
    expect(accessScreen('reader', base)).toBeNull();
    expect(accessScreen('writer', base)).toBeNull();
    expect(accessScreen('admin', base)).toBeNull();
  });

  it('asks a signed-out visitor to sign in first, with no explanation wall', () => {
    const s = accessScreen('anonymous-unknown', base)!;
    expect(s).toMatchObject({ layout: 'block', title: 'Sign in with GitHub to open acme/design-system', primary: { kind: 'signin' } });
    expect(s.secondary).toBeUndefined();
  });

  it('gives a teammate without access a ready message for their lead, and another account', () => {
    const s = accessScreen('no-access', base)!;
    expect(s.layout).toBe('block');
    expect(s.title).toBe('You do not have access to acme/design-system yet');
    expect(s.body).toContain('@ann cannot see it');
    expect(s.primary).toEqual({
      kind: 'copy',
      label: 'Ask your lead for access',
      text: `Hi, can you give @ann access to github.com/acme/design-system? I want to use our Bridge Studio: ${LINK}`,
      copied: 'Message copied. Paste it to your lead.',
    });
    expect(s.secondary).toEqual({ kind: 'signout', label: 'Sign in with another account' });
    expect(s.links?.[0]?.action).toMatchObject({ kind: 'link', href: 'https://github.com/acme/design-system/invitations' });
  });

  it('shows the install link to admins only when Bridge is not set up', () => {
    expect(accessScreen('not-installed', { ...base, admin: true })!.primary).toEqual({ kind: 'link', label: 'Install Bridge', href: 'https://github.com/apps/bridge-ds/installations/new', external: true });
    const other = accessScreen('not-installed', base)!;
    expect(other.layout).toBe('banner');
    expect(other.primary).toMatchObject({ kind: 'copy', label: 'Ask your lead to install Bridge' });
    expect(JSON.stringify(other)).not.toContain('installations/new"');
  });

  it('keeps people outside the team read only, still able to suggest', () => {
    const s = accessScreen('outside-contributor', base)!;
    expect(s).toMatchObject({ layout: 'banner', title: 'Read only' });
    expect(s.body).toContain('send suggestions');
    expect(s.body).not.toMatch(/not installed/i);
  });

  it('invites a guest on a public repository to sign in, over the Studio', () => {
    expect(accessScreen('anonymous-public', base)).toMatchObject({ layout: 'banner', primary: { kind: 'signin', label: 'Sign in with GitHub' } });
  });

  it('speaks designer words, without em dashes', () => {
    for (const state of ALL) {
      const text = JSON.stringify([accessScreen(state, base), accessScreen(state, { ...base, admin: true }), accessSummary(state, { login: 'ann', repo: 'acme/ds' }), accessBadge(state, true)]);
      expect(text).not.toMatch(/collaborator|installation id|permission|token|—/i);
    }
  });
});

describe('the messages people copy', () => {
  it('names the account and the link, or this account when unknown', () => {
    expect(askAccessMessage(null, 'acme/ds', LINK)).toContain('give this account access');
    expect(askInstallMessage('acme/ds', LINK)).toBe(`Hi, can you install Bridge on github.com/acme/ds? It takes a minute: ${installUrl()} (pick ds). Then the team opens ${LINK}`);
  });

  it('builds the team link from the site and the Studio root', () => {
    expect(teamLink('https://bridge.floriangouloubi.com/', '/studio/acme/ds/')).toBe('https://bridge.floriangouloubi.com/studio/acme/ds/');
    expect(teamLink('http://localhost:4321', 'studio/')).toBe('http://localhost:4321/studio/');
    expect(manageAccessUrl('acme', 'ds')).toBe('https://github.com/acme/ds/settings/access');
  });
});

describe('the team chip', () => {
  it('says the access in a word', () => {
    expect(accessBadge('admin', true).label).toBe('Admin');
    expect(accessBadge('writer', true).label).toBe('Can edit');
    expect(accessBadge('reader', true).label).toBe('Can suggest');
    expect(accessBadge('no-access', true)).toEqual({ label: 'No access', tone: 'danger' });
    expect(accessBadge(null, true).label).toBe('Checking');
    expect(accessBadge(null, false).label).toBe('Guest');
    expect(accessBadge('anonymous-public', false).label).toBe('Guest');
  });

  it('shows the demo as a design system to explore, never as signed out', () => {
    const anon = chipIdentity('peterbono/ai-design-system-demo', { demo: true, state: null, signedIn: false });
    expect(anon).toMatchObject({ kind: 'demo', name: 'Bridge demo', badge: { label: 'Explore freely' } });
    expect(anon.title).toContain('peterbono/ai-design-system-demo');
    expect(chipIdentity('peterbono/ai-design-system-demo', { demo: true, state: 'admin', signedIn: true }).badge.label).toBe('Admin');
    expect(chipIdentity('acme/ds', { demo: false, state: 'anonymous-public', signedIn: false })).toMatchObject({ kind: 'team', name: 'acme/ds', badge: { label: 'Guest' } });
    expect(chipIdentity('acme/ds', { demo: false, state: 'writer', signedIn: true }).badge.label).toBe('Can edit');
    expect(isDemoTeam('Peterbono/AI-design-system-demo', false)).toBe(true);
    expect(isDemoTeam('peterbono/ai-design-system-demo', true)).toBe(false);
    expect(isDemoTeam('acme/ds', false)).toBe(false);
  });

  it('remembers at most five recent teams, newest first, once each', () => {
    let list: string[] = [];
    for (const t of ['a/1', 'b/2', 'c/3', 'd/4', 'e/5', 'f/6', 'A/1']) list = pushRecentTeam(list, t);
    expect(list).toEqual(['A/1', 'f/6', 'e/5', 'd/4', 'c/3']);
    expect(parseRecentTeams(JSON.stringify(['ok/repo', 'nope', 3, '../x/y']))).toEqual(['ok/repo']);
    expect(parseRecentTeams('{bad')).toEqual([]);
  });

  it('drops placeholders and invalid names from the recent teams', () => {
    for (const t of ['owner/repo', 'owner/design', 'Owner/anything', 'OWNER/ds']) expect(isRecentTeamName(t)).toBe(false);
    for (const t of ['acme', 'acme/', '/ds', 'acme/ds/x', '-acme/ds', 'acme-/ds', 'ac--me/ds', 'acme/.', 'acme/..', 'ac me/ds']) {
      expect(isRecentTeamName(t)).toBe(false);
    }
    for (const t of ['acme/ds', 'peterbono/ai-design-system-demo', 'a/1', 'owners/ds', 'acme/owner']) expect(isRecentTeamName(t)).toBe(true);
    const stored = JSON.stringify(['owner/design', 'acme/ds', 'owner/repo', 'ACME/ds', 'acme-/x', 'globex/tokens']);
    expect(parseRecentTeams(stored)).toEqual(['acme/ds', 'globex/tokens']);
    expect(pushRecentTeam(['acme/ds'], 'owner/design')).toEqual(['acme/ds']);
  });

  it('removes one recent team, whatever its case', () => {
    expect(removeRecentTeam(['acme/ds', 'globex/tokens'], 'ACME/DS')).toEqual(['globex/tokens']);
    expect(removeRecentTeam(['acme/ds'], 'other/x')).toEqual(['acme/ds']);
  });

  it('remembers a team only once its page read the repository', () => {
    const states: RepoAccessState[] = ['anonymous-public', 'anonymous-unknown', 'no-access', 'not-installed', 'outside-contributor', 'reader', 'writer', 'admin'];
    expect(states.filter((s) => remembersTeam(s))).toEqual(['anonymous-public', 'outside-contributor', 'reader', 'writer', 'admin']);
    expect(states.filter((s) => forgetsTeam(s))).toEqual(['anonymous-unknown', 'no-access']);
    expect(remembersTeam(null)).toBe(false);
    expect(forgetsTeam(undefined)).toBe(false);
  });
});

describe('who can do what', () => {
  it('maps GitHub access to Bridge, from the mode and the owners', () => {
    const suggest = whoCanDoWhat({ changes: 'suggest', owners: { design: ['ann'], tech: ['bob', 'ann'] } });
    expect(suggest.map((r) => r.id)).toEqual(['read', 'write', 'admin', 'owners']);
    expect(suggest[1]!.can).toContain('suggestions');
    expect(suggest[3]!.can).toBe('Approve design or tech: @ann, @bob');
    expect(whoCanDoWhat({ changes: 'direct' })[1]!.can).toContain('Bridge opens them for review');
    expect(whoCanDoWhat({ owners: { design: ['a', 'b', 'c', 'd'] } })[3]!.can).toBe('Approve design or tech');
  });

  it('marks the viewer row', () => {
    expect(viewerRow('admin')).toBe('admin');
    expect(viewerRow('writer')).toBe('write');
    expect(viewerRow('reader')).toBe('read');
    expect(viewerRow('outside-contributor')).toBeNull();
  });
});
