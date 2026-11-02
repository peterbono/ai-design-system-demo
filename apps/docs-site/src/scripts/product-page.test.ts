// @vitest-environment jsdom
// A product page while GitHub is busy for the viewer: a wait with when Bridge is back, never "Product not found", "Make
// my copy", "cannot reach the product" or an empty list; the explorations as last read stay.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GitHubError, type ProductConfig } from '@bridge-ds/core';
import type { CopyView } from '../lib/design-copy';

const AT = new Date('2026-11-02T12:52:00Z');
const ADMIN: ProductConfig = { key: 'admin-app', name: 'Product admin', repo: 'acme/product-admin', design: { repo: 'acme/product-admin-design' } };

const s = vi.hoisted(() => ({
  products: [] as ProductConfig[],
  pulls: (() => Promise.reject(new Error('not in this test'))) as (path: string) => Promise<unknown>,
  copy: null as CopyView | null,
}));

vi.mock('./github-session', () => ({
  currentViewer: () => ({ login: 'sam', avatar_url: '' }),
  readRepo: () => ({ owner: 'acme', repo: 'ds', defaultBranch: 'main' }),
  ghGet: (path: string) => s.pulls(path),
}));
vi.mock('./product-repos', () => ({
  configuredProducts: () => s.products,
  productRepoByKey: (key: string) => {
    const p = s.products.find((x) => x.key === key);
    return p?.repo ? { product: p, repo: p.repo } : null;
  },
}));
vi.mock('./design-copy', () => ({
  copyRepos: (p: ProductConfig | null) => (p?.design ? { copy: 'acme/product-admin-design', code: 'acme/product-admin' } : null),
  readCopyView: async () => s.copy,
}));
vi.mock('./design-task', () => ({ designTaskStages: async () => new Map(), taskUrlOf: () => null }));
vi.mock('./home-data', () => ({ personOf: async (login: string, avatar: string) => ({ login, name: login, avatar }) }));
vi.mock('./preview-shots', () => ({ previewShotOf: async () => null }));

import { loadProductPage, type ProductPageData } from './product-page';

const busyError = () => Object.assign(new Error('GitHub rate limit reached'), { resetAt: AT, signedIn: true });

async function load(key = 'admin-app', opts?: Parameters<typeof loadProductPage>[2]): Promise<ProductPageData> {
  const seen: ProductPageData[] = [];
  await loadProductPage(key, (d) => seen.push(d), opts);
  return seen.at(-1)!;
}

beforeEach(() => {
  s.products = [ADMIN, { key: 'library', name: 'Library', default: true }];
  s.copy = { kind: 'ready', behind: 0 };
  s.pulls = () => Promise.reject(new Error('not in this test'));
});

describe('loadProductPage while GitHub is busy', () => {
  it('the team’s list never read (busy): a wait, not a missing product', async () => {
    s.products = [{ key: 'library', name: 'Library', default: true }];
    const d = await load('admin-app', { teamBusy: { resetsAt: AT, source: 'github' } });
    expect(d.product).toBeNull();
    expect(d.loading).toBe(false);
    expect(d.busy).toEqual({ resetsAt: AT, source: 'github' });
  });

  it('a product missing from a list that was read stays "not found" (no wait)', async () => {
    const d = await load('nope');
    expect(d.product).toBeNull();
    expect(d.busy).toBeNull();
  });

  it('the copy cannot be read (busy): no "Make my copy", the wait instead', async () => {
    s.copy = { kind: 'busy', busy: { resetsAt: AT, source: 'github' } };
    s.pulls = () => Promise.reject(busyError());
    const d = await load();
    expect(d.copy).toBeNull();
    expect(d.busy).toEqual({ resetsAt: AT, source: 'github' });
    expect(d.failed).toBeNull();
    expect(d.cards).toEqual([]);
  });

  it('the explorations cannot be read (busy): a wait, never "cannot reach the product"', async () => {
    s.copy = { kind: 'ready', behind: 0 };
    s.pulls = () => Promise.reject(busyError());
    const d = await load();
    expect(d.reached).toBeNull();
    expect(d.failed).toBeNull();
    expect(d.busy).toEqual({ resetsAt: AT, source: 'github' });
  });

  it('a 403 in GitHub’s limit words is a wait too, not an unreachable repository', async () => {
    s.copy = { kind: 'ready', behind: 0 };
    s.pulls = () => Promise.reject(new GitHubError(403, 'GitHub is limiting requests right now.', 'API rate limit exceeded'));
    const d = await load();
    expect(d.reached).toBeNull();
    expect(d.busy?.source).toBe('github');
  });

  it('keeps the explorations as last read, and says when Bridge is back', async () => {
    s.copy = { kind: 'ready', behind: 0 };
    const pull = { number: 7, title: 'New table', state: 'open', draft: true, body: '', user: { login: 'ann' }, head: { ref: 'explore/admin-app/table', sha: 'a1' }, labels: [{ name: 'exploration' }], updated_at: '2026-11-01T10:00:00Z', created_at: '2026-11-01T10:00:00Z' };
    s.pulls = (path) => (path.includes('state=closed') ? Promise.resolve({ data: [], stale: true, resetAt: AT }) : Promise.resolve({ data: [pull], stale: true, resetAt: AT }));
    const d = await load();
    expect(d.busy).toEqual({ resetsAt: AT, source: 'github' });
    expect(d.reached).toBe(true);
    expect(d.failed).toBeNull();
  });

  it('a product repository Bridge cannot read (not busy) still says so quietly', async () => {
    s.copy = { kind: 'ready', behind: 0 };
    s.pulls = () => Promise.reject(new GitHubError(404, 'Not Found'));
    const d = await load();
    expect(d.reached).toBe(false);
    expect(d.busy).toBeNull();
  });
});
