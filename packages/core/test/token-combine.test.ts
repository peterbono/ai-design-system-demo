import { describe, expect, it } from 'vitest';
import { changeEdits, combineChanges, combineConflicts, decodePicks, encodePicks, pickedOption, unpicked, type CombineSource } from '../src/token-combine';
import { flattenTokens, parseTokenFile } from '../src/dtcg-codec';
import { buildTokenSet } from '../src/token-set';
import { cssOf, cssVarOf, previewOverrides } from '../src/css-overrides';

const LIGHT = 'semantic/light.tokens.json';
const DARK = 'semantic/dark.tokens.json';

const color = (hex: string) => ({
  $type: 'color',
  $value: { colorSpace: 'srgb', components: [1, 3, 5].map((i) => Math.round((parseInt(hex.slice(i, i + 2), 16) / 255) * 1000) / 1000), hex },
});
const file = (tokens: Record<string, unknown>) => `${JSON.stringify({ color: tokens }, null, 2)}\n`;

const start = { text: color('#111111'), canvas: color('#ffffff'), link: color('#0000aa'), border: color('#dddddd') };
const latestLight = file(start);

const src = (number: number, light: Record<string, unknown> | null, extra: Partial<CombineSource> = {}): CombineSource => ({
  number,
  base: { [LIGHT]: latestLight },
  head: { [LIGHT]: light ? file(light) : undefined },
  files: [LIGHT],
  ...extra,
});

const hexes = (text: string | null | undefined) =>
  Object.fromEntries(flattenTokens(parseTokenFile(LIGHT, text ?? '{}')).map((t) => [t.path, (t.value as { hex: string }).hex]));

// Three token changes, as fixtures: A darkens the canvas, B makes it grey (conflicts with A) and moves the border,
// C only changes the link colour.
const A = changeEdits(src(101, { ...start, canvas: color('#f2f2f2') }));
const B = changeEdits(src(118, { ...start, canvas: color('#e0e0e0'), border: color('#cccccc') }));
const C = changeEdits(src(120, { ...start, link: color('#0b4a8b') }));

describe('changeEdits', () => {
  it('lists only the tokens the change moved since it started', () => {
    expect(B.edits.map((e) => [e.key, e.path, e.change])).toEqual([
      [`${LIGHT}#path:color.canvas`, 'color.canvas', 118],
      [`${LIGHT}#path:color.border`, 'color.border', 118],
    ]);
    expect(B.problems).toEqual([]);
  });

  it('never counts a value the library moved after the change started as an edit', () => {
    // The change started before the library darkened its text: its own file still has the old text value.
    const behind = changeEdits({ number: 7, base: { [LIGHT]: file(start) }, head: { [LIGHT]: file({ ...start, link: color('#000000') }) }, files: [LIGHT] });
    expect(behind.edits.map((e) => e.path)).toEqual(['color.link']);
    const latest = { [LIGHT]: file({ ...start, text: color('#000000') }) };
    expect(hexes(combineChanges(latest, [behind]).files[LIGHT])['color.text']).toBe('#000000');
  });

  it('records a removal and an added file', () => {
    const removed = changeEdits(src(9, { text: start.text, canvas: start.canvas, link: start.link }));
    expect(removed.edits).toHaveLength(1);
    expect(removed.edits[0]!.token).toBeUndefined();
    const added = changeEdits({ number: 10, base: {}, head: { [DARK]: file({ canvas: color('#000000') }) }, files: [DARK] });
    expect(added.edits.map((e) => [e.file, e.path])).toEqual([[DARK, 'color.canvas']]);
  });

  it('reports a file it cannot read instead of guessing', () => {
    const broken = changeEdits({ number: 11, base: { [LIGHT]: latestLight }, head: { [LIGHT]: '{ nope' }, files: [LIGHT] });
    expect(broken.problems[0]).toMatch(/semantic\/light.tokens.json \(change 11\) is not valid JSON/);
  });
});

describe('combineConflicts and picks', () => {
  it('finds the one token two changes set differently', () => {
    const conflicts = combineConflicts([A, B, C]);
    expect(conflicts.map((c) => [c.path, c.options.map((o) => o.changes)])).toEqual([['color.canvas', [[101], [118]]]]);
  });

  it('is not a conflict when two changes set a token the same way', () => {
    const same = changeEdits(src(130, { ...start, canvas: color('#f2f2f2') }));
    expect(combineConflicts([A, same])).toEqual([]);
    const c = combineChanges({ [LIGHT]: latestLight }, [A, same]);
    expect(c.from['color.canvas']).toEqual([101, 130]);
  });

  it('needs a pick that names one of the changes', () => {
    const [conflict] = combineConflicts([A, B]);
    expect(unpicked([conflict!], {})).toHaveLength(1);
    expect(pickedOption(conflict!, { [conflict!.key]: 118 })?.changes).toEqual([118]);
    expect(pickedOption(conflict!, { [conflict!.key]: 999 })).toBeNull();
  });
});

describe('combineChanges', () => {
  const latest = { [LIGHT]: latestLight, [DARK]: file({ canvas: color('#000000') }) };

  it('applies every edit on top of the latest library, with the pick for the conflict', () => {
    const key = `${LIGHT}#path:color.canvas`;
    const c = combineChanges(latest, [A, B, C], { [key]: 118 });
    expect(c.missing).toEqual([]);
    expect([c.edits, c.tokens]).toEqual([3, 3]);
    expect(hexes(c.files[LIGHT])).toEqual({ 'color.text': '#111111', 'color.canvas': '#e0e0e0', 'color.link': '#0b4a8b', 'color.border': '#cccccc' });
    expect(c.from).toEqual({ 'color.canvas': [118], 'color.border': [118], 'color.link': [120] });
    // Files no change touches stay byte for byte.
    expect(c.files[DARK]).toBe(latest[DARK]);
  });

  it('leaves an unpicked conflict at the library value and lists it', () => {
    const c = combineChanges(latest, [A, B, C]);
    expect(c.missing.map((m) => m.path)).toEqual(['color.canvas']);
    expect(hexes(c.files[LIGHT])['color.canvas']).toBe('#ffffff');
    expect(c.from['color.canvas']).toBeUndefined();
  });

  it('recomputes when a change is switched off: its edits go, and its conflict settles by itself', () => {
    const key = `${LIGHT}#path:color.canvas`;
    const all = combineChanges(latest, [A, B, C], { [key]: 118 });
    const withoutB = combineChanges(latest, [A, B, C], { [key]: 118 }, { include: [101, 120], unpicked: 'first' });
    expect(withoutB.included).toEqual([101, 120]);
    expect(withoutB.conflicts).toEqual([]);
    expect(hexes(withoutB.files[LIGHT])).toEqual({ 'color.text': '#111111', 'color.canvas': '#f2f2f2', 'color.link': '#0b4a8b', 'color.border': '#dddddd' });
    expect(withoutB.from).toEqual({ 'color.canvas': [101], 'color.link': [120] });
    expect(all.files[LIGHT]).not.toBe(withoutB.files[LIGHT]);
    const none = combineChanges(latest, [A, B, C], {}, { include: [] });
    expect(none.files).toEqual(latest);
  });

  it('uses the first included change when the picked one is off and two others still disagree', () => {
    const D = changeEdits(src(140, { ...start, canvas: color('#d0d0d0') }));
    const key = `${LIGHT}#path:color.canvas`;
    const c = combineChanges(latest, [A, B, D], { [key]: 118 }, { include: [101, 140], unpicked: 'first' });
    expect(c.missing.map((m) => m.path)).toEqual(['color.canvas']);
    expect(hexes(c.files[LIGHT])['color.canvas']).toBe('#f2f2f2');
  });

  it('removes a token a change removes, and adds a file a change adds', () => {
    const removed = changeEdits(src(9, { text: start.text, canvas: start.canvas, link: start.link }));
    const added = changeEdits({ number: 10, base: {}, head: { 'semantic/contrast.tokens.json': file({ canvas: color('#000000') }) }, files: ['semantic/contrast.tokens.json'] });
    const c = combineChanges(latest, [removed, added]);
    expect(Object.keys(hexes(c.files[LIGHT]))).not.toContain('color.border');
    expect(c.files['semantic/contrast.tokens.json']).toContain('#000000');
  });
});

describe('encodePicks / decodePicks', () => {
  it('round-trips picks through an address', () => {
    const picks = { [`${LIGHT}#path:color.canvas`]: 118, [`${DARK}#path:color.canvas`]: 101 };
    const raw = encodePicks(picks);
    expect(raw).toBe(`101:${DARK}#path:color.canvas~118:${LIGHT}#path:color.canvas`);
    expect(decodePicks(raw)).toEqual(picks);
    expect(decodePicks(new URLSearchParams(`use=${encodeURIComponent(raw)}`).get('use'))).toEqual(picks);
  });

  it('ignores anything that is not a change number and a key', () => {
    expect(decodePicks('abc:x#y~0:a#b~12:no-hash~~')).toEqual({});
    expect(decodePicks(null)).toEqual({});
  });
});

describe('previewOverrides', () => {
  it('paints only the variables whose resolved value differs', () => {
    const a = buildTokenSet({ [LIGHT]: latestLight });
    const b = buildTokenSet({ [LIGHT]: file({ ...start, link: color('#0b4a8b') }) });
    expect(previewOverrides(a, b, { theme: 'light' })).toEqual({ '--color-link': '#0b4a8b' });
    expect(cssVarOf('color.bg.default')).toBe('--color-bg-default');
    expect(cssOf('color', { colorSpace: 'srgb', components: [0, 0, 0], alpha: 0.5 })).toBe('rgb(0 0 0 / 0.5)');
  });
});
