// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { tryInProductUrl, type ProductConfig } from '@bridge-ds/core';
import type { ExplorationRow } from '../lib/explorations-view';

const BAD_URLS = ['javascript:alert(1)//', ' JaVaScRiPt:alert(1)//', 'data:text/html,<script>alert(1)</script>'];

// The admin preview a comment or a status on the branch reports: any string.
let reported = '';
vi.mock('../lib/explorations-view', async (importOriginal) => {
  const real = await importOriginal<typeof import('../lib/explorations-view')>();
  return { ...real, explorationPreviews: () => [{ app: 'admin', label: 'Admin demo', url: reported, state: 'ready', source: 'comment' }] };
});

// The product repositories this page knows (bridge.config.json products[]): none, unless a test sets one.
let repos: { product: ProductConfig; repo: string }[] = [];
vi.mock('./product-repos', async (importOriginal) => {
  const real = await importOriginal<typeof import('./product-repos')>();
  return { ...real, productRepoByKey: (key: string | null | undefined) => repos.find((x) => x.product.key === key) ?? null };
});

const { atRoute, productPreviewOf, tryUrlOf, withToolbar } = await import('./product-branch');

const r = { number: 9, branch: 'explore/x', headSha: 'abc' } as ExplorationRow;

describe('product branch "Try it in the product" link (rendered by React 18, which keeps javascript: hrefs)', () => {
  it.each(BAD_URLS)('drops a %j preview URL', (url) => {
    reported = url;
    // core tryInProductUrl refuses non-http(s) previews, and product-branch.ts checks the result again.
    expect(tryInProductUrl(url.trim(), 9, null)).toBe('');
    expect(tryUrlOf(r, { comments: [], statuses: [] })).toBeNull();
  });

  it('keeps an https preview', () => {
    reported = 'https://admin-git-x.vercel.app/';
    expect(tryUrlOf(r, { comments: [], statuses: [] })).toBe('https://admin-git-x.vercel.app/?bridge=9');
  });
});

// Exploration #611 (product: admin), as GitHub returned it: the Vercel comment and the commit statuses of 6afa2ee.
const fixture = (name: string) => readFileSync(join(__dirname, '../../../../packages/core/test/fixtures/previews', name), 'utf8');
const PR611 = { comments: [{ body: fixture('pr611-vercel-comment.md') }], statuses: JSON.parse(fixture('pr611-statuses.json')) };
const ADMIN_611 = 'https://bridge-admin-git-explore-explore-new-a658e0-peterbonos-projects.vercel.app/';
const admin: ProductConfig = { key: 'admin', name: 'Admin demo', path: 'apps/admin', preview: 'https://bridge-admin-git-{branch}-peterbonos-projects.vercel.app', framework: 'react' };
const r611 = { number: 611, branch: 'explore/explore-new-design-pr-being-built', headSha: '6afa2ee450161294e459a10f9209c2842513423a' } as ExplorationRow;

describe('the preview of an exploration started for a product of the design system repository', () => {
  // A page that embeds no preview apps (a team page): the product's own template matches Vercel's projects.
  it("finds the admin preview Vercel reported, with the product's template", () => {
    const p = productPreviewOf(r611, PR611, 'admin', admin);
    expect([p?.url, p?.source, p?.state]).toEqual([ADMIN_611, 'vercel-comment', 'ready']);
    expect(tryUrlOf(r611, PR611, admin)).toBe(`${ADMIN_611}?bridge=611`);
  });

  it('finds it from the statuses alone when the Vercel comment is missing', () => {
    const p = productPreviewOf(r611, { comments: [], statuses: PR611.statuses }, 'admin', admin);
    expect([p?.url, p?.source, p?.state]).toEqual([ADMIN_611, 'status', 'ready']);
  });
});

describe("an exploration in the design team's copy opens with the copy named (bridge-repo)", () => {
  const COPY = 'the-bridge-company/art-print-shop-design';
  const shop = { key: 'admin-app', name: 'Art print shop', repo: 'the-bridge-company/art-print-shop', design: { repo: COPY } } as ProductConfig;
  const preview = 'https://art-print-shop-design-git-explore-da-6e68e5-peterbonos-projects.vercel.app/';

  it("adds the copy, so the toolbar reads change #1 there and not in the developers' repository", () => {
    repos = [{ product: shop, repo: COPY }];
    const url = new URL(withToolbar({ ...r, number: 1, product: 'admin-app' } as ExplorationRow)(preview)!);
    expect(url.searchParams.get('bridge')).toBe('1');
    expect(url.searchParams.get('bridge-repo')).toBe(COPY);
  });

  it("names no repository for the developers' own repository or the design system's", () => {
    repos = [{ product: { ...shop, design: undefined } as ProductConfig, repo: 'the-bridge-company/art-print-shop' }];
    expect(withToolbar({ ...r, number: 1, product: 'admin-app' } as ExplorationRow)(preview)).toBe(`${preview}?bridge=1`);
    repos = [];
    expect(withToolbar(r)(preview)).toBe(`${preview}?bridge=9`);
  });

  it('lands on the page the capture found the change on, a path or a hash route, keeping the toolbar parameters', () => {
    repos = [];
    expect(withToolbar(r, '/plans')(preview)).toBe(`${preview}plans?bridge=9`);
    expect(withToolbar(r, '/?tenant=northwind#/orders')(preview)).toBe(`${preview}?bridge=9&tenant=northwind#/orders`);
    // Never another origin, never a Bridge parameter from the capture.
    expect(atRoute(`${preview}?bridge=9`, '//evil.example/x')).toBe(`${preview}?bridge=9`);
    expect(atRoute(`${preview}?bridge=9`, '/?bridge=1')).toBe(`${preview}?bridge=9`);
  });
});
