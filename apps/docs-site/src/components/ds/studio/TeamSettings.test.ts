// @vitest-environment jsdom
// Settings on a team shell: the owner exception reads once, in designer words; the sample team names its sample
// members (the same as Members), never the repository's accounts; token values from Figma never wait for a reviewer.
import '../../../../../../packages/react/src/test/setup';
import { createElement } from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const site: Record<string, unknown> = {
  owners: { design: ['sam'], tech: ['sam'] },
  rights: null,
  changes: 'suggest',
  soloOwnerCanApproveBoth: true,
  override: { allowed: ['sam'], requireReason: true, minReasonLength: 20 },
  visualImpact: { mode: 'auto' },
  defaultBranch: 'main',
};

const at = { owner: 'acme', repo: 'acme-product', site };

vi.mock('./TeamState', () => ({
  useTeamData: () => ({
    load: { status: 'ready', data: { owner: at.owner, repo: at.repo, model: { site: at.site, config: { governance: { protectedBranches: ['main'], branchPrefix: '' } }, tokens: { root: 'tokens' } } } },
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
vi.mock('./faces', () => ({ Who: ({ p }: { p: { login: string } }) => createElement('i', { 'data-face': p.login }) }));
vi.mock('../../../scripts/people', () => ({ knownNames: () => new Map() }));

const { default: TeamSettings } = await import('./TeamSettings');

// The sample team's repository, as its real config might say it: its real account owns everything, merging is tech's.
const sampleSite = {
  ...site,
  owners: { design: ['peterbono'], tech: ['peterbono'] },
  rights: { approveDesign: ['design'], approveTech: ['tech'], ship: ['tech'] },
  override: { allowed: ['peterbono'], requireReason: true, minReasonLength: 20 },
  demo: { viewer: 'Dana' },
};

describe('TeamSettings', () => {
  it('shows the owner exception once, by name', () => {
    render(createElement(TeamSettings));
    expect(screen.getAllByText('Exception')).toHaveLength(1);
    expect(screen.getByText('Sam Rivera, with a written reason of at least 20 characters.')).toBeInTheDocument();
  });

  it('says token values from Figma ship on the automatic checks', () => {
    render(createElement(TeamSettings));
    expect(screen.getByText('Token values from Figma')).toBeInTheDocument();
    expect(screen.getByText('Ship once the automatic checks pass.')).toBeInTheDocument();
    expect(screen.getByText('Nobody needs to approve them. A renamed or removed token waits for a code check.')).toBeInTheDocument();
  });

  it('on the sample team, names the members who review, as Members does, never the repository account', () => {
    Object.assign(at, { owner: 'peterbono', repo: 'bridge-demo-ds', site: sampleSite });
    try {
      const { container } = render(createElement(TeamSettings));
      const row = (label: string) => screen.getByText(label).closest('.set-row')!;
      const names = (label: string) => [...row(label).querySelectorAll('.set-owner')].map((o) => o.textContent);
      expect(names('Checks the look')).toEqual(['Dana', 'Ann']);
      expect(names('Checks the code')).toEqual(['Malik']);
      expect(names('Adds it to the library')).toEqual(['Malik']);
      // The faces are the sample members' own, seeded by the logins Members uses.
      expect([...row('Checks the look').querySelectorAll('[data-face]')].map((f) => f.getAttribute('data-face'))).toEqual(['~dana', '~ann-leroy']);
      expect(screen.queryByText('Only owner')).toBeNull();
      expect(screen.getByText('Dana, with a written reason of at least 20 characters.')).toBeInTheDocument();
      expect(screen.getByText('Token values from Figma')).toBeInTheDocument();
      expect(container.textContent).not.toMatch(/peterbono/);
    } finally {
      Object.assign(at, { owner: 'acme', repo: 'acme-product', site });
    }
  });
});
