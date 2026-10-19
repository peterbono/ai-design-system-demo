#!/usr/bin/env node
// Builds the publishable packages into their dist/ folders, the files npm, pkg.pr.new and the release workflow ship.
// Inside the monorepo nothing reads these files: apps, Storybook and tests resolve the `source` export condition
// (TypeScript sources). Published consumers get the `default` condition (built JS, .d.ts and one CSS file).
//
//   node scripts/build-packages.mjs              every publishable package, in dependency order
//                                                (tokens, core, react, visual, mcp, cli, stylelint-plugin, eslint-plugin)
//   node scripts/build-packages.mjs react core   only these
//
// After building, every non-source export target is checked to exist, so a broken manifest fails here and not
// in a product's install.
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ORDER = ['tokens', 'core', 'react', 'visual', 'mcp', 'cli', 'stylelint-plugin', 'eslint-plugin'];
const wanted = process.argv.slice(2).filter((a) => !a.startsWith('-'));
const targets = wanted.length ? ORDER.filter((p) => wanted.includes(p)) : ORDER;
const unknown = wanted.filter((p) => !ORDER.includes(p));
if (unknown.length) {
  console.error(`build-packages: unknown package(s) ${unknown.join(', ')}. Known: ${ORDER.join(', ')}`);
  process.exit(1);
}

const pkgDir = (name) => join(ROOT, 'packages', name);
const tsc = (args, cwd) => execFileSync(process.execPath, [join(ROOT, 'node_modules/typescript/bin/tsc'), ...args], { cwd, stdio: 'inherit' });

async function viteLib(name, { external, css, entry = { index: 'src/index.ts' } }) {
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
      lib: { entry, formats: ['es'], fileName: (_format, entryName) => `${entryName}.js`, ...(css ? { cssFileName: 'components' } : {}) },
      rollupOptions: { external },
    },
  });
}

const deps = (name) => {
  const pkg = JSON.parse(readFileSync(join(pkgDir(name), 'package.json'), 'utf8'));
  return [...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.peerDependencies ?? {})];
};
// Every dependency and peer stays an import, including deep imports (`react/jsx-runtime`).
// Node built-ins too (`node:fs` in @bridge-ds/core/node), so Vite never stubs them for the browser.
const NODE_BUILTINS = new Set(builtinModules);
const externalFor = (name) => {
  const list = deps(name);
  return (id) => id.startsWith('node:') || NODE_BUILTINS.has(id) || list.some((d) => id === d || id.startsWith(`${d}/`));
};
// Packages bundled with their own esbuild script (Node tools): JS from build.mjs, declarations from tsc.
const esbuildPackage = (name, { types = true } = {}) => () => {
  const dir = pkgDir(name);
  execFileSync(process.execPath, ['build.mjs'], { cwd: dir, stdio: 'inherit' });
  if (types) tsc(['-p', 'tsconfig.build.json'], dir);
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
    // Three entry points: the main one (browser-safe), ./audit (TypeScript parser) and ./node (git, fs).
    await viteLib('core', { external: externalFor('core'), css: false, entry: { index: 'src/index.ts', 'audit/index': 'src/audit/index.ts', 'node/index': 'src/node/index.ts' } });
    tsc(['-p', 'tsconfig.build.json'], dir);
    // The ramp engine is plain JavaScript (packages/tokens/scripts/ramps.mjs runs it without a build): tsc does
    // not emit declarations for its hand-written ramps.d.ts, so ship that file as is.
    copyFileSync(join(dir, 'src/ramps.d.ts'), join(dir, 'dist/ramps.d.ts'));
  },
  async react() {
    const dir = pkgDir('react');
    rmSync(join(dir, 'dist'), { recursive: true, force: true });
    // Two entry points: the components (index) and the DOM renderers for plain-script pages (./dom).
    await viteLib('react', { external: externalFor('react'), css: true, entry: { index: 'src/index.ts', dom: 'src/dom/index.ts' } });
    tsc(['-p', 'tsconfig.build.json'], dir);
    // One stylesheet for consumers: the global base first, then every component's CSS Modules output.
    const base = readFileSync(join(dir, 'src/styles/base.css'), 'utf8');
    const componentsCss = join(dir, 'dist/components.css');
    const components = existsSync(componentsCss) ? readFileSync(componentsCss, 'utf8') : '';
    writeFileSync(join(dir, 'dist/styles.css'), `${base}\n/* Components */\n${components}`);
    rmSync(componentsCss, { force: true });
  },
  visual: esbuildPackage('visual'),
  mcp: esbuildPackage('mcp'),
  cli: esbuildPackage('cli', { types: false }),
  'stylelint-plugin': esbuildPackage('stylelint-plugin'),
  'eslint-plugin': esbuildPackage('eslint-plugin'),
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
  const bins = typeof pkg.bin === 'string' ? [pkg.bin] : Object.values(pkg.bin ?? {});
  const files = new Set([pkg.main, pkg.types, ...bins, ...Object.values(pkg.exports ?? {}).flatMap(exportTargets)].filter(Boolean));
  const missing = [...files].filter((f) => !existsSync(join(dir, f)));
  if (missing.length) throw new Error(`${pkg.name}: export targets missing after build: ${missing.join(', ')}`);
  if (pkg.private) throw new Error(`${pkg.name}: "private": true would block publishing`);
  console.log(`build-packages: ${pkg.name}@${pkg.version} ok (${files.size} entry points)`);
}

for (const name of targets) {
  await BUILDERS[name]();
  verify(name);
}
