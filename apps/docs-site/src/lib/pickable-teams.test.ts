import { describe, expect, it } from 'vitest';
import { connectStep } from './connect-figma';
import { pickableTeams } from './pickable-teams';

const SITE = 'peterbono/ai-design-system-demo';
const account = { email: 'florian@example.com', name: 'Florian', nameSet: true, github: { login: 'peterbono', id: 1 }, teams: [] };

describe('pickable teams: the team switcher list, for the pickers too', () => {
  it('an admin of the site\'s own team with zero account teams can pick it (regression: "You are not in a team yet")', () => {
    const teams = pickableTeams({ account: [], recent: [], roles: {}, names: { [SITE]: 'Bridge DS' }, site: { repo: SITE, role: 'Admin' }, needsRepository: true });
    expect(teams).toEqual([{ repo: SITE, name: 'Bridge DS', role: 'Admin' }]);
    // Connect Figma offers it too.
    const step = connectStep('ABCDEFGHIJ', account, true, teams);
    expect(step.kind === 'pick' && step.teams.map((t) => t.repo)).toEqual([SITE]);
    expect(connectStep('ABCDEFGHIJ', account, true, []).kind).toBe('no-teams');
  });

  it('the site\'s own team only when GitHub lets the person push to it', () => {
    expect(pickableTeams({ account: [], recent: [], roles: {}, names: {}, site: { repo: SITE, role: null } })).toEqual([]);
  });

  it('merges the teams this browser opened (with a role) and the account\'s, once each, never the sample team', () => {
    const teams = pickableTeams({
      account: [{ repo: 'acme/design', name: 'Acme Design', role: 'admin' }, { repo: '_team/abc', name: 'New team', role: 'admin' }],
      recent: ['acme/design', 'lumen/brand', 'acme/acme-product', 'other/guest'],
      roles: { 'acme/design': 'Admin', 'lumen/brand': 'Can edit' },
      names: { 'lumen/brand': 'Lumen' },
      site: { repo: SITE, role: 'Admin' },
    });
    expect(teams.map((t) => [t.repo, t.name])).toEqual([
      [SITE, 'ai-design-system-demo'],
      ['acme/design', 'Acme Design'],
      ['lumen/brand', 'Lumen'],
      ['_team/abc', 'New team'],
    ]);
    // The pickers need a design system: a team made in Bridge without a repository is not offered there.
    expect(pickableTeams({ account: [{ repo: '_team/abc', name: 'New team' }], recent: [], roles: {}, names: {}, needsRepository: true })).toEqual([]);
  });
});
