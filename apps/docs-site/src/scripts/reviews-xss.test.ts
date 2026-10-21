// @vitest-environment jsdom
// The token diff of a review (renderTokenReview) renders token paths, values and contrast pairs from a branch's files.
import { describe, expect, it } from 'vitest';
import { renderTokenReview } from './reviews';
import type { TokenReview } from '../lib/token-review';

const XSS = '<img src=x onerror=alert(1)>';
const BREAK = '"><svg onload=alert(1)>';

describe('renderTokenReview (XSS)', () => {
  it('escapes paths, contexts and pair names, and drops CSS that could load a URL', () => {
    const review = {
      changes: [{ path: XSS, kind: BREAK, context: BREAK, before: { css: XSS, hex: 'red;background:url(https://evil.example/x)', alias: null }, after: { css: '#fff', hex: '#ffffff', alias: BREAK } }],
      contrast: [{ fg: XSS, bg: BREAK, where: XSS, before: 4.5, after: 3, min: '4.5"><img src=x onerror=alert(2)>', fgHexAfter: '#000', bgHexAfter: 'red;background:url(https://evil.example/x)' }],
      failing: 1,
      problems: [],
    } as unknown as TokenReview;
    const host = document.createElement('div');
    host.innerHTML = renderTokenReview(review);
    expect(host.querySelector('img, svg[onload], script')).toBeNull();
    for (const el of host.querySelectorAll('*')) for (const a of el.attributes) expect(a.name.startsWith('on')).toBe(false);
    expect(host.innerHTML).not.toContain('url(');
    expect(host.textContent).toContain(XSS);
  });
});
