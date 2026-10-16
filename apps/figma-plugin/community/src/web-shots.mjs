// Screenshots of live pages for the Community gallery: the Bridge Studio token explorer, the Reviews page of
// PR #4 (opened by DS Bridge) and the PR itself on GitHub. Nothing is staged: the pages are loaded as they are.
// Bridge pages call api.github.com from the browser; anonymous reads are limited to 60 an hour, so with
// GITHUB_TOKEN set those GET calls are answered with the token added on this side (the page never sees it).
// BRIDGE_URL points the Bridge shots at another build (a local `npm run docs:preview`, say); ONLY=web-review
// takes only the named shots (comma separated).
// Usage: [GITHUB_TOKEN=...] [BRIDGE_URL=http://localhost:4321] [ONLY=web-review] node web-shots.mjs <out-dir>
import { join } from 'node:path';
import { chromium } from 'playwright-core';

const outDir = process.argv[2];
if (!outDir) throw new Error('usage: node web-shots.mjs <out-dir>');
const bridge = (process.env.BRIDGE_URL || 'https://bridge.floriangouloubi.com').replace(/\/$/, '');
const only = process.env.ONLY?.split(',').filter(Boolean);
const shots = [
  // The draft tray is fixed to the viewport, so a full-page capture paints it over the table; it is empty in a
  // fresh browser, so it is hidden for the shot (only when empty: a real draft would stay visible).
  { name: 'web-tokens', url: `${bridge}/studio/tokens/`, hideEmptyDraftTray: true },
  { name: 'web-review', url: `${bridge}/studio/reviews/?pr=4` },
  { name: 'web-github-pr', url: 'https://github.com/peterbono/ai-design-system-demo/pull/4' },
].filter((s) => !only || only.includes(s.name));
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 810 }, deviceScaleFactor: 2, colorScheme: 'light' });
const token = process.env.GITHUB_TOKEN;
if (token)
  await page.route('https://api.github.com/**', async (r) => {
    if (r.request().method() !== 'GET') return r.abort();
    const res = await r.fetch({ headers: { ...r.request().headers(), authorization: `Bearer ${token}` } });
    return r.fulfill({ response: res });
  });
for (const s of shots) {
  await page.goto(s.url, { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(1500);
  if (s.hideEmptyDraftTray)
    await page.evaluate(() => {
      const tray = document.getElementById('ed-tray');
      if (tray && /No draft changes yet/.test(tray.textContent ?? '')) tray.style.display = 'none';
    });
  await page.screenshot({ path: join(outDir, `${s.name}.png`) });
  await page.screenshot({ path: join(outDir, `${s.name}-full.png`), fullPage: true });
}
await browser.close();
