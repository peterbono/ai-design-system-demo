// The judging of the hosted smoke test (scripts/hosted-smoke.mjs), without a network.
import { describe, expect, it } from 'vitest';
import { assetCases, CASES, judge, servedBy } from './hosted-smoke.mjs';

const page = (attrs) => `<!DOCTYPE html><html lang="en"${attrs}><head></head></html>`;

describe('hosted smoke', () => {
  it('tells a team shell from a Studio page', () => {
    expect(servedBy(page(' data-hosted data-shell="tokens" data-theme="light"'))).toBe('tokens');
    expect(servedBy(page(' data-theme="light" data-space="studio"'))).toBe('studio');
    expect(servedBy('<!doctype html><title>Redirecting</title><meta http-equiv="refresh" content="0;url=/x/">')).toBe('redirect');
    expect(servedBy('{"a":1}')).toBeNull();
  });

  it('passes the right answer and names what is wrong otherwise', () => {
    const team = CASES.find((c) => c.path === '/studio/peterbono/ai-design-system-demo/tokens/');
    expect(judge(team, { status: 200, body: page(' data-hosted data-shell="tokens"'), robots: 'noindex', type: 'text/html' })).toEqual([]);
    expect(judge(team, { status: 200, body: page(' data-theme="light"'), robots: null, type: 'text/html' })).toEqual(['served by studio, expected tokens', 'no X-Robots-Tag: noindex']);
    expect(judge(team, { status: 404, body: '' })).toEqual(['status 404, expected 200']);
    const bad = CASES.find((c) => c.path === '/studio/-bad/ds/');
    expect(judge(bad, { status: 404, body: '' })).toEqual([]);
  });

  it('covers both slash forms, the escape form, a collision and the existing pages', () => {
    const paths = CASES.map((c) => c.path);
    expect(paths).toEqual(expect.arrayContaining(['/studio/', '/studio/brands/new/', '/studio/~/brands/new/', '/studio/peterbono/ai-design-system-demo', '/studio/peterbono/ai-design-system-demo/']));
  });

  it('picks the built bundles of a page as asset cases', () => {
    expect(assetCases('<link href="/_astro/a.B1.css"><script src="/_astro/page.C2.js"></script>').map((c) => c.path)).toEqual(['/_astro/a.B1.css', '/_astro/page.C2.js']);
  });
});
