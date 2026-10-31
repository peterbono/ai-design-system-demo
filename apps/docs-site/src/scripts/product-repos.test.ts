// The product repositories' read must follow the team's settings: a read made before they arrived (no product
// repository yet) must not stand for the team's own (the team Home showed no exploration and "Nothing in progress").
import { beforeEach, describe, expect, it, vi } from 'vitest';

const s = vi.hoisted(() => ({ site: {} as Record<string, unknown>, paths: [] as string[] }));

vi.mock('./repo-context', () => ({ siteConfig: () => s.site }));
vi.mock('./exploration-start', () => ({ explorationsConfig: () => ({ owner: 'acme', repo: 'ds', defaultBranch: 'main', apps: {}, packages: [] }) }));
vi.mock('./github-session', () => ({
  getToken: () => null,
  readRepo: () => ({ owner: 'acme', repo: 'ds', defaultBranch: 'main' }),
  studioClient: () => null,
  ghGet: async (path: string) => {
    s.paths.push(path);
    return { data: [{ number: 7, title: 'Exploration: Dashboard', state: 'open', draft: true, labels: [{ name: 'exploration' }], head: { ref: 'explore/dashboard', sha: 'abc' }, base: { ref: 'main' }, body: '', user: { login: 'dana' }, updated_at: '2026-10-31T10:00:00Z', html_url: 'https://github.com/acme/shop/pull/7' }] };
  },
}));

import { productPulls } from './product-repos';

describe('product repositories read', () => {
  beforeEach(() => {
    s.paths = [];
  });

  it('reads again once the team settings name a product repository', async () => {
    s.site = { products: [{ key: 'library', name: 'Library', path: 'packages', default: true }] };
    expect(await productPulls()).toEqual([]);
    s.site = { products: [{ key: 'shop', name: 'Art print shop', repo: 'acme/shop' }, { key: 'library', name: 'Library', path: 'packages', default: true }] };
    const after = await productPulls();
    expect(after.map((p) => [p.product, p.number])).toEqual([['shop', 7]]);
    expect(s.paths.some((p) => p.includes('acme/shop'))).toBe(true);
    // The same products: read once.
    await productPulls();
    expect(s.paths.filter((p) => p.includes('acme/shop'))).toHaveLength(1);
  });
});
