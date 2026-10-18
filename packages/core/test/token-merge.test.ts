import { describe, expect, it } from 'vitest';
import { applyTokenMerge, defaultChoiceFor, missingChoices, planTokenMerge, removedSide, type TokenMergeInput } from '../src/token-merge';
import { flattenTokens, parseTokenFile } from '../src/dtcg-codec';

const FILE = 'semantic/light.tokens.json';

const color = (hex: string) => ({
  $type: 'color',
  $value: { colorSpace: 'srgb', components: [1, 3, 5].map((i) => Math.round((parseInt(hex.slice(i, i + 2), 16) / 255) * 1000) / 1000), hex },
});
const file = (tokens: Record<string, unknown>) => `${JSON.stringify({ color: tokens }, null, 2)}\n`;

const base = file({ text: color('#111111'), muted: color('#555555'), link: color('#0000aa'), border: color('#dddddd') });

function input(mine: string | undefined, theirs: string | undefined, b: string | undefined = base): TokenMergeInput {
  return { base: { [FILE]: b }, mine: { [FILE]: mine }, theirs: { [FILE]: theirs }, files: [FILE] };
}

const hexes = (text: string | null | undefined) =>
  Object.fromEntries(flattenTokens(parseTokenFile(FILE, text ?? '{}')).map((t) => [t.path, (t.value as { hex: string }).hex]));

describe('planTokenMerge', () => {
  it('takes each side when they touched different tokens, with no conflict', () => {
    const mine = file({ text: color('#000000'), muted: color('#555555'), link: color('#0000aa'), border: color('#dddddd') });
    const theirs = file({ text: color('#111111'), muted: color('#444444'), link: color('#0000aa'), border: color('#dddddd') });
    const plan = planTokenMerge(input(mine, theirs));
    expect(plan.conflicts).toEqual([]);
    expect([plan.mineOnly, plan.theirsOnly]).toEqual([1, 1]);
    expect(hexes(applyTokenMerge(input(mine, theirs), {}).files[FILE])).toEqual({ 'color.text': '#000000', 'color.muted': '#444444', 'color.link': '#0000aa', 'color.border': '#dddddd' });
  });

  it('is not a conflict when both sides made the same change', () => {
    const same = file({ text: color('#222222'), muted: color('#555555'), link: color('#0000aa'), border: color('#dddddd') });
    expect(planTokenMerge(input(same, same)).conflicts).toEqual([]);
  });

  it('lists a token both sides changed differently, keeping mine by default', () => {
    const mine = file({ text: color('#000000'), muted: color('#555555'), link: color('#0000aa'), border: color('#dddddd') });
    const theirs = file({ text: color('#333333'), muted: color('#555555'), link: color('#0000aa'), border: color('#dddddd') });
    const plan = planTokenMerge(input(mine, theirs));
    expect(plan.conflicts).toHaveLength(1);
    const c = plan.conflicts[0]!;
    expect([c.path, c.removedOn, c.defaultChoice, c.key]).toEqual(['color.text', null, 'mine', `${FILE}#path:color.text`]);
    expect([(c.base!.value as { hex: string }).hex, (c.mine!.value as { hex: string }).hex, (c.theirs!.value as { hex: string }).hex]).toEqual(['#111111', '#000000', '#333333']);
    expect(hexes(applyTokenMerge(input(mine, theirs), {}).files[FILE])['color.text']).toBe('#000000');
    expect(hexes(applyTokenMerge(input(mine, theirs), { [c.key]: 'theirs' }).files[FILE])['color.text']).toBe('#333333');
  });

  it('gives no default to a token removed on one side and changed on the other', () => {
    const removedHere = file({ muted: color('#555555'), link: color('#0000aa'), border: color('#dddddd') });
    const changedThere = file({ text: color('#333333'), muted: color('#555555'), link: color('#0000aa'), border: color('#dddddd') });
    const plan = planTokenMerge(input(removedHere, changedThere));
    expect(plan.conflicts.map((c) => [c.path, c.removedOn, c.defaultChoice])).toEqual([['color.text', 'mine', null]]);
    expect(missingChoices(plan, {})).toHaveLength(1);
    expect(() => applyTokenMerge(input(removedHere, changedThere), {})).toThrow(/Pick a value for color.text/);
    const key = plan.conflicts[0]!.key;
    expect(hexes(applyTokenMerge(input(removedHere, changedThere), { [key]: 'mine' }).files[FILE])['color.text']).toBeUndefined();
    expect(hexes(applyTokenMerge(input(removedHere, changedThere), { [key]: 'theirs' }).files[FILE])['color.text']).toBe('#333333');

    const reverse = planTokenMerge(input(changedThere, removedHere));
    expect(reverse.conflicts.map((c) => [c.removedOn, c.defaultChoice])).toEqual([['theirs', null]]);
  });

  it('removes a token this change removed when the library left it alone', () => {
    const mine = file({ text: color('#111111'), muted: color('#555555'), link: color('#0000aa') });
    const theirs = file({ text: color('#111111'), muted: color('#444444'), link: color('#0000aa'), border: color('#dddddd') });
    const merged = hexes(applyTokenMerge(input(mine, theirs), {}).files[FILE]);
    expect(merged).toEqual({ 'color.text': '#111111', 'color.muted': '#444444', 'color.link': '#0000aa' });
  });

  it('keeps the library text byte for byte where this change touched nothing', () => {
    const theirs = `${base.trimEnd().replace('#dddddd', '#cccccc')}\n`;
    const merged = applyTokenMerge(input(base, theirs), {}).files[FILE];
    expect(merged).toBe(theirs);
  });

  it('reports a file that is not JSON and refuses to merge it', () => {
    const plan = planTokenMerge(input('{ nope', base));
    expect(plan.problems[0]).toMatch(/this change/);
    expect(() => applyTokenMerge(input('{ nope', base), {})).toThrow();
  });

  it('counts which side each conflict kept', () => {
    const mine = file({ text: color('#000000'), muted: color('#000001'), link: color('#0000aa'), border: color('#dddddd') });
    const theirs = file({ text: color('#333333'), muted: color('#333334'), link: color('#0000aa'), border: color('#dddddd') });
    const plan = planTokenMerge(input(mine, theirs));
    const r = applyTokenMerge(input(mine, theirs), { [plan.conflicts[0]!.key]: 'theirs' });
    expect(r.kept).toEqual({ mine: 1, theirs: 1 });
  });
});

describe('the deleted-versus-changed rule', () => {
  it('has a default only when both sides still have the token', () => {
    expect(defaultChoiceFor({ base: 1, mine: 1, theirs: 1 })).toBe('mine');
    expect(defaultChoiceFor({ base: undefined, mine: 1, theirs: 1 })).toBe('mine');
    expect(defaultChoiceFor({ base: 1, mine: undefined, theirs: 1 })).toBeNull();
    expect(defaultChoiceFor({ base: 1, mine: 1, theirs: undefined })).toBeNull();
    expect(removedSide({ base: 1, mine: undefined, theirs: 1 })).toBe('mine');
    expect(removedSide({ base: 1, mine: 1, theirs: undefined })).toBe('theirs');
  });
});
