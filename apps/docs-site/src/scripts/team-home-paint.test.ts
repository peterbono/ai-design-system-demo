// @vitest-environment jsdom
// The team home paints at once, whatever the design system read does: the greeting and join requests stay on screen
// while it reads, and when it fails, the failure shows under them.
import { act } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const s = vi.hoisted(() => ({ team: null as null | (() => Promise<unknown>), loadHome: vi.fn() }));

vi.mock('./team-data', () => ({ loadTeamData: () => s.team!(), resetTeamData: () => undefined, teamOfPage: () => ({ owner: 'acme', repo: 'product' }), onTeamProgress: () => () => undefined }));
vi.mock('./github-session', () => ({
  currentAccess: () => ({ state: 'admin', write: true, admin: true }),
  currentContributor: () => null,
  currentViewer: () => ({ login: 'sam', avatar_url: '', name: 'Sam Rivera' }),
  getToken: () => 'gho_x',
  prefersSignIn: () => true,
  onAccess: () => undefined,
  initGitHubConnect: (fn: () => void) => fn(),
}));
vi.mock('./home-data', () => ({ loadHome: s.loadHome }));
vi.mock('./shell', () => ({ setReviewCount: () => undefined }));
vi.mock('./needs-you', () => ({ rememberMine: () => undefined }));
vi.mock('./demo-home', () => ({ loadDemoHome: () => undefined }));

import { initTeamHome } from './team-home';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function mount() {
  document.body.innerHTML = '<div data-src></div><div data-home></div><div data-ds></div>';
  const q = (sel: string) => document.querySelector<HTMLElement>(sel)!;
  return { home: q('[data-home]'), ds: q('[data-ds]'), src: q('[data-src]') };
}

beforeEach(() => {
  s.loadHome.mockReset();
  // GitHub has not answered for the branches; the request is Bridge's own.
  s.loadHome.mockImplementation((_stat, onUpdate) => onUpdate({ viewer: 'sam', loading: true, settled: false, failed: null, needs: [], branches: [], decisions: 0, reviewer: true }));
});

describe('initTeamHome', () => {
  it('paints the greeting before the design system is read', async () => {
    s.team = () => new Promise(() => undefined);
    const { home, ds } = mount();
    await act(async () => initTeamHome(home, null, ds));
    expect(home.textContent).toMatch(/Sam/);
    expect(s.loadHome).toHaveBeenCalled();
    expect(ds.querySelector('[aria-busy="true"]')).not.toBeNull();
  });

  it('keeps the home on screen and shows the failure under it when the read fails', async () => {
    s.team = () => Promise.reject(Object.assign(new Error('API rate limit exceeded'), { status: 429 }));
    const { home, ds } = mount();
    await act(async () => initTeamHome(home, null, ds));
    await act(async () => undefined);
    expect(home.textContent).toMatch(/Sam/);
    expect(ds.textContent).toMatch(/Try again/);
  });
});
