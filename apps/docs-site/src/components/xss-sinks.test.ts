// @vitest-environment jsdom
// XSS payloads through the HTML sinks fed by repo content or the GitHub API: docs tables (inline Markdown), changelog
// rows (mdTitleHtml), docs.json examples (registry props), PR links, avatar photos and the Field Guide drawings.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { inline, mdTitleHtml } from '../lib/markdown';
import { ILLUSTRATIONS } from '../brand/illustrations';
import { prLinksHtml } from '../scripts/github-session';
import { paintAvatar } from '../scripts/avatar';
import { resolveProps } from './registry';
import Example from './Example';
import AgentToolsTable from './ds/AgentToolsTable';
import MarkdownTable from './ds/MarkdownTable';
import ReleaseEntries from './ds/ReleaseEntries';

const PAYLOADS = ['<img src=x onerror=alert(1)>', '"><svg onload=alert(1)>', '[x](javascript:alert(1))', 'javascript:alert(1)'];

/** Parses `markup` and fails on any on* attribute, javascript:/data: URL, script or iframe. */
function expectInert(markup: string) {
  const doc = new DOMParser().parseFromString(`<body>${markup}</body>`, 'text/html');
  expect(doc.querySelector('script, iframe, object, embed')).toBeNull();
  for (const el of doc.body.querySelectorAll('*')) {
    for (const a of el.attributes) {
      expect(a.name.startsWith('on'), `${el.tagName} ${a.name}`).toBe(false);
      if (['href', 'src', 'action', 'formaction', 'xlink:href'].includes(a.name)) expect(a.value.replace(/\s/g, '')).not.toMatch(/^(javascript|data|vbscript):/i);
    }
  }
}

describe('build-time sinks fed by repo Markdown', () => {
  it('AgentToolsTable: tool descriptions from docs/AI.md (inline)', () => {
    const out = renderToStaticMarkup(createElement(AgentToolsTable, { tools: PAYLOADS.map((p, i) => ({ name: `t${i}`, use: inline(p) })) }));
    expectInert(out);
    expect(out).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });

  it('MarkdownTable: cells from docs/*.md (inline)', () => {
    const out = renderToStaticMarkup(createElement(MarkdownTable, { label: 'x', head: ['<b>a</b>', 'b'], rows: PAYLOADS.map((p) => [inline(p), inline(p)]) }));
    expectInert(out);
    expect(out).not.toContain('<b>');
  });

  it('ReleaseEntries: changeset titles and descriptions (mdTitleHtml)', () => {
    const entries = PAYLOADS.map((p) => ({ kind: 'Fix', titleHtml: mdTitleHtml(p), descriptionHtml: mdTitleHtml(`\`${p}\` ${p}`), bump: 'patch', packages: ['react'] }));
    const out = renderToStaticMarkup(createElement(ReleaseEntries, { entries, visible: 10 }));
    expectInert(out);
  });
});

describe('docs.json example props (registry resolveProps)', () => {
  const evil = {
    href: 'javascript:alert(1)',
    src: ' JaVa\tScRiPt:alert(1)',
    onClick: 'alert(1)',
    onMouseOver: 'alert(1)',
    srcDoc: '<script>alert(1)</script>',
    dangerouslySetInnerHTML: { __html: '<img src=x onerror=alert(1)>' },
    options: [{ label: 'a', href: 'javascript:alert(1)', onClick: 'alert(1)' }],
    title: '"><svg onload=alert(1)>',
  };

  it('drops raw HTML and handlers and neutralises URL props at every depth', () => {
    const p = resolveProps(evil);
    expect(p).not.toHaveProperty('dangerouslySetInnerHTML');
    expect(p).not.toHaveProperty('onClick');
    expect(p).not.toHaveProperty('onMouseOver');
    expect(p).not.toHaveProperty('srcDoc');
    expect(p.href).toBe('#');
    expect(p.src).toBe('#');
    expect(p.options).toEqual([{ label: 'a', href: '#' }]);
    expect(p.title).toBe(evil.title);
    expect(resolveProps({ href: 'https://example.com/a', variant: 'primary' })).toEqual({ href: 'https://example.com/a', variant: 'primary' });
  });

  it('a static example renders no script vector', () => {
    const node = { c: 'Row', p: evil, children: [{ c: 'Link', p: evil, children: ['<img src=x onerror=alert(1)>'] }] };
    const out = renderToStaticMarkup(createElement(Example, { node: node as never }));
    expectInert(out);
    expect(out).not.toContain('<img src=x');
  });
});

describe('script sinks fed by the GitHub API', () => {
  it('prLinksHtml: the PR url is an http(s) link or "#"', () => {
    for (const url of ['javascript:alert(1)', 'data:text/html,<script>alert(1)</script>', '"><svg onload=alert(1)>']) {
      const out = prLinksHtml({ number: 7, url });
      expectInert(out);
      expect(out).not.toContain('<svg');
    }
    expect(prLinksHtml({ number: '1"><img src=x onerror=alert(1)>' as never, url: 'https://github.com/o/r/pull/1' })).toContain('?pr=NaN');
    expect(prLinksHtml({ number: 3, url: 'https://github.com/o/r/pull/3' })).toContain('href="https://github.com/o/r/pull/3"');
  });

  it('paintAvatar: a javascript: or data: avatar URL shows no photo', () => {
    for (const url of ['javascript:alert(1)', 'data:image/svg+xml,<svg onload=alert(1)>']) {
      const root = document.createElement('span');
      root.innerHTML = '<span aria-hidden="true"></span>';
      paintAvatar(root, 'octocat', url, 64);
      expect(root.querySelector('img')).toBeNull();
    }
    const root = document.createElement('span');
    paintAvatar(root, 'octocat', 'https://avatars.githubusercontent.com/u/1?v=4', 64);
    expect(root.querySelector('img')?.getAttribute('src')).toBe('https://avatars.githubusercontent.com/u/1?v=4&s=64');
  });
});

describe('inlined SVG comes from constants only', () => {
  it('the Field Guide drawings carry no script, handler or link', () => {
    for (const [name, art] of Object.entries(ILLUSTRATIONS)) {
      expect(art.svg, name).not.toMatch(/<script|<foreignObject|\son[a-z]+=|href=|javascript:/i);
    }
  });
});
