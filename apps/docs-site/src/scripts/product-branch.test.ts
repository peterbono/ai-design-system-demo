// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { tryInProductUrl } from '@bridge-ds/core';
import type { ExplorationRow } from '../lib/explorations-view';

const BAD_URLS = ['javascript:alert(1)//', ' JaVaScRiPt:alert(1)//', 'data:text/html,<script>alert(1)</script>'];

// The admin preview a comment or a status on the branch reports: any string.
let reported = '';
vi.mock('../lib/explorations-view', async (importOriginal) => {
  const real = await importOriginal<typeof import('../lib/explorations-view')>();
  return { ...real, explorationPreviews: () => [{ app: 'admin', label: 'Admin demo', url: reported, state: 'ready', source: 'comment' }] };
});

const { tryUrlOf } = await import('./product-branch');

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
