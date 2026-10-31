import { describe, expect, it } from 'vitest';
import { buildIndex, crawlTargets, isOpenExploration, labelledProduct, libraryApp, PRUNE_AFTER_MS, pruneDecision, shotDecision, shotKey, shotPaths } from './preview-shots.mjs';

const pull = (o = {}) => ({ number: 2, state: 'open', labels: [], head: { ref: 'feat/x', sha: 'a1' }, body: '', ...o });

describe('preview-shots: which pull requests', () => {
  it('captures open explorations, by label, explore/* branch, Bridge block or after Done exploring', () => {
    expect(isOpenExploration(pull({ labels: [{ name: 'exploration' }] }))).toBe(true);
    expect(isOpenExploration(pull({ head: { ref: 'explore/pill-buttons', sha: 'a1' } }))).toBe(true);
    expect(isOpenExploration(pull({ body: 'x <!-- bridge-exploration {"name":"Pills"} -->' }))).toBe(true);
    expect(isOpenExploration(pull({ labels: ['ready-for-devs', 'product: admin-app'] }))).toBe(true);
  });

  it('leaves out plain branches, archived and closed explorations', () => {
    expect(isOpenExploration(pull())).toBe(false);
    expect(isOpenExploration(pull({ labels: ['exploration', 'archived'] }))).toBe(false);
    expect(isOpenExploration(pull({ state: 'closed', labels: ['exploration'] }))).toBe(false);
  });
});

describe('preview-shots: where and when', () => {
  it('stores one image and one json per pull request, keyed in lower case', () => {
    expect(shotPaths('peterbono/Bridge-Product-Admin', 2)).toEqual({ image: 'peterbono/bridge-product-admin/2.webp', meta: 'peterbono/bridge-product-admin/2.json' });
    expect(shotKey('peterbono/Bridge-Product-Admin', 2)).toBe('peterbono/bridge-product-admin#2');
  });

  it('skips a head commit already captured, retries a new one, stops after three failures', () => {
    expect(shotDecision({ sha: 'a1', stored: { sha: 'a1', image: 'x.webp' } }).action).toBe('skip');
    expect(shotDecision({ sha: 'b2', stored: { sha: 'a1', image: 'x.webp' } }).action).toBe('capture');
    expect(shotDecision({ sha: 'a1', stored: { sha: 'a1', image: 'x.webp' }, force: true }).action).toBe('capture');
    expect(shotDecision({ sha: 'a1', stored: { failed: { sha: 'a1', tries: 3 } } }).action).toBe('skip');
    expect(shotDecision({ sha: 'a1', stored: { failed: { sha: 'a1', tries: 2 } } }).action).toBe('capture');
    expect(shotDecision({ sha: 'a1', stored: null }).action).toBe('capture');
  });

  it('keeps shipped captures, removes the ones closed without merging after 30 days', () => {
    const now = Date.parse('2026-12-01T00:00:00Z');
    const at = (ms) => new Date(now - ms).toISOString();
    expect(pruneDecision({ closed: { at: at(PRUNE_AFTER_MS + 1000), merged: true } }, now)).toBe('keep');
    expect(pruneDecision({ closed: { at: at(PRUNE_AFTER_MS + 1000), merged: false } }, now)).toBe('remove');
    expect(pruneDecision({ closed: { at: at(PRUNE_AFTER_MS - 1000), merged: false } }, now)).toBe('keep');
    expect(pruneDecision({}, now)).toBe('keep');
  });
});

describe('preview-shots: which preview', () => {
  const apps = { docs: 'https://d-git-{branch}.app', storybook: 'https://s-git-{branch}.app', admin: 'https://a-git-{branch}.app' };
  it('picks the library app from the files, docs by default', () => {
    expect(libraryApp(['apps/admin/src/App.tsx'], apps)).toBe('admin');
    expect(libraryApp(['packages/react/src/components/Button/Button.tsx'], apps)).toBe('storybook');
    expect(libraryApp(['.bridge/explorations/x.md'], apps)).toBe('docs');
    expect(libraryApp([], {})).toBe(null);
  });

  it('reads the product a label names, never the library', () => {
    const products = [{ key: 'admin', name: 'Admin demo' }, { key: 'library', name: 'Library', default: true }];
    expect(labelledProduct(pull({ labels: ['product: admin'] }), products)?.key).toBe('admin');
    expect(labelledProduct(pull({ labels: ['product: library'] }), products)).toBe(null);
    expect(labelledProduct(pull(), products)).toBe(null);
  });

  it('opens same-origin pages only, once each, without files or the root', () => {
    const o = 'https://p.vercel.app';
    expect(crawlTargets(['/', '/orders', '/orders/', 'https://evil.example/x', '/logo.svg', '#top', '/customers?tab=all', 'mailto:a@b.c'], o)).toEqual([`${o}/orders`, `${o}/customers?tab=all`]);
    expect(crawlTargets(['/a', '/b', '/c'], o, 2)).toHaveLength(2);
  });
});

describe('preview-shots: index.json', () => {
  it('lists captures with an image only, in a stable order', () => {
    const idx = buildIndex([
      { repo: 'peterbono/zeta', pr: 1, sha: 's1', capturedAt: '2026-10-31T10:00:00Z', image: 'peterbono/zeta/1.webp', route: '/', url: 'https://z.app/' },
      { repo: 'peterbono/alpha', pr: 9, failed: { sha: 's9', tries: 1 } },
      { repo: 'peterbono/alpha', pr: 3, sha: 's3', capturedAt: '2026-10-31T09:00:00Z', image: 'peterbono/alpha/3.webp', screen: 'Orders alert', closed: { at: '2026-10-30T00:00:00Z', merged: true } },
    ]);
    expect(Object.keys(idx.shots)).toEqual(['peterbono/alpha#3', 'peterbono/zeta#1']);
    expect(idx.shots['peterbono/alpha#3']).toMatchObject({ sha: 's3', screen: 'Orders alert', closed: { merged: true } });
    expect(idx.version).toBe(1);
  });
});
