// Screenshots of live pages for the Community gallery: the Bridge Studio token explorer, the Reviews page of
// PR #4 (opened by DS Bridge) and the PR itself on GitHub. Nothing is staged: the pages are loaded as they are.
// Bridge pages call api.github.com from the browser; anonymous reads are limited to 60 an hour, so with
// GITHUB_TOKEN set those GET calls are answered with the token added on this side (the page never sees it).
// Usage: [GITHUB_TOKEN=...] node web-shots.mjs <out-dir>
import { join } from 'node:path';
import { chromium } from 'playwright-core';

const outDir = process.argv[2];
if (!outDir) throw new Error('usage: node web-shots.mjs <out-dir>');
const shots = [
  { name: 'web-tokens', url: 'https://bridge.floriangouloubi.com/studio/tokens/' },
  { name: 'web-review', url: 'https://bridge.floriangouloubi.com/studio/reviews/?pr=4' },
  { name: 'web-github-pr', url: 'https://github.com/peterbono/ai-design-system-demo/pull/4' },
];
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
  await page.screenshot({ path: join(outDir, `${s.name}.png`) });
  await page.screenshot({ path: join(outDir, `${s.name}-full.png`), fullPage: true });
}
await browser.close();
