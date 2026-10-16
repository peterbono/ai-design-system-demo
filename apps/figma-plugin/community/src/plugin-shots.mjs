// Screenshots of the real DS Bridge UI (dist/ui.html) for the Community gallery.
// Figma is not running here, so this script plays the main thread: it answers the UI's requests
// (init, snapshot) the way src/main/index.ts does, with a snapshot built by snapshot.ts. GitHub calls go
// to the real api.github.com, read-only (GET only, anything else is refused), with GITHUB_TOKEN.
// Usage: GITHUB_TOKEN=... node plugin-shots.mjs <snapshot.json> <out-dir> <pull|push>
// pull: a file with no variables yet (first pull plan). push: a pulled file with a designer's edits.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const here = dirname(fileURLToPath(import.meta.url));
const [snapshotPath, outDir, mode = 'push'] = process.argv.slice(2);
const token = process.env.GITHUB_TOKEN;
if (!snapshotPath || !outDir || !token) throw new Error('usage: GITHUB_TOKEN=... node plugin-shots.mjs <snapshot.json> <out-dir>');

const ui = readFileSync(join(here, '../../dist/ui.html'), 'utf8');
const snapshot = JSON.parse(readFileSync(snapshotPath, 'utf8'));
const config = JSON.parse(readFileSync(join(here, '../../../../bridge.config.json'), 'utf8'));
const repo = `${config.repo.owner}/${config.repo.name}`;
const head = await (await fetch(`https://api.github.com/repos/${repo}/branches/${config.repo.defaultBranch}`, { headers: { authorization: `Bearer ${token}` } })).json();

const init = {
  settings: { repo, branch: config.repo.defaultBranch, tokensPath: config.tokens.root },
  // The file was pulled from the current main: the snapshot's edits are the only Figma changes.
  sync: snapshot.variables.length ? { baseSha: head.commit.sha, lastPullAt: new Date().toISOString() } : {},
  hasToken: true,
  token: 'held-by-the-harness',
  fileName: snapshot.fileName,
};

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 480, height: 640 }, deviceScaleFactor: 2 });
await page.route('https://plugin.local/**', (r) => r.fulfill({ contentType: 'text/html', body: ui }));
await page.route('https://api.github.com/**', async (r) => {
  if (r.request().method() !== 'GET') return r.abort();
  const res = await r.fetch({ headers: { ...r.request().headers(), authorization: `Bearer ${token}` } });
  return r.fulfill({ response: res });
});
await page.exposeBinding('__answer', (_src, type) => (type === 'init' ? init : type === 'snapshot' ? snapshot : null));
await page.addInitScript(() => {
  // parent === window outside Figma: answer the UI's requests like the main thread would.
  window.addEventListener('message', async (e) => {
    const msg = e.data?.pluginMessage;
    if (msg?.kind !== 'request') return;
    const payload = (await window.__answer(msg.type)) ?? { ok: true };
    window.postMessage({ pluginMessage: { kind: 'response', reqId: msg.reqId, ok: true, payload } }, '*');
  });
});

await page.goto('https://plugin.local/ui.html');
const settle = () => page.waitForFunction(() => !document.getElementById('busy-text'), null, { timeout: 60000 }).then(() => page.waitForTimeout(400));

if (mode === 'pull') {
  await page.getByRole('button', { name: 'Check for updates' }).click();
  await settle();
  await page.screenshot({ path: join(outDir, 'plugin-pull.png') });
} else {
  await page.getByRole('tab', { name: 'Push' }).click();
  await page.getByRole('button', { name: 'Scan for changes' }).click();
  await settle();
  await page.screenshot({ path: join(outDir, 'plugin-push.png') });
}
await browser.close();
