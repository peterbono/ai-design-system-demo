// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { VisualManifest, VisualShot } from '../../lib/visual-impact';

const TEXT = '<img src=x onerror=alert(1)>';
const ATTR = '"><svg onload=alert(1)>';
const BAD_URLS = ['javascript:alert(1)', ' JaVaScRiPt:alert(1)', 'java\tscript:alert(1)', 'data:text/html,<script>alert(1)</script>'];

// What GitHub serves: the manifest a repo publishes (any content), or nothing.
let manifest: string | null = null;
vi.mock('../github-session', async (importOriginal) => {
  const real = await importOriginal<typeof import('../github-session')>();
  return {
    ...real,
    hasWorkingToken: () => false,
    ghGet: async (path: string, opts?: { raw?: boolean }) => {
      if (opts?.raw) return { data: manifest };
      if (path.includes('/git/matching-refs/')) return { data: manifest === null ? [] : [{ ref: 'refs/heads/bridge-visual', object: { sha: 't0' } }] };
      return { data: { tree: [{ path: 'pr-7', type: 'tree', sha: 't1' }, { path: 'abc', type: 'tree', sha: 't2' }, { path: 'manifest.json', type: 'blob', sha: 't3' }] } };
    },
  };
});

const { loadVisualImpact, renderTopChange } = await import('./visual-impact');

/** Parses the markup and fails on any event handler attribute or script/data URL in href or src. */
function expectInert(box: HTMLElement) {
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

// A hostile manifest: strings where numbers belong, markup in every text.
const shot = (): VisualShot =>
  ({
    key: ATTR,
    kind: 'story',
    label: TEXT,
    brand: ATTR,
    theme: TEXT,
    tenant: ATTR,
    status: 'changed',
    percent: 12,
    boxes: [{ x: ATTR, y: 1, width: 2, height: 3 }],
    size: { before: null, after: { width: `4" onload="alert(1)`, height: `3;background:url(javascript:alert(1))"><svg onload=alert(1)>` } },
    images: { before: `${ATTR}.png`, after: 'a.png', diff: TEXT, composite: ATTR },
    error: TEXT,
  }) as unknown as VisualShot;

const hostile = (): VisualManifest =>
  ({
    version: 1,
    options: { threshold: ATTR },
    selection: { tokens: [], components: [{ id: TEXT }], fallback: ATTR },
    summary: { shots: TEXT },
    shots: [shot(), { ...shot(), kind: 'route' }],
  }) as unknown as VisualManifest;

const o = (actionsUrl: string) => ({ owner: 'o', repo: 'r', pr: 7, sha: 'abc', actionsUrl });

describe('visual impact HTML (untrusted manifest)', () => {
  afterEach(() => {
    manifest = null;
    document.body.innerHTML = '';
  });

  it('a hostile manifest renders inert in the full list', async () => {
    manifest = JSON.stringify(hostile());
    const slot = document.createElement('div');
    const v = await loadVisualImpact(slot, o('https://github.com/o/r/actions'));
    expect(v.changed).toBe(2);
    expectInert(slot);
    expect(slot.textContent).toContain(TEXT);
    const img = slot.querySelector<HTMLImageElement>('img.vi-img')!;
    expect(img.getAttribute('width')).toBe('NaN');
    expect(img.getAttributeNames().filter((a) => a.startsWith('on'))).toEqual([]);
    const thumb = document.createElement('div');
    thumb.innerHTML = v.thumb;
    expectInert(thumb);
  });

  it.each(BAD_URLS)('the top change drops a %j "see all" link and stays inert', async (url) => {
    manifest = JSON.stringify(hostile());
    const v = await loadVisualImpact(document.createElement('div'), o('https://github.com/o/r/actions'));
    const slot = document.createElement('div');
    renderTopChange(slot, v, url);
    expectInert(slot);
    expect(slot.querySelector('[data-open-visual]')?.getAttribute('href')).toBe('#');
  });

  it.each(BAD_URLS)('not run yet: a %j actions URL is dropped', async (url) => {
    const slot = document.createElement('div');
    await loadVisualImpact(slot, o(url));
    expectInert(slot);
    expect(slot.querySelector('a')?.getAttribute('href')).toBe('#');
  });
});
