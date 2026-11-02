// @vitest-environment jsdom
// The Danger zone of a team's Settings: admins of a real team only; the confirm dialog asks for the team's name typed
// exactly; once done the page goes where the server says (the person's next team, else the start page); a refusal is
// said in the dialog. Words never carry an em dash.
import '../../../../../../packages/react/src/test/setup';
import { createElement } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DELETE_TEAM_WORDS, confirmMatches, deleteKindOf, githubAppsHref } from '../../../lib/delete-team';

let people: Record<string, unknown> | null = null;
vi.mock('./members-state', () => ({ useTeamPeople: () => people }));
const deleteTeam = vi.fn();
vi.mock('../../../scripts/entry-session', () => ({ deleteTeam: (...a: unknown[]) => deleteTeam(...a) }));

const { default: DeleteTeamBand, DeleteTeamRow, leave } = await import('./DeleteTeam');

const real = (x: Partial<{ repo: string; team: string; canManage: boolean; context: string }> = {}) => ({ context: 'real', repo: 'acme/ds', team: 'Acme DS', canManage: true, members: [], ...x });

describe('who sees the Danger zone', () => {
  afterEach(() => {
    people = null;
  });
  it('an admin of a real team sees Disconnect this team from Bridge', () => {
    people = real();
    render(createElement(DeleteTeamBand));
    expect(screen.getByRole('heading', { name: 'Danger zone' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Disconnect this team' })).toBeTruthy();
  });
  it('a member who is not admin, the sample team and an unread team see nothing', () => {
    for (const p of [real({ canManage: false }), real({ context: 'sample' }), null]) {
      people = p;
      const { container, unmount } = render(createElement(DeleteTeamBand));
      expect(container.innerHTML).toBe('');
      unmount();
    }
  });
});

describe('the confirm dialog', () => {
  beforeEach(() => {
    deleteTeam.mockReset();
    leave.to = vi.fn();
  });

  it('a team made in Bridge: Delete stays off until the exact name is typed, then goes to the next place', async () => {
    deleteTeam.mockResolvedValue({ kind: 'team', next: '/studio/acme/other/' });
    render(createElement(DeleteTeamRow, { team: '_team/00112233aabbccdd', name: "Florian's workspace" }));
    await userEvent.click(screen.getByRole('button', { name: 'Delete this team' }));
    const dialog = await screen.findByRole('dialog', { name: "Delete Florian's workspace?" });
    const confirm = () => dialog.querySelector<HTMLButtonElement>('button[type="submit"]')!;
    expect(confirm().disabled).toBe(true);
    const field = screen.getByLabelText("Type Florian's workspace to confirm");
    await userEvent.type(field, "florian's workspace");
    expect(confirm().disabled).toBe(true);
    await userEvent.clear(field);
    await userEvent.type(field, "Florian's workspace");
    expect(confirm().disabled).toBe(false);
    await userEvent.click(confirm());
    await waitFor(() => expect(leave.to).toHaveBeenCalledWith('/studio/acme/other/'));
    expect(deleteTeam).toHaveBeenCalledWith('_team/00112233aabbccdd');
  });

  it('a repository team says the repository stays on GitHub, and a refusal is said in the dialog', async () => {
    deleteTeam.mockRejectedValue(new Error('Only admins of this team can do this. Ask an admin of the team to make you one.'));
    render(createElement(DeleteTeamRow, { team: 'acme/ds', name: 'Acme DS' }));
    await userEvent.click(screen.getByRole('button', { name: 'Disconnect this team' }));
    const dialog = await screen.findByRole('dialog', { name: 'Disconnect Acme DS from Bridge?' });
    expect(dialog.textContent).toContain('stay on GitHub');
    expect(screen.getByRole('link', { name: DELETE_TEAM_WORDS.githubLink }).getAttribute('href')).toBe('https://github.com/acme/ds/settings/installations');
    await userEvent.type(screen.getByLabelText('Type Acme DS to confirm'), 'Acme DS');
    await userEvent.click(dialog.querySelector<HTMLButtonElement>('button[type="submit"]')!);
    expect(await screen.findByText(/Only admins of this team can do this/)).toBeTruthy();
    expect(leave.to).not.toHaveBeenCalled();
  });
});

describe('rules and words', () => {
  it('matches the exact name only', () => {
    expect(confirmMatches('  Acme DS ', 'Acme DS')).toBe(true);
    expect(confirmMatches('acme ds', 'Acme DS')).toBe(false);
    expect(confirmMatches('', '')).toBe(false);
  });
  it('a team key is deleted, a repository is disconnected', () => {
    expect(deleteKindOf('_team/00112233aabbccdd')).toBe('team');
    expect(deleteKindOf('acme/ds')).toBe('repository');
    expect(githubAppsHref('acme/ds')).toBe('https://github.com/acme/ds/settings/installations');
  });
  it('no em dash anywhere', () => {
    const all = JSON.stringify(DELETE_TEAM_WORDS) + DELETE_TEAM_WORDS.title.team('X') + DELETE_TEAM_WORDS.title.repository('X') + DELETE_TEAM_WORDS.confirmLabel('X');
    expect(all).not.toMatch(/—/);
  });
});
