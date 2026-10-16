// bridge impact: plan (what to capture and why), build both refs, capture, diff, composite, manifest.
import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { buildUsageIndex, diffLayered, loadConfig, LayeredTokenSet, selectTokenFiles, comboKey, type BridgeConfig } from '@bridge-ds/core';
import { git, listFilesAt, showFile } from '@bridge-ds/core/node';
import { launch, newContext, newPage, shoot, switchStory } from './capture.js';
import { composite } from './composite.js';
import { decodePng, diffPngs, encodePng } from './diff.js';
import { renderComment, summarize, summaryLine } from './manifest.js';
import { BRANDS, DEFAULT_ROUTES, DEFAULT_TENANTS, routeUrl, shotKey, storyUrl, THEMES } from './routes.js';
import { selectImpact, storiesFromSource } from './select.js';
import { serveDir, type Served } from './serve.js';
import type { AppRoute, Manifest, Only, Selection, ShotResult, StoryEntry, Tenant, Viewport } from './types.js';
import { buildRef, DEFAULT_BUILD, type BuildConfig, type Built, type Log } from './workspace.js';

export interface ImpactOptions {
  /** Repo root (a git checkout with node_modules installed). */
  root: string;
  base: string;
  head: string;
  /** Output folder for manifest.json and images. Default: <root>/visual-impact. */
  out?: string;
  only?: Only[];
  /** pixelmatch threshold, 0..1. Default 0.03 (one step of a color ramp is about 0.1). */
  threshold?: number;
  /** Build cache folder, keyed by commit. Default: <root>/node_modules/.cache/bridge-visual. */
  cacheDir?: string;
  /** Temp folder for worktrees. Default: OS temp. */
  workDir?: string;
  /** Only compute the selection; no build, no browser. */
  plan?: boolean;
  /** Raw URL base for images in comment.md (the bridge-visual branch folder of this run). */
  imageBase?: string;
  artifactUrl?: string;
  maxStoriesPerComponent?: number;
  routes?: AppRoute[];
  tenants?: Tenant[];
  modes?: { brand: string; theme: string }[];
  viewport?: { stories?: Viewport; app?: Viewport };
  build?: BuildConfig;
  /** Pages (tabs) capturing stories in parallel in the one browser. Default 2. */
  concurrency?: number;
  /** Keep before/after images of unchanged shots (off: only changed shots keep images). */
  keepUnchanged?: boolean;
  log?: Log;
}

export interface ImpactResult {
  manifest: Manifest;
  outDir: string;
  manifestPath: string;
  commentPath?: string;
  summary: string;
}

const STORY_READY = `document.body.classList.contains('sb-show-main') && (document.querySelector('#storybook-root')?.childElementCount > 0 || document.querySelector('[role="dialog"]')) || document.body.classList.contains('sb-show-errordisplay')`;
const APP_READY = `document.querySelector('#root')?.childElementCount > 0 && !document.querySelector('[aria-busy="true"]')`;

async function readConfig(root: string, sha: string): Promise<BridgeConfig> {
  const text = (await showFile(root, sha, 'bridge.config.json')) ?? (existsSync(join(root, 'bridge.config.json')) ? await readFile(join(root, 'bridge.config.json'), 'utf8') : null);
  if (!text) throw new Error('bridge.config.json not found: run `bridge init` first.');
  return loadConfig(text);
}

async function tokenSetAt(root: string, sha: string, config: BridgeConfig, files: string[]): Promise<LayeredTokenSet> {
  const tokensRoot = config.tokens.root.replace(/\/$/, '');
  const picked = selectTokenFiles(config, files);
  const texts = await Promise.all(picked.map(async (f) => [f, await showFile(root, sha, tokensRoot === '.' ? f : `${tokensRoot}/${f}`)] as const));
  return new LayeredTokenSet(config, new Map(texts.filter((t): t is readonly [string, string] => t[1] !== null)));
}

/** Token paths whose resolved CSS value differs in at least one mode, with the modes. Direct edits flagged. */
export function changedTokens(before: LayeredTokenSet, after: LayeredTokenSet): Selection['tokens'] {
  const direct = new Set(diffLayered(before, after).map((c) => c.path));
  const modes = new Map<string, string[]>();
  for (const combo of after.combos()) {
    const paths = new Set([...before.view(combo).keys(), ...after.view(combo).keys()]);
    for (const p of paths) {
      if (before.resolve(p, combo).css === after.resolve(p, combo).css) continue;
      (modes.get(p) ?? modes.set(p, []).get(p)!).push(comboKey(combo));
    }
  }
  return [...modes.entries()]
    .map(([path, m]) => ({ path, kind: direct.has(path) ? ('direct' as const) : ('alias' as const), modes: m }))
    .sort((a, b) => Number(a.kind === 'alias') - Number(b.kind === 'alias') || a.path.localeCompare(b.path));
}

async function readIndexJson(dir: string): Promise<StoryEntry[]> {
  const raw = JSON.parse(await readFile(join(dir, 'index.json'), 'utf8')) as { entries: Record<string, { type: string; id: string; title: string; name: string; importPath: string }> };
  return Object.values(raw.entries)
    .filter((e) => e.type === 'story')
    .map(({ id, title, name, importPath }) => ({ id, title, name, importPath }));
}

export interface Plan {
  base: { ref: string; sha: string };
  head: { ref: string; sha: string };
  config: BridgeConfig;
  selection: Selection;
  sources: { stories: StoryEntry[]; librarySrc: string; usage: ReturnType<typeof buildUsageIndex> };
}

/** Works out what to capture between two refs (no build, no browser). The base is the merge base. */
export async function planImpact(o: Pick<ImpactOptions, 'root' | 'base' | 'head' | 'only' | 'maxStoriesPerComponent' | 'build'>): Promise<Plan> {
  const root = resolve(o.root);
  const rev = async (r: string) => (await git(root, ['rev-parse', '--verify', `${r}^{commit}`])).trim();
  const headSha = await rev(o.head);
  const tipSha = await rev(o.base);
  const baseSha = (await git(root, ['merge-base', tipSha, headSha])).trim() || tipSha;
  const config = await readConfig(root, headSha);
  const [baseFiles, headFiles] = await Promise.all([listFilesAt(root, baseSha), listFilesAt(root, headSha)]);
  const [before, after] = await Promise.all([tokenSetAt(root, baseSha, config, baseFiles), tokenSetAt(root, headSha, config, headFiles)]);
  const tokens = changedTokens(before, after);
  const changed = (await git(root, ['diff', '--name-only', baseSha, headSha])).split('\n').filter(Boolean);
  const componentsDir = config.components?.dir ?? 'packages/react/src/components';
  const librarySrc = componentsDir.split('/').slice(0, -1).join('/') || componentsDir;
  const libFiles = headFiles.filter((f) => f.startsWith(`${librarySrc}/`) && /\.(css|tsx?|jsx?)$/.test(f));
  const texts = await Promise.all(libFiles.map(async (path) => ({ path, text: (await showFile(root, headSha, path)) ?? '' })));
  const usage = buildUsageIndex(texts, componentsDir);
  const stories = storiesFromSource(texts.filter((t) => /\.stories\.[jt]sx?$/.test(t.path)));
  const build = o.build ?? DEFAULT_BUILD;
  const only = o.only?.length ? o.only : (['stories', 'app'] as Only[]);
  const selection = selectImpact({
    files: changed,
    tokens,
    cssVar: (p) => after.cssVarName(p),
    usage,
    stories,
    librarySrc,
    globalPaths: [build.storybookConfigDir, 'packages/tokens/build.mjs', 'packages/tokens/scripts', 'packages/tokens/fonts.css'],
    appDir: build.appDir,
    ...(o.maxStoriesPerComponent ? { maxStoriesPerComponent: o.maxStoriesPerComponent } : {}),
  });
  if (!only.includes('stories')) selection.stories = [];
  if (!only.includes('app')) selection.app = { include: false, reason: 'Skipped (--only stories)' };
  return { base: { ref: o.base, sha: baseSha }, head: { ref: o.head, sha: headSha }, config, selection, sources: { stories, librarySrc, usage } };
}

interface Job {
  key: string;
  kind: 'story' | 'route';
  label: string;
  storyId?: string;
  route?: AppRoute;
  tenant?: Tenant;
  brand: string;
  theme: string;
}

export async function runImpact(o: ImpactOptions): Promise<ImpactResult> {
  const started = Date.now();
  const log = o.log ?? ((m: string) => process.stderr.write(`${m}\n`));
  const root = resolve(o.root);
  const outDir = resolve(o.out ?? join(root, 'visual-impact'));
  const threshold = o.threshold ?? 0.03;
  const only = o.only?.length ? o.only : (['stories', 'app'] as Only[]);
  const vp = { stories: o.viewport?.stories ?? { width: 1024, height: 768 }, app: o.viewport?.app ?? { width: 1280, height: 800 } };
  const build = o.build ?? DEFAULT_BUILD;
  const concurrency = o.concurrency ?? Number(process.env.BRIDGE_VISUAL_CONCURRENCY ?? 2);
  if (outDir === root || !relative(outDir, root).startsWith('..')) throw new Error(`--out must be a folder inside or outside the repo, not the repo or one of its parents (${outDir}).`);

  log(`bridge impact: planning ${o.base}...${o.head}`);
  const plan = await planImpact({ ...o, only, build });
  const { selection } = plan;
  const modes = o.modes ?? BRANDS.flatMap((brand) => THEMES.map((theme) => ({ brand, theme })));
  const tenants = o.tenants ?? DEFAULT_TENANTS;
  const routes = o.routes ?? DEFAULT_ROUTES;

  const finish = async (shots: ShotResult[]): Promise<ImpactResult> => {
    const manifest: Manifest = {
      version: 1,
      tool: '@bridge-ds/visual',
      createdAt: new Date().toISOString(),
      durationMs: Date.now() - started,
      base: plan.base,
      head: plan.head,
      options: { only, threshold, ...(o.plan ? { plan: true, planned: { modes: modes.length, appScreens: selection.app.include ? tenants.length * THEMES.length * routes.length : 0 } } : {}), viewport: vp },
      selection,
      summary: summarize(shots),
      shots,
    };
    await mkdir(outDir, { recursive: true });
    const manifestPath = join(outDir, 'manifest.json');
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    let commentPath: string | undefined;
    if (o.imageBase !== undefined || o.artifactUrl) {
      commentPath = join(outDir, 'comment.md');
      await writeFile(commentPath, renderComment(manifest, { ...(o.imageBase ? { imageBase: o.imageBase } : {}), ...(o.artifactUrl ? { artifactUrl: o.artifactUrl } : {}) }));
    }
    return { manifest, outDir, manifestPath, ...(commentPath ? { commentPath } : {}), summary: summaryLine(manifest) };
  };

  if (o.plan) return finish([]);

  const needStories = only.includes('stories') && selection.stories.length > 0;
  const needApp = only.includes('app') && selection.app.include;
  if (!needStories && !needApp) {
    log('Nothing visual to capture.');
    return finish([]);
  }

  const cache = resolve(o.cacheDir ?? join(root, 'node_modules', '.cache', 'bridge-visual'));
  const work = resolve(o.workDir ?? join(tmpdir(), `bridge-visual-${process.pid}`));
  await mkdir(work, { recursive: true });
  const builds: Record<'base' | 'head', Built> = { base: {}, head: {} };
  try {
    for (const side of ['head', 'base'] as const) {
      log(`Building ${side} (${plan[side].ref})`);
      builds[side] = await buildRef({ repo: root, sha: plan[side].sha, work, cache, plan: { storybook: needStories, app: needApp }, config: build, log });
    }
  } finally {
    await rm(work, { recursive: true, force: true });
  }

  // Refine with the real story list from the head build (ids exactly as Storybook made them).
  if (needStories && builds.head.storybook) {
    const real = await readIndexJson(builds.head.storybook);
    const refined = selectImpact({
      files: selection.files,
      tokens: selection.tokens,
      cssVar: (p) => `${plan.config.cssVar.prefix}${p.split('.').join(plan.config.cssVar.separator)}`,
      usage: plan.sources.usage,
      stories: real,
      librarySrc: plan.sources.librarySrc,
      globalPaths: [build.storybookConfigDir, 'packages/tokens/build.mjs', 'packages/tokens/scripts', 'packages/tokens/fonts.css'],
      appDir: build.appDir,
      ...(o.maxStoriesPerComponent ? { maxStoriesPerComponent: o.maxStoriesPerComponent } : {}),
    });
    selection.stories = refined.stories;
    selection.components = refined.components;
  }

  const byId = new Map<string, StoryEntry>();
  if (builds.head.storybook) for (const s of await readIndexJson(builds.head.storybook)) byId.set(s.id, s);
  if (builds.base.storybook && existsSync(join(builds.base.storybook, 'index.json'))) for (const s of await readIndexJson(builds.base.storybook)) if (!byId.has(s.id)) byId.set(s.id, s);

  const jobs: Job[] = [];
  if (needStories)
    for (const m of modes)
      for (const id of selection.stories) {
        const s = byId.get(id);
        jobs.push({ key: shotKey('story', id, `${m.brand}-${m.theme}`), kind: 'story', label: s ? `${s.title}: ${s.name}` : id, storyId: id, brand: m.brand, theme: m.theme });
      }
  if (needApp && builds.head.app)
    for (const t of tenants)
      for (const theme of THEMES)
        for (const r of routes) jobs.push({ key: shotKey('app', r.id, t.id, theme), kind: 'route', label: r.label, route: r, tenant: t, brand: t.brand, theme });

  await rm(outDir, { recursive: true, force: true });
  for (const d of ['before', 'after', 'diff', 'composite']) await mkdir(join(outDir, d), { recursive: true });
  const errors = new Map<string, string>();

  // One browser at a time: capture base, close, capture head, close.
  for (const side of ['base', 'head'] as const) {
    const b = builds[side];
    const served: Served[] = [];
    const browser = await launch();
    try {
      const sb = b.storybook && existsSync(join(b.storybook, 'index.json')) ? await serveDir(b.storybook) : null;
      const app = b.app && existsSync(join(b.app, 'index.html')) ? await serveDir(b.app) : null;
      if (sb) served.push(sb);
      if (app) served.push(app);
      const dir = join(outDir, side === 'base' ? 'before' : 'after');
      const storyJobs = jobs.filter((j) => j.kind === 'story');
      if (sb && storyJobs.length) {
        log(`Capturing ${storyJobs.length} story shots at ${side}`);
        const ctx = await newContext(browser, vp.stories);
        const known = new Set((await readIndexJson(b.storybook!)).map((s) => s.id));
        // Per mode: one page load with the brand and theme globals, then switch stories over the channel.
        // Modes are spread over a few pages (tabs) of the same browser.
        const queue = [...modes];
        const worker = async () => {
          const page = await newPage(ctx);
          for (let m = queue.shift(); m; m = queue.shift()) {
            let loaded = false;
            for (const j of storyJobs.filter((x) => x.brand === m!.brand && x.theme === m!.theme)) {
              if (!known.has(j.storyId!)) continue;
              const err = await shoot(page, {
                url: storyUrl(sb.url, j.storyId!, j.brand, j.theme),
                file: join(dir, `${j.key}.png`),
                fullPage: true,
                readyFn: STORY_READY,
                // Loading stories (Spinner, Skeleton) stay aria-busy on purpose: do not wait for them.
                settle: loaded ? { network: false, quiet: 2, interval: 40, busy: false } : { busy: false },
                ...(loaded ? { navigate: (p) => switchStory(p, j.storyId!) } : {}),
              });
              if (err) {
                errors.set(`${side}:${j.key}`, err);
                loaded = false;
              } else loaded = true;
            }
          }
          await page.close();
        };
        await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, modes.length)) }, worker));
        await ctx.close();
      }
      const routeJobs = jobs.filter((j) => j.kind === 'route');
      if (app && routeJobs.length) {
        log(`Capturing ${routeJobs.length} app shots at ${side}`);
        for (const t of tenants)
          for (const theme of THEMES) {
            // A fresh context per tenant and theme: the demo data is generated from the tenant seed on first load.
            const ctx = await newContext(browser, vp.app);
            const page = await newPage(ctx);
            for (const j of routeJobs.filter((x) => x.tenant!.id === t.id && x.theme === theme)) {
              const err = await shoot(page, { url: routeUrl(app.url, j.route!, t.id, theme), file: join(dir, `${j.key}.png`), fullPage: false, readyFn: APP_READY, ...(j.route!.waitFor ? { waitFor: j.route!.waitFor } : {}), mask: ['[data-visual-mask]', ...(j.route!.mask ?? [])] });
              if (err) errors.set(`${side}:${j.key}`, err);
            }
            await ctx.close();
          }
      }
    } finally {
      await browser.close();
      for (const s of served) await s.close();
    }
  }

  log('Diffing');
  const shots: ShotResult[] = [];
  for (const j of jobs) {
    const bf = join(outDir, 'before', `${j.key}.png`);
    const af = join(outDir, 'after', `${j.key}.png`);
    const hasB = existsSync(bf);
    const hasA = existsSync(af);
    const base: Omit<ShotResult, 'status' | 'changedPixels' | 'totalPixels' | 'percent' | 'boxes' | 'size' | 'images'> = {
      key: j.key,
      kind: j.kind,
      label: j.label,
      ...(j.storyId ? { storyId: j.storyId } : {}),
      ...(j.route ? { route: j.route.path } : {}),
      ...(j.tenant ? { tenant: j.tenant.id } : {}),
      brand: j.brand,
      theme: j.theme,
    };
    const err = errors.get(`head:${j.key}`) ?? errors.get(`base:${j.key}`);
    if (!hasB && !hasA) {
      shots.push({ ...base, status: 'error', changedPixels: 0, totalPixels: 0, percent: 0, boxes: [], size: { before: null, after: null }, images: {}, error: err ?? 'not captured' });
      continue;
    }
    if (!hasB || !hasA) {
      const png = decodePng(await readFile(hasA ? af : bf));
      const size = { width: png.width, height: png.height };
      shots.push({
        ...base,
        status: hasA ? 'added' : 'removed',
        changedPixels: png.width * png.height,
        totalPixels: png.width * png.height,
        percent: 100,
        boxes: [{ x: 0, y: 0, ...size }],
        size: { before: hasB ? size : null, after: hasA ? size : null },
        images: hasA ? { after: `after/${j.key}.png` } : { before: `before/${j.key}.png` },
        ...(err ? { error: err } : {}),
      });
      continue;
    }
    const pb = decodePng(await readFile(bf));
    const pa = decodePng(await readFile(af));
    const d = diffPngs(pb, pa, threshold);
    const changed = d.changedPixels > 0;
    const images: ShotResult['images'] = {};
    if (changed || o.keepUnchanged) Object.assign(images, { before: `before/${j.key}.png`, after: `after/${j.key}.png` });
    else await Promise.all([unlink(bf), unlink(af)]);
    if (d.diff) {
      await writeFile(join(outDir, 'diff', `${j.key}.png`), encodePng(d.diff));
      images.diff = `diff/${j.key}.png`;
    }
    shots.push({
      ...base,
      status: err ? 'error' : changed ? 'changed' : 'unchanged',
      changedPixels: d.changedPixels,
      totalPixels: d.totalPixels,
      percent: d.percent,
      boxes: d.boxes,
      size: { before: { width: pb.width, height: pb.height }, after: { width: pa.width, height: pa.height } },
      images,
      ...(err ? { error: err } : {}),
    });
  }

  const toComposite = shots.filter((s) => s.status === 'changed' || s.status === 'added' || s.status === 'removed');
  if (toComposite.length) {
    log(`Composing ${toComposite.length} before/after/diff images`);
    const browser = await launch();
    try {
      const ctx = await browser.newContext({ viewport: { width: 1700, height: 900 }, deviceScaleFactor: 1 });
      const page = await ctx.newPage();
      for (const s of toComposite) {
        const w = Math.max(s.size.before?.width ?? 0, s.size.after?.width ?? 0);
        const h = Math.max(s.size.before?.height ?? 0, s.size.after?.height ?? 0);
        const file = join(outDir, 'composite', `${s.key}.png`);
        await composite(page, {
          title: s.label,
          subtitle: `${s.tenant ? `${DEFAULT_TENANTS.find((t) => t.id === s.tenant)?.name ?? s.tenant}, ` : ''}${s.brand}, ${s.theme} · ${s.status === 'changed' ? `${s.percent.toFixed(2)}% changed` : s.status}`,
          before: s.images.before ? join(outDir, s.images.before) : null,
          after: s.images.after ? join(outDir, s.images.after) : null,
          diff: s.images.diff ? join(outDir, s.images.diff) : null,
          width: w,
          height: h,
          boxes: s.boxes,
          out: file,
        });
        s.images.composite = `composite/${s.key}.png`;
      }
      await ctx.close();
    } finally {
      await browser.close();
    }
  }
  const result = await finish(shots);
  log(`${result.summary} Manifest: ${relative(process.cwd(), result.manifestPath) || result.manifestPath}`);
  return result;
}
