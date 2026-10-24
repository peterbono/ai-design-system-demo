// Deterministic screenshots with playwright-core and an installed Chrome: fixed viewport and scale, frozen
// clock and Math.random, no animations, transitions or caret, fonts loaded, network outside loopback stubbed,
// volatile regions masked, and a DOM that has stopped changing.
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';
import type { Viewport } from './types.js';

export const FROZEN_TIME = '2026-01-15T10:00:00.000Z';

const FREEZE_CSS = `*,*::before,*::after{animation-duration:0s!important;animation-delay:0s!important;animation-iteration-count:1!important;transition:none!important;caret-color:transparent!important;scroll-behavior:auto!important}
::-webkit-scrollbar{display:none}
[data-visual-mask]{visibility:hidden!important}`;

// Seeded Math.random (mulberry32) so ids, jitter and generated data repeat run to run.
const INIT_SCRIPT = `(() => {
  let a = 0x2f6b1d;
  Math.random = function () { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const add = () => { const s = document.createElement('style'); s.setAttribute('data-bridge-visual', ''); s.textContent = ${JSON.stringify(FREEZE_CSS)}; (document.head || document.documentElement).appendChild(s); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', add); else add();
})();`;

const PIXEL = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mN8+P9/PQAJNAPNdHq0qgAAAABJRU5ErkJggg==', 'base64');

export interface LaunchOptions {
  /** Path to a Chrome or Chromium binary; otherwise the installed Chrome (channel "chrome"). */
  executablePath?: string;
  channel?: string;
}

export async function launch(o: LaunchOptions = {}): Promise<Browser> {
  const executablePath = o.executablePath ?? process.env.BRIDGE_CHROME_PATH;
  return chromium.launch({
    headless: true,
    ...(executablePath ? { executablePath } : { channel: o.channel ?? process.env.BRIDGE_CHROME_CHANNEL ?? 'chrome' }),
    args: ['--lang=en-US', '--disable-gpu', '--font-render-hinting=none', '--disable-lcd-text', '--force-color-profile=srgb', '--hide-scrollbars', '--disable-skia-runtime-opts', '--disable-renderer-backgrounding'],
  });
}

export async function newContext(browser: Browser, viewport: Viewport, deviceScaleFactor = 1): Promise<BrowserContext> {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor, reducedMotion: 'reduce', colorScheme: 'light', locale: 'en-US', timezoneId: 'UTC', serviceWorkers: 'block' });
  await ctx.addInitScript(INIT_SCRIPT);
  // Only loopback is real: remote images become a transparent pixel, anything else remote is aborted.
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1[:/]|localhost[:/])/, (route) =>
    route.request().resourceType() === 'image' ? route.fulfill({ status: 200, contentType: 'image/png', body: PIXEL }) : route.abort(),
  );
  return ctx;
}

export async function newPage(ctx: BrowserContext): Promise<Page> {
  const page = await ctx.newPage();
  await page.clock.setFixedTime(new Date(FROZEN_TIME));
  return page;
}

/** Waits for fonts, images, two frames, and a DOM whose markup stops changing (bounded). */
export async function settle(page: Page, o: { timeout?: number; network?: boolean; quiet?: number; interval?: number; busy?: boolean } = {}): Promise<void> {
  const timeout = o.timeout ?? 10000;
  if (o.network !== false) await page.waitForLoadState('networkidle', { timeout }).catch(() => undefined);
  const work = page.evaluate(async ({ limit, quiet, interval, waitBusy }) => {
    const frames = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(null))));
    await document.fonts.ready;
    const sig = () => `${document.body.innerHTML.length}:${document.querySelectorAll('*').length}`;
    let last = '';
    let same = 0;
    // The page clock is fixed, so time the wait with performance.now().
    const t0 = performance.now();
    while (performance.now() - t0 < limit) {
      await frames();
      await new Promise((r) => setTimeout(r, interval));
      const s = sig();
      const busy = waitBusy && document.querySelectorAll('[aria-busy="true"]').length > 0;
      if (s === last && !busy) same++;
      else same = 0;
      last = s;
      if (same >= quiet) break;
    }
    // Pending images, bounded: a lazy image below the fold never loads, so do not wait on it forever.
    const pending = Array.from(document.images).filter((i) => !i.complete && i.loading !== 'lazy');
    await Promise.race([Promise.all(pending.map((i) => new Promise((r) => ((i.onload = r), (i.onerror = r))))), new Promise((r) => setTimeout(r, 3000))]);
    await document.fonts.ready;
    await frames();
  }, { limit: timeout, quiet: o.quiet ?? 3, interval: o.interval ?? 120, waitBusy: o.busy ?? true });
  let timer: NodeJS.Timeout | undefined;
  await Promise.race([work, new Promise((r) => (timer = setTimeout(r, timeout + 5000)))]).finally(() => clearTimeout(timer));
}

export interface ShotRequest {
  url: string;
  /** Replaces page.goto(url): e.g. switching stories inside an already loaded Storybook. */
  navigate?: (page: Page) => Promise<void>;
  /** Settle options; app screens wait for the network, story switches do not. */
  settle?: Parameters<typeof settle>[1];
  file: string;
  fullPage: boolean;
  waitFor?: string;
  ready?: string;
  /** JS expression polled until truthy before settling (story rendered, app mounted). */
  readyFn?: string;
  mask?: string[];
}

/** Navigates, settles and writes a PNG. Returns an error message instead of throwing. */
export async function shoot(page: Page, r: ShotRequest): Promise<string | null> {
  const debug = process.env.BRIDGE_VISUAL_DEBUG ? (step: string) => process.stderr.write(`    ${step} ${Date.now() - t0}ms\n`) : () => undefined;
  const t0 = Date.now();
  try {
    if (r.navigate) await r.navigate(page);
    else await page.goto(r.url, { waitUntil: 'load', timeout: 30000 });
    if (r.ready) await page.waitForSelector(r.ready, { state: 'attached', timeout: 15000 });
    if (r.readyFn) await page.waitForFunction(r.readyFn, undefined, { timeout: 20000 });
    if (r.waitFor) await page.waitForSelector(r.waitFor, { state: 'visible', timeout: 15000 });
    debug('ready');
    await settle(page, r.settle);
    debug('settled');
    const err = await page.evaluate(() => (document.body.classList.contains('sb-show-errordisplay') ? (document.querySelector('#error-message')?.textContent ?? 'Story failed to render') : null));
    const buf = await page.screenshot({
      fullPage: r.fullPage,
      animations: 'disabled',
      caret: 'hide',
      scale: 'css',
      mask: (r.mask ?? []).map((s) => page.locator(s)),
      maskColor: '#ff00ff',
    });
    debug('shot');
    await mkdir(dirname(r.file), { recursive: true });
    await writeFile(r.file, buf);
    return err;
  } catch (e) {
    return (e as Error).message.split('\n')[0] ?? 'capture failed';
  }
}

/**
 * Shows a story in an already loaded Storybook preview through its channel (what the manager does when you
 * click a story), much faster than a page load per story. Resolves once the story rendered or failed.
 */
export async function switchStory(page: Page, storyId: string): Promise<void> {
  const ok = await page.evaluate(
    (id) =>
      new Promise<boolean>((resolve) => {
        const ch = (window as unknown as { __STORYBOOK_ADDONS_CHANNEL__?: { on: (e: string, f: () => void) => void; off: (e: string, f: () => void) => void; emit: (e: string, p: unknown) => void } }).__STORYBOOK_ADDONS_CHANNEL__;
        if (!ch) return resolve(false);
        const events = ['storyRendered', 'storyErrored', 'storyThrewException', 'storyMissing', 'playFunctionThrewException'];
        const timer = setTimeout(() => done(), 15000);
        function done() {
          clearTimeout(timer);
          for (const e of events) ch!.off(e, done);
          resolve(true);
        }
        for (const e of events) ch.on(e, done);
        window.scrollTo(0, 0);
        ch.emit('setCurrentStory', { storyId: id, viewMode: 'story' });
      }),
    storyId,
  );
  if (!ok) throw new Error('Storybook channel not found');
}

/**
 * A page for `bridge specs --measure`: an installed Chrome, one page at 1200x800, light scheme, reduced motion. Unlike
 * the capture context it reaches remote hosts (a team's deployed Storybook). Close it when done.
 */
export async function openMeasurePage(o: LaunchOptions & { scale?: number } = {}): Promise<{ page: Page; close: () => Promise<void> }> {
  const browser = await launch(o);
  try {
    // scale: device pixels per CSS pixel for screenshots (2 for the fidelity check); CSS measures do not change.
    const ctx = await browser.newContext({ viewport: { width: 1200, height: 800 }, deviceScaleFactor: o.scale ?? 1, reducedMotion: 'reduce', colorScheme: 'light', locale: 'en-US', serviceWorkers: 'block' });
    const page = await ctx.newPage();
    return { page, close: () => browser.close().catch(() => undefined) };
  } catch (e) {
    await browser.close().catch(() => undefined);
    throw e;
  }
}
