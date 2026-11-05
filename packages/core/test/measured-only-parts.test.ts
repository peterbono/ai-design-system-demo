// specsFromMeasure: a part only some variants render (a check mark when checked) is a part of the set, drawn from that
// story, hidden in the variants that do not render it. Before, the set had only the default story's parts and a designer
// was told to draw the rest by hand.
import { describe, expect, it } from 'vitest';
import { partsOfEveryVariant, specsFromMeasure, type MeasuredSpec, type MeasuredSpecsFile } from '../src';

const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 12 12"><path d="M2 6l3 3 5-6" stroke="#fff"/></svg>';

function spec(story: string, checked: boolean): MeasuredSpec {
  return {
    story,
    parts: [
      { id: 'root', name: 'Root', kind: 'frame', source: 'item', layout: { direction: 'HORIZONTAL', primary: 'MIN', counter: 'CENTER' } },
      { id: 'box', name: 'Box', kind: 'frame', parent: 'root', source: 'box', layout: { direction: 'HORIZONTAL', primary: 'CENTER', counter: 'CENTER' } },
      ...(checked ? [{ id: 'mark', name: 'Mark', kind: 'icon' as const, parent: 'box', source: 'mark' }] : []),
      { id: 'label', name: 'Label', kind: 'text', parent: 'root', source: 'label', characters: 'Notify me' },
      ...(checked ? [{ id: 'label', name: 'Label', kind: 'text' as const, parent: 'root', source: 'hint', characters: 'On' }].map((p) => ({ ...p, id: 'label-on' })) : []),
    ],
    values: { root: { itemSpacing: 8 }, box: { width: 16, height: 16, fill: checked ? 'checkbox.bg-checked' : 'checkbox.bg' }, ...(checked ? { mark: { width: 12, height: 12 } } : {}), label: { fontSize: 14 } },
    raw: {},
    tokens: {},
    boxes: { root: { x: 10, y: 10, width: 120, height: 24 }, box: { x: 10, y: 14, width: 16, height: 16 }, ...(checked ? { mark: { x: 12, y: 16, width: 12, height: 12 } } : {}), label: { x: 34, y: 10, width: 80, height: 24 } },
    coverage: { fields: 0, declared: 0, matched: 0, literal: 0 },
    ...(checked ? { vectors: { mark: { svg, strokes: ['checkbox.check'] } }, sized: { mark: { width: 12, height: 12 } } } : {}),
  };
}

const file = (): MeasuredSpecsFile => ({
  version: 1,
  storybook: 'https://storybook.acme.dev',
  measuredAt: '2026-11-05T00:00:00.000Z',
  stories: [
    { id: 'forms-check--default', title: 'Forms/Check', name: 'Default', props: { checked: false }, spec: spec('forms-check--default', false) },
    { id: 'forms-check--checked', title: 'Forms/Check', name: 'Checked', props: { checked: true }, spec: spec('forms-check--checked', true) },
  ],
  components: [{ title: 'Forms/Check', name: 'Check', argTypes: { checked: { kind: 'boolean', default: false } } }],
}) as unknown as MeasuredSpecsFile;

describe('measured only: parts of every variant', () => {
  it('the check mark is a part of the set, hidden when unchecked, with its own SVG when checked', () => {
    const check = specsFromMeasure(file()).specs.components[0]!;
    expect(check.parts.map((p) => `${p.id}<${p.parent ?? ''}:${p.kind}`)).toEqual(['root<:frame', 'box<root:frame', 'mark<box:vector', 'label<root:text', 'label-on<root:text']);
    const off = check.variants.find((v) => v.props.Checked === 'false')!;
    const on = check.variants.find((v) => v.props.Checked === 'true')!;
    expect(off.hidden).toEqual(['mark', 'label-on']);
    expect(on.hidden).toBeUndefined();
    expect(on.vectors).toEqual({ mark: { svg, strokes: ['checkbox.check'] } });
    expect(on.values.mark).toMatchObject({ width: 12, height: 12 });
  });

  it('a part keeps its place under its parent, an id the tree has takes a number, its box moves to the default frame', () => {
    const base = spec('a', false);
    const other = spec('b', true);
    // The other story's root sits elsewhere in its page, and names its hint "label" too.
    other.boxes = Object.fromEntries(Object.entries(other.boxes).map(([k, b]) => [k, { ...b, x: b.x + 100, y: b.y + 50 }]));
    other.parts = other.parts.map((p) => (p.id === 'label-on' ? { ...p, id: 'label' } : p.id === 'label' ? { ...p, id: 'text' } : p));
    const merged = partsOfEveryVariant(base, [other]);
    expect(merged.parts.map((p) => p.id)).toEqual(['root', 'box', 'mark', 'label', 'label-2']);
    expect(merged.parts.find((p) => p.id === 'label-2')).toMatchObject({ parent: 'root', characters: 'On' });
    expect(merged.boxes.mark).toEqual({ x: 12, y: 16, width: 12, height: 12 });
    expect(merged.vectors?.mark?.svg).toBe(svg);
    // The default story is never changed.
    expect(base.parts.map((p) => p.id)).toEqual(['root', 'box', 'label']);
  });
});
