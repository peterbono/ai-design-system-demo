#!/usr/bin/env node
// Preview shots: a real thumbnail of every open exploration's preview, for Bridge Studio (the exploration page, the
// Studio home cards and the Changes rows). Run by .github/workflows/preview-shots.yml; see docs/EXPLORATIONS.md.
//
//   node scripts/preview-shots.mjs run --shots <dir> [--config bridge.config.json] [--force] [--dry-run]
//   node scripts/preview-shots.mjs capture --url <preview url> --out <file.webp> [--marker-crawl]
//
// `run` reads the open explorations of this repository and of each product repository in bridge.config.json
// products[] that has a `repo` and a `preview`, captures the preview of every head commit not captured yet, and writes
// into <dir> (a checkout of the orphan branch bridge-shots):
//   <owner>/<repo>/<pr>.webp   800 px wide, from a 1440 by 900 window (the changed screen when Bridge finds it)
//   <owner>/<repo>/<pr>.json   { repo, pr, sha, url, route, screen, title, branch, capturedAt, image, ... }
//   index.json                 every capture by "owner/repo#pr", the one file Studio reads (raw.githubusercontent.com)
// A capture is overwritten for a new head commit. A pull request closed without merging for more than 30 days loses
// its capture; a merged one keeps it ("how it looked").
// Privacy: a product repository's preview is captured only when that repository is public (GitHub says so); for a
// private one nothing is captured and any capture it had is removed, so Studio keeps its plate.
//
// GitHub: GITHUB_TOKEN of the workflow only (GH_TOKEN), never a person's token. The calls: per repository its
// visibility and its open pull requests; per head commit not captured yet its comments (the Vercel bot comment gives
// the preview URL Vercel built, shortened when long) and its commit statuses (is the preview of that commit ready),
// plus its files for a library exploration (which preview app). A closed pull request is read once, its state kept.
//
// Browser: playwright-core with the Chrome of the runner (BRIDGE_CHROME_CHANNEL=chrome) or Chromium. Dependencies
// come from BRIDGE_DEPS (a folder with node_modules/@bridge-ds/core and playwright-core), else this repository.
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const SHOTS_BRANCH = 'bridge-shots';
export const VIEWPORT = { width: 1440, height: 900 };
export const SHOT_WIDTH = 800;
/** A pull request closed without merging keeps its capture this long. */
export const PRUNE_AFTER_MS = 30 * 24 * 3600 * 1000;
/** Failed captures of one head commit before Bridge stops trying it (a new commit tries again). */
export const MAX_TRIES = 3;
/** Same-origin pages opened to look for the changed screen when the preview root has no marker. */
export const CRAWL_LIMIT = 8;
export const MARKER_ATTR = 'data-bridge-change';

const EXPLORATION_LABEL = 'exploration';
const ARCHIVED_LABEL = 'archived';
const PRODUCT_LABEL_PREFIX = 'product: ';

const labelNames = (p) => (p.labels ?? []).map((l) => (typeof l === 'string' ? l : (l?.name ?? ''))).filter(Boolean);

/** An open exploration Studio shows: the label, an explore/* branch or the Bridge block, not archived. */
export function isOpenExploration(p) {
  if (p.state && p.state !== 'open') return false;
  const names = labelNames(p);
  if (names.includes(ARCHIVED_LABEL)) return false;
  return names.includes(EXPLORATION_LABEL) || (p.head?.ref ?? '').startsWith('explore/') || /<!-- bridge-exploration \{/.test(p.body ?? '') || names.includes('ready-for-devs');
}

/** "peterbono/bridge-product-admin" and 2: the files of that capture, relative to the shots folder. */
export function shotPaths(repo, pr) {
  const base = `${repo.toLowerCase()}/${pr}`;
  return { image: `${base}.webp`, meta: `${base}.json` };
}

/** The key of a capture in index.json, and in Studio: "owner/repo#pr", lower case. */
export const shotKey = (repo, pr) => `${repo.toLowerCase()}#${pr}`;

/**
 * Which preview app of the design system repository shows a library exploration, from its files (the same order as
 * Studio's lib/exploration-page libraryPreviewApp): the admin demo, the docs, Storybook.
 */
export function libraryApp(files, apps) {
  const f = files ?? [];
  const has = (k) => Boolean(apps?.[k]);
  if (f.some((x) => x.startsWith('apps/admin/')) && has('admin')) return 'admin';
  if (f.some((x) => x.startsWith('apps/docs-site/')) && has('docs')) return 'docs';
  if (f.some((x) => x.startsWith('packages/react/')) && has('storybook')) return 'storybook';
  return has('docs') ? 'docs' : has('storybook') ? 'storybook' : has('admin') ? 'admin' : null;
}

/** The product a "product: <key>" label names, among the configured ones (null for the library or none). */
export function labelledProduct(p, products) {
  for (const l of labelNames(p)) {
    if (!l.toLowerCase().startsWith(PRODUCT_LABEL_PREFIX)) continue;
    const key = l.slice(PRODUCT_LABEL_PREFIX.length).trim().toLowerCase();
    const hit = (products ?? []).find((x) => x.key?.toLowerCase() === key || x.name?.toLowerCase() === key);
    if (hit && !hit.default) return hit;
  }
  return null;
}

/**
 * What to do with one exploration: skip it (already captured at this head, or tried too often) or capture it.
 * `stored` is its .json when there is one.
 */
export function shotDecision({ sha, stored, force = false }) {
  if (!force && stored?.sha === sha && stored?.image) return { action: 'skip', why: 'captured at this head' };
  if (!force && stored?.failed?.sha === sha && (stored.failed.tries ?? 0) >= MAX_TRIES) return { action: 'skip', why: `failed ${stored.failed.tries} times at this head` };
  return { action: 'capture' };
}

/**
 * A stored capture whose pull request is no longer open: keep it, or remove it. `closed` is what GitHub says (read
 * once, kept in the .json): merged keeps it ("how it looked"); closed without merging, removed after 30 days; reopened
 * (open again) keeps it.
 */
export function pruneDecision(meta, now) {
  if (!meta?.closed) return 'keep';
  if (meta.closed.merged) return 'keep';
  const at = Date.parse(meta.closed.at ?? '');
  if (!Number.isFinite(at)) return 'keep';
  return now - at > PRUNE_AFTER_MS ? 'remove' : 'keep';
}

/** index.json from every stored capture with an image: sorted keys, so an unchanged set writes the same bytes. */
export function buildIndex(metas) {
  const shots = {};
  for (const m of [...metas].filter((x) => x && x.image && x.sha).sort((a, b) => shotKey(a.repo, a.pr).localeCompare(shotKey(b.repo, b.pr)))) {
    shots[shotKey(m.repo, m.pr)] = {
      sha: m.sha,
      capturedAt: m.capturedAt,
      image: m.image,
      ...(m.url ? { url: m.url } : {}),
      ...(m.route ? { route: m.route } : {}),
      ...(m.screen ? { screen: m.screen } : {}),
      ...(m.closed ? { closed: m.closed } : {}),
    };
  }
  return { version: 1, branch: SHOTS_BRANCH, shots };
}

/** A same-origin link worth opening while looking for the changed screen: a page, not a file, an anchor or the root. */
export function crawlTargets(hrefs, origin, limit = CRAWL_LIMIT) {
  const seen = new Set(['/']);
  const out = [];
  for (const h of hrefs) {
    let u;
    try {
      u = new URL(h, origin);
    } catch {
      continue;
    }
    if (u.origin !== origin) continue;
    if (/\.(png|jpe?g|gif|svg|webp|pdf|zip|json|xml|txt|css|js)$/i.test(u.pathname)) continue;
    const path = u.pathname.replace(/\/+$/, '') || '/';
    if (seen.has(path)) continue;
    seen.add(path);
    out.push(`${origin}${u.pathname}${u.search}`);
    if (out.length >= limit) break;
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Dependencies, GitHub, files.

function deps() {
  const base = process.env.BRIDGE_DEPS ? resolve(process.env.BRIDGE_DEPS, 'package.json') : fileURLToPath(import.meta.url);
  const require = createRequire(base);
  const load = (name) => import(pathToFileURL(require.resolve(name)).href);
  return { core: () => load('@bridge-ds/core'), playwright: () => load('playwright-core') };
}

function gh(token) {
  const api = process.env.GITHUB_API_URL || 'https://api.github.com';
  let calls = 0;
  const get = async (path) => {
    calls++;
    const res = await fetch(`${api}${path}`, {
      headers: { accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', ...(token ? { authorization: `Bearer ${token}` } : {}), 'user-agent': 'bridge-preview-shots' },
    });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`GitHub ${res.status} on ${path}`);
    return res.json();
  };
  return { get, calls: () => calls };
}

const readJson = (file) => {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
};
const writeJson = (file, data) => {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
};

/** Every stored capture's .json under the shots folder (owner/repo/pr.json). */
function storedMetas(dir) {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const owner of readdirSync(dir)) {
    const od = join(dir, owner);
    if (owner.startsWith('.') || !statSync(od).isDirectory() || owner === 'apps' || owner === 'deploy') continue;
    for (const repo of readdirSync(od)) {
      const rd = join(od, repo);
      if (!statSync(rd).isDirectory()) continue;
      for (const f of readdirSync(rd)) {
        if (!/^\d+\.json$/.test(f)) continue;
        const m = readJson(join(rd, f));
        if (m && m.repo && m.pr) out.push({ ...m, file: relative(dir, join(rd, f)) });
      }
    }
  }
  return out;
}

const log = (...a) => console.log(...a);

// ---------------------------------------------------------------------------------------------------------------
// Capture.

const HIDE_CSS = `[data-bridge-toolbar], vercel-live-feedback, #vercel-live-feedback, [id^="vercel-toolbar"], vercel-toolbar { display: none !important; }
*, *::before, *::after { animation-duration: 0s !important; transition-duration: 0s !important; caret-color: transparent !important; }`;

async function settle(page, url) {
  await page.goto(url, { waitUntil: 'networkidle', timeout: 45000 }).catch(async (err) => {
    // A page that keeps a connection open never reaches network idle: the load event is enough.
    if (!/timeout/i.test(String(err?.message))) throw err;
    await page.waitForLoadState('load', { timeout: 10000 }).catch(() => undefined);
  });
  await page.evaluate(() => document.fonts?.ready).catch(() => undefined);
  await page.waitForTimeout(600);
}

const markerOf = (page) =>
  page.evaluate((attr) => {
    const el = document.querySelector(`[${attr}]`);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { label: el.getAttribute(attr) || null, top: r.top + window.scrollY, bottom: r.bottom + window.scrollY };
  }, MARKER_ATTR);

/** Downscales a PNG to `width` px and encodes it as WebP, in the browser: no image library on the runner. */
async function toWebp(context, png, width) {
  const page = await context.newPage();
  try {
    await page.setContent('<!doctype html><title>shot</title>');
    return Buffer.from(
      await page.evaluate(
        async ({ b64, w }) => {
          const img = new Image();
          img.src = `data:image/png;base64,${b64}`;
          await img.decode();
          const h = Math.round((img.height * w) / img.width);
          const c = document.createElement('canvas');
          c.width = w;
          c.height = h;
          const g = c.getContext('2d');
          g.imageSmoothingEnabled = true;
          g.imageSmoothingQuality = 'high';
          g.drawImage(img, 0, 0, w, h);
          return c.toDataURL('image/webp', 0.82).split(',')[1];
        },
        { b64: png.toString('base64'), w: width },
      ),
      'base64',
    );
  } finally {
    await page.close();
  }
}

/**
 * One capture: the preview root, or the first page that carries a change marker (data-bridge-change) among the root's
 * same-origin links, scrolled so the marked area is in view. No ?bridge parameter: the Bridge toolbar stays closed.
 */
export async function captureOne(browser, url, { crawl = true } = {}) {
  const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1, colorScheme: 'light', reducedMotion: 'reduce', serviceWorkers: 'block' });
  try {
    const page = await context.newPage();
    const root = new URL(url);
    await settle(page, root.href);
    let marker = await markerOf(page);
    if (!marker && crawl) {
      const hrefs = await page.$$eval('a[href]', (as) => as.map((a) => a.getAttribute('href') || ''));
      for (const target of crawlTargets(hrefs, root.origin)) {
        await settle(page, target).catch(() => undefined);
        marker = await markerOf(page).catch(() => null);
        if (marker) break;
      }
      if (!marker) await settle(page, root.href);
    }
    await page.addStyleTag({ content: HIDE_CSS }).catch(() => undefined);
    if (marker && marker.bottom > VIEWPORT.height) {
      // The marked area, a little below the top of the window, so its heading shows.
      await page.evaluate((y) => window.scrollTo(0, Math.max(0, y)), marker.top - 96);
      await page.waitForTimeout(300);
    }
    const final = new URL(page.url());
    const png = await page.screenshot({ type: 'png' });
    const webp = await toWebp(context, png, SHOT_WIDTH);
    return { webp, route: final.pathname + final.search, screen: marker?.label ?? null, width: SHOT_WIDTH, height: Math.round((VIEWPORT.height * SHOT_WIDTH) / VIEWPORT.width) };
  } finally {
    await context.close();
  }
}

async function launch() {
  const pw = await deps().playwright();
  const chromium = pw.chromium ?? pw.default?.chromium;
  const channel = process.env.BRIDGE_CHROME_CHANNEL || undefined;
  return chromium.launch({ headless: true, ...(channel ? { channel } : {}) });
}

// ---------------------------------------------------------------------------------------------------------------
// Run.

function targetsOf(config, hostRepo) {
  const products = config.products ?? [];
  const out = [{ repo: hostRepo, ds: true, products }];
  for (const p of products) {
    if (!p.repo || !p.preview || p.repo.toLowerCase() === hostRepo.toLowerCase()) continue;
    out.push({ repo: p.repo, ds: false, product: p });
  }
  return out;
}

/**
 * The preview URL Vercel reported for the head commit, with its state, or null. In this repository: the labelled
 * product's app (the admin demo), then the library app its files point at; an app whose build Vercel skipped (nothing
 * of the exploration in it) gives way to the next. In a product repository: the product's preview.
 */
async function previewFor(core, api, t, pull, config) {
  const [comments, status] = await Promise.all([api.get(`/repos/${t.repo}/issues/${pull.number}/comments?per_page=100`), api.get(`/repos/${t.repo}/commits/${pull.head.sha}/status`)]);
  const sources = { comments: comments ?? [], statuses: status?.statuses ?? [] };
  const ctx = { branch: pull.head.ref, pr: pull.number, sha: pull.head.sha };
  let candidates;
  if (t.ds) {
    const apps = config.previews?.apps ?? {};
    const all = core.resolveBranchPreviews(apps, ctx, sources);
    const product = labelledProduct(pull, t.products);
    const files = ((await api.get(`/repos/${t.repo}/pulls/${pull.number}/files?per_page=100`)) ?? []).map((f) => f.filename);
    const order = [product && apps[product.key] ? product.key : null, libraryApp(files, apps), 'docs'].filter(Boolean);
    candidates = [...new Set(order)].map((app) => all.find((x) => x.app === app)).filter(Boolean);
  } else {
    candidates = core.resolveBranchPreviews({ admin: t.product.preview }, ctx, sources);
  }
  const resolved = candidates.find((x) => x.url && !x.skipped);
  if (!resolved) return null;
  // A plain "Vercel" status (one project per repository) says whether this commit's preview is built.
  const plain = t.ds ? null : (status?.statuses ?? []).find((s) => /^vercel$/i.test(s.context.trim()));
  const state = plain ? ({ success: 'ready', pending: 'building', failure: 'failed', error: 'failed' }[plain.state] ?? resolved.state) : resolved.state;
  return { url: resolved.url, state, app: resolved.app };
}

export async function run({ dir, configPath, force = false, dryRun = false, hostRepo, token, now = Date.now() }) {
  const core = await deps().core();
  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  const host = hostRepo || `${config.repo.owner}/${config.repo.name}`;
  const api = gh(token);
  const stored = new Map(storedMetas(dir).map((m) => [shotKey(m.repo, m.pr), m]));
  const open = new Set();
  const jobs = [];
  const privateRepos = new Set();
  const readRepos = new Set();
  for (const t of targetsOf(config, host)) {
    if (!t.ds) {
      // Privacy: a product repository's preview is captured only when the repository is public.
      const info = await api.get(`/repos/${t.repo}`).catch(() => null);
      if (!info || info.private || (info.visibility && info.visibility !== 'public')) {
        privateRepos.add(t.repo.toLowerCase());
        log(`${t.repo}: not public (or not readable), no capture, Studio keeps the plate.`);
        continue;
      }
    }
    const pulls = await api.get(`/repos/${t.repo}/pulls?state=open&per_page=100`).catch((e) => (log(`${t.repo}: ${e.message}`), null));
    if (!pulls) continue;
    readRepos.add(t.repo.toLowerCase());
    for (const p of pulls.filter(isOpenExploration)) {
      const key = shotKey(t.repo, p.number);
      open.add(key);
      const meta = stored.get(key);
      const d = shotDecision({ sha: p.head.sha, stored: meta, force });
      if (d.action === 'skip') {
        log(`${key}: skip (${d.why}).`);
        continue;
      }
      const preview = await previewFor(core, api, t, p, config).catch((e) => (log(`${key}: ${e.message}`), null));
      if (!preview) {
        log(`${key}: no preview build of its own yet (or none reported).`);
        continue;
      }
      if (preview.state === 'building' || preview.state === 'failed') {
        log(`${key}: preview ${preview.state}, later.`);
        continue;
      }
      jobs.push({ key, repo: t.repo, pull: p, url: preview.url, meta });
    }
  }

  let changed = false;
  // Captures of private product repositories go; closed pull requests are read once, then kept or pruned.
  for (const [key, m] of stored) {
    if (open.has(key)) {
      if (m.closed) {
        delete m.closed;
        if (!dryRun) writeJson(join(dir, m.file), stripFile(m));
        changed = true;
      }
      continue;
    }
    const repo = m.repo.toLowerCase();
    if (privateRepos.has(repo)) {
      log(`${key}: its repository is not public, capture removed.`);
      if (!dryRun) removeShot(dir, m);
      stored.delete(key);
      changed = true;
      continue;
    }
    if (!readRepos.has(repo)) continue;
    if (!m.closed) {
      const p = await api.get(`/repos/${m.repo}/pulls/${m.pr}`).catch(() => null);
      if (!p || p.state === 'open') continue; // Open but no longer an exploration (archived): kept as it is.
      m.closed = { at: p.closed_at ?? new Date(now).toISOString(), merged: Boolean(p.merged_at) };
      if (!dryRun) writeJson(join(dir, m.file), stripFile(m));
      changed = true;
    }
    if (pruneDecision(m, now) === 'remove') {
      log(`${key}: closed without merging over 30 days ago, capture removed.`);
      if (!dryRun) removeShot(dir, m);
      stored.delete(key);
      changed = true;
    }
  }

  if (jobs.length && !dryRun) {
    const browser = await launch();
    try {
      for (const j of jobs) {
        const paths = shotPaths(j.repo, j.pull.number);
        try {
          const shot = await captureOne(browser, j.url);
          mkdirSync(dirname(join(dir, paths.image)), { recursive: true });
          writeFileSync(join(dir, paths.image), shot.webp);
          const meta = {
            repo: j.repo,
            pr: j.pull.number,
            sha: j.pull.head.sha,
            branch: j.pull.head.ref,
            title: j.pull.title,
            url: j.url,
            route: shot.route,
            screen: shot.screen,
            capturedAt: new Date().toISOString(),
            image: paths.image,
            width: shot.width,
            height: shot.height,
            bytes: shot.webp.length,
          };
          writeJson(join(dir, paths.meta), meta);
          stored.set(j.key, { ...meta, file: paths.meta });
          log(`${j.key}: captured ${j.url}${shot.route !== '/' ? ` (${shot.route})` : ''}, ${Math.round(shot.webp.length / 1024)} KB.`);
        } catch (e) {
          const prev = j.meta?.failed?.sha === j.pull.head.sha ? (j.meta.failed.tries ?? 0) : 0;
          const meta = { ...(j.meta ? stripFile(j.meta) : { repo: j.repo, pr: j.pull.number }), failed: { sha: j.pull.head.sha, at: new Date().toISOString(), tries: prev + 1, error: String(e?.message ?? e).slice(0, 300) } };
          writeJson(join(dir, paths.meta), meta);
          stored.set(j.key, { ...meta, file: paths.meta });
          log(`${j.key}: capture failed (${meta.failed.error}).`);
        }
        changed = true;
      }
    } finally {
      await browser.close();
    }
  } else if (jobs.length) {
    for (const j of jobs) log(`${j.key}: would capture ${j.url}.`);
  }

  const index = buildIndex([...stored.values()]);
  const indexFile = join(dir, 'index.json');
  const before = existsSync(indexFile) ? readFileSync(indexFile, 'utf8') : '';
  const after = `${JSON.stringify(index, null, 2)}\n`;
  if (before !== after) {
    if (!dryRun) writeFileSync(indexFile, after);
    changed = true;
  }
  log(`Done: ${jobs.length} to capture, ${Object.keys(index.shots).length} stored, ${api.calls()} GitHub calls.`);
  return { jobs: jobs.length, changed, index };
}

const stripFile = ({ file, ...m }) => m;

function removeShot(dir, m) {
  const p = shotPaths(m.repo, m.pr);
  rmSync(join(dir, p.image), { force: true });
  rmSync(join(dir, p.meta), { force: true });
}

// ---------------------------------------------------------------------------------------------------------------

function args(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const k = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) out[k] = true;
      else {
        out[k] = next;
        i++;
      }
    } else out._.push(a);
  }
  return out;
}

async function main() {
  const a = args(process.argv.slice(2));
  const cmd = a._[0];
  if (cmd === 'run') {
    if (!a.shots) throw new Error('--shots <dir> is required');
    const res = await run({
      dir: a.shots,
      configPath: a.config || 'bridge.config.json',
      force: a.force === true || a.force === 'true',
      dryRun: Boolean(a['dry-run']),
      hostRepo: process.env.GITHUB_REPOSITORY,
      token: process.env.GH_TOKEN || process.env.GITHUB_TOKEN,
    });
    if (process.env.GITHUB_OUTPUT) writeFileSync(process.env.GITHUB_OUTPUT, `changed=${res.changed}\ncaptured=${res.jobs}\n`, { flag: 'a' });
  } else if (cmd === 'capture') {
    if (!a.url || !a.out) throw new Error('--url and --out are required');
    const browser = await launch();
    try {
      const shot = await captureOne(browser, a.url, { crawl: a['no-crawl'] !== true });
      mkdirSync(dirname(a.out), { recursive: true });
      writeFileSync(a.out, shot.webp);
      log(JSON.stringify({ out: a.out, route: shot.route, screen: shot.screen, width: shot.width, height: shot.height, bytes: shot.webp.length }));
    } finally {
      await browser.close();
    }
  } else {
    console.error('Usage: node scripts/preview-shots.mjs run --shots <dir> | capture --url <url> --out <file.webp>');
    process.exit(1);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e) => {
    console.error(e?.stack ?? e);
    process.exit(1);
  });
}
