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
  variantCombosFromMapping,
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

describe('Checked=mixed is the indeterminate prop', () => {
  const argTypes: Record<string, MeasuredArgType> = { checked: { kind: 'boolean' } };
  const figma: FigmaComponentRef = {
    properties: [
      { name: 'Checked', type: 'VARIANT', values: ['false', 'true', 'mixed'] },
      { name: 'State', type: 'VARIANT', values: ['Default'] },
    ],
    parts: [{ id: 'root', name: 'Root', kind: 'frame' }],
    variants: ['false', 'true', 'mixed'].map((c) => ({ props: { Checked: c, State: 'Default' }, values: { root: { fill: `checkbox.${c}` } } })),
  };

  it('maps mixed to checked false plus indeterminate, and plans that combination', () => {
    const m = mapPropsToFigma(argTypes, figma.properties);
    expect(m.mapped[0]).toMatchObject({ prop: 'checked', values: { false: false, true: true, mixed: false }, also: { mixed: { indeterminate: true } } });
    expect(m.mapped[0]!.unmatchedValues).toBeUndefined();
    expect(variantCombosFromMapping(m)).toEqual([{ checked: false }, { checked: true }, { checked: false, indeterminate: true }]);
    expect(planVariantMeasures(argTypes, { combos: variantCombosFromMapping(m), states: ['rest'] }).map((p) => p.overrides)).toEqual([{ checked: false }, { checked: true }, { checked: false, indeterminate: true }]);
  });

  it('checks each Checked value against its own story, the unchecked one not against the indeterminate story', () => {
    const story = (overrides: Record<string, boolean>, c: string): MeasuredSpecsStory => ({ id: `cb-${c}`, title: 'Forms/Checkbox', name: 'Default', url: '', ms: 1, props: { checked: false, ...overrides }, overrides, spec: spec([{ id: 'root', name: 'Root', kind: 'frame' }], { root: { fill: `checkbox.${c}` } }) });
    const stories = [story({ checked: false, indeterminate: true }, 'mixed'), story({ checked: false }, 'false'), story({ checked: true }, 'true')];
    const s = componentStatus({ name: 'Checkbox', argTypes, figma, stories });
    expect(s.variants.map((v) => [v.key, v.status, v.story])).toEqual([
      ['Checked=false, State=Default', 'matches', 'cb-false'],
      ['Checked=true, State=Default', 'matches', 'cb-true'],
      ['Checked=mixed, State=Default', 'matches', 'cb-mixed'],
    ]);
    expect(s.status).toBe('matches');
  });
});

describe('triage of the full-library measure: pairing and story noise', () => {
  const S = (id: string, parent: string | undefined, kind: SpecPart['kind'], source?: string, characters?: string): SpecPart => ({ id, name: id, kind, ...(parent ? { parent } : {}), ...(source ? { source } : {}), ...(characters ? { characters } : {}) });

  it('pairs by any class of the part, not only the last (a size modifier)', () => {
    const pairs = pairParts([S('root', undefined, 'frame'), S('control', 'root', 'frame', 'Input.module.css .control, Input.module.css .md')], spec([S('root', undefined, 'frame'), S('label', 'root', 'frame', 'label'), S('control', 'root', 'frame', 'control')]));
    expect(pairs.get('control')).toBe('control');
  });

  it('leaves a classless static frame (a drawn decoration) off a measured part another static part names', () => {
    const statics = [S('root', undefined, 'frame'), S('decoration', 'root', 'frame'), S('tab', 'root', 'frame', 'Tabs.module.css .tab')];
    const pairs = pairParts(statics, spec([S('root', undefined, 'frame'), S('tab', 'root', 'frame', 'tab'), S('tab-2', 'root', 'frame', 'tab')]));
    expect(pairs.get('tab')).toBe('tab');
    expect(pairs.get('decoration')).toBeUndefined();
  });

  it('does not pair the same words in another role (the current crumb against a crumb link)', () => {
    const statics = [S('root', undefined, 'frame'), S('current', 'root', 'text', 'Breadcrumb.module.css .current', 'Input')];
    expect(pairParts(statics, spec([S('root', undefined, 'frame'), S('link', 'root', 'text', 'link subtle', 'Input')])).get('current')).toBeUndefined();
  });

  it('keeps the parts of a hidden classed parent unpaired, whatever classes they share', () => {
    const statics = [S('root', undefined, 'frame'), S('error', 'root', 'frame', 'Field.module.css .error'), S('icon', 'error', 'icon', 'Icon.module.css .icon, Icon.module.css .xs')];
    expect(pairParts(statics, spec([S('root', undefined, 'frame'), S('check', 'root', 'icon', 'icon xs glyph')])).get('icon')).toBeUndefined();
  });

  const parts = [S('root', undefined, 'frame')];
  const figma: FigmaComponentRef = { properties: [{ name: 'State', type: 'VARIANT', values: ['Default', 'Disabled'] }], parts, variants: [{ props: { State: 'Default' }, values: { root: { fill: 'table.bg' } } }, { props: { State: 'Disabled' }, values: { root: { fill: 'table.bg' } } }] };
  const st = (id: string, fill: string, extra: Partial<MeasuredSpecsStory> = {}): MeasuredSpecsStory => ({ id, title: 'Data/Table', name: id, url: '', ms: 1, props: {}, spec: spec(parts, { root: { fill } }), ...extra });

  it('compares a variant with the closest of the stories that render its props', () => {
    const s = componentStatus({ name: 'Table', argTypes: {}, figma: { ...figma, variants: [figma.variants[0]!] }, stories: [st('sortable', 'table.bg-selected'), st('plain', 'table.bg')] });
    expect(s.variants[0]).toMatchObject({ status: 'matches', story: 'plain' });
  });

  it('says which arg the story refused when a variant has no story', () => {
    const s = componentStatus({ name: 'Table', argTypes: {}, figma, stories: [st('plain', 'table.bg'), st('plain', 'table.bg', { spec: undefined, overrides: { disabled: true }, error: 'the story does not take the arg disabled=true' })] });
    expect(s.summary).toBe('No story shows some variants: State=Disabled; the story does not take disabled');
  });

  it('names the open popup Figma draws when the component itself has no set', () => {
    expect(componentStatus({ name: 'Dialog', stories: [st('d', 'x')], figmaSets: ['Dialog/Popup'] })).toMatchObject({ reason: 'no-figma', summary: 'Figma draws the open popup (Dialog/Popup): measure it open with --open' });
  });
});

