// Checkouts and builds per ref: a detached git worktree in a temp folder, node_modules linked from the main
// checkout (no second install), then the token build, Storybook and the app. Builds are cached by commit.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { lstat, mkdir, readdir, readFile, realpath, rm, symlink } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { git } from '@bridge/core/node';

export type Log = (msg: string) => void;

/** Entries of node_modules that hold per-checkout state and must not be shared. */
const PRIVATE = new Set(['.cache', '.vite', '.vite-temp', '.package-lock.json']);

async function workspaceDirs(root: string): Promise<string[]> {
  const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')) as { workspaces?: string[] | { packages?: string[] } };
  const pats = Array.isArray(pkg.workspaces) ? pkg.workspaces : (pkg.workspaces?.packages ?? []);
  const out: string[] = [];
  for (const p of pats) {
    if (!p.endsWith('/*')) {
      if (existsSync(join(root, p, 'package.json'))) out.push(p);
      continue;
    }
    const parent = p.slice(0, -2);
    if (!existsSync(join(root, parent))) continue;
    for (const d of await readdir(join(root, parent))) if (existsSync(join(root, parent, d, 'package.json'))) out.push(`${parent}/${d}`);
  }
  return out;
}

async function link(target: string, at: string) {
  await mkdir(dirname(at), { recursive: true });
  await symlink(target, at);
}

/**
 * Gives `dst` (a worktree of the same repo) a node_modules that reuses the installed packages of `src`
 * while its workspace packages (@bridge/*, @demo-ds/*...) point at `dst`'s own sources. Per-checkout caches
 * stay private. Nested workspace node_modules are linked too.
 */
export async function linkNodeModules(src: string, dst: string): Promise<void> {
  const srcNm = await realpath(join(src, 'node_modules'));
  const dstNm = join(dst, 'node_modules');
  if (existsSync(dstNm)) return;
  const dirs = await workspaceDirs(dst);
  const names = new Map<string, string>();
  for (const d of dirs) {
    const { name } = JSON.parse(await readFile(join(dst, d, 'package.json'), 'utf8')) as { name?: string };
    if (name) names.set(name, d);
  }
  await mkdir(dstNm, { recursive: true });
  for (const e of await readdir(srcNm)) {
    if (PRIVATE.has(e)) continue;
    if (e.startsWith('@')) {
      for (const c of await readdir(join(srcNm, e))) if (!names.has(`${e}/${c}`)) await link(join(srcNm, e, c), join(dstNm, e, c));
    } else if (!names.has(e)) await link(join(srcNm, e), join(dstNm, e));
  }
  for (const [name, d] of names) {
    const at = join(dstNm, name);
    await rm(at, { force: true, recursive: false }).catch(() => undefined);
    await link(relative(dirname(at), join(dst, d)), at);
  }
  for (const d of dirs) {
    const nested = join(src, d, 'node_modules');
    if (existsSync(nested) && !existsSync(join(dst, d, 'node_modules'))) await link(await realpath(nested), join(dst, d, 'node_modules'));
  }
}

export async function addWorktree(repo: string, sha: string, dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true });
  await git(repo, ['worktree', 'prune']);
  await git(repo, ['worktree', 'add', '--detach', '--force', dir, sha]);
}

export async function removeWorktree(repo: string, dir: string): Promise<void> {
  try {
    // node_modules is a folder of symlinks: remove it first so git does not walk into the shared install.
    await rm(join(dir, 'node_modules'), { recursive: true, force: true });
    await git(repo, ['worktree', 'remove', '--force', dir]);
  } catch {
    await rm(dir, { recursive: true, force: true });
  }
  await git(repo, ['worktree', 'prune']).catch(() => undefined);
}

export function run(cmd: string, args: string[], cwd: string, log: Log, root = cwd, env: Record<string, string> = {}): Promise<void> {
  return new Promise((resolve, reject) => {
    const bin = [...new Set([join(cwd, 'node_modules', '.bin'), join(root, 'node_modules', '.bin')])].join(':');
    const child = spawn(cmd, args, {
      cwd,
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, NODE_OPTIONS: process.env.NODE_OPTIONS ?? '--max-old-space-size=3072', STORYBOOK_DISABLE_TELEMETRY: '1', ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let tail = '';
    const keep = (b: Buffer) => (tail = (tail + b.toString()).slice(-4000));
    child.stdout.on('data', keep);
    child.stderr.on('data', keep);
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else {
        log(tail);
        reject(new Error(`${cmd} ${args.join(' ')} failed in ${cwd} (exit ${code})`));
      }
    });
  });
}

export interface BuildPlan {
  storybook: boolean;
  app: boolean;
}

export interface BuildConfig {
  /** Folder of the app to build with Vite (relative to the repo root). */
  appDir: string;
  storybookConfigDir: string;
  tokensBuild: string[];
}

export const DEFAULT_BUILD: BuildConfig = {
  appDir: 'apps/admin',
  storybookConfigDir: '.storybook',
  tokensBuild: ['npm', 'run', 'tokens:build', '--silent'],
};

export interface Built {
  storybook?: string;
  app?: string;
}

const isDir = async (p: string) => (await lstat(p).catch(() => null))?.isDirectory() ?? false;

/**
 * Builds what `plan` asks for at commit `sha`, in a temporary worktree under `work`, into `cache/<sha>`.
 * A build already in the cache is reused, so re-running against the same base is fast.
 */
export async function buildRef(o: { repo: string; sha: string; work: string; cache: string; plan: BuildPlan; config?: BuildConfig; log: Log; keep?: boolean }): Promise<Built> {
  const cfg = o.config ?? DEFAULT_BUILD;
  const out = join(o.cache, o.sha);
  const sbOut = join(out, 'storybook');
  const appOut = join(out, 'app');
  const needSb = o.plan.storybook && !existsSync(join(sbOut, 'index.json'));
  const needApp = o.plan.app && !existsSync(join(appOut, 'index.html'));
  const built: Built = { ...(o.plan.storybook ? { storybook: sbOut } : {}), ...(o.plan.app ? { app: appOut } : {}) };
  if (!needSb && !needApp) {
    o.log(`  ${o.sha.slice(0, 7)}: builds cached`);
    return built;
  }
  const dir = join(o.work, `wt-${o.sha.slice(0, 12)}`);
  o.log(`  ${o.sha.slice(0, 7)}: worktree ${dir}`);
  await addWorktree(o.repo, o.sha, dir);
  try {
    await linkNodeModules(o.repo, dir);
    o.log(`  ${o.sha.slice(0, 7)}: tokens`);
    await run(cfg.tokensBuild[0]!, cfg.tokensBuild.slice(1), dir, o.log);
    if (needSb) {
      o.log(`  ${o.sha.slice(0, 7)}: storybook build`);
      await rm(sbOut, { recursive: true, force: true });
      await run('storybook', ['build', '-c', cfg.storybookConfigDir, '-o', sbOut, '--quiet', '--disable-telemetry'], dir, o.log);
    }
    if (needApp && (await isDir(join(dir, cfg.appDir)))) {
      o.log(`  ${o.sha.slice(0, 7)}: app build`);
      await rm(appOut, { recursive: true, force: true });
      await run('vite', ['build', '--outDir', appOut, '--emptyOutDir', '--logLevel', 'warn'], join(dir, cfg.appDir), o.log, dir);
    }
  } finally {
    if (!o.keep) await removeWorktree(o.repo, dir);
  }
  if (o.plan.app && !existsSync(join(appOut, 'index.html'))) delete built.app;
  return built;
}
