import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ROOT } from './repo';
import { QUEUE, STEP_MS, approveInQueue, fitScale, heroKeyTarget, heroSnap, heroValueText, panoramaFit, stepForKey, stepTick, undoInQueue } from './homepage';

describe('hero bridge', () => {
  it('says where the bridge is', () => {
    expect(heroValueText(0)).toBe('Kept in your design system');
    expect(heroValueText(30)).toBe('Mostly design system');
    expect(heroValueText(50)).toBe('Half exploration, half design system');
    expect(heroValueText(70)).toBe('Mostly exploration');
    expect(heroValueText(100)).toBe('All exploration');
  });

  it('snaps to the closer side, the middle back to the exploration', () => {
    expect(heroSnap(49)).toBe(0);
    expect(heroSnap(50)).toBe(100);
    expect(heroSnap(80)).toBe(100);
  });

  it('moves all the way with keys', () => {
    expect(heroKeyTarget('ArrowLeft')).toBe(0);
    expect(heroKeyTarget('Home')).toBe(0);
    expect(heroKeyTarget('ArrowUp')).toBe(100);
    expect(heroKeyTarget('End')).toBe(100);
    expect(heroKeyTarget('Tab')).toBeNull();
  });
});

describe('step tabs', () => {
  it('moves with arrows, wrapping, and jumps with Home and End', () => {
    expect(stepForKey('ArrowDown', 2)).toBe(0);
    expect(stepForKey('ArrowUp', 0)).toBe(2);
    expect(stepForKey('ArrowRight', 0)).toBe(1);
    expect(stepForKey('Home', 2)).toBe(0);
    expect(stepForKey('End', 0)).toBe(2);
    expect(stepForKey('Enter', 1)).toBeNull();
  });

  it('advances after the step time, never while paused, and ignores long frames', () => {
    expect(stepTick(STEP_MS - 10, 16, 2, false)).toEqual({ elapsed: 0, step: 0 });
    expect(stepTick(100, 16, 1, true)).toEqual({ elapsed: 100, step: 1 });
    expect(stepTick(0, 5000, 0, false)).toEqual({ elapsed: 64, step: 0 });
  });
});

describe('drawings', () => {
  it('scales a drawing to its column', () => {
    expect(fitScale(270, 540)).toBe(0.5);
    expect(fitScale(0, 540)).toBe(1);
  });

  it('centres the panorama and keeps it at 62% or more', () => {
    expect(panoramaFit(1440)).toEqual({ x: 0, scale: 1, height: 332 });
    const phone = panoramaFit(390);
    expect(phone.scale).toBe(0.62);
    expect(phone.x).toBeCloseTo((390 - 1440 * 0.62) / 2);
  });
});

describe('review queue', () => {
  it('approves, shows the next change, then nothing when all are done', () => {
    let s = approveInQueue(QUEUE, new Set(), 'ph');
    expect(s.selected).toBe('bg');
    s = approveInQueue(QUEUE, s.done, 'bg');
    s = approveInQueue(QUEUE, s.done, 'fr');
    expect(s.selected).toBeNull();
    expect(s.done.size).toBe(3);
  });

  it('undo puts the change back and shows it', () => {
    const s = undoInQueue(new Set(['ph', 'bg']), 'ph');
    expect([...s.done]).toEqual(['bg']);
    expect(s.selected).toBe('ph');
  });

  it('has no em dash in its words', () => {
    expect(JSON.stringify(QUEUE)).not.toMatch(/—/);
  });
});

describe('homepage sections', () => {
  const page = readFileSync(join(ROOT, 'apps/docs-site/src/pages/index.astro'), 'utf8');
  const footer = readFileSync(join(ROOT, 'apps/docs-site/src/components/site/SiteFooter.astro'), 'utf8');

  it('starts in Bridge, then ships, then the system everyone can trust', () => {
    const titles = [...page.matchAll(/<HpStepSection[\s\S]*?title="([^"]+)"/g)].map((m) => m[1]);
    expect(titles).toEqual(['Start it in Bridge. Every change is tracked.', 'Ship it everywhere at once.', 'One system everyone can trust.']);
    expect(page).not.toContain('title="Keep what works."');
    // Text left, then panel left, then text left again.
    const flips = [...page.matchAll(/<HpStepSection\s+id="[^"]+"\s+(flip\s+)?title=/g)].map((m) => Boolean(m[1]));
    expect(flips).toEqual([false, true, false]);
    expect(page).toContain('lede="Explore with Claude AI as usual. Bridge tracks what it changes in your system."');
    expect(page).not.toMatch(/—/);
  });

  it('shows the dialog, then the sieve, then the sign-off: Field Guide drawings, no interface with buttons', () => {
    expect(page).toMatch(/slot="p0" class="hp-card hp-dlg"/);
    expect(page).toContain('<HpSieve />');
    expect(page).toContain('<HpSignoff />');
    for (const f of ['HpSieve', 'HpSignoff']) {
      const src = readFileSync(join(ROOT, `apps/docs-site/src/components/home/${f}.astro`), 'utf8');
      expect(src).not.toMatch(/hp-obtn|<Button|<button/);
      expect(src).not.toMatch(/#[0-9a-f]{6}/i);
    }
  });

  it('keeps the footer About column to About Bridge and GitHub', () => {
    expect(footer).not.toContain('npmjs.com');
    expect(footer).toContain("label: 'About Bridge'");
  });
});
