// QA harness for the "New brand detected" card on Push. Writes qa-screens-newbrand/plugin-new-brand.html at the
// repo root (gitignored): the real built UI (dist/ui.html) with a stand-in for the Figma main thread and for the
// GitHub REST API serving this repo's token files, driven to Push > Scan > "Create it in this pull request".
// Usage: npm run plugin:build && node apps/figma-plugin/scripts/qa-new-brand.mjs   (then open the file at 1440 wide)
// Add ?state=fail to the file URL for a too-light Acme primary (failing contrast).
import * as esbuild from 'esbuild';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const repo = join(root, '../..');
const ui = join(root, 'dist/ui.html');
if (!existsSync(ui)) throw new Error('Run npm run plugin:build first (dist/ui.html is missing).');

process.chdir(root); // test helpers read the repo relative to the plugin folder
const tmp = join(root, '.qa-dist');
await esbuild.build({ entryPoints: [join(root, 'test/qa-new-brand.ts')], bundle: true, conditions: ['source'], platform: 'node', format: 'esm', target: 'node20', outfile: join(tmp, 'qa.mjs'), logLevel: 'warning' });
const { newBrandHarnessData } = await import(pathToFileURL(join(tmp, 'qa.mjs')).href);
const { files, headSha, snapshot } = await newBrandHarnessData();
await rm(tmp, { recursive: true, force: true });

const blobs = Object.fromEntries(Object.entries(files).map(([path, text]) => [path, Buffer.from(text, 'utf8').toString('base64')]));
const stub = `
(() => {
  const DATA = ${JSON.stringify({ blobs, headSha, snapshot })};
  const fail = new URLSearchParams(location.search).get('state') === 'fail';
  if (fail) {
    const brand = DATA.snapshot.collections.find((c) => c.name === 'Brand');
    const v = DATA.snapshot.variables.find((x) => x.collectionId === brand.id && x.name === 'palette/primary/700');
    v.valuesByMode['Brand:acme'] = { kind: 'color', r: 0.62, g: 0.83, b: 1, a: 1 };
  }
  const paths = Object.keys(DATA.blobs);
  const json = (body, status = 200) => Promise.resolve({ ok: status < 400, status, json: async () => body, headers: { get: () => null } });
  // GitHub REST stand-in: only the reads a scan makes.
  window.fetch = (url) => {
    const p = new URL(url).pathname;
    if (/\\/git\\/ref\\/heads\\//.test(p)) return json({ object: { sha: DATA.headSha } });
    if (/\\/git\\/commits\\//.test(p)) return json({ tree: { sha: 'tree-1' } });
    if (/\\/git\\/trees\\//.test(p)) return json({ tree: paths.map((path) => ({ path, type: 'blob', sha: 'blob:' + path, mode: '100644' })), truncated: false });
    const blob = /\\/git\\/blobs\\/(.+)$/.exec(p);
    if (blob) return json({ content: DATA.blobs[decodeURIComponent(blob[1]).slice(5)], encoding: 'base64' });
    if (/\\/pulls/.test(p)) return json([]);
    return json({ message: 'Not Found' }, 404);
  };
  // Figma main-thread stand-in.
  const answers = {
    init: () => ({ settings: { repo: 'peterbono/ai-design-system-demo', branch: 'main', tokensPath: 'packages/tokens/src' }, sync: { baseSha: DATA.headSha }, hasToken: true, token: 'qa', fileName: DATA.snapshot.fileName }),
    snapshot: () => DATA.snapshot,
  };
  window.addEventListener('message', (e) => {
    const m = e.data && e.data.pluginMessage;
    if (!m || m.kind !== 'request') return;
    const f = answers[m.type];
    window.postMessage({ pluginMessage: { kind: 'response', reqId: m.reqId, ok: !!f, payload: f ? f() : undefined, error: f ? undefined : 'not in the harness' } }, '*');
  });
  // Drive: Push tab, scan, include the new brand.
  const step = () => {
    const tab = document.getElementById('tab-push');
    if (tab && tab.getAttribute('aria-selected') !== 'true') tab.click();
    const scan = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Scan for changes');
    if (scan && !scan.disabled) scan.click();
    const box = document.getElementById('brand-acme');
    if (box && !box.checked) box.click();
    if (document.querySelector('.brand-result')) document.body.dataset.qaReady = 'true';
    else setTimeout(step, 100);
  };
  addEventListener('load', () => setTimeout(step, 50));
})();
`;
// The plugin window, centered on a neutral page so a 1440 wide screenshot reads like Figma.
const frame = `<style>html{background:#e5e5e5}body{display:flex;justify-content:center;align-items:flex-start;padding:24px 0;background:#e5e5e5;height:auto}#app{width:420px;height:760px;background:#fff;border-radius:8px;box-shadow:0 2px 14px rgba(0,0,0,.15);overflow:hidden}</style>`;
const html = (await readFile(ui, 'utf8')).replace('</head>', `${frame}<script>${stub.replace(/<\/script/gi, '<\\/script')}</script></head>`);
await mkdir(join(repo, 'qa-screens-newbrand'), { recursive: true });
const out = join(repo, 'qa-screens-newbrand/plugin-new-brand.html');
await writeFile(out, html);
console.log(`qa: wrote ${out}`);
