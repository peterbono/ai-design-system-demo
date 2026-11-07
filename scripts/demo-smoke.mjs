#!/usr/bin/env node
// Demo smoke test: loads the demo team's pages as a signed-out visitor and fails when an exploration is missing, a
// state is not shown, or the page logs an error of its own. Run by .github/workflows/demo-smoke.yml against the
// production site after each deploy, on a schedule, or by hand:
//
//   node scripts/demo-smoke.mjs [--base https://bridge.floriangouloubi.com] [--shots <dir>]
//
// Expected: the Account app of acme-design-demo/bridge-demo-ds lists every exploration of its design copy, one per
// state (exploring, waiting for lead, in review or check the build, shipped). Browser: playwright-core with the
// runner's Chrome (BRIDGE_CHROME_CHANNEL=chrome) or Chromium; BRIDGE_DEPS points at a folder holding playwright-core.
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const TEAM = 'acme-design-demo/bridge-demo-ds';
export const PRODUCT = 'account';
/** The explorations of the demo's design copy, by number, and the state each card must say. */
export const EXPECTED = [
  { n: 1, title: 'Team seats and roles', state: /Exploring/ },
  { n: 2, title: 'Profile page', state: /Waiting for lead/ },
  { n: 3, title: 'Notification channels', state: /Exploring/ },
  { n: 4, title: 'Invoice status as badges', state: /In review|Check the build/, check: true },
  { n: 5, title: 'Yearly prices on plans', state: /Shipped/ },
];

/** The heading of Check the build (components/ds/studio BuildCheck), and how long a visitor may wait for it. */
export const CHECK_HEADING = 'Ready to ship?';
export const CHECK_MS = 4000;
/** A row of who checks the build: the section read, not only its frame. */
export const CHECK_ROW = '.xp-build-row';

/**
 * Console errors that are not the page's own: a signed-out visitor's expected refusals (a sign-in probe answers 401,
 * a capture or snapshot that does not exist yet answers 404) are logged by the browser as "Failed to load resource".
 */
export function ownErrors(messages) {
  return messages.filter((m) => !/^Failed to load resource: the server responded with a status of (401|403|404)\b/.test(m));
}

/** What is wrong with a product page's cards: a missing exploration or a card that does not say its state. */
export function cardProblems(cards, expected = EXPECTED) {
  const problems = [];
  for (const e of expected) {
    const card = cards.find((c) => c.href.includes(`exploration=${e.n}&`) || c.href.endsWith(`exploration=${e.n}`));
    if (!card) problems.push(`exploration #${e.n} (${e.title}) is missing from the product page`);
    else if (!e.state.test(card.text)) problems.push(`exploration #${e.n} (${e.title}) does not say ${e.state}: "${card.text.slice(0, 120)}"`);
  }
  return problems;
}

function args(argv) {
  const o = { base: 'https://bridge.floriangouloubi.com', shots: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--base') o.base = argv[++i].replace(/\/$/, '');
    else if (argv[i] === '--shots') o.shots = resolve(argv[++i]);
  }
  return o;
}

async function main() {
  const o = args(process.argv.slice(2));
  const require = createRequire(join(resolve(process.env.BRIDGE_DEPS ?? '.'), 'package.json'));
  const { chromium } = require('playwright-core');
  const browser = await chromium.launch(process.env.BRIDGE_CHROME_CHANNEL ? { channel: process.env.BRIDGE_CHROME_CHANNEL } : {});
  const problems = [];
  const studio = `${o.base}/studio/${TEAM}/`;
  const pages = [
    ['home', studio],
    ['changes', `${studio}changes/`],
    ['product', `${studio}products/${PRODUCT}/`],
    ...EXPECTED.map((e) => [`exploration-${e.n}`, `${studio}changes/?exploration=${e.n}&product=${PRODUCT}`]),
  ];
  if (o.shots) mkdirSync(o.shots, { recursive: true });
  for (const [name, url] of pages) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors = [];
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    page.on('pageerror', (e) => errors.push(`uncaught: ${e.message}`));
    const started = Date.now();
    const res = await page.goto(url, { waitUntil: 'load', timeout: 60000 }).catch((e) => ({ status: () => `failed (${e.message})` }));
    if (res?.status?.() !== 200) problems.push(`${name}: ${url} answered ${res?.status?.()}`);
    // The handed-off exploration with a ready build: Check the build itself, within CHECK_MS of the page loading.
    const checked = EXPECTED.find((x) => `exploration-${x.n}` === name && x.check);
    if (checked) {
      const shown = await page.getByText(CHECK_HEADING).first().waitFor({ timeout: CHECK_MS }).then(() => page.locator(CHECK_ROW).first().waitFor({ timeout: Math.max(1, CHECK_MS - (Date.now() - started)) })).then(() => true, () => false);
      if (!shown) problems.push(`${name}: Check the build ("${CHECK_HEADING}") did not show within ${CHECK_MS / 1000} s`);
      else console.log(`${name}: Check the build showed after ${((Date.now() - started) / 1000).toFixed(1)} s`);
    }
    await page.waitForTimeout(8000);
    if (name === 'product') {
      const cards = await page.$$eval('main a[href*="exploration="]', (as) => as.map((a) => ({ href: a.getAttribute('href') ?? '', text: (a.closest('article, li, div')?.textContent ?? a.textContent ?? '').replace(/\s+/g, ' ').trim() })));
      problems.push(...cardProblems(cards).map((p) => `product: ${p}`));
    }
    if (name.startsWith('exploration-')) {
      const e = EXPECTED.find((x) => `exploration-${x.n}` === name);
      const shown = await page.getByRole('heading', { level: 1, name: e.title }).isVisible().catch(() => false);
      if (!shown) problems.push(`${name}: the exploration page does not show "${e.title}"`);
    }
    for (const err of ownErrors(errors)) problems.push(`${name}: console error: ${err.slice(0, 200)}`);
    if (o.shots) await page.screenshot({ path: join(o.shots, `${name}.png`), fullPage: true });
    await page.close();
  }
  await browser.close();
  if (problems.length) {
    console.log(`Demo smoke test: ${problems.length} problem(s)\n${problems.map((p) => `- ${p}`).join('\n')}`);
    process.exit(1);
  }
  console.log(`Demo smoke test: ${pages.length} pages read as a signed-out visitor, every exploration in its state.`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) await main();
