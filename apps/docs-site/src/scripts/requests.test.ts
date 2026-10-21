// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { REQUEST_LABEL } from '@bridge-ds/core';
import { requestsCacheKey, type RequestRow } from '../lib/requests-view';
import { loadRequestRows, renderRequestDetail, rowHtml } from './requests';

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

const row = (url: string): RequestRow =>
  ({
    number: 12,
    url,
    component: ATTR,
    kind: 'variant',
    kindLabel: TEXT,
    title: TEXT,
    status: 'requested',
    statusLabel: TEXT,
    tone: 'neutral',
    requester: ATTR,
    assignees: [],
    createdAt: ATTR,
    prs: [{ number: 3, url, state: 'open', merged: false, author: ATTR }],
    jiraKey: 'DS-1',
    request: {
      component: ATTR,
      title: TEXT,
      summary: TEXT,
      changes: [{ field: ATTR, before: TEXT, after: ATTR }],
      figma: { url, nodeName: TEXT },
      images: [url, `https://ok.example/${ATTR}`],
    },
  }) as unknown as RequestRow;

const page = (jiraBase: string | null) => {
  document.body.innerHTML = jiraBase === null ? '' : `<script type="application/json" id="bridge-repo">${JSON.stringify({ integrations: { jira: { baseUrl: jiraBase } } })}</script>`;
};

describe('requests HTML (untrusted issue data)', () => {
  afterEach(() => page(null));

  it.each(BAD_URLS)('the list row escapes every text (%j)', (url) => {
    const box = expectInert(rowHtml(row(url)));
    expect(box.textContent).toContain(TEXT);
  });

  it.each(BAD_URLS)('the detail drops a %j issue, Figma, image and Jira URL', (url) => {
    page(url);
    const box = expectInert(renderRequestDetail(row(url)));
    expect(box.querySelector('a.cg-gh')?.getAttribute('href')).toBe('#');
    expect(box.textContent).toContain(TEXT);
  });

  it('keeps https links', () => {
    page('https://acme.atlassian.net');
    const box = expectInert(renderRequestDetail(row('https://github.com/o/r/issues/12')));
    expect(box.querySelector('a.cg-gh')?.getAttribute('href')).toBe('https://github.com/o/r/issues/12');
    expect(box.querySelector('a[href^="https://acme.atlassian.net/browse/DS-1"]')).not.toBeNull();
  });

  it('a tampered session cache cannot put markup in a request number', async () => {
    const issue = {
      number: `1"><img src=x onerror=alert(1)>`,
      title: TEXT,
      body: '',
      html_url: 'javascript:alert(1)',
      state: 'open',
      labels: [REQUEST_LABEL],
      user: { login: ATTR },
      assignees: [],
      created_at: '2026-01-01T00:00:00Z',
    };
    sessionStorage.setItem(requestsCacheKey('peterbono/ai-design-system-demo', 'issues'), JSON.stringify({ at: Date.now(), data: [issue] }));
    const rows = await loadRequestRows({ openPulls: [], closed: false });
    expect(rows.length).toBe(1);
    expectInert(rowHtml(rows[0]!));
    expectInert(renderRequestDetail(rows[0]!));
  });
});
