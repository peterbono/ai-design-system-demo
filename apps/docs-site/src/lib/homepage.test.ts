import { describe, expect, it } from 'vitest';
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
