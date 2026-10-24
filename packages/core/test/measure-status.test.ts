// What the measure can promise per component: text-first part pairing, the variants to measure, code props mapped to
// Figma properties, the contract screen's status, and the browser-safe measured-specs.json reader. All pure, so they
// run in the Figma plugin's UI as they do in the CLI.
import { describe, expect, it } from 'vitest';
import {
  compareSpecToMeasured,
  componentStatus,
  describeDiff,
  mapPropsToFigma,
  MeasuredSpecsError,
  pairParts,
  parseMeasuredSpecsFile,
  planVariantMeasures,
  variantValuesFromMapping,
  type FigmaComponentRef,
  type MeasuredArgType,
  type MeasuredSpec,
  type MeasuredSpecsStory,
  type SpecPart,
} from '../src';

const spec = (parts: SpecPart[], values: MeasuredSpec['values'] = {}, extra: Partial<MeasuredSpec> = {}): MeasuredSpec => ({
  story: 's',
  parts,
  values,
  raw: {},
  tokens: {},
  boxes: { root: { x: 0, y: 0, width: 100, height: 40 } },
  coverage: { fields: 10, declared: 8, matched: 1, literal: 1 },
  ...extra,
});

describe('pairParts: compound sets pair text layers by their words', () => {
  // A checkbox group: the static spec lists the group label first, the measure finds an option label first.
  const staticParts: SpecPart[] = [
    { id: 'root', name: 'Root', kind: 'frame' },
    { id: 'legend', name: 'legend', kind: 'frame', parent: 'root', source: 'G.module.css .legend' },
    { id: 'label-text', name: 'Label', kind: 'text', parent: 'legend', text: 'Label' },
    { id: 'item', name: 'item', kind: 'frame', parent: 'root', source: 'C.module.css .item' },
    { id: 'label', name: 'Label', kind: 'text', parent: 'item', source: 'C.module.css .label', characters: 'Releases' },
    { id: 'error', name: 'Error', kind: 'frame', parent: 'root', source: 'G.module.css .error' },
    { id: 'icon', name: 'Icon', kind: 'icon', parent: 'error' },
  ];
  const measured = spec([
    { id: 'root', name: 'Root', kind: 'frame' },
    { id: 'item', name: 'Item', kind: 'frame', parent: 'root', source: 'item' },
    { id: 'icon', name: 'Icon', kind: 'icon', parent: 'item' },
    { id: 'text', name: 'Text', kind: 'frame', parent: 'item', source: 'text' },
    { id: 'label', name: 'Label', kind: 'text', parent: 'text', source: 'label', characters: 'Releases' },
    { id: 'legend', name: 'Legend', kind: 'frame', parent: 'root', source: 'legend' },
    { id: 'legend-text', name: 'Legend text', kind: 'text', parent: 'legend', characters: 'Label' },
  ]);

  it('pairs each text with the measured text that says the same words', () => {
    const pairs = pairParts(staticParts, measured, { properties: [{ name: 'Label', type: 'TEXT', default: 'Label' }] });
    expect(pairs.get('label-text')).toBe('legend-text');
    expect(pairs.get('label')).toBe('label');
    expect(pairs.get('legend')).toBe('legend');
    expect(pairs.get('item')).toBe('item');
  });

  it('does not pair a part whose parent the render does not show (the error icon is not the check)', () => {
    expect(pairParts(staticParts, measured).get('icon')).toBeUndefined();
  });

  it('agrees on a value the measured declaration reaches through the same token', () => {
    const m = spec([{ id: 'root', name: 'Root', kind: 'frame' }], { root: { strokeWeight: 1 } }, { tokens: { root: { strokeWeight: { via: 'declared', chain: ['--border-width-default'], exact: false } } } });
    const c = compareSpecToMeasured([{ id: 'root', name: 'Root', kind: 'frame' }], { root: { strokeWeight: 'border-width.default' } }, m);
    expect(c.same).toBe(1);
    expect(c.sameToken).toBe(1);
  });

  it('reads hex and rgb() as the same color', () => {
    const m = spec([{ id: 'root', name: 'Root', kind: 'frame' }], {}, { raw: { root: { fill: 'rgb(255, 255, 255)' } } });
    const c = compareSpecToMeasured([{ id: 'root', name: 'Root', kind: 'frame' }], { root: { fill: 'color.bg.default' } }, { ...m, values: { root: { fill: 'x.y' } } }, () => '#ffffff');
    expect(c.same).toBe(1);
  });
});

const BUTTON: Record<string, MeasuredArgType> = {
  variant: { kind: 'enum', options: ['primary', 'secondary', 'danger'], default: 'primary' },
  size: { kind: 'enum', options: ['sm', 'md', 'lg'], default: 'md' },
  as: { kind: 'enum', options: ['button', 'a'] },
  disabled: { kind: 'boolean' },
  fullWidth: { kind: 'boolean' },
  children: { kind: 'text' },
};

describe('planVariantMeasures: every variant, not the first three stories', () => {
  it('crosses the enum props and the states, disabled as an arg, wiring props aside', () => {
    const plan = planVariantMeasures(BUTTON);
    expect(plan).toHaveLength(3 * 3 * 3);
    expect(plan).toContainEqual({ overrides: { variant: 'danger', size: 'lg' }, state: 'hover' });
    expect(plan).toContainEqual({ overrides: { variant: 'primary', size: 'sm', disabled: true } });
    expect(plan.some((p) => 'as' in p.overrides)).toBe(false);
  });

  it('varies the props a Figma mapping names, booleans included, and drops states first under the cap', () => {
    const plan = planVariantMeasures(BUTTON, { values: { variant: ['primary'], fullWidth: [false, true] }, states: ['rest', 'hover', 'focus-visible'], max: 4 });
    expect(plan).toEqual([
      { overrides: { variant: 'primary', fullWidth: false } },
      { overrides: { variant: 'primary', fullWidth: false }, state: 'hover' },
      { overrides: { variant: 'primary', fullWidth: true } },
      { overrides: { variant: 'primary', fullWidth: true }, state: 'hover' },
    ]);
  });
});

describe('mapPropsToFigma', () => {
  it('maps properties by name and VARIANT values by option, State to pseudo states and disabled', () => {
    const m = mapPropsToFigma(BUTTON, [
      { name: 'Variant', type: 'VARIANT', values: ['Primary', 'Secondary', 'Ghost'] },
      { name: 'Size', type: 'VARIANT', values: ['sm', 'md', 'lg'] },
      { name: 'State', type: 'VARIANT', values: ['Default', 'Hover', 'Pressed', 'Disabled', 'Loading'] },
      { name: 'Full width', type: 'BOOLEAN' },
      { name: 'Label', type: 'TEXT' },
      { name: 'Tone', type: 'VARIANT', values: ['a'] },
    ]);
    expect(m.mapped.find((x) => x.figma === 'Variant')).toEqual({ figma: 'Variant', type: 'VARIANT', prop: 'variant', values: { Primary: 'primary', Secondary: 'secondary' }, unmatchedValues: ['Ghost'] });
    expect(m.mapped.find((x) => x.figma === 'State')?.values).toEqual({ Default: 'rest', Hover: 'hover', Pressed: 'active', Disabled: 'disabled' });
    expect(m.mapped.find((x) => x.figma === 'Full width')?.prop).toBe('fullWidth');
    expect(m.mapped.find((x) => x.figma === 'Label')?.prop).toBe('children');
    expect(m.figmaOnly).toEqual(['Tone']);
    expect(variantValuesFromMapping(m)).toEqual({ variant: ['primary', 'secondary'], size: ['sm', 'md', 'lg'] });
  });
});

describe('componentStatus: Matches, Differs, or Can\'t check yet with a reason', () => {
  const parts: SpecPart[] = [{ id: 'root', name: 'Root', kind: 'frame' }];
  const figma: FigmaComponentRef = {
    properties: [
      { name: 'Size', type: 'VARIANT', values: ['sm', 'md'] },
      { name: 'State', type: 'VARIANT', values: ['Default', 'Hover'] },
    ],
    parts,
    variants: [
      { props: { Size: 'sm', State: 'Default' }, values: { root: { paddingLeft: 'space.2' } } },
      { props: { Size: 'md', State: 'Default' }, values: { root: { paddingLeft: 'space.3' } } },
      { props: { Size: 'md', State: 'Hover' }, values: { root: { paddingLeft: 'space.3' } } },
    ],
  };
  const story = (props: Record<string, string>, pad: string, extra: Partial<MeasuredSpecsStory> = {}): MeasuredSpecsStory => ({ id: `b--${props.size}`, title: 'Button', name: 'B', url: '', ms: 1, props, spec: spec(parts, { root: { paddingLeft: pad } }), ...extra });
  const argTypes = { size: BUTTON.size! };

  it('matches when every Figma variant has a measured story that agrees', () => {
    const s = componentStatus({ name: 'Button', argTypes, figma, stories: [story({ size: 'sm' }, 'space.2'), story({ size: 'md' }, 'space.3'), story({ size: 'md' }, 'space.3', { state: 'hover' })] });
    expect(s.status).toBe('matches');
    expect(s.variants.map((v) => v.status)).toEqual(['matches', 'matches', 'matches']);
  });

  it('differs, with the first difference in designer words', () => {
    const s = componentStatus({ name: 'Button', argTypes, figma, stories: [story({ size: 'sm' }, 'space.1-5'), story({ size: 'md' }, 'space.3'), story({ size: 'md' }, 'space.3', { state: 'hover' })] });
    expect(s.status).toBe('differs');
    expect(s.summary).toBe('Left padding is space.1-5 in code, space.2 in Figma');
    expect(describeDiff({ part: 'label', field: 'fontWeight', static: 500, measured: 400, same: false })).toBe('Font weight is 400 in code, 500 in Figma (label)');
  });

  it("can't check a variant no story shows, and says which", () => {
    const s = componentStatus({ name: 'Button', argTypes, figma, stories: [story({ size: 'sm' }, 'space.2'), story({ size: 'md' }, 'space.3')] });
    expect(s).toMatchObject({ status: 'cant-check', reason: 'no-story-for-variant', detail: 'Size=md, State=Hover' });
  });

  it('gives the reason in the order a team fixes them', () => {
    expect(componentStatus({ name: 'X', stories: [] }).reason).toBe('no-story');
    expect(componentStatus({ name: 'X', stories: [{ id: 'x', title: 'X', name: 'X', url: '', ms: 0, error: 'the story threw' }] })).toMatchObject({ reason: 'did-not-render', detail: 'the story threw' });
    expect(componentStatus({ name: 'X', stories: [{ id: 'x', title: 'X', name: 'X', url: '', ms: 0, error: 'no popup', opened: 'none' }] }).reason).toBe('popup-closed');
    const literal = story({ size: 'sm' }, 'space.2', { spec: spec(parts, {}, { coverage: { fields: 40, declared: 1, matched: 10, literal: 29 } }) });
    expect(componentStatus({ name: 'X', stories: [literal], figma }).reason).toBe('no-token-variables');
    expect(componentStatus({ name: 'X', stories: [story({ size: 'sm' }, 'space.2')] }).reason).toBe('no-figma');
    expect(componentStatus({ name: 'X', argTypes: {}, figma, stories: [story({ size: 'sm' }, 'space.2')] })).toMatchObject({ reason: 'prop-unmapped', detail: 'Size has no prop in code' });
  });
});

describe('parseMeasuredSpecsFile', () => {
  const file = { version: 1, storybook: 'https://sb.example.com', measuredAt: '2026-10-24T00:00:00Z', stories: [{ id: 'a--b', title: 'A', name: 'B', url: '', ms: 1, spec: spec([{ id: 'root', name: 'Root', kind: 'frame' }]), props: { size: 'md' } }] };

  it('reads text or parsed JSON', () => {
    expect(parseMeasuredSpecsFile(JSON.stringify(file)).stories[0]!.props).toEqual({ size: 'md' });
    expect(parseMeasuredSpecsFile(file).storybook).toBe('https://sb.example.com');
  });

  it('says what is wrong', () => {
    expect(() => parseMeasuredSpecsFile('{')).toThrow(MeasuredSpecsError);
    expect(() => parseMeasuredSpecsFile({ ...file, version: 2 })).toThrow(/version 2/);
    expect(() => parseMeasuredSpecsFile({ ...file, stories: [{ id: 'x', spec: { parts: 'no' } }] })).toThrow(/story x has a spec without parts/);
  });
});
