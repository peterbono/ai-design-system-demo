// @vitest-environment jsdom
// Settings > General of a team made in Bridge (no repository yet, TeamKeySettings.tsx TeamKeyName): an admin renames
// the team in place (api/entry rename-team), a member reads the name.
import '../../../../../../packages/react/src/test/setup';
import { createElement } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { expectNoAxeViolations } from '../../../../../../packages/react/src/test/axe';
import type { TeamInfo } from '../../../lib/entry';
import { TeamKeyName } from './TeamKeySettings';

const calls = vi.hoisted(() => ({ renamed: [] as [string, string][] }));

vi.mock('../../../scripts/entry-session', () => ({
  renameTeam: async (key: string, name: string) => {
    calls.renamed.push([key, name]);
    return { ...team('admin'), name };
  },
}));

const team = (role: 'admin' | 'edit'): TeamInfo => ({
  id: 'c0ffee0000000017',
  key: '_team/c0ffee0000000017',
  name: 'Northwind Design',
  role,
  repo: null,
  storybook: null,
  discovery: null,
  memberCount: 2,
  people: [],
});

beforeEach(() => {
  calls.renamed = [];
});

describe('TeamKeyName', () => {
  it('lets an admin rename the team, Save on the same row', async () => {
    const user = userEvent.setup();
    const onRenamed = vi.fn();
    const { container } = render(createElement(TeamKeyName, { team: team('admin'), onRenamed }));
    const field = screen.getByRole('textbox', { name: 'Team name' });
    const save = screen.getByRole('button', { name: 'Save' });
    expect(save).toBeDisabled();
    await user.clear(field);
    await user.type(field, '  Northwind   Studio ');
    await user.click(save);
    await waitFor(() => expect(calls.renamed).toEqual([['_team/c0ffee0000000017', 'Northwind Studio']]));
    expect(await screen.findByRole('status')).toHaveTextContent('Saved.');
    expect(onRenamed).toHaveBeenCalledWith(expect.objectContaining({ name: 'Northwind Studio' }));
    await expectNoAxeViolations(container);
  });

  it('says what is wrong with an empty name and sends nothing', async () => {
    const user = userEvent.setup();
    render(createElement(TeamKeyName, { team: team('admin') }));
    await user.clear(screen.getByRole('textbox', { name: 'Team name' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Type a name for your team.')).toBeInTheDocument();
    expect(calls.renamed).toEqual([]);
  });

  it('shows a member the name, with nothing to edit', () => {
    render(createElement(TeamKeyName, { team: team('edit') }));
    expect(screen.getByText('Northwind Design')).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
  });
});
