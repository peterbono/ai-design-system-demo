// @vitest-environment jsdom
// Settings on a team shell: the owner exception reads once, in designer words.
import '../../../../../../packages/react/src/test/setup';
import { createElement } from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const site = {
  owners: { design: ['sam'], tech: ['sam'] },
  rights: null,
  changes: 'suggest',
  soloOwnerCanApproveBoth: true,
  override: { allowed: ['sam'], requireReason: true, minReasonLength: 20 },
  visualImpact: { mode: 'auto' },
  defaultBranch: 'main',
};

vi.mock('./TeamState', () => ({
  useTeamData: () => ({
    load: { status: 'ready', data: { owner: 'acme', repo: 'acme-product', model: { site, config: { governance: { protectedBranches: ['main'], branchPrefix: '' } }, tokens: { root: 'tokens' } } } },
    retry: () => {},
  }),
  TeamLoadError: () => null,
  TeamLoadProgress: () => null,
}));
vi.mock('./members-state', () => ({
  useTeamPeople: () => ({ members: [{ login: 'sam', name: 'Sam Rivera', role: 'admin', reviews: ['design', 'tech'] }] }),
}));
vi.mock('./SettingsParts', () => ({
  AdminOnlyNote: () => null,
  Code: ({ children }: { children: unknown }) => createElement('code', null, children as never),
  DevFold: () => null,
}));
vi.mock('../../../scripts/people', () => ({ knownNames: () => new Map() }));

const { default: TeamSettings } = await import('./TeamSettings');

describe('TeamSettings', () => {
  it('shows the owner exception once, by name', () => {
    render(createElement(TeamSettings));
    expect(screen.getAllByText('Exception')).toHaveLength(1);
    expect(screen.getByText('Sam Rivera, with a written reason of at least 20 characters.')).toBeInTheDocument();
  });
});
