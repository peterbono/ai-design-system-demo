import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ICONS, type IconName } from './icons';
import { parseIconNode, SITE_ICONS, siteIcon } from './site-icons';

describe('site icons', () => {
  it('parses every element with camelCased attributes', () => {
    expect(parseIconNode('<circle cx="12" cy="12" r="4"/><path d="M4 20h0" stroke-width="3"/>')).toEqual([
      ['circle', { key: 'circle-0', cx: '12', cy: '12', r: '4' }],
      ['path', { key: 'path-1', d: 'M4 20h0', strokeWidth: '3' }],
    ]);
  });

  it('has one component per glyph, each drawing the same number of elements', () => {
    for (const name of Object.keys(ICONS) as IconName[]) {
      const html = renderToStaticMarkup(createElement(siteIcon(name)));
      const expected = ICONS[name].match(/<[a-z]+\b/g)!.length;
      expect(html.match(/<(path|circle|rect)\b/g)?.length, name).toBe(expected);
      expect(html, name).toContain('viewBox="0 0 24 24"');
    }
    expect(Object.keys(SITE_ICONS)).toHaveLength(Object.keys(ICONS).length);
  });

  it('keeps per-element overrides such as a fill or a stroke width', () => {
    expect(renderToStaticMarkup(createElement(siteIcon('contrast')))).toContain('fill="currentColor" stroke="none"');
    expect(renderToStaticMarkup(createElement(siteIcon('radius')))).toContain('stroke-width="3"');
  });
});
