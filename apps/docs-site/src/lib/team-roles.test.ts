// Roles by team in the Studio: approvals, who acts, the ship gate, the Overview sentence and the Settings picker, with
// GitHub teams in governance.owners ("@acme/design"). Team states are given as TeamDirectory would read them.
import { describe, expect, it } from 'vitest';
import { approverEntries, approverLists, DEFAULT_RIGHTS, loadConfig, shipPolicy, teamUnreadableMessage, type TeamStates } from '@bridge-ds/core';
import { approvalRows, needFromDetail, whoActs, type People } from './changes';
import { mergeGate, summarizeApprovals, summarizeCi } from './review-rules';
import { overviewTodo, type TodoRequest } from './overview-todo';
import { ownerFromInput, ownerOptions, roleRows, rolesProposal, sameOwners, teamsPickerHint, withRoles } from './roles-view';

const config = { design: ['@acme/design'], tech: ['@acme/web', 'tara'] };
const ok = (slug: string, members: string[]) => ({ key: `@acme/${slug}`, org: 'acme', slug, status: 'ok' as const, members });
const teams: TeamStates = { '@acme/design': ok('design', ['ana', 'bo', 'cy', 'di']), '@acme/web': ok('web', ['theo']) };
const blind: TeamStates = {
  '@acme/design': { key: '@acme/design', org: 'acme', slug: 'design', status: 'unreadable', reason: 'missing-permission', message: teamUnreadableMessage({ org: 'acme', slug: 'design' }, 'missing-permission') },
  '@acme/web': ok('web', ['theo']),
};
const green = summarizeCi([{ name: 'Build', status: 'completed', conclusion: 'success' }]);

function people(states: TeamStates, extra: Partial<People> = {}): People {
  const ship = shipPolicy(config, DEFAULT_RIGHTS, states)!;
  return { owners: approverLists(config, DEFAULT_RIGHTS, states), entries: approverEntries(config, DEFAULT_RIGHTS), shipEntries: ship.entries, teams: states, author: 'zed', shippers: ship.logins, ...extra };
}

function detail(states: TeamStates, reviewers: string[]) {
  const owners = approverLists(config, DEFAULT_RIGHTS, states);
  const approvals = summarizeApprovals(
    reviewers.map((l, i) => ({ user: { login: l }, state: 'APPROVED', submitted_at: `2026-10-0${i + 1}` })),
    owners,
    'zed',
  );
  const gate = mergeGate({ tier: 3, ci: green, approvals, draft: false, state: 'open' });
  return { approvals, need: needFromDetail({ state: 'open', ci: green, gate, changesRequestedBy: [] }) };
}

describe('approvals and who acts, with teams', () => {
  it('an approval counts when the reviewer is in the team; sentences name the team with its size', () => {
    const none = detail(teams, []);
    expect(whoActs(none.need, people(teams)).sentence).toBe('Waiting for the design owner (@acme/design (4 people)) and the tech owner (@acme/web (1 person) or @tara) to approve.');
    const one = detail(teams, ['bo']);
    expect(one.approvals.design).toBe(true);
    const rows = approvalRows({ tier: 3, approvals: one.approvals, people: people(teams, { approvers: one.approvals.approvers }), open: true });
    expect(rows.map((r) => [r.label, r.state, r.text])).toEqual([
      ['Design', 'approved', 'Approved by @bo'],
      ['Tech', 'waiting', 'Waiting for @acme/web (1 person) or @tara'],
    ]);
    // An approval from outside the team does not count.
    expect(detail(teams, ['zoe']).approvals.design).toBe(false);
  });

  it('a team member is asked by name: your turn', () => {
    const w = whoActs(detail(teams, []).need, people(teams, { viewer: 'CY' }));
    expect(w).toMatchObject({ yourTurn: true, action: 'approve-design' });
  });

  it('a team that cannot be read counts nobody, never everybody', () => {
    const d = detail(blind, ['ana']);
    expect(d.approvals.design).toBe(false);
    expect(whoActs(d.need, people(blind)).sentence).toBe('Waiting for the design owner (@acme/design) and the tech owner (@acme/web (1 person) or @tara) to approve.');
    expect(whoActs(d.need, people(blind, { viewer: 'ana' })).yourTurn).toBe(false);
  });

  it('ready to ship names the team that ships', () => {
    const ready = whoActs({ kind: 'ready' }, people(teams));
    expect(ready.sentence).toBe('Ready to ship: @acme/web (1 person) or @tara can ship it.');
  });
});

describe('ship gate with teams', () => {
  const approvals = { approvers: ['ana', 'theo'], changesRequested: [], design: true, tech: true };
  it('a team member ships, an outsider reads the team in the sentence', () => {
    const ship = shipPolicy(config, DEFAULT_RIGHTS, teams);
    expect(mergeGate({ tier: 3, ci: green, approvals, draft: false, state: 'open', viewer: 'theo', ship }).allowed).toBe(true);
    const out = mergeGate({ tier: 3, ci: green, approvals, draft: false, state: 'open', viewer: 'ana', ship });
    expect(out.reasons).toEqual(['Only the tech owner can ship this (@acme/web (1 person), @tara).']);
  });

  it('a ship team that cannot be read blocks with the reason and the fix', () => {
    const shipTeams = { design: [], tech: ['@acme/web'] };
    const unread: TeamStates = { '@acme/web': { ...blind['@acme/design']!, key: '@acme/web', slug: 'web', message: teamUnreadableMessage({ org: 'acme', slug: 'web' }, 'missing-permission') } as TeamStates[string] };
    const ship = shipPolicy(shipTeams, DEFAULT_RIGHTS, unread);
    const g = mergeGate({ tier: 3, ci: green, approvals, draft: false, state: 'open', viewer: 'theo', ship });
    expect(g.allowed).toBe(false);
    expect(g.reasons[0]).toBe('Only the tech owner can ship this (@acme/web).');
    expect(g.reasons[1]).toMatch(/@acme\/web cannot be read: the GitHub token needs read:org/);
  });
});

describe('overview names teams', () => {
  it('a request nobody is on waits for the owners, a team named as a team', () => {
    const request: TodoRequest = { number: 9, component: 'Select', title: 'Add a native Select', status: 'requested', requester: 'ana', assignees: [], prs: [] };
    const t = overviewTodo({ changes: [], requests: [request], viewer: 'zoe', owners: ['ana', 'bo', 'theo'], ownerNames: ['@acme/design (2 people)', '@acme/web (1 person)'] });
    expect(t.others[0]!.why).toContain('Waiting for a design system owner (@acme/design (2 people) or @acme/web (1 person)) to decide.');
    const mine = overviewTodo({ changes: [], requests: [request], viewer: 'BO', owners: ['ana', 'bo', 'theo'], ownerNames: ['@acme/design (2 people)'] });
    expect(mine.mine[0]!.task).toBe('decide');
  });
});

describe('Settings: people and teams', () => {
  it('reads what is typed as a person or a team, or says how to write it', () => {
    expect(ownerFromInput('  ')).toBe(null);
    expect(ownerFromInput('@Dana')).toEqual({ entry: 'Dana' });
    expect(ownerFromInput('acme/design')).toEqual({ entry: '@acme/design' });
    expect(ownerFromInput('acme/')).toEqual({ error: '"acme/" is not a GitHub login or team. Type a person as @login, a team as @org/team.' });
  });

  it('suggests teams, then people, then what is typed', () => {
    const o = ownerOptions({ teams: [{ slug: 'design', name: 'Design' }], people: ['dana'], org: 'acme', query: '' });
    expect(o).toEqual([
      { value: '@acme/design', label: '@acme/design', description: 'Design', group: 'Teams' },
      { value: 'dana', label: '@dana', group: 'People' },
    ]);
    expect(ownerOptions({ org: 'acme', query: '@acme/web' })).toEqual([{ value: '@acme/web', label: '@acme/web', description: 'Add this team' }]);
    expect(ownerOptions({ people: ['dana'], org: 'acme', query: 'DANA' })).toEqual([{ value: 'dana', label: '@dana' }]);
    expect(ownerOptions({ org: 'acme', query: 'not valid!' })).toEqual([]);
  });

  it('says why teams cannot be suggested and how to fix it', () => {
    expect(teamsPickerHint(null, 'acme')).toBe(null);
    expect(teamsPickerHint('personal-account', 'peterbono')).toMatch(/personal GitHub account/);
    expect(teamsPickerHint('missing-permission', 'acme')).toMatch(/read:org/);
    expect(teamsPickerHint('no-token', 'acme')).toMatch(/Connect GitHub/);
    expect(teamsPickerHint('no-token', 'acme', true)).toBe('Sign in to pick a team. You can still type @org/team.');
  });

  const CONFIG = `{
  "governance": {
    "owners": { "design": ["dana"], "tech": ["theo"] },
    "rights": { "approveDesign": ["design"], "approveTech": ["tech"], "ship": ["tech"] }
  }
}
`;

  it('writes owners only when they change, on the same line layout', () => {
    const rights = DEFAULT_RIGHTS;
    expect(withRoles(CONFIG, { rights, visualMode: 'auto', owners: { design: ['@Dana'], tech: ['theo'] } })).toBe(CONFIG);
    const next = withRoles(CONFIG, { rights, visualMode: 'auto', owners: { design: ['@acme/design', 'dana'], tech: ['theo'] } });
    expect(next).toBe(CONFIG.replace('"design": ["dana"]', '"design": ["@acme/design", "dana"]'));
    expect(loadConfig(JSON.parse(next)).governance.owners.design).toEqual(['@acme/design', 'dana']);
    expect(sameOwners(['a', '@B'], ['A', 'b'])).toBe(true);
  });

  it('the proposal lists the owners it sets, teams marked', () => {
    const owners = { design: ['@acme/design'], tech: ['theo'] };
    const p = rolesProposal(roleRows(owners, DEFAULT_RIGHTS), 'auto', { date: new Date('2026-10-18'), tierLabel: 'Tier 3', owners });
    expect(p.body).toContain('Edits `governance.owners`, `governance.rights` and `visualImpact`');
    expect(p.body).toContain('- Design owners: @acme/design (team).');
    expect(p.body).toContain('- Tech owners: @theo.');
  });
});
