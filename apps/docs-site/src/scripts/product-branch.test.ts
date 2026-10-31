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

const { productPreviewOf, tryUrlOf } = await import('./product-branch');

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
