// @vitest-environment jsdom
// Being built opened directly on a team shell (a fresh load, no other Studio page first): it reads the team's settings
// itself before it reads the product repositories, so the explorations handed to a product's developers show (prod,
// 2026-11-05: the list was empty for Art print shop until another page had loaded the team).
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProductConfig } from '@bridge-ds/core';

const SHOP: ProductConfig = { key: 'admin-app', name: 'Art print shop', repo: 'acme/shop', design: { repo: 'acme/shop-design' } };
const LIBRARY: ProductConfig = { key: 'library', name: 'Library', path: 'packages', default: true };

const block = (o: Record<string, unknown>) => `<!-- bridge-exploration ${JSON.stringify(o)} -->`;
const handedOff = {
  number: 1,
  title: 'Exploration: Dashboard, orders waiting to ship',
  state: 'open',
  draft: true,
  labels: [{ name: 'ready-for-devs' }, { name: 'product: admin-app' }],
  head: { ref: 'explore/dashboard', sha: 'abc' },
  base: { ref: 'main' },
  body: block({ name: 'Dashboard: orders waiting to ship', slug: 'dashboard', doneAt: '2026-10-31T00:45:36Z', doneBy: 'sam' }),
  user: { login: 'sam' },
  created_at: '2026-10-30T17:19:26Z',
  updated_at: '2026-10-31T00:45:36Z',
  repo: 'acme/shop-design',
  product: 'admin-app',
};

const s = vi.hoisted(() => ({ hosted: true, teamLoaded: false, teamLoads: 0 }));

vi.mock('../lib/team-path', async (orig) => ({ ...(await orig<typeof import('../lib/team-path')>()), isHosted: () => s.hosted }));
vi.mock('./team-data', () => ({
  loadTeamData: async () => {
    s.teamLoads += 1;
    s.teamLoaded = true;
    return {};
  },
}));
// The team's products are known only once the team is read, as siteConfig() on a team shell.
vi.mock('./product-repos', () => ({
  configuredProducts: () => (s.teamLoaded ? [SHOP, LIBRARY] : [LIBRARY]),
  productPulls: async () => (s.teamLoaded ? [handedOff] : []),
}));
vi.mock('./repo-context', () => ({ siteConfig: () => (s.teamLoaded ? { products: [SHOP, LIBRARY] } : {}) }));
vi.mock('./github-session', () => ({
  currentAccess: () => null,
  currentContributor: () => null,
  currentViewer: () => ({ login: 'sam', avatar_url: '' }),
  hasWorkingToken: () => true,
  readRepo: () => ({ owner: 'acme', repo: 'ds', defaultBranch: 'main' }),
  ghGet: async () => ({ data: [], stale: false }),
}));
vi.mock('./connector-api', () => ({ listFixSessions: async () => [] }));
vi.mock('./design-task', () => ({ readDesignTask: async () => null }));
vi.mock('./next-release', () => ({ libraryScope: () => ({}) }));
vi.mock('./review-reads', () => ({ readReviews: async () => new Map() }));
vi.mock('./teams', () => ({ siteApprovers: () => ({ design: [], tech: [] }) }));
vi.mock('./preview-shots', () => ({ previewShotOf: async () => null }));
vi.mock('./people', () => ({ knownNames: () => ({}), lookUpNames: async () => ({}) }));

import { loadBuildData } from './building-data';

beforeEach(() => {
  s.hosted = true;
  s.teamLoaded = false;
  s.teamLoads = 0;
  sessionStorage.clear();
});

describe('Being built on a fresh load', () => {
  it('a team shell reads the team first: the product’s handed-off exploration is listed', async () => {
    const d = await loadBuildData({ fresh: true });
    expect(s.teamLoads).toBe(1);
    expect(d.explorations?.map((x) => [x.exploration.product, x.status])).toEqual([['Art print shop', 'requested']]);
  });

  it('a self-hosted page has its settings embedded: no team read', async () => {
    s.hosted = false;
    s.teamLoaded = true;
    await loadBuildData({ fresh: true });
    expect(s.teamLoads).toBe(0);
  });
});
