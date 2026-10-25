// The site's Content-Security-Policy, in one place. Enforced (vercel.json headers, checked against this file by
// csp.test.ts) after a Report-Only period and a crawl of every page type with zero violations; browsers still send
// each violation to /api/csp-report, which logs it.
// No dependencies: astro.config.mjs reads it while Astro loads its config, to check the built pages.
//
// Why each source is there:
//   script-src  own bundles, plus the hash of each inline script the build emits (theme before paint, view-as-change
//               marker, old-link redirects, Astro's island loaders). The build fails when a page carries an inline
//               script whose hash is not listed (astro.config.mjs, bridge-csp-hashes). vercel.live: preview toolbar.
//   style-src   'unsafe-inline': Astro and React write style attributes and scoped <style> blocks.
//   img-src     GitHub avatars, raw files (visual impact screenshots), issue attachments (github.com/user-attachments
//               redirects to *.githubusercontent.com), data: and blob: (pasted request images, drawn avatars).
//   connect-src GitHub API and raw files (Studio reads), Anthropic (docs drafting with the visitor's own key), own
//               /api (token exchange, Storybook proxy).
//   frame-src   team Storybooks and preview apps live on any https host.
//   form-action GitHub sign-in.

/** sha256 hashes of every inline <script> body the build emits (excluding JSON data blocks). */
export const INLINE_SCRIPT_HASHES: readonly string[] = [
  'sha256-BUHlb9h08KS+Qc5t+5VhUdZHEAkXlerV2/sEs/1WNUU=', // layouts/Layout.astro: theme, brand, density, maintainer before paint
  'sha256-R2rSXGlMIwO2rNqoV2ROuVtSVtNEFgPWQLeLqAyaFvk=', // layouts/Landing.astro: theme before paint
  'sha256-0i1jID8f3nUfRPNhacyaeS4wGZEAFS1umKuXE4TuR0g=', // components/ViewAsChange.astro: ?change= marker before paint
  'sha256-2i54S69TCx0SXRZcyVo7fWMIA3ogTDcNBQgLy0oxKws=', // pages/tokens/index.astro: old /tokens/?edit=1 links
  'sha256-uqAksvOuf994THgXNMsJ+BOKOBw0cPIxoWb+HGfPI7Y=', // lib/redirects.ts REDIRECT_SCRIPT_BODY: redirect pages
  'sha256-U7a72oKuFFz8D7GUHLA1NZ0ciymHmDOc9T9aVDg2rWU=', // Astro: <astro-island> runtime
  'sha256-QzWFZi+FLIx23tnm9SBU4aEgx4x8DsuASP07mfqol/c=', // Astro: client:load
  'sha256-eIXWvAmxkr251LJZkjniEK5LcPF3NkapbJepohwYRIc=', // Astro: client:only
  'sha256-BF0290pkb3jxQsE7z00xR8Imp8X34FLC88L0lkMnrGw=', // Astro: client:idle
  'sha256-Q2BPg90ZMplYY+FSdApNErhpWafg2hcRRbndmvxuL/Q=', // Astro: client:visible
];

export const CSP_REPORT_PATH = '/api/csp-report';

export const CSP_DIRECTIVES: Readonly<Record<string, readonly string[]>> = {
  'default-src': ["'self'"],
  'script-src': ["'self'", ...INLINE_SCRIPT_HASHES.map((h) => `'${h}'`), 'https://vercel.live'],
  'style-src': ["'self'", "'unsafe-inline'"],
  'img-src': ["'self'", 'data:', 'blob:', 'https://avatars.githubusercontent.com', 'https://raw.githubusercontent.com', 'https://*.githubusercontent.com', 'https://github.com', 'https://vercel.live', 'https://vercel.com'],
  'font-src': ["'self'", 'data:'],
  'connect-src': ["'self'", 'https://api.github.com', 'https://raw.githubusercontent.com', 'https://api.anthropic.com', 'https://vercel.live', 'wss://ws-us3.pusher.com'],
  'frame-src': ["'self'", 'https:'],
  'object-src': ["'none'"],
  'base-uri': ["'none'"],
  'form-action': ["'self'", 'https://github.com'],
  'frame-ancestors': ["'none'"],
  'report-uri': [CSP_REPORT_PATH],
};

/** The header value. */
export function cspHeader(directives: Readonly<Record<string, readonly string[]>> = CSP_DIRECTIVES): string {
  return Object.entries(directives)
    .map(([k, v]) => `${k} ${v.join(' ')}`)
    .join('; ');
}

/** Bodies of the inline scripts in one HTML page: no src, not a JSON data block. */
export function inlineScripts(html: string): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    const attrs = m[1] ?? '';
    if (/\ssrc\s*=/i.test(attrs)) continue;
    if (/type\s*=\s*["']?application\/(ld\+)?json/i.test(attrs)) continue;
    out.push(m[2] ?? '');
  }
  return out;
}
