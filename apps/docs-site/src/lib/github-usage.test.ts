import { describe, expect, it } from 'vitest';
import { clockOf, parseUsage, USAGE_WORDS as W, usageLines } from './github-usage';

const NOW = Date.parse('2026-11-02T13:10:00Z');
const RESET = Date.parse('2026-11-02T14:00:00Z');
const clock = (ms: number) => clockOf(ms, 'en-GB', 'UTC');
const usage = (used: number, low = false) => ({ usage: { limit: 5000, used, remaining: 5000 - used, resetAt: RESET, low }, slowedAt: null });

describe('Settings, GitHub usage (admins)', () => {
  it('says how much Bridge used this hour and when it resets', () => {
    expect(usageLines(usage(1240), NOW, clock)).toEqual({ sentence: 'Bridge used 1,240 of 5,000 GitHub reads this hour. Resets at 14:00.', help: [], tone: 'calm' });
  });

  it('says it calmly when the team is close to the limit, with the numbers second', () => {
    expect(usageLines(usage(4100, true), NOW, clock)).toEqual({
      sentence: "Bridge is close to GitHub's hourly limit for this team. Pages may load from the last saved copy until 14:00.",
      help: ['4,100 of 5,000 reads used.'],
      tone: 'warning',
    });
  });

  it('reads a reset window, or no data, as a fresh hour', () => {
    expect(usageLines({ usage: null, slowedAt: null }, NOW, clock).sentence).toBe(W.none);
    expect(usageLines(usage(4900, true), RESET + 1, clock)).toEqual({ sentence: W.none, help: [], tone: 'calm' });
  });

  it('mentions a recent slow down from GitHub, and forgets it after an hour', () => {
    const slowedAt = Date.parse('2026-11-02T13:02:00Z');
    expect(usageLines({ ...usage(1240), slowedAt }, NOW, clock).help).toEqual(['GitHub asked Bridge to slow down at 13:02. Pages may load from the last saved copy for a few minutes.']);
    expect(usageLines({ ...usage(1240), slowedAt }, slowedAt + 61 * 60 * 1000, clock).help).toEqual([]);
  });

  it('uses no em dash and no developer words', () => {
    const all = [W.label, W.meter, W.none, W.used('1', '2', '3'), W.low('3'), W.lowCount('1', '2'), W.slowed('3')].join(' ');
    expect(all).not.toMatch(/—/);
    expect(all).not.toMatch(/\b(API|rate limit|quota|token|installation|request|cache|header)\b/i);
  });

  it('checks what the page receives', () => {
    expect(parseUsage({ usage: { limit: 5000, used: 10, remaining: 4990, resetAt: RESET, low: false }, slowedAt: null })).toEqual(usage(10));
    expect(parseUsage({ usage: { limit: 'x' } })).toEqual({ usage: null, slowedAt: null });
    expect(parseUsage(null)).toEqual({ usage: null, slowedAt: null });
  });
});
