// @vitest-environment jsdom
// History reads pull request data and token files from arbitrary repositories: titles, numbers, URLs, values and
// contrast samples stay text and never become markup, a second style declaration or a javascript: link.
import { describe, expect, it, vi } from 'vitest';

const IMG = '<img src=x onerror=alert(1)>';
const SVG = '"><svg onload=alert(1)>';
const STYLE = 'red;background:url(javascript:alert(1))';
const JS = 'javascript:alert(1)';

const entry = {
  id: 'pr-1',
  sha: 'abc',
  date: '2026-10-01T00:00:00Z',
  author: 'ana',
  title: IMG,
  why: IMG,
  pr: { number: SVG, url: JS, title: IMG, body: null },
  changes: [],
  counts: { total: 1, changed: 1, added: 0, renamed: 0, removed: 0 },
  tier: 1,
  bump: 'patch',
  breaking: false,
  reasons: [],
  changesets: [],
  version: 'Unreleased',
};
const report = { entries: [entry], releases: [] };

vi.mock('./state', () => ({
  loadHistory: () => Promise.resolve({ data: { reviews: {} }, config: { repo: { owner: 'o', name: 'r' } } }),
  activeReport: () => ({ report, demo: false }),
  DEMO_AVAILABLE: false,
  DEMO_BANNER: 'Demo',
  DEMO_EVENT: 'bridge:history-demo',
  demoOn: () => false,
  setDemo: () => {},
}));
vi.mock('@bridge-ds/core', async (orig) => ({
  ...(await orig<typeof import('@bridge-ds/core')>()),
  tokenHistory: () => [
    { kind: 'changed', fields: ['value'], before: STYLE, beforeCss: STYLE, after: IMG, afterCss: SVG, title: IMG, entryId: SVG, modeLabel: IMG, date: '2026-10-01', author: IMG, pr: { number: SVG } },
    { kind: 'renamed', fields: [], from: SVG, title: IMG, entryId: 'x', modeLabel: 'Light', date: '2026-10-01', author: 'ana' },
  ],
}));
vi.mock('../github-session', async (orig) => ({
  ...(await orig<typeof import('../github-session')>()),
  initGitHubConnect: () => {},
  ghGet: () => Promise.resolve({ data: [{ number: SVG, body: null, title: IMG }] }),
  hasWorkingToken: () => false,
  currentViewer: () => null,
  readRepo: () => ({ owner: 'o', repo: 'r' }),
}));
vi.mock('../../lib/review-queue', async (orig) => ({ ...(await orig<typeof import('../../lib/review-queue')>()), releasePull: (xs: unknown[]) => xs[0] ?? null }));
vi.mock('../pr-status', () => ({ owners: () => ({ design: [], tech: [] }), shippers: () => null }));
vi.mock('../teams', () => ({ loadTeams: () => Promise.resolve() }));
vi.mock('../people', () => ({ knownNames: () => ({}), paintPeople: () => Promise.resolve(), personHtml: () => '' }));
vi.mock('../../lib/select-bridge', () => ({ onSelectPick: () => {}, selectValue: () => '', setSelect: () => {} }));

const { initTokenHistoryPanel } = await import('./token-panel');
const { initHistory, routeHistory } = await import('./page');
const { pairsTable } = await import('./planner');

function expectInert(host: Element) {
  for (const el of host.querySelectorAll('*')) {
    for (const a of el.attributes) {
      expect(a.name.startsWith('on'), `${el.tagName} ${a.name}`).toBe(false);
      if (a.name === 'href' || a.name === 'src') expect(a.value).not.toMatch(/^\s*javascript:/i);
      if (a.name === 'style') expect(a.value).not.toMatch(/url\(|expression|javascript:|red;/i);
    }
  }
  expect(host.querySelector('img, svg[onload], script, iframe')).toBeNull();
}

const flush = () => new Promise((r) => setTimeout(r, 20));

describe('history sinks with hostile repository data', () => {
  it('the token history panel: titles, authors, pull request numbers and values', async () => {
    initTokenHistoryPanel();
    const body = document.createElement('div');
    document.body.append(body);
    document.dispatchEvent(new CustomEvent('bridge:token-detail', { detail: { path: 'color.x', body } }));
    await flush();
    const panel = body.querySelector('.hs-panel')!;
    // Pull request numbers are not shown to designers; the hostile rename source stays text.
    expect(panel.textContent).not.toContain(`#${SVG}`);
    expect(panel.textContent).toContain(SVG);
    expect(panel.textContent).toContain(IMG);
    expectInert(panel);
    body.remove();
  });

  it('the History page: timeline rows, entry detail and the next release card', async () => {
    document.body.innerHTML = `<div class="cg-hs-head"></div>
      <div id="hs-banner"></div><button id="hs-demo"></button><button id="hs-filter-toggle" aria-expanded="false"></button>
      <form id="hs-filters"><input data-hs-token /></form><datalist id="hs-paths"></datalist>
      <div id="hs-list-view"><div id="hs-timeline"></div><p id="hs-none"></p></div><div id="hs-detail"></div>
      <section id="hs-next"><h2 id="hs-next-title"></h2><ul id="hs-next-lines"></ul><a id="hs-next-cta"></a><p id="hs-next-who"></p></section>`;
    history.replaceState(null, '', '/studio/changes/?view=history');
    initHistory();
    await flush();
    const tl = document.getElementById('hs-timeline')!;
    expect(tl.textContent).toContain(IMG);
    expect(tl.textContent).not.toContain(SVG);
    expectInert(tl);
    const who = document.getElementById('hs-next-who')!;
    expect(who.querySelector('a')).not.toBeNull();
    expectInert(who);

    history.replaceState(null, '', '/studio/changes/?view=history&entry=pr-1');
    routeHistory();
    const detail = document.getElementById('hs-detail')!;
    expect(detail.textContent).toContain(IMG);
    expect(detail.querySelector('a.cg-gh')?.getAttribute('href')).toBe('#');
    expectInert(detail);
  });

  it('the undo planner: contrast samples take hex colors only, names and minimums stay text', () => {
    const review = {
      changes: [],
      contrast: [{ fg: IMG, bg: SVG, where: IMG, before: 4.5, after: 2, min: SVG, fgHexAfter: STYLE, bgHexAfter: '#ffffff' }],
    };
    const host = document.createElement('div');
    host.innerHTML = pairsTable(review as never);
    expectInert(host);
    expect(host.querySelector<HTMLElement>('.rv-aa')!.getAttribute('style')).toBe('background-color:#ffffff;color:');
    expect(host.textContent).toContain(`min ${SVG}:1`);
  });
});
