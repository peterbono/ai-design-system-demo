// The rules behind Invite collaborators and Settings > Members (lib/invites.ts): role words, the GitHub mapping read
// back, who may change what, the email field and the sample team.
import { describe, expect, it } from 'vitest';
import {
  adminCount,
  choiceOf,
  GITHUB_PERMISSION,
  inviteePeople,
  inviteOptions,
  isEmail,
  memberActions,
  MEMBERS_WORDS,
  memberLine,
  membersContext,
  normalizeChoice,
  ownerGroupOf,
  parseEmails,
  pendingLine,
  roleChoices,
  roleLabel,
  roleOf,
  roleText,
  sameChoice,
  sampleTeam,
  sendLabel,
  sentSummary,
  sortMembers,
  type Member,
} from './invites';

const owners = { design: ['ann', '@acme/design'], tech: ['Malik'] };

describe('roles', () => {
  it('maps each role to one GitHub permission, and Reviewer to an owner list', () => {
    expect(GITHUB_PERMISSION).toEqual({ view: 'pull', edit: 'push', reviewer: 'push', admin: 'admin' });
    expect(ownerGroupOf({ role: 'reviewer', reviewAs: 'tech' })).toBe('tech');
    expect(ownerGroupOf({ role: 'reviewer' })).toBe('design');
    expect(ownerGroupOf({ role: 'edit' })).toBeNull();
  });

  it('names the trigger like the board: "Reviewer: design"', () => {
    expect(roleLabel({ role: 'edit' })).toBe('Can edit');
    expect(roleLabel({ role: 'view' })).toBe('Can view');
    expect(roleLabel({ role: 'reviewer', reviewAs: 'design' })).toBe('Reviewer: design');
    expect(roleLabel({ role: 'reviewer', reviewAs: 'tech' })).toBe('Reviewer: tech');
    expect(roleLabel({ role: 'admin' })).toBe('Admin');
  });

  it('a Reviewer always says what they review; other roles never do', () => {
    expect(normalizeChoice({ role: 'reviewer' })).toEqual({ role: 'reviewer', reviewAs: 'design' });
    expect(normalizeChoice({ role: 'edit', reviewAs: 'tech' })).toEqual({ role: 'edit' });
    expect(sameChoice({ role: 'reviewer' }, { role: 'reviewer', reviewAs: 'design' })).toBe(true);
    expect(sameChoice({ role: 'reviewer', reviewAs: 'tech' }, { role: 'reviewer' })).toBe(false);
  });

  it('offers contributor roles only, never Can view (readers use Library access)', () => {
    expect(roleChoices(false).map((c) => c.role)).toEqual(['edit', 'reviewer', 'admin']);
    expect(roleChoices(true).map((c) => c.role)).not.toContain('view');
    // Someone who already has read access still reads as Can view.
    expect(roleLabel({ role: 'view' })).toBe('Can view');
  });

  it('on a personal account, only Can edit and Reviewer can be given', () => {
    expect(roleChoices(true).filter((c) => !c.disabled).map((c) => c.role)).toEqual(['edit', 'reviewer']);
    expect(roleChoices(false).every((c) => !c.disabled)).toBe(true);
  });
});

describe('reading roles back from GitHub', () => {
  it('admin wins, write plus an owner entry is Reviewer, write alone Can edit, read Can view', () => {
    expect(roleOf({ login: 'dana', role_name: 'admin' }, owners)).toEqual({ role: 'admin', reviews: [] });
    expect(roleOf({ login: 'ANN', role_name: 'write' }, owners)).toEqual({ role: 'reviewer', reviews: ['design'] });
    expect(roleOf({ login: 'malik', role_name: 'maintain' }, owners)).toEqual({ role: 'reviewer', reviews: ['tech'] });
    expect(roleOf({ login: 'leo', role_name: 'write' }, owners)).toEqual({ role: 'edit', reviews: [] });
    expect(roleOf({ login: 'priya', role_name: 'read' }, owners)).toEqual({ role: 'view', reviews: [] });
    expect(roleOf({ login: 'tri', role_name: 'triage' }, owners)).toEqual({ role: 'view', reviews: [] });
  });

  it('falls back to the permissions object, and a GitHub team entry never matches a login', () => {
    expect(roleOf({ login: 'x', permissions: { admin: true, push: true, pull: true } }, owners).role).toBe('admin');
    expect(roleOf({ login: 'x', permissions: { push: true, pull: true } }, owners).role).toBe('edit');
    expect(roleOf({ login: 'acme', permissions: { push: true } }, { design: ['@acme/design'], tech: [] }).role).toBe('edit');
    // A reader listed as owner stays Can view: approving needs write access.
    expect(roleOf({ login: 'ann', role_name: 'read' }, owners)).toEqual({ role: 'view', reviews: [] });
  });

  it('keeps the owner lists of an admin for the line under their name', () => {
    const m = roleOf({ login: 'ann', role_name: 'admin' }, { design: ['ann'], tech: ['ann'] });
    expect(m).toEqual({ role: 'admin', reviews: ['design', 'tech'] });
    expect(memberLine(m)).toBe('Reviews design and code');
    expect(roleText(m)).toBe('Admin');
  });

  it('words each member', () => {
    expect(memberLine({ role: 'reviewer', reviews: ['design'] })).toBe('Reviews design');
    expect(memberLine({ role: 'reviewer', reviews: ['tech'] })).toBe('Reviews code');
    expect(memberLine({ role: 'edit', reviews: [] })).toBe('Explores and changes the library');
    expect(memberLine({ role: 'view', reviews: [] })).toBe('Sees everything, comments and suggests');
    expect(choiceOf({ role: 'reviewer', reviews: ['tech'] })).toEqual({ role: 'reviewer', reviewAs: 'tech' });
    expect(roleText({ role: 'reviewer', reviews: ['design', 'tech'] })).toBe('Reviewer: design');
  });
});

describe('who may change what', () => {
  const m = (role: Member['role'], you = false) => ({ role, you });

  it('nobody but an admin, and never on their own row', () => {
    expect(memberActions(m('edit'), { canManage: false, admins: 1 })).toEqual({ changeRole: false, makeAdmin: false, remove: false });
    expect(memberActions(m('admin', true), { canManage: true, admins: 2 })).toEqual({ changeRole: false, makeAdmin: false, remove: false });
    expect(memberActions(m('edit'), { canManage: true, admins: 1 })).toEqual({ changeRole: true, makeAdmin: true, remove: true });
  });

  it('an admin signed in by email manages email members only: a GitHub member reads as text', () => {
    expect(memberActions({ role: 'edit', via: 'email' }, { canManage: true, admins: 2, emailAdmin: true })).toEqual({ changeRole: true, makeAdmin: true, remove: true });
    expect(memberActions({ role: 'edit' }, { canManage: true, admins: 2, emailAdmin: true })).toEqual({ changeRole: false, makeAdmin: false, remove: false });
    expect(memberActions({ role: 'edit' }, { canManage: true, admins: 2 })).toEqual({ changeRole: true, makeAdmin: true, remove: true });
    expect(MEMBERS_WORDS.githubPeople).toMatch(/signed in with GitHub as an admin of the repository/);
    for (const t of [MEMBERS_WORDS.githubPeople, MEMBERS_WORDS.reviewerNeedsRepo, MEMBERS_WORDS.personalAdmin]) expect(t).not.toMatch(/\u2014/);
  });

  it('never leaves the team without an admin', () => {
    expect(memberActions(m('admin'), { canManage: true, admins: 1 })).toEqual({ changeRole: false, makeAdmin: false, remove: false });
    expect(memberActions(m('admin'), { canManage: true, admins: 2 })).toEqual({ changeRole: true, makeAdmin: false, remove: true });
    expect(adminCount([{ role: 'admin' }, { role: 'edit' }, { role: 'admin' }])).toBe(2);
  });

  it('lists you first, then by role and name', () => {
    const xs = sortMembers([
      { name: 'Zed', role: 'view' },
      { name: 'Bo', role: 'admin' },
      { name: 'Me', role: 'edit', you: true },
      { name: 'Al', role: 'reviewer' },
    ]);
    expect(xs.map((x) => x.name)).toEqual(['Me', 'Bo', 'Al', 'Zed']);
  });
});

describe('the email field', () => {
  it('takes several emails at once, lower case, valid and new only', () => {
    expect(parseEmails('Ann@Acme.design, leo@acme.design; nope bad@ <priya@acme.design>', ['leo@acme.design'])).toEqual(['ann@acme.design', 'priya@acme.design']);
    expect(isEmail('a@b.co')).toBe(true);
    expect(isEmail('a@b')).toBe(false);
    expect(isEmail('a b@c.de')).toBe(false);
  });

  it('suggests known people by name or email, marks people already in, and offers a new typed address', () => {
    const s = sampleTeam();
    const f = { people: s.people, members: s.members, pending: s.pending, chosen: [] as string[], team: 'Acme Design' };
    const mal = inviteOptions('mal', f);
    expect(mal.map((o) => o.label)).toEqual(['Malik', 'Mal Reyes']);
    expect(mal[0]).toMatchObject({ disabled: true, description: 'malik@acme.design · Already in Acme Design' });
    expect(mal[1]).toMatchObject({ value: 'mal.reyes@acme.design' });
    expect(mal[1]!.disabled).toBeUndefined();
    expect(inviteOptions('new@acme.design', f)).toContainEqual({ value: 'new@acme.design', label: 'new@acme.design', description: 'Invite by email' });
    // Pending invites count as in the team.
    expect(inviteOptions('priya@acme.design', f).at(-1)).toMatchObject({ disabled: true });
    // Sofia is a member (she asks for work in the demo): listed, disabled, already in.
    expect(inviteOptions('sofia', f)).toEqual([expect.objectContaining({ label: 'Sofia', disabled: true })]);
    // Two people the field suggests who are not in the team yet.
    expect(inviteOptions('', f).filter((o) => !o.disabled).map((o) => o.label)).toEqual(['Mal Reyes', 'Jonas Berg']);
    // Chosen addresses stay listed so their chips keep a label.
    expect(inviteOptions('', { ...f, chosen: ['x@y.co'] }).some((o) => o.value === 'x@y.co')).toBe(true);
  });

  it('sends the GitHub account of a known person along, so an organization member can be added directly', () => {
    expect(inviteePeople(['ann@acme.design', 'new@acme.design'], [{ name: 'Ann', email: 'ann@acme.design', login: 'ann' }])).toEqual([{ email: 'ann@acme.design', login: 'ann' }, { email: 'new@acme.design' }]);
  });

  it('counts the invites on the button and words the outcome', () => {
    expect(sendLabel(0)).toBe('Send invites');
    expect(sendLabel(1)).toBe('Send 1 invite');
    expect(sendLabel(2)).toBe('Send 2 invites');
    expect(sentSummary([{ status: 'sent' }, { status: 'sent' }, { status: 'added' }, { status: 'failed' }])).toBe('2 invites sent, 1 added to the team, 1 not sent.');
    expect(sentSummary([])).toBe('');
  });

  it('says when an invite went out', () => {
    const now = Date.UTC(2026, 9, 22, 9);
    expect(pendingLine(new Date(now - 2 * 86400_000).toISOString(), now)).toBe('Invited 2 days ago, not joined yet');
    expect(pendingLine(new Date(now - 86400_000).toISOString(), now)).toBe('Invited yesterday, not joined yet');
    expect(pendingLine(new Date(now - 60_000).toISOString(), now)).toBe('Invited just now, not joined yet');
  });
});

describe('contexts', () => {
  it('never mixes the sample team, a real team and the workspace', () => {
    expect(membersContext('peterbono/bridge-demo-ds', false)).toBe('sample');
    expect(membersContext('peterbono/ai-design-system-demo', false)).toBe('real');
    expect(membersContext('acme/ds', false)).toBe('real');
    expect(membersContext('acme/ds', true)).toBe('none');
    expect(membersContext(null, false)).toBe('none');
  });

  it('the sample team is Dana (you, admin), Ann, Leo, Malik, Sofia and Priya not joined yet', () => {
    const s = sampleTeam();
    expect(s.members.map((m) => `${m.name}:${roleText(m)}`)).toEqual(['Dana:Admin', 'Ann:Reviewer: design', 'Leo:Can edit', 'Malik:Reviewer: tech', 'Sofia:Can edit']);
    expect(s.members[0]!.you).toBe(true);
    // Sofia asks for work in the demo ("Requested by Sofia Reyes."), so she is a member; Priya has no work there.
    expect(s.members.find((m) => m.name === 'Sofia')).toMatchObject({ login: '~sofia-reyes', email: 'sofia@acme.design' });
    expect(s.pending).toEqual([expect.objectContaining({ email: 'priya@acme.design', role: 'edit', face: '~priya-natarajan' })]);
    expect(s.people.some((p) => /priya/i.test(p.email ?? ''))).toBe(false);
    expect(sampleTeam('Robin').members[0]!.name).toBe('Robin');
  });
});
