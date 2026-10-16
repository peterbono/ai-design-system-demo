// Renders the Community kit from art.html with Chrome (playwright-core, channel chrome):
// icon.png 128x128, cover.png and gallery-*.png 1920x1080, into apps/figma-plugin/community/.
// Gallery views frame the real screenshots made by plugin-shots.mjs and web-shots.mjs.
// Usage: node render.mjs <shots-dir> [view ...]   (views: icon, cover, gallery-plugin, gallery-review, gallery-tokens)
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';

const here = dirname(fileURLToPath(import.meta.url));
const shots = process.argv[2];
if (!shots) throw new Error('usage: node render.mjs <shots-dir>');
const shotsUrl = pathToFileURL(resolve(shots)).href + '/';
const out = join(here, '..');
const pick = process.argv.slice(3);
const views = [
  { view: 'icon', file: 'icon.png', w: 128, h: 128, scale: 1 },
  { view: 'cover', file: 'cover.png', w: 1920, h: 1080, scale: 1 },
  { view: 'gallery-plugin', file: 'gallery-1-plugin.png', w: 1920, h: 1080, scale: 1 },
  { view: 'gallery-review', file: 'gallery-2-pull-request.png', w: 1920, h: 1080, scale: 1 },
  { view: 'gallery-tokens', file: 'gallery-3-tokens.png', w: 1920, h: 1080, scale: 1 },
].filter((v) => !pick.length || pick.includes(v.view));
const browser = await chromium.launch({ channel: 'chrome', headless: true });
for (const v of views) {
  const page = await browser.newPage({ viewport: { width: v.w, height: v.h }, deviceScaleFactor: v.scale });
  await page.goto(`${pathToFileURL(join(here, 'art.html')).href}?view=${v.view}&shots=${encodeURIComponent(shotsUrl)}`);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForFunction(() => [...document.images].every((i) => !i.src || i.complete));
  await page.locator(`#${v.view}`).screenshot({ path: join(out, v.file) });
  await page.close();
  console.log(v.file);
}
await browser.close();
