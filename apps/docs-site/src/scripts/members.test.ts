// @vitest-environment jsdom
// Settings > Members for someone on the team who cannot list it on GitHub (an email contributor, a GitHub reader): the
// full team, read from /api/contribute?members=1, read only, never another member's email.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RepoAccess } from '../lib/access';

const s = vi.hoisted(() => ({
  viewer: null as null | { login: string; name?: string; email?: string },
  access: null as RepoAccess | null,
  token: null as string | null,
  team: vi.fn(),
  ghGet: vi.fn(),
  teamData: null as null | (() => Promise<unknown>),
}));

vi.mock('./github-session', () => ({
  currentViewer: () => s.viewer,
  getToken: () => s.token,
  ghGet: s.ghGet,
  resolveAccess: async () => s.access,
}));
vi.mock('./contribute-session', () => ({ contributeTeam: s.team }));
vi.mock('./invites-api', () => ({ invitesAvailable: async () => true, listInvites: vi.fn(async () => ({ invites: [], members: [], personal: false })) }));
vi.mock('./people', () => ({ knownNames: () => ({}) }));
vi.mock('./repo-context', () => ({ repoContext: () => ({ owner: 'acme', repo: 'ds', defaultBranch: 'main', hosted: true }), siteConfig: () => ({}) }));
vi.mock('./team-data', () => ({ loadTeamData: () => (s.teamData ? s.teamData() : Promise.resolve({ model: { site: { owners: { design: ['peterbono'], tech: ['peterbono'] } } } })) }));

import { loadMembers } from './members';

const PEOPLE = {
  collaborators: [{ login: 'peterbono', avatar_url: 'https://avatars.githubusercontent.com/u/1', role_name: 'admin', permissions: { admin: true, push: true, pull: true } }],
  members: [{ name: 'Goulou Photographie', role: 'edit' as const, you: true }],
};

beforeEach(() => {
  vi.clearAllMocks();
  s.teamData = null;
  s.team.mockResolvedValue(PEOPLE);
});

describe('loadMembers for a member who cannot list the team on GitHub', () => {
  it('gives an email contributor the whole team, read only, without asking GitHub', async () => {
    s.viewer = { login: 'goulou@example.com', name: 'Goulou Photographie', email: 'goulou@example.com' };
    s.access = { state: 'writer', write: true, admin: false, reach: true, contributor: true };
    s.token = 'contrib';
    const d = await loadMembers();
    expect(s.team).toHaveBeenCalledWith('acme/ds', null);
    expect(s.ghGet).not.toHaveBeenCalled();
    expect(d.complete).toBe(true);
    expect(d.canManage).toBe(false);
    expect(d.members.map((m) => [m.name, m.role, Boolean(m.you)])).toEqual([
      ['peterbono', 'admin', false],
      ['Goulou Photographie', 'edit', true],
    ]);
    expect(d.members[1]).toMatchObject({ via: 'email', email: 'goulou@example.com' });
  });

  it('gives a GitHub reader the same list, with their own token for the server to check', async () => {
    s.viewer = { login: 'ana' };
    s.access = { state: 'reader', write: false, admin: false };
    s.token = 'gho_ana';
    s.team.mockResolvedValue({ ...PEOPLE, members: [{ name: 'Goulou Photographie', role: 'edit' }] });
    const d = await loadMembers();
    expect(s.team).toHaveBeenCalledWith('acme/ds', 'gho_ana');
    expect(d.members.find((m) => m.via === 'email')).toEqual({ login: 'email-member-0', name: 'Goulou Photographie', role: 'edit', reviews: [], via: 'email' });
  });

  it('falls back to the reviewers from the settings when the server cannot answer', async () => {
    s.viewer = { login: 'goulou@example.com', email: 'goulou@example.com' };
    s.access = { state: 'writer', write: true, admin: false, contributor: true };
    s.team.mockRejectedValue(new Error('down'));
    const d = await loadMembers();
    expect(d.complete).toBe(false);
    expect(d.members.map((m) => m.login)).toEqual(['peterbono']);
  });

  it('never waits for the design system read: the people paint without review roles, marked to read again', async () => {
    s.viewer = { login: 'goulou@example.com', name: 'Goulou Photographie', email: 'goulou@example.com' };
    s.access = { state: 'writer', write: true, admin: false, reach: true, contributor: true };
    s.token = 'contrib';
    s.teamData = () => new Promise(() => undefined);
    // Past OWNERS_WAIT_MS (real time, under a second).
    const d = await loadMembers();
    expect(d.ownersKnown).toBe(false);
    expect(d.members.map((m) => m.name)).toEqual(['peterbono', 'Goulou Photographie']);
  });

  it('paints the people when the design system read fails', async () => {
    s.viewer = { login: 'goulou@example.com', email: 'goulou@example.com' };
    s.access = { state: 'writer', write: true, admin: false, reach: true, contributor: true };
    s.teamData = () => Promise.reject(Object.assign(new Error('API rate limit exceeded'), { status: 429 }));
    const d = await loadMembers();
    expect(d.ownersKnown).toBe(false);
    expect(d.complete).toBe(true);
  });
});
