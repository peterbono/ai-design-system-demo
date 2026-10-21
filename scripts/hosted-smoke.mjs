#!/usr/bin/env node
// Smoke test of team addresses on a deployed docs site (multi-team plan 4.1 and 9, PR 3a). Run it after a deploy:
//
//   node scripts/hosted-smoke.mjs https://<deployment>.vercel.app
//
// Each case requests one address and checks the status, which page answered (a Studio page of this build, the
// team shell for a route: <html data-shell="...">, or a team Library shell: <html data-library-shell="..."> read as
// "library:<route>"), and the X-Robots-Tag header of team addresses. A team Library decides indexing in the page
// (noindex unless its bridge.config.json says library.public), so its shell must not carry a static noindex tag. Static files win
// over the vercel.json rewrites, so the existing Studio pages must still answer as themselves.
// A preview behind Vercel Deployment Protection: add --vercel-curl to send each request through `vercel curl` (your
// Vercel login, from a folder linked to the project), or set VERCEL_AUTOMATION_BYPASS_SECRET (sent as
// x-vercel-protection-bypass). Exit 1 when a case fails.
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const DEMO = '/studio/peterbono/ai-design-system-demo';
const LIB = '/library/peterbono/ai-design-system-demo';

/**
 * shell: the route marker of the team shell expected (data-shell), 'studio' for a page of this build that is not
 * a shell, 'redirect' for a redirect page, or undefined for a file that is not a page. noindex: the response must carry X-Robots-Tag: noindex.
 */
export const CASES = [
  // Existing pages keep answering as themselves, with and without the trailing slash, with a query.
  { path: '/studio/', status: 200, shell: 'studio' },
  { path: '/studio', status: 200, shell: 'studio' },
  { path: '/studio/changes/?pr=1', status: 200, shell: 'studio' },
  { path: '/studio/changes', status: 200, shell: 'studio' },
  { path: '/studio/tokens/', status: 200, shell: 'studio' },
  { path: '/studio/brands/new/', status: 200, shell: 'studio' },
  { path: '/studio/components/storybook/', status: 200, shell: 'studio' },
  { path: '/studio/auth/callback/?code=x&state=y', status: 200, shell: 'studio' },
  // An old address kept as a static redirect page (lib/redirects.ts): a real file, so not a team.
  { path: '/studio/settings/governance/', status: 200, shell: 'redirect' },
  { path: '/studio/versions/data.json', status: 200, type: 'application/json' },
  // A team, with and without the trailing slash, on each kind of route.
  { path: `${DEMO}/`, status: 200, shell: 'home', noindex: true },
  { path: DEMO, status: 200, shell: 'home', noindex: true },
  { path: `${DEMO}/tokens/`, status: 200, shell: 'tokens', noindex: true },
  { path: `${DEMO}/tokens`, status: 200, shell: 'tokens', noindex: true },
  { path: `${DEMO}/changes/?pr=12`, status: 200, shell: 'changes', noindex: true },
  { path: `${DEMO}/components/storybook/`, status: 200, shell: 'components-storybook', noindex: true },
  { path: `${DEMO}/brands/new`, status: 200, shell: 'brands-new', noindex: true },
  { path: '/studio/acme/ds.v2/quality/', status: 200, shell: 'quality', noindex: true },
  // An owner named like a Studio page: a team unless a real file takes the exact pair.
  { path: '/studio/brands/kit/', status: 200, shell: 'home', noindex: true },
  // The escape form, for a pair a Studio page takes.
  { path: '/studio/~/brands/new/', status: 200, shell: 'home', noindex: true },
  { path: '/studio/~/brands/new/settings', status: 200, shell: 'settings', noindex: true },
  { path: '/studio/~/components/docs/review/', status: 200, shell: 'review', noindex: true },
  // Not a team: a name GitHub refuses, a route no shell has.
  { path: '/studio/-bad/ds/', status: 404 },
  { path: `${DEMO}/nope/`, status: 404 },
  // The shells themselves and the reserved list, never indexed.
  { path: '/team-shell/', status: 200, shell: 'home', noindex: true },
  { path: '/team-shell/reserved.json', status: 200, type: 'application/json', noindex: true },
  // Bridge's own Library home stays itself; a team's Library opens its shell on every route (multi-team PR 4a).
  { path: '/library/', status: 200, shell: 'studio' },
  { path: '/library', status: 200, shell: 'studio' },
  { path: `${LIB}/`, status: 200, shell: 'library:home', indexable: true },
  { path: LIB, status: 200, shell: 'library:home', indexable: true },
  { path: `${LIB}/foundations/`, status: 200, shell: 'library:foundations', indexable: true },
  { path: `${LIB}/components/`, status: 200, shell: 'library:components', indexable: true },
  { path: `${LIB}/components/?c=button`, status: 200, shell: 'library:components', indexable: true },
  { path: `${LIB}/tokens`, status: 200, shell: 'library:tokens', indexable: true },
  { path: '/library/acme/ds.v2/tokens/', status: 200, shell: 'library:tokens', indexable: true },
  { path: '/library/-bad/ds/', status: 404 },
  { path: `${LIB}/nope/`, status: 404 },
  { path: '/library-shell/', status: 200, shell: 'library:home', noindex: true },
  // Assets.
  { path: '/tokens.css', status: 200, type: 'text/css' },
  { path: '/favicon.svg', status: 200, type: 'image/svg+xml' },
];

/** Which page answered: the shell marker, 'studio' for another page, 'redirect' for a redirect page, null when the
 * body is not a page. */
export function servedBy(body) {
  const tag = /<html\b[^>]*>/i.exec(body)?.[0];
  if (!tag) return /<meta http-equiv="refresh"/i.test(body) ? 'redirect' : null;
  const shell = /\sdata-shell="([^"]*)"/.exec(tag)?.[1];
  const library = /\sdata-library-shell="([^"]*)"/.exec(tag)?.[1];
  if (library) return `library:${library}`;
  return shell ?? (/\sdata-hosted[\s>=]/.test(tag) ? 'hosted' : 'studio');
}

/** The problems of one response against its case; [] when it passes. */
export function judge(c, res) {
  const problems = [];
  if (res.status !== c.status) return [`status ${res.status}, expected ${c.status}`];
  if (c.status !== 200) return problems;
  if (c.shell !== undefined) {
    const by = servedBy(res.body);
    if (by !== c.shell) problems.push(`served by ${by ?? 'no page'}, expected ${c.shell}`);
  }
  if (c.type && !(res.type ?? '').includes(c.type)) problems.push(`content-type ${res.type}, expected ${c.type}`);
  const robots = (res.robots ?? '').toLowerCase().includes('noindex');
  if (c.noindex && !robots) problems.push('no X-Robots-Tag: noindex');
  if (c.indexable && /<meta name="robots" content="noindex"/i.test(res.body)) problems.push('a static noindex tag: the page decides (library.public)');
  return problems;
}

/** The first built CSS and JS bundles a page links, as extra asset cases. */
export function assetCases(body) {
  const out = [];
  for (const ext of ['css', 'js']) {
    const m = new RegExp(`["'](/_astro/[^"']+\\.${ext})["']`).exec(body);
    if (m) out.push({ path: m[1], status: 200, type: ext === 'css' ? 'text/css' : 'javascript' });
  }
  return out;
}

/** A response from `curl -s -i` output: the last header block (after any 1xx), then the body. */
export function parseCurlOutput(out) {
  let rest = out;
  let head = '';
  do {
    const end = rest.search(/\r?\n\r?\n/);
    head = end < 0 ? rest : rest.slice(0, end);
    rest = end < 0 ? '' : rest.slice(end).replace(/^\r?\n\r?\n/, '');
  } while (/^HTTP\/\S+ 1\d\d/.test(head) && rest.startsWith('HTTP/'));
  const status = Number(/^HTTP\/\S+ (\d{3})/.exec(head)?.[1] ?? 0);
  const header = (name) => new RegExp(`^${name}:\\s*(.*?)\\s*$`, 'im').exec(head)?.[1] ?? null;
  return { status, type: header('content-type'), robots: header('x-robots-tag'), body: rest };
}

async function request(base, path, headers, viaVercel) {
  if (viaVercel) {
    const url = new URL(path, base).href;
    const out = execFileSync('vercel', ['curl', url, '--deployment', base, '--yes', '--', '-s', '-i'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });
    return parseCurlOutput(out);
  }
  const res = await fetch(new URL(path, base), { redirect: 'manual', headers });
  return { status: res.status, type: res.headers.get('content-type'), robots: res.headers.get('x-robots-tag'), body: await res.text() };
}

async function main() {
  const viaVercel = process.argv.includes('--vercel-curl');
  const base = process.argv.slice(2).find((a) => !a.startsWith('--'));
  if (!base || !/^https?:\/\//.test(base)) {
    console.error('Usage: node scripts/hosted-smoke.mjs <deployment URL> [--vercel-curl]');
    process.exit(2);
  }
  const headers = process.env.VERCEL_AUTOMATION_BYPASS_SECRET ? { 'x-vercel-protection-bypass': process.env.VERCEL_AUTOMATION_BYPASS_SECRET } : {};
  const home = await request(base, '/studio/', headers, viaVercel);
  const cases = [
    ...CASES,
    ...assetCases(home.body),
    ...assetCases((await request(base, `${DEMO}/`, headers, viaVercel)).body).map((c) => ({ ...c, from: 'team shell' })),
    ...assetCases((await request(base, `${LIB}/`, headers, viaVercel)).body).map((c) => ({ ...c, from: 'library shell' })),
  ];
  let failed = 0;
  for (const c of cases) {
    let problems;
    let res;
    try {
      res = await request(base, c.path, headers, viaVercel);
      problems = judge(c, res);
    } catch (err) {
      problems = [`request failed: ${err.message}`];
    }
    if (problems.length) failed++;
    const what = res ? `${res.status} ${c.shell ? servedBy(res.body) ?? '-' : (res.type ?? '').split(';')[0]}${res.robots ? ' noindex' : ''}` : 'error';
    console.log(`${problems.length ? 'FAIL' : 'ok  '}  ${c.path.padEnd(58)} ${what}${problems.length ? `  (${problems.join('; ')})` : ''}`);
  }
  // Vercel answers X-Robots-Tag: noindex on every response of a preview deployment, so there the noindex checks
  // cannot tell the vercel.json rules apart; only a production deployment proves them.
  const asset = await request(base, '/tokens.css', headers, viaVercel);
  if ((asset.robots ?? '').includes('noindex')) console.log('\nnote: this deployment marks every response noindex (a Vercel preview): the noindex checks only prove something on production.');
  console.log(`\n${cases.length - failed} of ${cases.length} passed on ${base}`);
  process.exit(failed ? 1 : 0);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
