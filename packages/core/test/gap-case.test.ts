// Gap cases on real measures (Carbon, trimmed from a `bridge specs --measure --variants --shots` run): the story shot
// says a variant differs, the measure and what Figma drew say why, in words and in deltas.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  applyFixes,
  buildGapCase,
  parseMeasuredSpecsFile,
  partWords,
  storyForVariant,
  summarizeComponent,
  variantDifferences,
  type ComponentSpec,
  type GapBuiltVariant,
  type MeasuredSpecsFile,
  type MeasuredSpecsStory,
  type SpecVariant,
} from '../src';

const load = (): MeasuredSpecsFile => parseMeasuredSpecsFile(readFileSync(join(__dirname, 'fixtures/gap/carbon-measured.json'), 'utf8'));
const story = (f: MeasuredSpecsFile, id: string, overrides = '{}', state?: string): MeasuredSpecsStory =>
  f.stories.find((s) => s.id === id && JSON.stringify(s.overrides ?? {}) === overrides && (s.state ?? undefined) === state)!;

/** A one-variant set drawn from a story the way the measured-only pull draws it: frames with content hug. */
function setFrom(name: string, s: MeasuredSpecsStory, tweak: (v: SpecVariant) => void = () => undefined): ComponentSpec {
  const m = s.spec!;
  const parents = new Set(m.parts.filter((p) => !p.pin && !p.cover).map((p) => p.parent));
  const values: SpecVariant['values'] = {};
  for (const p of m.parts) {
    const v = { ...(m.values[p.id] ?? {}) };
    if (parents.has(p.id)) {
      delete v.width;
      delete v.height;
    }
    values[p.id] = v;
  }
  const variant: SpecVariant = { props: {}, values };
  tweak(variant);
  return { name, hash: '', source: [], axes: [], properties: [], parts: m.parts.map((p) => ({ ...p })), variants: [variant], unmapped: [] };
}

const fidelity = (name: string, figma: { width: number; height: number }, code: { width: number; height: number }, percent = 12) =>
  summarizeComponent(name, [{ key: 'Default', status: 'differs', percent, size: { figma, code } }]);

describe('gap case: Carbon TextInput', () => {
  const f = load();
  const s = story(f, 'components-textinput--default');
  const spec = setFrom('TextInput', s);
  // What Figma drew: the label wrapper hugs its label (16, not 24) and the helper lost its 4 px margin.
  const built: GapBuiltVariant = {
    boxes: {
      root: { x: 0, y: 0, width: 300, height: 72 },
      'cds--text-input-label-wrapper': { x: 0, y: 0, width: 300, height: 16 },
      'cds--label': { x: 0, y: 0, width: 56, height: 16 },
      'cds--text-input-field-outer-wrapper': { x: 0, y: 16, width: 300, height: 56 },
      'cds--text-input-field-wrapper': { x: 0, y: 16, width: 300, height: 40 },
      'cds--text-input': { x: 0, y: 16, width: 300, height: 40 },
      'cds--form-helper-text': { x: 0, y: 56, width: 300, height: 16 },
    },
  };

  it('says how much height is missing and where', () => {
    const gap = buildGapCase({ component: 'TextInput', measured: f, spec, fidelity: fidelity('TextInput', { width: 300, height: 72 }, { width: 300, height: 84 }), built: { Default: built }, shots: { Default: s.shot! } });
    expect(gap.referee).toBe('shots');
    expect(gap.checked).toBe(1);
    expect(gap.differing).toBe(1);
    const v = gap.variants[0]!;
    expect(v.story).toMatchObject({ id: 'components-textinput--default', state: 'rest' });
    expect(v.shot).toBe('measured-shots/components-textinput-default.png');
    const height = v.differences.find((d) => d.property === 'height')!;
    expect(height).toMatchObject({ part: 'root', expected: 84, actual: 72, delta: -12 });
    expect(height.text).toBe('Height 72 in Figma vs 84 in code: 8 px missing below the label, 4 px missing below the text input field wrapper');
    expect(gap.summary).toBe('TextInput differs from the code on 1 of 1 variant. Height 72 in Figma vs 84 in code: 8 px missing below the label, 4 px missing below the text input field wrapper.');
    expect(gap.detail).toContain('- Default: story components-textinput--default, at rest, shot measured-shots/components-textinput-default.png, 12% of pixels, Figma 300x72 vs code 300x84');
    expect(gap.detail).toContain('  - root height: expected 84, actual 72 (-12 px)');
  });

  it('without layer boxes, still gives the size from the shots', () => {
    const gap = buildGapCase({ component: 'TextInput', measured: f, spec, fidelity: fidelity('TextInput', { width: 300, height: 72 }, { width: 300, height: 84 }) });
    expect(gap.variants[0]!.differences[0]!.text).toBe('Height 72 in Figma vs 84 in code');
  });

  it('a variant the shots match is not a gap', () => {
    const ok = summarizeComponent('TextInput', [{ key: 'Default', status: 'matches', percent: 0.4, size: { figma: { width: 300, height: 84 }, code: { width: 300, height: 84 } } }]);
    const gap = buildGapCase({ component: 'TextInput', measured: f, spec, fidelity: ok });
    expect(gap.variants).toEqual([]);
    expect(gap.summary).toBe('TextInput matches the code on 1 variant.');
  });
});

describe('gap case: Carbon Toggle', () => {
  const f = load();
  const s = story(f, 'components-toggle--default');

  it('names a knob Figma hides and a radius it squares off', () => {
    const spec = setFrom('Toggle', s, (v) => {
      v.hidden = ['cds--toggle-switch-before'];
      v.values['cds--toggle-switch'] = { ...v.values['cds--toggle-switch'], cornerRadius: 0 };
    });
    const gap = buildGapCase({ component: 'Toggle', measured: f, spec, fidelity: fidelity('Toggle', { width: 74, height: 58 }, { width: 74, height: 58 }, 4.2) });
    const d = gap.variants[0]!.differences;
    expect(d.map((x) => x.text)).toEqual(['The toggle switch before is hidden in Figma, shown in code', 'Corner radius 0 in Figma vs full in code (toggle switch)']);
    expect(d[0]).toMatchObject({ part: 'cds--toggle-switch-before', property: 'presence', expected: 'present', actual: 'hidden' });
    expect(d[1]).toMatchObject({ part: 'cds--toggle-switch', property: 'cornerRadius', expected: 12, actual: 0, delta: -12 });
  });

  it('a knob Figma never drew is missing', () => {
    const spec = setFrom('Toggle', s);
    spec.parts = spec.parts.filter((p) => p.id !== 'cds--toggle-switch-before');
    const d = variantDifferences({ parts: spec.parts, variant: spec.variants[0]!, measured: s.spec! });
    expect(d).toEqual([{ text: 'The toggle switch before is missing in Figma', part: 'cds--toggle-switch-before', partName: 'toggle switch before', property: 'presence', expected: 'present', actual: 'missing' }]);
  });

  it('finds the story of a variant by its axes', () => {
    const spec: Pick<ComponentSpec, 'axes'> = {
      axes: [
        { name: 'Toggled', prop: 'toggled', values: ['false', 'true'], default: 'false' },
        { name: 'State', values: ['Default', 'Hover'], default: 'Default' },
      ],
    };
    const stories = f.stories.filter((x) => x.title === 'Components/Toggle');
    const hit = storyForVariant(spec, { Toggled: 'true', State: 'Hover' }, stories);
    expect(hit).toMatchObject({ id: 'components-toggle--default', state: 'hover', overrides: { toggled: true } });
  });
});

describe('gap case: Carbon IconButton', () => {
  const f = load();
  const s = story(f, 'components-iconbutton--default');
  const spec = setFrom('IconButton', s);
  // Figma hugs the 16 px icon: the 48 px button shrinks to its content.
  const built: GapBuiltVariant = {
    boxes: {
      root: { x: 0, y: 0, width: 16, height: 16 },
      'cds--tooltip-trigger-wrapper': { x: 0, y: 0, width: 16, height: 16 },
      'cds--btn': { x: 0, y: 0, width: 16, height: 16 },
      icon: { x: 0, y: 0, width: 16, height: 16 },
    },
  };
  const fid = fidelity('IconButton', { width: 16, height: 16 }, { width: 48, height: 48 }, 61);

  it('says the space around the icon is missing', () => {
    const gap = buildGapCase({ component: 'IconButton', measured: f, spec, fidelity: fid, built: { Default: built } });
    const d = gap.variants[0]!.differences;
    expect(d[0]!.text).toBe('Height 16 in Figma vs 48 in code: 16 px missing above the icon, 16 px missing below the icon');
    expect(d[1]!.text).toBe('Width 16 in Figma vs 48 in code: 16 px missing before the icon, 16 px missing after the icon');
  });

  it('an icon drawn as a vector is the measured icon, and a wrapper the pull adds stands for its part', () => {
    const drawn = setFrom('IconButton', s);
    drawn.parts.find((p) => p.id === 'icon')!.kind = 'vector';
    // A margin wrapper around the button, as the pull adds one: the render has no such element.
    const btn = drawn.parts.find((p) => p.id === 'cds--btn')!;
    drawn.parts.splice(drawn.parts.indexOf(btn), 0, { id: 'cds--btn-wrapper', name: 'Btn wrapper', kind: 'frame', parent: btn.parent, layout: { direction: 'VERTICAL', primary: 'MIN', counter: 'STRETCH' } });
    btn.parent = 'cds--btn-wrapper';
    const boxes = { ...built.boxes, 'cds--btn-wrapper': { x: 0, y: 0, width: 16, height: 16 } };
    const d = buildGapCase({ component: 'IconButton', measured: f, spec: drawn, fidelity: fid, built: { Default: { boxes } } }).variants[0]!.differences;
    expect(d.filter((x) => x.property === 'presence')).toEqual([]);
    expect(d[0]!.text).toBe('Height 16 in Figma vs 48 in code: 16 px missing above the icon, 16 px missing below the icon');
  });

  it('after a fixed-size fix, a Figma that still hugs reads as a sizing gap', () => {
    const { file } = applyFixes(f, [{ id: 'iconbutton-fixed', kind: 'part', component: 'IconButton', part: 'cds--btn', width: 'fixed', height: 'fixed', reason: 'Carbon sets the icon button to 48 px square.' }]);
    const gap = buildGapCase({ component: 'IconButton', measured: file, spec });
    expect(gap.referee).toBe('values');
    expect(gap.fixes).toEqual(['iconbutton-fixed']);
    const sizing = gap.variants[0]!.differences.filter((x) => x.property === 'sizing');
    expect(sizing.map((x) => x.text)).toEqual(['Width fixed at 48 in code, hugs its content in Figma (btn)', 'Height fixed at 48 in code, hugs its content in Figma (btn)']);
  });

  it('a differing variant with no story is honest about it', () => {
    const gap = buildGapCase({ component: 'IconButton', measured: { ...f, stories: [] }, spec, fidelity: fid });
    expect(gap.variants[0]!.unexplained).toMatch(/No measured story renders this variant/);
  });
});

describe('partWords', () => {
  it('reads class-named parts', () => {
    expect(partWords({ id: 'cds--toggle-switch-before', name: 'x' })).toBe('toggle switch before');
    expect(partWords({ id: 'root', name: 'Root' })).toBe('component');
    expect(partWords({ id: 'iconStart', name: 'Icon start' })).toBe('icon start');
    expect(partWords({ id: 'lucide', name: 'lucide' })).toBe('icon');
    expect(partWords({ id: 'lucide-chevron-down', name: 'x' })).toBe('icon');
  });
});

describe('gap case: values that agree on a variant the shot says differs', () => {
  const f = load();
  const s = story(f, 'components-toggle--default');
  const spec = setFrom('Toggle', s);

  it('over 5% of pixels: Bridge does not measure what differs yet, never a match', () => {
    const gap = buildGapCase({ component: 'Toggle', measured: f, spec, fidelity: fidelity('Toggle', { width: 74, height: 58 }, { width: 74, height: 58 }, 30.6) });
    expect(gap.variants[0]!.unexplained).toBe("Bridge doesn't measure what differs here yet: the measured values agree, but 30.6% of the pixels differ. Not a match: the images decide");
    expect(gap.summary).toBe("Toggle differs from the code on 1 of 1 variant: Bridge doesn't measure what differs here yet (the measured values agree, the images do not).");
  });

  it('a few percent: a near match to compare by eye', () => {
    const gap = buildGapCase({ component: 'Toggle', measured: f, spec, fidelity: fidelity('Toggle', { width: 74, height: 58 }, { width: 74, height: 58 }, 4.2) });
    expect(gap.variants[0]!.unexplained).toMatch(/^The measured values agree with what Figma drew/);
    expect(gap.summary).toBe('Toggle differs from the code on 1 of 1 variant: the measure agrees, compare the images.');
  });
});
