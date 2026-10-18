import { describe, expect, it } from 'vitest';
import { changeEdits } from '@bridge-ds/core';
import { latestBase } from './latest';
import { scopeSelector, together, togetherPairs } from './together';
import { fromText, parseChanges, readChanges, readUse, SESSION_KEY, shouldRender, toggleIncluded, togetherLabel, TOGETHER_HINT, USE_KEY, type StorageLike } from './session';

// The latest library exactly as the toolbar loads it: this checkout's token files and config.
const base = latestBase('packages/tokens/src');
const latest = base.latest;
const LIGHT = 'semantic/light.tokens.json';

function lightWith(values: Record<string, string>): string {
  const json = JSON.parse(latest[LIGHT]!) as Record<string, unknown>;
  for (const [path, value] of Object.entries(values)) path.split('.').reduce<Record<string, unknown>>((n, k) => n[k] as Record<string, unknown>, json).$value = value;
  return `${JSON.stringify(json, null, 2)}\n`;
}
const edits = (number: number, values: Record<string, string>) => changeEdits({ number, base: { [LIGHT]: latest[LIGHT] }, head: { [LIGHT]: lightWith(values) }, files: [LIGHT] });

// Fixtures: three token changes; 101 and 118 set the page canvas differently.
const A = edits(101, { 'color.bg.default': '{palette.neutral.50}' });
const B = edits(118, { 'color.bg.default': '{palette.neutral.100}', 'color.border.default': '{palette.neutral.300}' });
const C = edits(120, { 'color.text.link': '{palette.primary.800}' });
const KEY = `${LIGHT}#path:color.bg.default`;

describe('together', () => {
  it('paints the combination in light only, for every brand and density, with the pick', () => {
    const r = together(base, [A, B, C], { [KEY]: 118 }, [101, 118, 120]);
    expect(r.unpicked).toEqual([]);
    expect(r.css).toContain(`${scopeSelector('light', 'bridge', 'comfortable')} {`);
    expect(r.css).toContain(`${scopeSelector('light', 'ocean', 'compact')} {`);
    expect(r.css).not.toContain('[data-theme="dark"]');
    expect(r.css).toMatch(/--color-bg-default: #[0-9a-f]{6};/);
    expect(r.tokens.map((t) => [t.path, t.from])).toEqual([
      ['color.bg.default', [118]],
      ['color.border.default', [118]],
      ['color.text.link', [120]],
    ]);
  });

  it('recomputes live when a change is switched off', () => {
    const all = together(base, [A, B, C], { [KEY]: 118 }, [101, 118, 120]);
    const withoutB = together(base, [A, B, C], { [KEY]: 118 }, [101, 120]);
    expect(withoutB.tokens.map((t) => [t.path, t.from])).toEqual([
      ['color.bg.default', [101]],
      ['color.text.link', [120]],
    ]);
    expect(withoutB.css).not.toBe(all.css);
    expect(together(base, [A, B, C], {}, []).css).toBe('');
  });

  it('gives before and after where the page is, as computed styles read them', () => {
    const r = together(base, [A, B, C], { [KEY]: 101 }, [101, 118, 120]);
    const light = togetherPairs(base, r, { theme: 'light', brand: 'bridge', density: 'comfortable' });
    const bg = light.find((p) => p.token.path === 'color.bg.default')!;
    expect(bg.before).toMatch(/^rgb\(\d+, \d+, \d+\)$/);
    expect(bg.before).not.toBe(bg.after);
    expect(bg.token.from).toEqual([101]);
    // Nothing differs in dark: no pair there.
    expect(togetherPairs(base, r, { theme: 'dark', brand: 'bridge', density: 'comfortable' })).toEqual([]);
  });

  it('names the change a value comes from', () => {
    const titles: Record<number, string> = { 101: 'Darker default background', 118: 'Grey canvas' };
    expect(fromText([101], (n) => titles[n] ?? null)).toBe('from Darker default background');
    expect(fromText([101, 118, 7], (n) => titles[n] ?? null)).toBe('from Darker default background, Grey canvas and #7');
  });
});

function memoryStorage(seed: Record<string, string> = {}): StorageLike & { data: Map<string, string> } {
  const data = new Map(Object.entries(seed));
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v), removeItem: (k) => void data.delete(k) };
}

describe('lists of changes in the address', () => {
  it('reads ?bridge=101,118,120 with the picks, and keeps both for the session', () => {
    const s = memoryStorage();
    expect(readChanges('?bridge=101,118,120&bridge-use=118%3Aa%23b', s)).toEqual([101, 118, 120]);
    expect(s.data.get(SESSION_KEY)).toBe('101,118,120');
    expect(readUse('?bridge=101,118,120&bridge-use=118%3Aa%23b', s)).toBe('118:a#b');
    expect(s.data.get(USE_KEY)).toBe('118:a#b');
    expect(readChanges('', s)).toEqual([101, 118, 120]);
    expect(readUse('', s)).toBe('118:a#b');
    // One change again forgets the picks.
    expect(readChanges('?bridge=101', s)).toEqual([101]);
    expect(s.data.has(USE_KEY)).toBe(false);
  });

  it('parses strictly: no repeats, at most 4, nothing half-read', () => {
    expect(parseChanges('101,101,118')).toEqual([101, 118]);
    expect(parseChanges('101%2C118')).toEqual([101, 118]);
    expect(parseChanges('1,2,3,4,5')).toEqual([1, 2, 3, 4]);
    expect(parseChanges('101,<script>')).toEqual([]);
    expect(readChanges('?bridge=101,off', memoryStorage({ [SESSION_KEY]: '7' }))).toEqual([]);
  });

  it('renders on production for changes tried together, and only then', () => {
    expect(shouldRender({ change: 101, where: 'production', returnTo: null, together: true })).toBe(true);
    expect(shouldRender({ change: 101, where: 'production', returnTo: null })).toBe(false);
  });

  it('switches changes on and off in the order Studio listed them', () => {
    expect(toggleIncluded([101, 118, 120], [101, 120], 118, true)).toEqual([101, 118, 120]);
    expect(toggleIncluded([101, 118, 120], [101, 118, 120], 101, false)).toEqual([118, 120]);
    expect(togetherLabel(3)).toBe('These 3 changes');
    expect(togetherLabel(1)).toBe('This change');
    expect(TOGETHER_HINT).not.toMatch(/—|\b(branch|pull request|merge|commit)\b/i);
  });
});
