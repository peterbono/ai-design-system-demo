// The Content-Security-Policy in vercel.json is the one in lib/csp.ts, and the report endpoint logs what it should.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { CSP_DIRECTIVES, INLINE_SCRIPT_HASHES, cspHeader, inlineScripts } from './csp';
import { REDIRECT_SCRIPT_BODY, redirectScript } from './redirects';
import { handleCspReport, reportsIn } from '../../api/csp-report/index';

const vercel = JSON.parse(readFileSync(new URL('../../vercel.json', import.meta.url), 'utf8')) as {
  headers: { source: string; headers: { key: string; value: string }[] }[];
};
const allPages = vercel.headers.find((h) => h.source === '/(.*)');
const header = (key: string) => allPages?.headers.find((h) => h.key === key)?.value;

describe('Content-Security-Policy', () => {
  it('vercel.json enforces the policy of lib/csp.ts on every path, and keeps reporting', () => {
    expect(header('Content-Security-Policy')).toBe(cspHeader());
    expect(header('Content-Security-Policy-Report-Only')).toBeUndefined();
    expect(vercel.headers.filter((h) => h.headers.some((x) => /^content-security-policy/i.test(x.key)))).toEqual([allPages]);
    expect(CSP_DIRECTIVES['report-uri']).toEqual(['/api/csp-report']);
    expect(header('X-Content-Type-Options')).toBe('nosniff');
    expect(header('Referrer-Policy')).toBe('strict-origin-when-cross-origin');
  });

  it('allows inline scripts by hash only, and nothing that runs strings or plugins', () => {
    const script = CSP_DIRECTIVES['script-src']!;
    expect(script).not.toContain("'unsafe-inline'");
    expect(script).not.toContain("'unsafe-eval'");
    expect(script.filter((s) => s.startsWith("'sha256-"))).toHaveLength(INLINE_SCRIPT_HASHES.length);
    expect(CSP_DIRECTIVES['object-src']).toEqual(["'none'"]);
    expect(CSP_DIRECTIVES['base-uri']).toEqual(["'none'"]);
    expect(CSP_DIRECTIVES['frame-ancestors']).toEqual(["'none'"]);
  });

  it('lists the GitHub hosts the Studio reads from', () => {
    expect(CSP_DIRECTIVES['connect-src']).toEqual(expect.arrayContaining(["'self'", 'https://api.github.com', 'https://raw.githubusercontent.com']));
    expect(CSP_DIRECTIVES['img-src']).toEqual(expect.arrayContaining(['https://avatars.githubusercontent.com', 'https://raw.githubusercontent.com']));
  });

  it('every redirect page shares one script, whose hash is in the policy', () => {
    const [a] = inlineScripts(redirectScript('/studio/changes/'));
    const [b] = inlineScripts(redirectScript('/components/button/?edit=1&x="1"'));
    expect(a).toBe(REDIRECT_SCRIPT_BODY);
    expect(b).toBe(REDIRECT_SCRIPT_BODY);
    expect(INLINE_SCRIPT_HASHES).toContain(`sha256-${createHash('sha256').update(REDIRECT_SCRIPT_BODY).digest('base64')}`);
  });

  it('inlineScripts skips external scripts and JSON data blocks', () => {
    const html = '<script src="/a.js"></script><script type="application/json" id="x">{"a":1}</script><script type="module">go()</script><script>one()</script>';
    expect(inlineScripts(html)).toEqual(['go()', 'one()']);
  });
});

describe('/api/csp-report', () => {
  const post = (body: string, headers: Record<string, string> = {}) =>
    new Request('https://bridge.example/api/csp-report', { method: 'POST', body, headers: { 'content-type': 'application/csp-report', ...headers } });

  it('logs one line per report, in both report formats', async () => {
    const lines: string[] = [];
    const res = await handleCspReport(post(JSON.stringify({ 'csp-report': { 'document-uri': 'https://b/x', 'violated-directive': 'script-src', 'blocked-uri': 'inline', cookie: 'nope' } })), (l) => lines.push(l));
    expect(res.status).toBe(204);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('"violated-directive":"script-src"');
    expect(lines[0]).not.toContain('cookie');
    expect(reportsIn([{ type: 'csp-violation', body: { effectiveDirective: 'img-src', blockedURL: 'https://x/y.png' } }])).toEqual([{ effectiveDirective: 'img-src', blockedURL: 'https://x/y.png' }]);
  });

  it('refuses other methods and oversized bodies, and ignores junk', async () => {
    expect((await handleCspReport(new Request('https://bridge.example/api/csp-report'))).status).toBe(405);
    expect((await handleCspReport(post('x'.repeat(20_000)))).status).toBe(413);
    const lines: string[] = [];
    expect((await handleCspReport(post('not json'), (l) => lines.push(l))).status).toBe(204);
    expect((await handleCspReport(post('{"csp-report":"<script>"}'), (l) => lines.push(l))).status).toBe(204);
    expect(lines).toEqual([]);
  });

  it('cuts long fields', () => {
    const [r] = reportsIn({ 'csp-report': { 'blocked-uri': 'x'.repeat(1000) } });
    expect(String(r!['blocked-uri'])).toHaveLength(300);
  });
});
