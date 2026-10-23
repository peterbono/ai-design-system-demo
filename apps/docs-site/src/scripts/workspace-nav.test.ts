// @vitest-environment jsdom
// The workspace rail and a team made in Bridge (board D9): Home and Settings carry ?team=<id>, Settings is hidden
// without a team; the team's Settings read the team by its key; Approve puts the person in the list at once (BR-19).
import { afterEach, describe, expect, it } from 'vitest';
import { paintWorkspaceNav } from './workspace-nav';
import { teamKeyOfPage } from '../lib/team-path';
import { withJoined } from '../components/ds/studio/MembersSection';
import type { MembersData } from './members';

const rail = () => {
  document.body.innerHTML = '<ul><li><a class="nav-link" href="/studio/workspace/">Home</a></li><li><a class="nav-link" href="/studio/workspace/settings/">Settings</a></li></ul>';
  return [...document.querySelectorAll('a')];
};

afterEach(() => {
  history.replaceState(null, '', '/');
  document.documentElement.removeAttribute('data-team-settings');
});

describe('the workspace rail', () => {
  it('hides Settings while there is no team', () => {
    history.replaceState(null, '', '/studio/workspace/');
    const [home, settings] = rail();
    paintWorkspaceNav();
    expect(home!.getAttribute('href')).toBe('/studio/workspace/');
    expect(settings!.closest('li')!.hidden).toBe(true);
  });

  it("opens the team's Home and Settings once the address names it", () => {
    history.replaceState(null, '', '/studio/workspace/?team=c0ffee0000000017');
    const [home, settings] = rail();
    paintWorkspaceNav();
    expect(home!.getAttribute('href')).toBe('/studio/workspace/?team=c0ffee0000000017');
    expect(settings!.getAttribute('href')).toBe('/studio/workspace/settings/?team=c0ffee0000000017');
    expect(settings!.closest('li')!.hidden).toBe(false);
  });
});

describe("a team made in Bridge, on its Settings", () => {
  it('reads the team key from the address, only on that page', () => {
    history.replaceState(null, '', '/studio/workspace/settings/?team=C0FFEE0000000017');
    expect(teamKeyOfPage()).toBeNull();
    document.documentElement.setAttribute('data-team-settings', '');
    expect(teamKeyOfPage()).toBe('_team/c0ffee0000000017');
    history.replaceState(null, '', '/studio/workspace/settings/?team=nope');
    expect(teamKeyOfPage()).toBeNull();
  });

  it('adds an approved person to the members at once, once', () => {
    const d = { members: [{ login: 'sam@acme.com', name: 'Sam', role: 'admin', reviews: [], email: 'sam@acme.com', via: 'email' }] } as unknown as MembersData;
    const r = { id: 'r1', name: 'Jordan Lee', email: 'Jordan.Lee@acme.com', createdAt: '', expiresAt: '' };
    const next = withJoined(d, r);
    expect(next.members.at(-1)).toEqual({ login: 'jordan.lee@acme.com', name: 'Jordan Lee', role: 'edit', reviews: [], email: 'jordan.lee@acme.com', via: 'email' });
    expect(withJoined(next, r)).toBe(next);
  });
});
