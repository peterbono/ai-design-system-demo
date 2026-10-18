import { describe, expect, it } from 'vitest';
import { productPreview, topScreen, tryInProductUrl } from './try-in-product';
import type { VisualShot } from './visual-impact';

const apps = {
  docs: 'https://bridge-docs-git-{branch}-peterbonos-projects.vercel.app',
  admin: 'https://bridge-admin-git-{branch}-peterbonos-projects.vercel.app',
};
const ctx = { branch: 'tokens/color-bg-default-20261018-1348', pr: 101, sha: 'ae2539a' };
const ADMIN = 'bridge-admin-git-tokens-color-bg-def-b58ff0-peterbonos-projects.vercel.app';
const vercelComment = (projects: { name: string; previewUrl: string; nextCommitStatus: string }[]) =>
  `[vc]: #abc:${Buffer.from(JSON.stringify({ projects })).toString('base64')}\nThe latest updates on your projects.`;

describe('productPreview', () => {
  it('uses the URL the Vercel bot comment reports for the admin', () => {
    const comments = [{ body: vercelComment([{ name: 'bridge-admin', previewUrl: ADMIN, nextCommitStatus: 'DEPLOYED' }]) }];
    expect(productPreview(apps, ctx, { comments })).toBe(`https://${ADMIN}/`);
  });

  it('never falls back to the config template, and skips failed builds and forks', () => {
    // The template fits in 63 characters for a short branch, but nothing reported it: no button.
    expect(productPreview(apps, { ...ctx, branch: 'x' }, {})).toBeNull();
    const failed = [{ body: vercelComment([{ name: 'bridge-admin', previewUrl: ADMIN, nextCommitStatus: 'FAILED' }]) }];
    expect(productPreview(apps, ctx, { comments: failed })).toBeNull();
    const ok = [{ body: vercelComment([{ name: 'bridge-admin', previewUrl: ADMIN, nextCommitStatus: 'DEPLOYED' }]) }];
    expect(productPreview(apps, { ...ctx, fromFork: true }, { comments: ok })).toBeNull();
    expect(productPreview({ docs: apps.docs }, ctx, { comments: ok })).toBeNull();
  });

  it('ignores a status that only points at the Vercel inspector', () => {
    const statuses = [{ context: 'Vercel – bridge-admin', state: 'success', target_url: 'https://vercel.com/peterbonos-projects/bridge-admin/6HB9' }];
    expect(productPreview(apps, ctx, { statuses })).toBeNull();
  });
});

const shot = (o: Partial<VisualShot>): VisualShot => ({
  key: 'k',
  kind: 'route',
  label: 'Orders list',
  route: '/orders',
  tenant: 'northwind',
  brand: 'bridge',
  theme: 'light',
  status: 'changed',
  percent: 10,
  boxes: [],
  size: { before: null, after: null },
  images: {},
  ...o,
});

describe('topScreen', () => {
  it('picks the admin screen that changes most, never a component example', () => {
    const top = topScreen([
      shot({ kind: 'story', label: 'Data display/Divider: All States', route: undefined, tenant: undefined, percent: 99.34 }),
      shot({ label: 'Dashboard', route: '/', percent: 20.43 }),
      shot({ label: 'Order edit', route: '/orders/12', percent: 30.21 }),
      shot({ label: 'Customers', route: '/customers', status: 'unchanged', percent: 0 }),
    ]);
    expect(top).toEqual({ label: 'Order edit', route: '/orders/12', tenant: 'northwind', theme: 'light' });
  });

  it('is null when no admin screen changes', () => {
    expect(topScreen([shot({ status: 'unchanged', percent: 0 })])).toBeNull();
    expect(topScreen(null)).toBeNull();
  });
});

describe('tryInProductUrl', () => {
  it('opens the screen with the toolbar on, in its shop and theme', () => {
    expect(tryInProductUrl(`https://${ADMIN}/`, 101, { label: 'Order edit', route: '/orders/12', tenant: 'northwind', theme: 'light' })).toBe(
      `https://${ADMIN}/?bridge=101&tenant=northwind&theme=light#/orders/12`,
    );
  });

  it('opens the home without a screen', () => {
    expect(tryInProductUrl(`https://${ADMIN}/some/path?x=1#y`, 101, null)).toBe(`https://${ADMIN}/?bridge=101`);
  });
});
