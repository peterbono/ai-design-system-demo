#!/usr/bin/env node
// Screens check: renders the screens a pull request changes, in CI, and writes the sticky PR comment that shows them.
// Run by .github/workflows/screens.yml; see docs/VISUAL-CHECK.md.
//
//   node scripts/screens.mjs plan --base <sha> [--head <sha>]            which screens (scripts/screens.map.json)
//   node scripts/screens.mjs capture --site <dist> --out <dir> --screens a,b [--root <checkout>] [--compare <dir>]
//                                    [--gh-cache <file>]                 screenshots + checks, <dir>/report.json
//   node scripts/screens.mjs report --after <dir> [--before <dir>] --pr <n> --sha <sha> [--base-sha <sha>]
//                                   [--raw-base <url>] [--run-url <url>] --out <dir>   comment.md + publish/ + verdict
//
// What it renders: the built docs site (astro build, apps/docs-site/dist) served by a small static server that does
// the team and Library rewrites of vercel.json, so the sample team (peterbono/bridge-demo-ds) renders signed out with
// its sample data, exactly as a visitor sees it. No Vercel deploy, no account, no private team: only the sample team,
// the public site and email fixtures (notify-mail rendered with sample names).
// GitHub: the sample team's reads go from the page to api.github.com; here they are answered from Node with the
// workflow's GITHUB_TOKEN (GH_TOKEN) when there is one, read only (any write answers 403), and kept in --gh-cache, so
// the base and head captures see the same data and each URL costs one call per run.
// Each screen: 1440 by 900 and 390 by 844, light and dark (emails: light), full page up to three screens tall.
// Checks: page crash or error status, console errors, horizontal scroll at 390 px (render errors), axe-core WCAG A/AA
// violations (warnings). With --compare (the base capture), the share of pixels that changed. An error already on the
// base (same screen, size and theme) is a warning, not a failure: the check fails only on what the pull request adds.
//
// Browser: playwright-core with the runner's Chrome (BRIDGE_CHROME_CHANNEL=chrome) or Chromium: nothing to download.
import { createServer } from 'node:http';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync, copyFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(HERE, '..');
export const MAP_FILE = join(HERE, 'screens.map.json');
export const MARKER = '<!-- bridge-screens -->';
export const VIEWPORTS = { desktop: { width: 1440, height: 900 }, mobile: { width: 390, height: 844 } };
export const THEMES = ['light', 'dark'];
/** Full page captures stop at this many window heights. */
export const MAX_SCREENS_TALL = 3;
/** A pixel counts as changed past this difference on any channel (0 to 255): anti-aliasing noise stays below. */
export const PIXEL_THRESHOLD = 24;
/** GitHub caps a comment at 65,536 characters. */
export const MAX_COMMENT = 60000;
const CONCURRENCY = 3;
const SAMPLE_ORIGIN = 'https://bridge.example';

// ---------------------------------------------------------------------------------------------------------------
// Pure parts (scripts/screens.test.mjs).

/** A glob of the map as a RegExp: `**` any folders, `*` any part of one name. */
export function globToRegExp(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*' && glob[i + 1] === '*') {
      // "a/**" matches everything under a/, "**/b" b in any folder.
      re += '.*';
      i++;
      if (glob[i + 1] === '/') i++;
    } else if (c === '*') re += '[^/]*';
    else re += c.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`);
}

const matchesAny = (file, globs) => globs.some((g) => globToRegExp(g).test(file));

/** Tests, stories and docs JSON never change a screen. */
const NOT_UI = /\.(test|spec|stories)\.[cm]?[jt]sx?$|\.docs\.json$|\.md$/;

export const loadMap = (file = MAP_FILE) => JSON.parse(readFileSync(file, 'utf8'));

/**
 * The screens a list of changed files shows: every rule that matches adds its screens; a UI file no rule matches
 * adds the default set. Changes to the check itself (script, map, workflow) render the default set. At most
 * map.maxScreens, rule screens first. `why` says which files brought each screen.
 */
export function planScreens(files, map) {
  const ui = files.filter((f) => matchesAny(f, map.ui) && !NOT_UI.test(f));
  const why = new Map();
  const ruled = new Set();
  const add = (id, file, byRule) => {
    if (!map.screens[id]) throw new Error(`screens.map.json: unknown screen "${id}"`);
    if (!why.has(id)) why.set(id, []);
    if (!why.get(id).includes(file)) why.get(id).push(file);
    if (byRule) ruled.add(id);
  };
  for (const f of ui) {
    const rules = map.rules.filter((r) => matchesAny(f, r.files));
    if (rules.length) for (const r of rules) for (const id of r.screens) add(id, f, true);
    else for (const id of map.default) add(id, f, false);
  }
  // Screens a rule named first (the ones the change is about), then the default set.
  const all = [...why.keys()].sort((a, b) => Number(ruled.has(b)) - Number(ruled.has(a)));
  const max = map.maxScreens ?? 8;
  const screens = all.slice(0, max);
  return { screens, why: Object.fromEntries(screens.map((id) => [id, why.get(id)])), ui, dropped: all.slice(max) };
}

const OWNER = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/;
const REPO = /^[A-Za-z0-9._-]{1,100}$/;
const SLUG = /^[A-Za-z0-9][A-Za-z0-9-]*$/;

/**
 * The shell a team or Library address is served from when no file answers it, as vercel.json rewrites it (and
 * dev/local-api.ts teamRewrite): /studio/<owner>/<repo>/... to /team-shell/..., products to one product shell,
 * /library/<owner>/<repo>/... to /library-shell/.... `reserved`: first parts of real Studio pages. Path only.
 */
export function rewrite(pathname, reserved) {
  const parts = pathname.split('/');
  if (parts[1] === 'studio') {
    const escaped = parts[2] === '~';
    const [owner, repo] = escaped ? [parts[3], parts[4]] : [parts[2], parts[3]];
    if (!owner || !repo || !OWNER.test(owner) || !REPO.test(repo) || repo === '.' || repo === '..') return null;
    if (!escaped && reserved.has(owner)) return null;
    const rest = parts.slice(escaped ? 5 : 4);
    if (rest[0] === 'products' && rest[1] && SLUG.test(rest[1]) && !rest[2]) return '/team-shell/products/item/';
    return `/team-shell/${rest.join('/')}`;
  }
  if (parts[1] === 'library') {
    const [owner, repo] = [parts[2], parts[3]];
    if (!owner || !repo || !OWNER.test(owner) || !REPO.test(repo) || repo === '.' || repo === '..') return null;
    const rest = parts.slice(4);
    if (rest[0] === 'components' && rest[1] && SLUG.test(rest[1])) return '/library-shell/components/item/';
    return `/library-shell/${rest.join('/')}`;
  }
  return null;
}

/** An error message without what changes between runs (ports, line numbers, hashes): the same error compares equal. */
export const normalizeError = (text) =>
  String(text ?? '')
    .replace(/https?:\/\/(localhost|127\.0\.0\.1):\d+/g, '')
    .replace(/:\d+:\d+/g, '')
    .replace(/[.-][A-Za-z0-9_-]{8}\.(js|css)/g, '.$1')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 240);

/** File stem of one capture: home-desktop-dark. */
export const shotName = (screen, viewport, theme) => `${screen}-${viewport}-${theme}`;

/** The variants of a screen: two sizes, its themes (both, or light only for emails). */
export function variantsOf(screen) {
  const themes = screen.themes ?? THEMES;
  return Object.keys(VIEWPORTS).flatMap((viewport) => themes.map((theme) => ({ viewport, theme })));
}

/** What a capture found that fails the check, each as one line. Empty: it rendered. */
export function renderErrors(v) {
  const out = [];
  if (v.crash) out.push(`page error: ${v.crash}`);
  if (v.status && v.status >= 400) out.push(`HTTP ${v.status}`);
  for (const e of v.pageErrors ?? []) out.push(`uncaught: ${normalizeError(e)}`);
  for (const e of v.consoleErrors ?? []) out.push(`console: ${normalizeError(e)}`);
  if (v.overflow) out.push(`horizontal scroll at ${VIEWPORTS[v.viewport].width} px (${v.overflow.scrollWidth} px wide${v.overflow.offenders?.length ? `: ${v.overflow.offenders.join(', ')}` : ''})`);
  return out;
}

/**
 * The verdict of a run: render errors new against the base (same screen, size and theme) fail; those the base already
 * had, and every axe violation, are warnings. Without a base capture of a variant, its errors are new.
 */
export function verdict(after, before) {
  const failures = [];
  const warnings = [];
  const baseOf = new Map((before?.variants ?? []).map((v) => [shotName(v.screen, v.viewport, v.theme), v]));
  for (const v of after.variants) {
    const where = `${after.labels?.[v.screen] ?? v.screen}, ${v.viewport} ${v.theme}`;
    const base = baseOf.get(shotName(v.screen, v.viewport, v.theme));
    const baseErrs = new Set(base ? renderErrors(base).map(stripNumbers) : []);
    for (const e of renderErrors(v)) {
      if (base && baseErrs.has(stripNumbers(e))) warnings.push({ where, text: `${e} (already on main)` });
      else failures.push({ where, text: e });
    }
    for (const a of v.axe ?? []) warnings.push({ where, text: `axe ${a.id} (${a.impact ?? 'minor'}, ${a.nodes} ${a.nodes === 1 ? 'element' : 'elements'}): ${a.help}`, axe: true });
  }
  return { failed: failures.length > 0, failures, warnings };
}

// Overflow widths move with content; the fact of an overflow is what compares.
const stripNumbers = (s) => s.replace(/\(\d+ px wide[^)]*\)/, '').replace(/\d+/g, '#');

const pct = (r) => (r == null ? '' : r === 0 ? 'no change' : r < 0.001 ? '<0.1%' : `${(r * 100).toFixed(r < 0.1 ? 1 : 0)}%`);

/**
 * The sticky comment: what was rendered and why, failures, a grid per screen (Light and Dark columns, desktop and
 * mobile rows), the base images under "Before (main)" for the views that changed, and warnings folded.
 */
export function commentBody({ after, before, check, pr, sha, baseSha, rawBase, runUrl, durationS }) {
  const L = [];
  const short = (s) => (s ? s.slice(0, 7) : '');
  const label = (id) => after.labels?.[id] ?? id;
  const img = (dir, v, w) => {
    const file = `${dir}/${shotName(v.screen, v.viewport, v.theme)}.webp`;
    return rawBase ? `<a href="${rawBase}/${file}"><img src="${rawBase}/${file}" width="${w}" alt="${label(v.screen)}, ${v.viewport} ${v.theme}"></a>` : `\`${file}\``;
  };
  L.push(MARKER, '## Screens', '');
  const screenIds = [...new Set(after.variants.map((v) => v.screen))];
  const changedScreens = screenIds.filter((id) => after.variants.some((v) => v.screen === id && v.diff && v.diff.ratio > 0));
  L.push(
    `${screenIds.length} ${screenIds.length === 1 ? 'screen' : 'screens'} rendered at \`${short(sha)}\`${before ? `, compared with main at \`${short(baseSha)}\`` : ''}. Sample team and public pages only.` +
      `${runUrl ? ` [Run and full-size PNGs](${runUrl})` : ''}${durationS ? ` (${Math.round(durationS)} s)` : ''}.`,
  );
  L.push('');
  if (check.failures.length) {
    L.push(`**Render errors (${check.failures.length})**, the Screens check fails until they are fixed:`, '');
    for (const f of check.failures.slice(0, 30)) L.push(`- ${f.where}: ${escapeMd(f.text)}`);
    if (check.failures.length > 30) L.push(`- And ${check.failures.length - 30} more in the run.`);
    L.push('');
  } else L.push('No render errors: no crash, no console error, no horizontal scroll at 390 px.', '');
  if (before) L.push(changedScreens.length ? `Changed against main: ${changedScreens.map(label).join(', ')}.` : 'No visible change against main on these screens.', '');

  const order = [...changedScreens, ...screenIds.filter((id) => !changedScreens.includes(id))];
  for (const id of order) {
    const vs = after.variants.filter((v) => v.screen === id);
    const themes = [...new Set(vs.map((v) => v.theme))];
    const changed = vs.filter((v) => v.diff && v.diff.ratio > 0);
    const why = after.why?.[id]?.length ? ` · from ${after.why[id].slice(0, 3).map((f) => `\`${f.split('/').pop()}\``).join(', ')}${after.why[id].length > 3 ? ` and ${after.why[id].length - 3} more` : ''}` : '';
    const state = !before ? '' : changed.length ? ` · changed in ${changed.length} of ${vs.length} views (up to ${pct(Math.max(...changed.map((v) => v.diff.ratio)))})` : vs.some((v) => v.diff) ? ' · no change' : ' · new';
    const grid = (dir, pick) => {
      const rows = ['', `| | ${themes.map((t) => (t === 'light' ? 'Light' : 'Dark')).join(' | ')} |`, `| --- | ${themes.map(() => '---').join(' | ')} |`];
      for (const vp of Object.keys(VIEWPORTS)) {
        const cells = themes.map((t) => {
          const v = vs.find((x) => x.viewport === vp && x.theme === t);
          if (!v || !pick(v)) return ' ';
          if (!v.webp) return 'not captured';
          return `${img(dir, v, vp === 'desktop' ? 360 : 180)}${dir === 'after' && v.diff ? `<br><sub>${pct(v.diff.ratio)}</sub>` : ''}`;
        });
        rows.push(`| ${vp === 'desktop' ? 'Desktop 1440' : 'Mobile 390'} | ${cells.join(' | ')} |`);
      }
      return rows.join('\n');
    };
    L.push(`<details${changed.length || !before ? ' open' : ''}><summary><b>${label(id)}</b>${state}${why}</summary>`, '');
    L.push(`\`${after.paths?.[id] ?? ''}\``, grid('after', () => true), '');
    if (changed.length && before) L.push('<details><summary>Before (main)</summary>', grid('before', (v) => v.diff && v.diff.ratio > 0), '', '</details>', '');
    L.push('</details>', '');
  }
  if (check.warnings.length) {
    const axe = check.warnings.filter((w) => w.axe);
    const other = check.warnings.filter((w) => !w.axe);
    L.push(`<details><summary>Warnings: ${other.length ? `${other.length} already on main, ` : ''}${axe.length} accessibility (axe)</summary>`, '');
    for (const w of [...other, ...axe].slice(0, 60)) L.push(`- ${w.where}: ${escapeMd(w.text)}`);
    if (check.warnings.length > 60) L.push(`- And ${check.warnings.length - 60} more in the run.`);
    L.push('', '</details>', '');
  }
  if (after.dropped?.length) L.push(`Not rendered (over the ${after.variants.length ? 'per run' : ''} limit): ${after.dropped.map(label).join(', ')}.`, '');
  if (after.github) L.push(`<sub>GitHub reads: ${after.github.calls} calls${after.github.cached ? `, ${after.github.cached} from the shared cache` : ''}. How to read this: docs/VISUAL-CHECK.md.</sub>`);
  let body = L.join('\n');
  if (body.length > MAX_COMMENT) body = `${body.slice(0, MAX_COMMENT)}\n\n_Cut: the full list is in the run._`;
  return body;
}

const escapeMd = (s) => String(s).replace(/\|/g, '\\|').replace(/</g, '&lt;').replace(/\r?\n/g, ' ');

// ---------------------------------------------------------------------------------------------------------------
// Static server with the rewrites of vercel.json.

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml', '.zip': 'application/zip', '.webmanifest': 'application/manifest+json' };

function fileFor(root, pathname) {
  let p;
  try {
    p = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  const full = resolve(root, `.${p}`);
  if (full !== root && !full.startsWith(root + sep)) return null;
  if (existsSync(full) && statSync(full).isFile()) return full;
  const index = join(full, 'index.html');
  if (existsSync(index)) return index;
  if (existsSync(`${full}.html`)) return `${full}.html`;
  return null;
}

/** One fixed port: the site prints its own address (connector URLs), so base and head must share it to compare. */
export const PORT = 4173;

export function serve(site, port = PORT) {
  const root = resolve(site);
  const studio = join(root, 'studio');
  const reserved = new Set(existsSync(studio) ? readdirSync(studio).map((f) => f.replace(/\.(html|json)$/, '')) : []);
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname.startsWith('/api/')) {
      // No functions in a static build: the page gets what it gets from a site without them.
      res.writeHead(404, { 'content-type': 'application/json' });
      return res.end('{"error":"not_found","message":"No functions in the Screens check."}');
    }
    let file = fileFor(root, url.pathname);
    if (!file) {
      const to = rewrite(url.pathname, reserved);
      if (to) file = fileFor(root, to);
    }
    if (!file) {
      res.writeHead(404, { 'content-type': TYPES['.html'] });
      const nf = join(root, '404.html');
      return res.end(existsSync(nf) ? readFileSync(nf) : 'Not found');
    }
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(readFileSync(file));
  });
  return new Promise((ok) => server.listen(port, '127.0.0.1', () => ok({ origin: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((d) => server.close(d)) })));
}

// ---------------------------------------------------------------------------------------------------------------
// Emails: notify-mail rendered with sample names, from the checkout being captured (base or head).

export const SAMPLE_LINKS = { to: 'you@example.com', settings: `${SAMPLE_ORIGIN}/studio/#account`, unsubscribe: `${SAMPLE_ORIGIN}/api/notify?unsubscribe=sample` };

export function sampleNotices(now = Date.UTC(2026, 10, 2, 9)) {
  const team = 'Acme Design';
  const teamRepo = 'peterbono/bridge-demo-ds';
  const at = (h) => now - h * 3600_000;
  const href = (q) => `${SAMPLE_ORIGIN}/studio/peterbono/bridge-demo-ds/changes/${q}`;
  return [
    { id: 's1', kind: 'question', title: 'Profile page', actor: 'Dana', team, teamRepo, href: href('?exploration=36'), at: at(5) },
    { id: 's2', kind: 'look', title: 'Notification channels', actor: 'Theo', team, teamRepo, href: href('?exploration=47'), at: at(4) },
    { id: 's3', kind: 'changes', title: 'Team seats and roles', actor: 'Dana', team, teamRepo, href: href('?exploration=46'), at: at(3) },
    { id: 's4', kind: 'shipped', title: 'Invoice status as badges', actor: 'Theo', team, teamRepo, href: href('?exploration=45'), at: at(2) },
    { id: 's5', kind: 'declined', title: 'Avatar xl size', actor: 'Dana', team, teamRepo, href: href('?pr=26'), at: at(1) },
  ];
}

async function renderEmails(root) {
  const docs = join(root, 'apps', 'docs-site');
  const mod = join(docs, 'api', '_lib', 'notify-mail.ts');
  if (!existsSync(mod)) return {};
  const require = createRequire(join(root, 'package.json'));
  const { runnerImport } = await import(pathToFileURL(require.resolve('vite')).href);
  const { module: m } = await runnerImport(mod, { configFile: false, root: docs, logLevel: 'silent' });
  const items = sampleNotices();
  const out = {};
  try {
    out.instant = m.instantEmail(items[0], SAMPLE_LINKS).html;
  } catch (e) {
    out.instantError = String(e?.message ?? e);
  }
  try {
    out.digest = m.digestEmail(items, { ...SAMPLE_LINKS, home: `${SAMPLE_ORIGIN}/studio/peterbono/bridge-demo-ds/` })?.html ?? null;
  } catch (e) {
    out.digestError = String(e?.message ?? e);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Capture.

const HIDE_CSS = `[data-bridge-toolbar], vercel-live-feedback, #vercel-live-feedback, vercel-toolbar { display: none !important; }
*, *::before, *::after { animation-duration: 0s !important; animation-delay: 0s !important; transition-duration: 0s !important; transition-delay: 0s !important; caret-color: transparent !important; }`;

/** GitHub reads of the page, answered from Node with the workflow token and kept for the whole run (and the next). */
function githubCache(file, token) {
  const kept = new Map();
  let cached = 0;
  let calls = 0;
  if (file && existsSync(file)) {
    try {
      for (const [k, v] of Object.entries(JSON.parse(readFileSync(file, 'utf8')).entries ?? {})) kept.set(k, v);
    } catch {
      /* a broken cache file is an empty cache */
    }
  }
  const preloaded = kept.size;
  const inflight = new Map();
  const CORS = { 'access-control-allow-origin': '*', 'access-control-expose-headers': 'ETag, Link, X-RateLimit-Remaining, X-RateLimit-Reset' };
  const KEEP = ['content-type', 'etag', 'link', 'x-ratelimit-remaining', 'x-ratelimit-reset', 'x-ratelimit-limit'];
  async function handle(route) {
    const req = route.request();
    const method = req.method();
    if (method === 'OPTIONS') return route.fulfill({ status: 204, headers: { ...CORS, 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET, HEAD' } });
    if (method !== 'GET' && method !== 'HEAD') return route.fulfill({ status: 403, headers: { ...CORS, 'content-type': 'application/json' }, body: '{"message":"The Screens check reads only."}' });
    const key = req.url();
    let hit = kept.get(key);
    if (hit) cached++;
    else {
      if (!inflight.has(key)) {
        inflight.set(
          key,
          (async () => {
            calls++;
            const headers = { ...req.headers() };
            delete headers['if-none-match'];
            delete headers['if-modified-since'];
            if (token && new URL(key).hostname === 'api.github.com') headers.authorization = `Bearer ${token}`;
            const res = await route.fetch({ headers, maxRetries: 1 });
            const h = {};
            for (const k of KEEP) if (res.headers()[k]) h[k] = res.headers()[k];
            const entry = { status: res.status(), headers: h, body: (await res.body()).toString('base64') };
            if (entry.status < 500 && entry.status !== 403 && entry.status !== 429) kept.set(key, entry);
            return entry;
          })().finally(() => setTimeout(() => inflight.delete(key), 0)),
        );
      }
      hit = await inflight.get(key);
    }
    return route.fulfill({ status: hit.status, headers: { ...hit.headers, ...CORS }, body: Buffer.from(hit.body, 'base64') });
  }
  return {
    handle,
    stats: () => ({ calls, cached, preloaded }),
    save() {
      if (!file) return;
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, JSON.stringify({ entries: Object.fromEntries(kept) }));
    },
  };
}

async function launch(root) {
  const require = createRequire(join(root, 'package.json'));
  let pw;
  try {
    pw = await import(pathToFileURL(require.resolve('playwright-core')).href);
  } catch {
    pw = await import(pathToFileURL(createRequire(join(REPO_ROOT, 'package.json')).resolve('playwright-core')).href);
  }
  const chromium = pw.chromium ?? pw.default?.chromium;
  const channel = process.env.BRIDGE_CHROME_CHANNEL || undefined;
  return chromium.launch({ headless: true, ...(channel ? { channel } : {}) });
}

function axeSource(root) {
  for (const base of [root, REPO_ROOT]) {
    try {
      return readFileSync(createRequire(join(base, 'package.json')).resolve('axe-core/axe.min.js'), 'utf8');
    } catch {
      /* next */
    }
  }
  return null;
}

/** Real horizontal scroll (not clipped content): scroll right and see whether the page moved, then name the cause. */
const OVERFLOW_PROBE = () => {
  const w = document.documentElement.clientWidth;
  window.scrollTo(100000, window.scrollY);
  const moved = window.scrollX > 0;
  const scrollWidth = Math.max(document.documentElement.scrollWidth, document.body ? document.body.scrollWidth : 0);
  window.scrollTo(0, 0);
  if (!moved) return null;
  const clips = (el) => {
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      const o = getComputedStyle(p).overflowX;
      if (o !== 'visible') return true;
    }
    return false;
  };
  const name = (el) => `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}${typeof el.className === 'string' && el.className.trim() ? `.${el.className.trim().split(/\s+/).slice(0, 2).join('.')}` : ''}`;
  const offenders = [];
  for (const el of document.querySelectorAll('body *')) {
    const r = el.getBoundingClientRect();
    if (!r.width || r.right <= w + 1) continue;
    const pr = el.parentElement?.getBoundingClientRect();
    if (pr && pr.right > w + 1) continue;
    if (clips(el)) continue;
    offenders.push(`${name(el)} (${Math.round(r.right)} px)`);
    if (offenders.length >= 3) break;
  }
  return { scrollWidth, offenders };
};

/** Downscale-free PNG to WebP and the pixel difference with the base, in a blank page: no image library on the runner. */
async function imageTools(browser) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.setContent('<!doctype html><title>tools</title>');
  return {
    webp: async (png) =>
      Buffer.from(
        await page.evaluate(async (b64) => {
          const img = new Image();
          img.src = `data:image/png;base64,${b64}`;
          await img.decode();
          const c = document.createElement('canvas');
          c.width = img.width;
          c.height = img.height;
          c.getContext('2d').drawImage(img, 0, 0);
          return c.toDataURL('image/webp', 0.8).split(',')[1];
        }, png.toString('base64')),
        'base64',
      ),
    diff: (a, b, threshold = PIXEL_THRESHOLD) =>
      page.evaluate(
        async ({ a, b, t }) => {
          const load = async (s) => {
            const i = new Image();
            i.src = `data:image/png;base64,${s}`;
            await i.decode();
            return i;
          };
          const [ia, ib] = await Promise.all([load(a), load(b)]);
          const w = Math.min(ia.width, ib.width);
          const h = Math.min(ia.height, ib.height);
          const px = (img) => {
            const c = document.createElement('canvas');
            c.width = w;
            c.height = h;
            const g = c.getContext('2d', { willReadFrequently: true });
            g.drawImage(img, 0, 0);
            return g.getImageData(0, 0, w, h).data;
          };
          const da = px(ia);
          const db = px(ib);
          let changed = 0;
          let box = null;
          for (let i = 0; i < da.length; i += 4) {
            if (Math.abs(da[i] - db[i]) <= t && Math.abs(da[i + 1] - db[i + 1]) <= t && Math.abs(da[i + 2] - db[i + 2]) <= t) continue;
            changed++;
            const x = (i / 4) % w;
            const y = Math.floor(i / 4 / w);
            box = box ? { x0: Math.min(box.x0, x), y0: Math.min(box.y0, y), x1: Math.max(box.x1, x), y1: Math.max(box.y1, y) } : { x0: x, y0: y, x1: x, y1: y };
          }
          const area = Math.max(ia.width * ia.height, ib.width * ib.height);
          // Extra height on one side counts as changed.
          const pixels = changed + area - w * h;
          return { ratio: area ? pixels / area : 0, pixels, box, sizeChanged: ia.width !== ib.width || ia.height !== ib.height };
        },
        { a: a.toString('base64'), b: b.toString('base64'), t: threshold },
      ),
    close: () => ctx.close(),
  };
}

async function captureVariant({ browser, origin, screen, id, viewport, theme, github, axe, emails, out, storage }) {
  const size = VIEWPORTS[viewport];
  const v = { screen: id, viewport, theme, consoleErrors: [], pageErrors: [], notes: [] };
  const started = Date.now();
  const context = await browser.newContext({ viewport: size, deviceScaleFactor: 1, colorScheme: theme, reducedMotion: 'reduce', serviceWorkers: 'block', locale: 'en-US', timezoneId: 'UTC' });
  try {
    // The theme, and what a returning visitor has already dismissed (map.storage: first-visit tours), so the screen shows.
    await context.addInitScript(
      ({ t, kept }) => {
        try {
          localStorage.setItem('ds-theme', t);
          for (const [k, val] of Object.entries(kept)) localStorage.setItem(k, val);
        } catch {
          /* storage blocked */
        }
      },
      { t: theme, kept: { ...(storage ?? {}), ...(screen.storage ?? {}) } },
    );
    // GitHub (the sample team's data) through the cache; other outside hosts are cut, so the page is the same each run.
    await context.route(/^https:\/\/(api\.github\.com|raw\.githubusercontent\.com)\//, (r) => github.handle(r));
    await context.route(
      (url) => !/^(127\.0\.0\.1|localhost|github\.com|api\.github\.com|raw\.githubusercontent\.com|avatars\.githubusercontent\.com)$/.test(url.hostname) && url.protocol !== 'data:' && url.protocol !== 'blob:',
      (r) => r.abort('blockedbyclient'),
    );
    const page = await context.newPage();
    page.on('console', (msg) => {
      if (msg.type() !== 'error') return;
      const loc = msg.location()?.url ?? '';
      const text = msg.text();
      if (/^Failed to load resource/.test(text)) {
        // No functions (/api/*) in a static build, and outside hosts are cut on purpose: noted, never an error.
        if (/\/api\//.test(loc) || (loc && !/^https?:\/\/(127\.0\.0\.1|localhost)[:/]/.test(loc))) {
          v.notes.push(`${text.replace(/^Failed to load resource: /, '')} ${loc.replace(origin, '')}`);
          return;
        }
      }
      if (/ERR_BLOCKED_BY_CLIENT/.test(text)) return;
      v.consoleErrors.push(loc && !text.includes(loc) ? `${text} (${loc.replace(origin, '')})` : text);
    });
    page.on('pageerror', (e) => v.pageErrors.push(String(e?.message ?? e)));
    page.on('crash', () => (v.crash = 'the page crashed'));
    if (screen.email) {
      const html = emails[screen.email];
      if (!html) throw new Error(emails[`${screen.email}Error`] ?? `no ${screen.email} email in this checkout`);
      await page.setContent(html, { waitUntil: 'load' });
    } else {
      const res = await page.goto(`${origin}${screen.path}`, { waitUntil: 'load', timeout: 45000 });
      v.status = res?.status() ?? null;
      await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => v.notes.push('network never went idle (15 s)'));
      await page.waitForFunction(() => !document.querySelector('[aria-busy="true"]'), null, { timeout: 6000 }).catch(() => v.notes.push('still marked busy after 6 s'));
    }
    await page.evaluate(() => document.fonts?.ready).catch(() => undefined);
    await page.addStyleTag({ content: HIDE_CSS }).catch(() => undefined);
    await page.waitForTimeout(400);
    if (viewport === 'mobile') v.overflow = await page.evaluate(OVERFLOW_PROBE);
    const height = await page.evaluate(() => Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0));
    const clipH = Math.min(Math.max(height, size.height), size.height * MAX_SCREENS_TALL);
    const png = await page.screenshot({ type: 'png', fullPage: true, clip: { x: 0, y: 0, width: size.width, height: clipH } });
    v.height = clipH;
    v.fullHeight = height;
    v.png = `${shotName(id, viewport, theme)}.png`;
    writeFileSync(join(out, v.png), png);
    if (axe) {
      await page.addScriptTag({ content: axe }).catch(() => undefined);
      const found = await page
        .evaluate(async () => {
          if (!window.axe) return null;
          const r = await window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] }, resultTypes: ['violations'] });
          return r.violations.map((x) => ({ id: x.id, impact: x.impact, nodes: x.nodes.length, help: x.help }));
        })
        .catch(() => null);
      if (found) v.axe = found;
      else v.notes.push('axe did not run');
    }
    return { v, png };
  } catch (e) {
    v.crash = String(e?.message ?? e).split('\n')[0].slice(0, 300);
    return { v, png: null };
  } finally {
    v.ms = Date.now() - started;
    await context.close().catch(() => undefined);
  }
}

export async function capture({ site, root = REPO_ROOT, out, screens: ids, map = loadMap(), ghCache, token, compare, why = {}, dropped = [] }) {
  mkdirSync(out, { recursive: true });
  const started = Date.now();
  const server = await serve(site);
  const browser = await launch(root);
  const github = githubCache(ghCache, token);
  const axe = axeSource(root);
  const needsEmail = ids.some((id) => map.screens[id]?.email);
  let emails = {};
  if (needsEmail) emails = await renderEmails(root).catch((e) => ({ instantError: String(e?.message ?? e), digestError: String(e?.message ?? e) }));
  const tools = await imageTools(browser);
  const jobs = ids.flatMap((id) => variantsOf(map.screens[id]).map((x) => ({ id, ...x })));
  const variants = [];
  try {
    let next = 0;
    const worker = async () => {
      while (next < jobs.length) {
        const j = jobs[next++];
        const { v, png } = await captureVariant({ browser, origin: server.origin, screen: map.screens[j.id], id: j.id, viewport: j.viewport, theme: j.theme, github, axe, emails, out, storage: map.storage });
        if (png) {
          const webp = await tools.webp(png);
          v.webp = `${shotName(j.id, j.viewport, j.theme)}.webp`;
          writeFileSync(join(out, v.webp), webp);
          const basePng = compare ? join(compare, v.png) : null;
          if (basePng && existsSync(basePng)) v.diff = await tools.diff(png, readFileSync(basePng));
        }
        variants.push(v);
        log(`${shotName(j.id, j.viewport, j.theme)}: ${v.crash ? `failed (${v.crash})` : `${v.ms} ms${v.diff ? `, ${pct(v.diff.ratio)}` : ''}${v.consoleErrors.length ? `, ${v.consoleErrors.length} console errors` : ''}${v.overflow ? ', horizontal scroll' : ''}${v.axe?.length ? `, ${v.axe.length} axe` : ''}`}`);
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, jobs.length) }, worker));
  } finally {
    await tools.close().catch(() => undefined);
    await browser.close().catch(() => undefined);
    await server.close();
    github.save();
  }
  const order = (v) => ids.indexOf(v.screen) * 10 + Object.keys(VIEWPORTS).indexOf(v.viewport) * 2 + THEMES.indexOf(v.theme);
  variants.sort((a, b) => order(a) - order(b));
  const report = {
    version: 1,
    screens: ids,
    labels: Object.fromEntries(ids.map((id) => [id, map.screens[id].label])),
    paths: Object.fromEntries(ids.map((id) => [id, map.screens[id].path ?? `email: ${map.screens[id].email}`])),
    why,
    dropped,
    variants,
    github: github.stats(),
    seconds: Math.round((Date.now() - started) / 1000),
  };
  writeFileSync(join(out, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  log(`Captured ${variants.filter((v) => v.webp).length} of ${jobs.length} views in ${report.seconds} s, ${report.github.calls} GitHub calls (${report.github.cached} cached).`);
  return report;
}

// ---------------------------------------------------------------------------------------------------------------
// Report: comment, publish folder, verdict.

export function report({ afterDir, beforeDir, out, pr, sha, baseSha, rawBase, runUrl, durationS }) {
  const after = JSON.parse(readFileSync(join(afterDir, 'report.json'), 'utf8'));
  const before = beforeDir && existsSync(join(beforeDir, 'report.json')) ? JSON.parse(readFileSync(join(beforeDir, 'report.json'), 'utf8')) : null;
  const check = verdict(after, before);
  mkdirSync(out, { recursive: true });
  // The folder pushed to bridge-shots: every head image, base images only for views that changed.
  const pub = join(out, 'publish');
  rmSync(pub, { recursive: true, force: true });
  mkdirSync(join(pub, 'after'), { recursive: true });
  for (const v of after.variants) {
    if (!v.webp) continue;
    copyFileSync(join(afterDir, v.webp), join(pub, 'after', v.webp));
    if (before && v.diff && v.diff.ratio > 0 && existsSync(join(beforeDir, v.webp))) {
      mkdirSync(join(pub, 'before'), { recursive: true });
      copyFileSync(join(beforeDir, v.webp), join(pub, 'before', v.webp));
    }
  }
  const body = commentBody({ after, before, check, pr, sha, baseSha, rawBase, runUrl, durationS });
  writeFileSync(join(out, 'comment.md'), `${body}\n`);
  const summary = { pr, sha, baseSha, failed: check.failed, failures: check.failures, warnings: check.warnings.length, screens: after.screens };
  writeFileSync(join(out, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
  writeFileSync(join(pub, 'report.json'), `${JSON.stringify({ ...summary, variants: after.variants.map(({ notes, ...v }) => v) }, null, 2)}\n`);
  return { check, body };
}

// ---------------------------------------------------------------------------------------------------------------

const log = (...a) => console.log(...a);

function args(argv) {
  const o = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const k = a.slice(2);
      const n = argv[i + 1];
      if (n === undefined || n.startsWith('--')) o[k] = true;
      else {
        o[k] = n;
        i++;
      }
    } else o._.push(a);
  }
  return o;
}

const output = (pairs) => {
  if (!process.env.GITHUB_OUTPUT) return;
  writeFileSync(process.env.GITHUB_OUTPUT, Object.entries(pairs).map(([k, v]) => `${k}=${v}\n`).join(''), { flag: 'a' });
};

async function main() {
  const a = args(process.argv.slice(2));
  const cmd = a._[0];
  const map = loadMap(a.map || MAP_FILE);
  if (cmd === 'plan') {
    let files;
    if (a.files) files = String(a.files).split(/[,\n]/).map((s) => s.trim()).filter(Boolean);
    else {
      if (!a.base) throw new Error('--base <sha> or --files is required');
      files = execFileSync('git', ['diff', '--name-only', a.base, a.head || 'HEAD'], { encoding: 'utf8' }).split('\n').filter(Boolean);
    }
    const plan = planScreens(files, map);
    const file = a.out || null;
    if (file) writeFileSync(file, `${JSON.stringify(plan, null, 2)}\n`);
    log(plan.screens.length ? `Screens: ${plan.screens.join(', ')} (from ${plan.ui.length} UI files).` : 'No UI file changed: nothing to render.');
    output({ screens: plan.screens.join(','), run: plan.screens.length > 0 });
  } else if (cmd === 'capture') {
    if (!a.site || !a.out || !a.screens) throw new Error('--site, --out and --screens are required');
    const plan = a.plan && existsSync(a.plan) ? JSON.parse(readFileSync(a.plan, 'utf8')) : {};
    await capture({
      site: a.site,
      root: resolve(a.root || REPO_ROOT),
      out: a.out,
      screens: String(a.screens).split(',').filter(Boolean),
      map,
      ghCache: a['gh-cache'] || null,
      token: process.env.GH_TOKEN || process.env.GITHUB_TOKEN || null,
      compare: a.compare || null,
      why: plan.why ?? {},
      dropped: plan.dropped ?? [],
    });
  } else if (cmd === 'report') {
    if (!a.after || !a.out) throw new Error('--after and --out are required');
    const { check } = report({
      afterDir: a.after,
      beforeDir: a.before || null,
      out: a.out,
      pr: Number(a.pr) || null,
      sha: a.sha || '',
      baseSha: a['base-sha'] || '',
      rawBase: a['raw-base'] || '',
      runUrl: a['run-url'] || '',
      durationS: Number(a.duration) || 0,
    });
    log(check.failed ? `Render errors: ${check.failures.length}.` : 'No render errors.');
    for (const f of check.failures) log(`  ${f.where}: ${f.text}`);
    log(`Warnings: ${check.warnings.length}.`);
    output({ failed: check.failed });
  } else {
    console.error('Usage: node scripts/screens.mjs plan --base <sha> | capture --site <dist> --out <dir> --screens a,b | report --after <dir> --out <dir>');
    process.exit(1);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch((e) => {
    console.error(e?.stack ?? e);
    process.exit(1);
  });
}
