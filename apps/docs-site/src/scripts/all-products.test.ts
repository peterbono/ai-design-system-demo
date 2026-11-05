// @vitest-environment jsdom
// All products counts with the one status Home and the product page use (lib/exploration-state): a design copy
// exploration whose developers' task was closed as done is Shipped, never "waiting to be picked up" (prod, 2026-11-05:
// the Art print shop row said "2 waiting to be picked up" while Home and its cards said one).
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProductConfig } from '@bridge-ds/core';
import type { LifecycleStage } from '../lib/review-state';
import { folderLine } from '../lib/product-page';

const SHOP: ProductConfig = { key: 'admin-app', name: 'Art print shop', repo: 'acme/shop', design: { repo: 'acme/shop-design' } };
const TASK_DONE = 'https://github.com/acme/shop/issues/12';
const TASK_OPEN = 'https://github.com/acme/shop/issues/7';

const block = (o: Record<string, unknown>) => `<!-- bridge-exploration ${JSON.stringify(o)} -->`;
const handedOff = (number: number, task: string, extra: Record<string, unknown> = {}) => ({
  number,
  title: `Exploration: ${number}`,
  state: 'open',
  draft: true,
  labels: [{ name: 'ready-for-devs' }, { name: 'product: admin-app' }],
  head: { ref: `explore/x-${number}`, sha: `sha${number}` },
  base: { ref: 'main' },
  body: block({ name: `X ${number}`, slug: `x-${number}`, doneAt: '2026-11-02T01:40:45Z', task, ...extra }),
  user: { login: 'sam' },
  updated_at: '2026-11-02T02:00:00Z',
  repo: 'acme/shop-design',
  product: 'admin-app',
});

const s = vi.hoisted(() => ({
  stages: new Map<string, LifecycleStage>(),
  productPulls: [] as unknown[],
}));

vi.mock('./github-session', () => ({
  currentViewer: () => ({ login: 'sam', avatar_url: '' }),
  currentContributor: () => null,
  readRepo: () => ({ owner: 'acme', repo: 'ds', defaultBranch: 'main' }),
  ghGet: async () => ({ data: [] }),
}));
vi.mock('./repo-context', () => ({ repoContext: () => ({ owner: 'acme', repo: 'ds', defaultBranch: 'main', hosted: false }) }));
vi.mock('./product-repos', () => ({
  configuredProducts: () => [SHOP, { key: 'library', name: 'Library', path: 'packages', default: true }],
  productPulls: async () => s.productPulls,
}));
vi.mock('./design-task', () => ({
  designTaskStages: async () => s.stages,
  taskUrlOf: (body: string | null | undefined) => /"task":"([^"]+)"/.exec(body ?? '')?.[1] ?? null,
}));

import { readAllProducts } from './all-products';

beforeEach(() => {
  s.stages = new Map();
  s.productPulls = [handedOff(1, TASK_OPEN), handedOff(4, TASK_DONE, { member: 'm-dino' })];
});

describe('readAllProducts status', () => {
  it('a task closed as done reads Shipped, as on Home: one waiting, not two', async () => {
    s.stages = new Map<string, LifecycleStage>([
      [TASK_OPEN, 'waiting-for-code'],
      [TASK_DONE, 'shipped'],
    ]);
    const read = await readAllProducts();
    const byNumber = Object.fromEntries(read!.cards.map((c) => [c.number, c.lifecycle]));
    expect(byNumber).toEqual({ 1: 'waiting-for-code', 4: 'shipped' });
    expect(folderLine(read!.cards)).toBe('1 waiting to be picked up');
  });

  it('a task picked up reads Being built', async () => {
    s.stages = new Map<string, LifecycleStage>([[TASK_OPEN, 'being-built']]);
    const read = await readAllProducts();
    expect(read!.cards.find((c) => c.number === 1)?.lifecycle).toBe('being-built');
  });

  it('tasks not read yet: the pull request alone says where it stands', async () => {
    const read = await readAllProducts();
    expect(read!.cards.map((c) => c.lifecycle)).toEqual(['waiting-for-code', 'waiting-for-code']);
  });

  it('counts the whole team, the viewer’s own marked (Home’s sentence counts only those)', async () => {
    const read = await readAllProducts();
    expect(read!.cards.map((c) => [c.number, c.own])).toEqual(expect.arrayContaining([[1, true], [4, false]]));
  });
});
