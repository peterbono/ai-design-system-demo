// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import type { BranchPreview } from '@bridge-ds/core';
import type { ExplorationRow } from '../lib/explorations-view';
import { previewList, renderExplorationDetail, rowHtml } from './explorations';

const TEXT = '<img src=x onerror=alert(1)>';
const ATTR = '"><svg onload=alert(1)>';
const BAD_URLS = ['javascript:alert(1)', ' JaVaScRiPt:alert(1)', 'java\tscript:alert(1)', 'data:text/html,<script>alert(1)</script>'];

/** Parses the markup and fails on any event handler attribute or script/data URL in href or src. */
function expectInert(markup: string) {
  const box = document.createElement('div');
  box.innerHTML = markup;
  for (const el of box.querySelectorAll('*')) {
    for (const a of el.getAttributeNames()) expect(a.startsWith('on'), `${el.tagName} ${a}`).toBe(false);
    for (const a of ['href', 'src']) {
      const v = (el.getAttribute(a) ?? '').replace(/[\u0000- \u007f]/g, '').toLowerCase();
      expect(v.startsWith('javascript:') || v.startsWith('data:'), `${el.tagName} ${a}=${v}`).toBe(false);
    }
  }
  expect(box.querySelector('svg, script, img[src="x"]')).toBeNull();
  return box;
}

const row = (url: string, over: Partial<ExplorationRow> = {}): ExplorationRow => ({
  number: 7,
  url,
  branch: 'explore/x',
  slug: 'x',
  name: TEXT,
  purpose: ATTR,
  useCaseLabel: TEXT,
  status: 'active',
  statusLabel: TEXT,
  tone: 'neutral',
  author: ATTR,
  source: null,
  agent: null,
  updatedAt: ATTR,
  previews: [{ app: 'docs', label: TEXT, url }],
  headSha: 'abc',
  requests: [{ number: 3, title: TEXT, component: ATTR, url, statusLabel: TEXT, open: true }],
  ...over,
});

describe('explorations HTML (untrusted pull request and preview data)', () => {
  it.each(BAD_URLS)('the list row drops a %j preview URL and escapes every text', (url) => {
    const box = expectInert(rowHtml(row(url)));
    expect(box.textContent).toContain(TEXT);
  });

  it.each(BAD_URLS)('the preview list drops a %j preview URL', (url) => {
    const previews: BranchPreview[] = [{ app: 'docs', label: ATTR, url, state: 'ready', source: 'comment' } as unknown as BranchPreview];
    const box = expectInert(previewList(previews));
    expect(box.querySelector('a')?.getAttribute('href')).toBe('#');
  });

  it.each(BAD_URLS)('the detail drops a %j pull request URL and escapes its texts', (url) => {
    const box = expectInert(renderExplorationDetail(row(url), { connected: true }));
    expect(box.querySelector('a.cg-gh')?.getAttribute('href')).toBe('#');
    expect(box.querySelector('h1')?.textContent).toContain(TEXT);
  });

  it('offers Done exploring and Archive in direct mode only, as the product page does, and never Close', () => {
    const r = row('https://x-git-explore-x.vercel.app/');
    const direct = expectInert(renderExplorationDetail(r, { connected: true, suggest: false }));
    expect(direct.querySelector('[data-ex-done]')?.textContent).toBe('Done exploring');
    expect(direct.querySelector('[data-ex-archive]')?.textContent).toBe('Archive');
    expect(direct.querySelector('[data-ex-close], [data-ex-close-ask], [data-ex-promote]')).toBeNull();
    const box = expectInert(renderExplorationDetail(r, { connected: true, suggest: true }));
    expect(box.querySelector('[data-ex-done]')).toBeNull();
    expect(box.querySelector('[data-ex-archive]')).toBeNull();
  });

  it('offers Done exploring and Archive only to the person who started it or a reviewer', () => {
    const r = { ...row('https://x.vercel.app/'), status: 'active' } as Parameters<typeof renderExplorationDetail>[0];
    const keeper = expectInert(renderExplorationDetail(r, { connected: true, suggest: false, keeper: true }));
    expect(keeper.querySelector('[data-ex-done]')).not.toBeNull();
    const other = expectInert(renderExplorationDetail(r, { connected: true, suggest: false, keeper: false }));
    expect(other.querySelector('[data-ex-done]')).toBeNull();
    expect(other.querySelector('[data-ex-archive]')).toBeNull();
    expect(other.textContent).toMatch(/or a reviewer can say it is done exploring or archive it/);
  });

  it('once done exploring: Archive only; archived: Unarchive; the developer fold has the two commands as a starting point', () => {
    const ready = expectInert(renderExplorationDetail(row('https://x.vercel.app/', { status: 'ready' }), { connected: true, suggest: false, keeper: true }));
    expect(ready.querySelector('[data-ex-done]')).toBeNull();
    expect(ready.querySelector('[data-ex-archive]')?.textContent).toBe('Archive');
    const archived = expectInert(renderExplorationDetail(row('https://x.vercel.app/', { status: 'ready', archived: true }), { connected: true, suggest: false, keeper: true }));
    expect(archived.querySelector('[data-unarchive]')?.textContent).toBe('Unarchive');
    const dev = ready.querySelector('#ex-sec-dev');
    expect(dev?.hasAttribute('open')).toBe(false);
    expect(dev?.querySelector('pre')?.textContent).toBe('git fetch origin\ngit checkout explore/x');
    expect(dev?.textContent).toMatch(/starting point, not ready to ship/);
  });

  it('keeps https links', () => {
    const box = expectInert(rowHtml(row('https://x-git-explore-x.vercel.app/')));
    expect(box.querySelector('a[target="_blank"]')?.getAttribute('href')).toBe('https://x-git-explore-x.vercel.app/');
  });
});
