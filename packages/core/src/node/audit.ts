// Node side of `bridge audit`: load the design system from its repo and read a product folder from disk.
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { loadConfig, type BridgeConfig } from '../config';
import { globToRegExp, LayeredTokenSet, selectTokenFiles } from '../layered';
import { AUDIT_IGNORE_DIRS, buildAuditReport, compareWithBaseline, isAuditable, planCssFixes, type CssFixEdit } from '../audit/report';
import { DesignSystemIndex } from '../audit/ds-index';
import type { AuditReport } from '../audit/types';

export interface LoadedDesignSystem {
  root: string;
  config: BridgeConfig;
  set: LayeredTokenSet;
  index: DesignSystemIndex;
}

const toPosix = (p: string) => p.split(sep).join('/');

function walk(dir: string, root: string, out: string[], skipDirs: string[]): void {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    const abs = join(dir, name);
    let st;
    try {
      st = statSync(abs);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      if (!skipDirs.includes(name)) walk(abs, root, out, skipDirs);
    } else out.push(toPosix(relative(root, abs)));
  }
}

/** Nearest folder at or above `from` with a bridge.config.json. */
export function findDesignSystemRoot(from: string): string | undefined {
  let dir = resolve(from);
  for (;;) {
    if (existsSync(join(dir, 'bridge.config.json'))) return dir;
    const up = dirname(dir);
    if (up === dir) return undefined;
    dir = up;
  }
}

const cache = new Map<string, LoadedDesignSystem>();

/** Design system at `root` (a repo with bridge.config.json): tokens in every mode, components, packages. Cached per root. */
export function loadDesignSystem(root: string, opts: { fresh?: boolean } = {}): LoadedDesignSystem {
  const abs = resolve(root);
  const hit = cache.get(abs);
  if (hit && !opts.fresh) return hit;
  const cfgPath = join(abs, 'bridge.config.json');
  if (!existsSync(cfgPath)) throw new Error(`No bridge.config.json in ${abs}: pass the design system repo (--ds <dir>) or run bridge init there.`);
  const config = loadConfig(readFileSync(cfgPath, 'utf8'));
  const tokensRoot = config.tokens.root.replace(/\/$/, '');
  const listed: string[] = [];
  walk(join(abs, tokensRoot === '.' ? '' : tokensRoot), abs, listed, ['node_modules', '.git', 'dist']);
  const files = new Map<string, string>();
  for (const f of selectTokenFiles(config, listed)) files.set(f, readFileSync(join(abs, tokensRoot === '.' ? '' : tokensRoot, f), 'utf8'));
  const set = new LayeredTokenSet(config, files);
  const components: string[] = [];
  let packages = config.audit?.packages;
  if (config.components) {
    const dir = join(abs, config.components.dir);
    if (existsSync(dir)) for (const name of readdirSync(dir)) if (/^[A-Z][A-Za-z0-9]*$/.test(name) && statSync(join(dir, name)).isDirectory()) components.push(name);
    if (!packages) {
      packages = ['@bridge/react'];
      for (let d = dir; d.startsWith(abs) && d !== abs; d = dirname(d)) {
        const pj = join(d, 'package.json');
        if (existsSync(pj)) {
          const name = (JSON.parse(readFileSync(pj, 'utf8')) as { name?: string }).name;
          if (name && !packages.includes(name)) packages.unshift(name);
          break;
        }
      }
    }
  }
  const index = new DesignSystemIndex(set, {
    packages: packages ?? ['@bridge/react'],
    components: components.sort(),
    ...(config.audit?.foreignLibraries ? { foreignLibraries: config.audit.foreignLibraries } : {}),
    ...(config.audit?.nativeElements ? { nativeElements: config.audit.nativeElements } : {}),
  });
  const loaded = { root: abs, config, set, index };
  cache.set(abs, loaded);
  return loaded;
}

/** Auditable files under `target` (a folder or a single file), repo-relative to it. */
export function collectAuditFiles(target: string, exclude: string[] = []): { root: string; files: { path: string; text: string }[]; skipped: number } {
  const abs = resolve(target);
  if (statSync(abs).isFile()) return { root: dirname(abs), files: [{ path: toPosix(relative(dirname(abs), abs)), text: readFileSync(abs, 'utf8') }], skipped: 0 };
  const all: string[] = [];
  walk(abs, abs, all, AUDIT_IGNORE_DIRS);
  const ex = exclude.map(globToRegExp);
  const files: { path: string; text: string }[] = [];
  let skipped = 0;
  for (const p of all.sort()) {
    if (!isAuditable(p) || ex.some((r) => r.test(p))) continue;
    const full = join(abs, p);
    if (statSync(full).size > 512 * 1024) {
      skipped++;
      continue;
    }
    files.push({ path: p, text: readFileSync(full, 'utf8') });
  }
  return { root: abs, files, skipped };
}

export interface RunAuditOptions {
  /** Design system repo root (with bridge.config.json). Default: nearest one above the current directory. */
  ds?: string;
  label?: string;
  baseline?: AuditReport;
  version?: string;
  /** Path recorded in the report (default: target relative to cwd). */
  displayPath?: string;
  exclude?: string[];
}

/** Audit a product folder against a design system. */
export function runAudit(target: string, opts: RunAuditOptions = {}): AuditReport {
  const dsRoot = opts.ds ?? findDesignSystemRoot(process.cwd());
  if (!dsRoot) throw new Error('No design system found: run from a repo with bridge.config.json or pass --ds <dir>.');
  const ds = loadDesignSystem(dsRoot);
  const { files, skipped } = collectAuditFiles(target, [...(ds.config.audit?.exclude ?? []), ...(opts.exclude ?? [])]);
  const report = buildAuditReport(
    { files, skipped, target: opts.displayPath ?? (toPosix(relative(process.cwd(), resolve(target))) || '.'), ...(opts.label ? { label: opts.label } : {}), ...(opts.version ? { version: opts.version } : {}) },
    ds.index,
  );
  return opts.baseline ? compareWithBaseline(report, opts.baseline) : report;
}

/** Plan (and optionally write) the safe CSS autofix for every CSS/SCSS/Less file under `target`. */
export function fixCss(target: string, ds: DesignSystemIndex, write: boolean): { file: string; edits: CssFixEdit[] }[] {
  const { root, files } = collectAuditFiles(target);
  const out: { file: string; edits: CssFixEdit[] }[] = [];
  for (const f of files) {
    const lang = f.path.endsWith('.scss') || f.path.endsWith('.sass') ? 'scss' : f.path.endsWith('.less') ? 'less' : f.path.endsWith('.css') ? 'css' : null;
    if (!lang) continue;
    const plan = planCssFixes(f.text, lang, ds);
    if (!plan.edits.length) continue;
    if (write) writeFileSync(join(root, f.path), plan.output);
    out.push({ file: f.path, edits: plan.edits });
  }
  return out;
}
