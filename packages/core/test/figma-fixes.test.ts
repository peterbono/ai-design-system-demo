// figma-fixes.json: the corrections a team keeps for the components the measure does not draw right. Validated like any
// config, re-applied to every fresh measure (so they survive pulls), each with a provenance record.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  applyFixes,
  appliedFixLines,
  FigmaFixesError,
  parseFigmaFixes,
  parseMeasuredSpecsFile,
  specsFromMeasure,
  validateFigmaFixes,
  type FigmaFix,
  type MeasuredSpecsFile,
} from '../src';
import { buttonMeasure } from './button-label-fixture';

const load = (): MeasuredSpecsFile => parseMeasuredSpecsFile(readFileSync(join(__dirname, 'fixtures/gap/carbon-measured.json'), 'utf8'));
const base = { reason: 'Carbon draws it this way in every theme.' };
const toggleDefault = (f: MeasuredSpecsFile) => f.stories.find((s) => s.id === 'components-toggle--default' && !s.overrides && !s.state)!;

describe('validateFigmaFixes', () => {
  it('accepts every kind', () => {
    const file = {
      $schema: 'https://bridge.floriangouloubi.com/figma-fixes.schema.json',
      version: 1,
      fixes: [
        { id: 'knob-radius', kind: 'part', component: 'Toggle', part: '.cds--toggle__switch', set: { cornerRadius: 'full', fill: 'cds.support.success' }, width: 48, height: 'fixed', ...base },
        { id: 'knob-overlay', kind: 'part', component: 'Toggle', part: 'cds--toggle-switch-before', overlay: { top: 3, left: 3 }, where: { args: { toggled: false } }, ...base },
        { id: 'kind-names', kind: 'axis', action: 'map', component: 'Button', arg: 'kind', property: 'Kind', values: { primary: 'Primary', 'danger--ghost': 'Danger ghost' }, ...base },
        { id: 'no-align', kind: 'axis', action: 'ignore', component: 'IconButton', arg: 'align', ...base },
        { id: 'no-skeleton-hover', kind: 'axis', action: 'prune', component: 'TextInput', where: { args: { readOnly: true }, state: 'hover' }, ...base },
        { id: 'toggle-on', kind: 'story', component: 'Toggle', where: { args: { toggled: true }, state: 'rest' }, use: { story: 'components-toggle--small-toggle' }, ...base },
        { id: 'tooltip-note', kind: 'status', component: 'IconButton', status: 'cant-check', by: 'claude', ...base },
        { id: 'just-a-note', kind: 'status', component: 'IconButton', ...base },
      ],
    };
    expect(validateFigmaFixes(file)).toEqual([]);
    expect(parseFigmaFixes(JSON.stringify(file)).fixes).toHaveLength(8);
  });

  it('says what is wrong, in plain words', () => {
    const problems = validateFigmaFixes({
      version: 1,
      fixes: [
        { id: 'Bad Id', kind: 'part', component: 'Toggle', part: 'x', set: { fill: 3 }, ...base },
        { id: 'dup', kind: 'part', component: 'Toggle', part: 'x', hide: true, width: 'hug', ...base },
        { id: 'dup', kind: 'status', component: 'Toggle', status: 'matches', ...base },
        { id: 'radius', kind: 'part', component: 'Toggle', part: 'x', set: { paddingTop: 'full', bogus: 1 }, ...base },
        { id: 'no-reason', kind: 'axis', action: 'map', component: 'Toggle', arg: 'size', reason: 'ok' },
        { id: 'dash', kind: 'axis', action: 'ignore', component: 'Toggle', arg: 'size', reason: 'not a property \u2014 never drawn', extra: 1 },
        { id: 'story', kind: 'story', component: 'Toggle', use: { story: 'x' }, ...base },
        { id: 'prune', kind: 'axis', action: 'prune', component: 'Toggle', ...base },
      ],
    });
    expect(problems).toEqual([
      'fix Bad Id: id must be lower case letters, digits and dashes',
      'fix Bad Id: set.fill is a color: a token path or null, not a number',
      'fix dup: hide goes alone: a hidden part has nothing else to change',
      'fix dup: id is repeated',
      'fix dup: status cannot be "matches": only the shot comparison says a component matches',
      'fix radius: set.paddingTop: "full" is for cornerRadius only',
      expect.stringMatching(/^fix radius: set\.bogus is not a field/),
      'fix no-reason: reason is missing: say why, in a sentence',
      'fix no-reason: map gives property (the Figma name) and/or values',
      'fix dash: reason uses an em dash: use a colon or a comma',
      'fix dash: extra is not a key of a axis fix',
      'fix story: where names the variant (args and/or state) the story is for',
      'fix prune: prune needs where (the args and/or state of the variants to drop)',
    ]);
  });

  it('parseFigmaFixes throws with every problem', () => {
    expect(() => parseFigmaFixes('{')).toThrow(FigmaFixesError);
    expect(() => parseFigmaFixes({ version: 2, fixes: [] })).toThrow(/version 2 is not supported/);
  });
});

describe('applyFixes on Carbon measures', () => {
  it('patches parts: radius, fixed size, hide, overlay, align', () => {
    const f = load();
    const before = JSON.stringify(f);
    const fixes: FigmaFix[] = [
      { id: 'switch-pill', kind: 'part', component: 'Toggle', part: '.cds--toggle__switch', set: { cornerRadius: 'full' }, ...base },
      { id: 'btn-48', kind: 'part', component: 'IconButton', part: 'cds--btn', width: 'fixed', height: 48, ...base },
      { id: 'no-tooltip', kind: 'part', component: 'IconButton', part: 'cds--popover', hide: true, ...base },
      { id: 'knob-pin', kind: 'part', component: 'Toggle', part: 'cds--toggle-switch-before', overlay: { top: 3, left: 3 }, where: { state: 'rest' }, ...base },
      { id: 'label-row', kind: 'part', component: 'TextInput', part: 'cds--text-input-label-wrapper', align: { counter: 'CENTER' }, height: 'hug', ...base },
    ];
    const { file, applied } = applyFixes(f, { version: 1, fixes });
    expect(JSON.stringify(f)).toBe(before);
    expect(applied.map((a) => [a.id, a.result])).toEqual(fixes.map((x) => [x.id, 'applied']));

    const toggle = file.stories.find((s) => s.id === 'components-toggle--default' && !s.overrides && !s.state)!;
    expect(toggle.spec!.values['cds--toggle-switch']!.cornerRadius).toBe(12);
    expect(toggle.spec!.parts.find((p) => p.id === 'cds--toggle-switch-before')!.pin).toEqual({ top: 3, left: 3 });
    expect(toggle.fixes).toEqual(['switch-pill', 'knob-pin']);
    // The hover story is out of the knob fix's where.
    const hover = file.stories.find((s) => s.title === 'Components/Toggle' && s.state === 'hover')!;
    expect(hover.fixes).toEqual(['switch-pill']);

    const btn = file.stories.find((s) => s.id === 'components-iconbutton--default' && !s.state && !s.overrides)!.spec!;
    expect(btn.sized!['cds--btn']).toEqual({ width: 48, height: 48 });
    expect(btn.values['cds--btn']).toMatchObject({ width: 48, height: 48 });
    expect(btn.parts.map((p) => p.id)).toEqual(['root', 'cds--tooltip-trigger-wrapper', 'cds--btn', 'icon']);
    expect(btn.values['cds--popover-content']).toBeUndefined();

    const input = file.stories.find((s) => s.id === 'components-textinput--default')!.spec!;
    expect(input.parts.find((p) => p.id === 'cds--text-input-label-wrapper')!.layout).toMatchObject({ direction: 'HORIZONTAL', counter: 'CENTER' });
    expect(input.values['cds--text-input-label-wrapper']!.height).toBeUndefined();

    expect(file.components!.find((c) => c.title === 'Components/Toggle')!.figma!.fixes).toEqual(['switch-pill', 'knob-pin']);
    expect(file.figmaFixes!.applied).toHaveLength(5);
  });

  it('maps, ignores and prunes axes', () => {
    const f = load();
    const toggles = f.stories.filter((s) => s.title === 'Components/Toggle').length;
    const { file, applied } = applyFixes(f, [
      { id: 'size-names', kind: 'axis', action: 'map', component: 'Toggle', arg: 'size', property: 'Size', values: { sm: 'Small', md: 'Medium' }, ...base },
      { id: 'no-toggled', kind: 'axis', action: 'ignore', component: 'Toggle', arg: 'toggled', ...base },
      { id: 'no-invalid-press', kind: 'axis', action: 'prune', component: 'TextInput', where: { args: { invalid: true }, state: 'active' }, ...base },
    ]);
    const hints = file.components!.find((c) => c.title === 'Components/Toggle')!.figma!;
    expect(hints).toMatchObject({ properties: { size: 'Size' }, values: { size: { sm: 'Small', md: 'Medium' } }, ignored: ['toggled'] });
    expect(file.components!.find((c) => c.title === 'Components/Toggle')!.argTypes.toggled).toBeUndefined();
    // The three toggled=true renders are left out: the set is drawn at the default.
    expect(file.stories.filter((s) => s.title === 'Components/Toggle')).toHaveLength(toggles - 3);
    expect(file.stories.some((s) => s.title === 'Components/TextInput' && s.state === 'active')).toBe(false);
    expect(applied.map((a) => a.detail)).toEqual(['size drawn as Size (sm as Small, md as Medium)', 'toggled is not a Figma property: 3 stories at another value left out', 'dropped 1 variant story']);
  });

  it('points a variant to another story', () => {
    const f = load();
    const { file, applied } = applyFixes(f, [
      { id: 'on-from-small', kind: 'story', component: 'Toggle', where: { args: { toggled: true }, state: 'rest' }, use: { story: 'components-toggle--small-toggle' }, ...base },
    ]);
    const on = file.stories.filter((s) => s.title === 'Components/Toggle' && s.props && (s.overrides?.toggled === true) && !s.state);
    expect(on).toHaveLength(1);
    expect(on[0]).toMatchObject({ id: 'components-toggle--small-toggle', overrides: { toggled: true }, fixes: ['on-from-small'] });
    expect(applied[0]!.detail).toBe('variant toggled=true, state=rest drawn from components-toggle--small-toggle, in place of 1 other story');
  });

  it('keeps an honest status with its reason', () => {
    const f = load();
    f.statuses = [{ name: 'IconButton', status: 'matches', summary: 'Matches Figma on 1 variant', variants: [] }];
    const { file } = applyFixes(f, [
      { id: 'tooltip', kind: 'status', component: 'IconButton', status: 'cant-check', reason: 'The tooltip opens on hover: Figma draws it closed.' },
      { id: 'note', kind: 'status', component: 'Toggle', reason: 'The knob slides in code; Figma swaps variants.' },
    ]);
    expect(file.statuses![0]).toMatchObject({ status: 'cant-check', summary: 'The tooltip opens on hover: Figma draws it closed.' });
    expect(file.components!.find((c) => c.title === 'Components/IconButton')!.figma!.status).toEqual([{ status: 'cant-check', reason: 'The tooltip opens on hover: Figma draws it closed.', fix: 'tooltip' }]);
    expect(file.components!.find((c) => c.title === 'Components/Toggle')!.figma!.notes).toEqual([{ text: 'The knob slides in code; Figma swaps variants.', fix: 'note' }]);
  });

  it('reports what it could not find, and does not apply a fix twice', () => {
    const f = load();
    const fixes: FigmaFix[] = [
      { id: 'gone-part', kind: 'part', component: 'Toggle', part: 'cds--nope', hide: true, ...base },
      { id: 'gone-component', kind: 'part', component: 'Slider', part: 'root', width: 'hug', ...base },
      { id: 'gone-story', kind: 'story', component: 'Toggle', where: { state: 'hover' }, use: { story: 'components-toggle--nope' }, ...base },
      { id: 'pill', kind: 'part', component: 'Toggle', part: '.cds--toggle__switch', set: { cornerRadius: 'full' }, ...base },
    ];
    const once = applyFixes(f, fixes);
    expect(appliedFixLines(once.applied)).toEqual([
      'not found  gone-part (Toggle, part): no part cds--nope in the stories it names',
      'not found  gone-component (Slider, part): no measured story of Slider',
      'not found  gone-story (Toggle, story): no measured render of story components-toggle--nope',
      expect.stringMatching(/^applied {2}pill \(Toggle, part\): \.cds--toggle__switch: cornerRadius full on \d+ stories$/),
    ]);
    const twice = applyFixes(once.file, fixes);
    expect(twice.applied.find((a) => a.id === 'pill')!.result).toBe('already');
    expect(toggleDefault(twice.file).spec!.values['cds--toggle-switch']!.cornerRadius).toBe(12);
    expect(twice.file.figmaFixes!.applied.filter((a) => a.id === 'pill')).toHaveLength(1);
  });
});

describe('width fixed takes each story its own size (#607)', () => {
  const smWidth = { id: 'button-sm-width', kind: 'part', component: 'Button', part: 'root', where: { args: { size: 'sm' } }, width: 'fixed', reason: 'Figma hugs the label at 75 px where the code renders 72.' } as FigmaFix;
  const sm = (f: MeasuredSpecsFile) => f.stories.find((s) => s.overrides?.size === 'sm')!;
  const md = (f: MeasuredSpecsFile) => f.stories.find((s) => !s.overrides)!;

  it('does not pin a width that only hugs the story label: the small button is not drawn 120.84 px wide', () => {
    const r = applyFixes(buttonMeasure(), [smWidth]);
    expect(r.applied[0]).toMatchObject({ id: 'button-sm-width', result: 'skipped', stories: 0 });
    expect(r.applied[0]!.detail).toContain('root width not fixed on 1 story');
    expect(r.applied[0]!.detail).toContain("that story's words");
    expect(r.applied[0]!.detail).toContain('actions-button--primary (variant=primary, size=sm) 120.84 px');
    expect(sm(r.file).spec!.sized?.root?.width).toBeUndefined();
    expect((sm(r.file) as { fixes?: string[] }).fixes).toBeUndefined();
    expect(appliedFixLines(r.applied)[0]).toMatch(/^skipped {2}button-sm-width/);
    // What the pull draws: the root still hugs, in every size.
    const set = specsFromMeasure(r.file).specs.components.find((c) => c.name === 'Button')!;
    for (const v of set.variants) expect(v.values.root?.width).toBeUndefined();
  });

  it('pins every story to its own measured width, never the width of another story', () => {
    const r = applyFixes(buttonMeasure({ own: true }), [{ ...smWidth, where: undefined }]);
    expect(r.applied[0]).toMatchObject({ result: 'applied', stories: 2 });
    expect(sm(r.file).spec!.sized?.root?.width).toBe(150);
    expect(md(r.file).spec!.sized?.root?.width).toBe(160);
    const set = specsFromMeasure(r.file).specs.components.find((c) => c.name === 'Button')!;
    expect(Object.fromEntries(set.variants.map((v) => [v.props.Size, v.values.root?.width]))).toEqual({ md: 160, sm: 150 });
  });

  it('a fix that does more than the width still lays the rest on, and says which width it left', () => {
    const r = applyFixes(buttonMeasure(), [{ ...smWidth, set: { cornerRadius: 'full' } } as FigmaFix]);
    expect(r.applied[0]).toMatchObject({ result: 'applied', stories: 1 });
    expect(r.applied[0]!.detail).toContain('root width not fixed on 1 story');
    expect(sm(r.file).spec!.values.root!.cornerRadius).toBe(16);
    expect(sm(r.file).spec!.sized?.root?.width).toBeUndefined();
  });

  it('a height that hugs a label is still the story own height: only widths carry the words', () => {
    const r = applyFixes(buttonMeasure(), [{ ...smWidth, width: undefined, height: 'fixed' } as FigmaFix]);
    expect(r.applied[0]).toMatchObject({ result: 'applied', stories: 1 });
    expect(sm(r.file).spec!.sized?.root?.height).toBe(32);
  });
});
