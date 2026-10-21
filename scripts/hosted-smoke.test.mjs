// The judging of the hosted smoke test (scripts/hosted-smoke.mjs), without a network.
import { describe, expect, it } from 'vitest';
import { assetCases, CASES, judge, parseCurlOutput, servedBy } from './hosted-smoke.mjs';

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

  it('tells a team Library shell apart, and refuses a static noindex there (library.public decides)', () => {
    expect(servedBy(page(' data-library-shell="tokens" data-theme="light"'))).toBe('library:tokens');
    const lib = CASES.find((c) => c.path === '/library/peterbono/ai-design-system-demo/tokens');
    expect(judge(lib, { status: 200, body: page(' data-library-shell="tokens"'), robots: null, type: 'text/html' })).toEqual([]);
    expect(judge(lib, { status: 200, body: '<html data-library-shell="tokens"><head><meta name="robots" content="noindex"></head>', robots: null })).toEqual(['a static noindex tag: the page decides (library.public)']);
    expect(judge(lib, { status: 200, body: page(' data-theme="light"'), robots: null })).toEqual(['served by studio, expected library:tokens']);
    expect(CASES.map((c) => c.path)).toEqual(expect.arrayContaining(['/library/', '/library/peterbono/ai-design-system-demo', '/library/peterbono/ai-design-system-demo/', '/library/-bad/ds/']));
  });

  it('picks the built bundles of a page as asset cases', () => {
    expect(assetCases('<link href="/_astro/a.B1.css"><script src="/_astro/page.C2.js"></script>').map((c) => c.path)).toEqual(['/_astro/a.B1.css', '/_astro/page.C2.js']);
  });

  it('reads curl -i output, past a 100 Continue', () => {
    const out = 'HTTP/1.1 100 Continue\r\n\r\nHTTP/2 200\r\ncontent-type: text/html; charset=utf-8\r\nx-robots-tag: noindex\r\n\r\n<html data-shell="home">';
    expect(parseCurlOutput(out)).toEqual({ status: 200, type: 'text/html; charset=utf-8', robots: 'noindex', body: '<html data-shell="home">' });
    expect(parseCurlOutput('HTTP/2 404\nserver: Vercel\n\nnot found')).toMatchObject({ status: 404, robots: null, body: 'not found' });
  });
});
