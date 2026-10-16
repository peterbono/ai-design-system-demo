#!/usr/bin/env node
// Builds the publishable packages into their dist/ folders, the files npm, pkg.pr.new and the release workflow ship.
// Inside the monorepo nothing reads these files: apps, Storybook and tests resolve the `source` export condition
// (TypeScript sources). Published consumers get the `default` condition (built JS, .d.ts and one CSS file).
//
//   node scripts/build-packages.mjs              tokens, core, react (in dependency order)
//   node scripts/build-packages.mjs react core   only these
//
// After building, every non-source export target is checked to exist, so a broken manifest fails here and not
// in a product's install.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ORDER = ['tokens', 'core', 'react'];
const wanted = process.argv.slice(2).filter((a) => !a.startsWith('-'));
const targets = wanted.length ? ORDER.filter((p) => wanted.includes(p)) : ORDER;
const unknown = wanted.filter((p) => !ORDER.includes(p));
if (unknown.length) {
  console.error(`build-packages: unknown package(s) ${unknown.join(', ')}. Known: ${ORDER.join(', ')}`);
  process.exit(1);
}

const pkgDir = (name) => join(ROOT, 'packages', name);
const tsc = (args, cwd) => execFileSync(process.execPath, [join(ROOT, 'node_modules/typescript/bin/tsc'), ...args], { cwd, stdio: 'inherit' });

async function viteLib(name, { external, css }) {
  const { build, defaultClientConditions } = await import('vite');
  const dir = pkgDir(name);
  await build({
    configFile: false,
    root: dir,
    logLevel: 'warn',
    esbuild: { jsx: 'automatic' },
    resolve: { conditions: ['source', ...defaultClientConditions] },
    build: {
      outDir: 'dist',
      emptyOutDir: false,
      sourcemap: true,
      minify: false,
      target: 'es2022',
      lib: { entry: 'src/index.ts', formats: ['es'], fileName: () => 'index.js', ...(css ? { cssFileName: 'components' } : {}) },
      rollupOptions: { external },
    },
  });
}

const deps = (name) => {
  const pkg = JSON.parse(readFileSync(join(pkgDir(name), 'package.json'), 'utf8'));
  return [...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.peerDependencies ?? {})];
};
// Every dependency and peer stays an import, including deep imports (`react/jsx-runtime`).
const externalFor = (name) => {
  const list = deps(name);
  return (id) => list.some((d) => id === d || id.startsWith(`${d}/`));
};

const BUILDERS = {
  tokens() {
    const dir = pkgDir('tokens');
    execFileSync(process.execPath, ['build.mjs'], { cwd: dir, stdio: 'inherit' });
    // dist/tokens.ts is generated; compile it to JS and declarations next to it.
    tsc(['dist/tokens.ts', '--declaration', '--target', 'ES2022', '--module', 'ESNext', '--skipLibCheck', '--outDir', 'dist'], dir);
  },
  async core() {
    const dir = pkgDir('core');
    rmSync(join(dir, 'dist'), { recursive: true, force: true });
    await viteLib('core', { external: externalFor('core'), css: false });
    tsc(['-p', 'tsconfig.build.json'], dir);
  },
  async react() {
    const dir = pkgDir('react');
    rmSync(join(dir, 'dist'), { recursive: true, force: true });
    await viteLib('react', { external: externalFor('react'), css: true });
    tsc(['-p', 'tsconfig.build.json'], dir);
    // One stylesheet for consumers: the global base first, then every component's CSS Modules output.
    const base = readFileSync(join(dir, 'src/styles/base.css'), 'utf8');
    const componentsCss = join(dir, 'dist/components.css');
    const components = existsSync(componentsCss) ? readFileSync(componentsCss, 'utf8') : '';
    writeFileSync(join(dir, 'dist/styles.css'), `${base}\n/* Components */\n${components}`);
    rmSync(componentsCss, { force: true });
  },
};

function exportTargets(value) {
  if (typeof value === 'string') return [value];
  if (value && typeof value === 'object') {
    return Object.entries(value).flatMap(([cond, v]) => (cond === 'source' ? [] : exportTargets(v)));
  }
  return [];
}

function verify(name) {
  const dir = pkgDir(name);
  const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
  const files = new Set([pkg.main, pkg.types, ...Object.values(pkg.exports ?? {}).flatMap(exportTargets)].filter(Boolean));
  const missing = [...files].filter((f) => !existsSync(join(dir, f)));
  if (missing.length) throw new Error(`${pkg.name}: export targets missing after build: ${missing.join(', ')}`);
  if (pkg.private) throw new Error(`${pkg.name}: "private": true would block publishing`);
  console.log(`build-packages: ${pkg.name}@${pkg.version} ok (${files.size} entry points)`);
}

for (const name of targets) {
  await BUILDERS[name]();
  verify(name);
}
