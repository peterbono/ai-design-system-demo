// Builds the plugin: dist/code.js (main thread) and dist/ui.html (UI with JS and CSS inlined).
// Usage: node scripts/build.mjs [--watch]
import * as esbuild from 'esbuild';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const watch = process.argv.includes('--watch');

// Figma's main-thread sandbox runs an older JS engine: transpile down to ES2017.
const mainOptions = {
  entryPoints: [join(root, 'src/main/index.ts')],
  bundle: true,
  conditions: ['source'],
  format: 'iife',
  target: 'es2017',
  outfile: join(dist, 'code.js'),
  logLevel: 'info',
};

async function buildUi() {
  const js = await esbuild.build({
    entryPoints: [join(root, 'src/ui/index.ts')],
    bundle: true,
    conditions: ['source'],
    format: 'iife',
    target: 'es2020',
    minify: !watch,
    write: false,
  });
  const css = await esbuild.build({
    entryPoints: [join(root, 'src/ui/styles.css')],
    bundle: true,
    conditions: ['source'],
    minify: !watch,
    write: false,
  });
  const template = await readFile(join(root, 'src/ui/template.html'), 'utf8');
  // Escape closing tags so inlined code cannot terminate the <script> or <style> element.
  const script = js.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
  const style = css.outputFiles[0].text.replace(/<\/style/gi, '<\\/style');
  const html = template.replace('/*__STYLE__*/', () => style).replace('/*__SCRIPT__*/', () => script);
  await writeFile(join(dist, 'ui.html'), html);
  console.log(`  dist/ui.html  ${(html.length / 1024).toFixed(1)}kb`);
}

await mkdir(dist, { recursive: true });
if (watch) {
  const ctx = await esbuild.context(mainOptions);
  await ctx.watch();
  const uiCtx = await esbuild.context({
    entryPoints: [join(root, 'src/ui/index.ts'), join(root, 'src/ui/styles.css')],
    bundle: true,
    conditions: ['source'],
    write: false,
    outdir: join(dist, '.ui-watch'),
    plugins: [{ name: 'inline-ui', setup: (b) => b.onEnd(() => buildUi().catch((e) => console.error(e))) }],
  });
  await uiCtx.watch();
  console.log('watching src/ for changes...');
} else {
  await esbuild.build(mainOptions);
  await buildUi();
}
