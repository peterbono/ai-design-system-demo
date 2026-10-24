// Spec source "measured only": every set built from measured-specs.json alone, as for a design system with a Storybook
// and no component-specs.json. Fixture: the real measure of Breadcrumb, Card, Menu, NumberField and Tabs (main,
// 2026-10-24) with the forced states and props the measure recorded.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { parseComponentSpecs, variantKeyOf } from '@bridge-ds/core';
import { applyPullPlan } from '../src/main/apply';
import { applyComponentPlan, scanGenerated } from '../src/main/build-components';
import { type SharedStore, saveSettings, sharedSettings } from '../src/main/shared-state';
import { takeSnapshot } from '../src/main/snapshot';
import { DEFAULT_SETTINGS } from '../src/shared/messages';
import { buildComponentPlan, writablePlan } from '../src/sync/component-pull';
import { analyze, buildPull } from '../src/sync/flows';
import { specsFromMeasure } from '../src/sync/measured-only';
import { parseMeasuredSpecs } from '../src/sync/measured-specs';
import { FakeGitHub } from './fake-github';
import { SimFigma } from './figma-api';
import { realChecksText, realConfigText, realFiles } from './helpers';

const fixture = () => parseMeasuredSpecs(readFileSync(join(process.cwd(), 'test/fixtures/measured-worse-sets.json'), 'utf8'));
const staticSpecs = () => parseComponentSpecs(readFileSync(join(process.cwd(), '../../packages/react/component-specs.json'), 'utf8'));
const axesOf = (c: { axes: { name: string; values: string[] }[] }) => c.axes.map((a) => `${a.name}=${a.values.join('|')}`);

test('measured only: Tabs gets the axes of code from its stories alone, the states its CSS styles', () => {
  const { specs, report } = specsFromMeasure(fixture());
  assert.ok(report.sets >= 4, `${report.sets} sets`);
  const tabs = specs.components.find((c) => c.name === 'Tabs')!;
  const code = staticSpecs().components.find((c) => c.name === 'Tabs')!;
  for (const axis of ['Variant', 'Size', 'Orientation']) assert.deepEqual(axesOf(tabs).find((a) => a.startsWith(`${axis}=`)), axesOf(code).find((a) => a.startsWith(`${axis}=`)), axis);
  // Every variant draws the parts of the default one, by the same ids.
  for (const v of tabs.variants) for (const id of Object.keys(v.values)) assert.ok(tabs.parts.some((p) => p.id === id), id);
  // A frame with content hugs it: no measured px width on the root.
  assert.ok(tabs.variants.every((v) => typeof v.values.root?.width !== 'number'));
});

test('measured only: a pressed state that draws like hover is not a state of its own', () => {
  const m = fixture();
  const card = m.stories.filter((s) => s.title.endsWith('/Card'));
  // Pressed copies of the hover stories, drawing the same: the CSS does not style :active.
  const hover = card.filter((s) => s.state === 'hover');
  m.stories.push(...hover.map((s) => ({ ...s, id: `${s.id}-active`, state: 'active' as const })));
  const states = specsFromMeasure(m).specs.components.find((c) => c.name === 'Card')!.axes.find((a) => a.name === 'State')?.values ?? [];
  assert.ok(!states.includes('Pressed'), states.join(', '));
});

test('measured only: the sets build in Figma with the variables of the repo, no part failing', async () => {
  const sim = new SimFigma();
  sim.install();
  const files: Record<string, string> = {};
  for (const [rel, text] of Object.entries(realFiles())) files[`${DEFAULT_SETTINGS.tokensPath}/${rel}`] = text;
  files[`${DEFAULT_SETTINGS.tokensPath}/contrast.checks.json`] = realChecksText();
  files['bridge.config.json'] = realConfigText();
  const client = new FakeGitHub(files).client();
  const a = await analyze(client, DEFAULT_SETTINGS, {}, await takeSnapshot());
  await applyPullPlan(buildPull(a, new Map()).plan);
  const { specs } = specsFromMeasure(fixture());
  const report = await applyComponentPlan(writablePlan(buildComponentPlan(specs, 'measured-specs.json', await scanGenerated(), a.head)));
  assert.deepEqual(report.failed, []);
  assert.equal(sim.sets().length, specs.components.length);
});

test('the setting: measured only round-trips', () => {
  const data = new Map<string, string>();
  const root: SharedStore = { get: (k) => data.get(k) ?? '', set: (k, v) => void data.set(k, v), keys: () => [...data.keys()] };
  saveSettings(root, { repo: 'acme/ds', branch: 'main', tokensPath: 'tokens', specSource: 'measured-only' });
  assert.equal(sharedSettings(root).specSource, 'measured-only');
});

test('measured only: a token the library does not have, or a color with none, takes the measured literal', () => {
  const m = fixture();
  const story = m.stories.find((s) => s.title.endsWith('/Card') && s.spec)!;
  m.stories = [story];
  story.spec!.values.root = { ...story.spec!.values.root, fill: 'acme.surface' };
  story.spec!.raw.root = { ...story.spec!.raw.root, fill: 'rgb(255, 0, 170)' };
  const { specs } = specsFromMeasure(m, { known: (p) => p !== 'acme.surface' });
  assert.equal(specs.components[0]!.variants[0]!.values.root!.fill, 'rgb(255, 0, 170)');
});

test('measured only: a component whose root is a text (a link) is a frame that hugs that text', () => {
  const m = fixture();
  const story = m.stories.find((s) => s.title.endsWith('/Card') && s.spec)!;
  m.stories = [{ ...story, title: 'Components/Link', spec: { ...story.spec!, parts: [{ id: 'root', name: 'Root', kind: 'text', source: 'cds--link', characters: 'Link' }], values: { root: { fontSize: 14, textFill: 'rgb(15, 98, 254)', paddingLeft: 2, width: 28, height: 18 } }, raw: {} } }];
  const link = specsFromMeasure(m).specs.components[0]!;
  assert.deepEqual(link.parts.map((p) => [p.id, p.kind, p.parent]), [['root', 'frame', undefined], ['root-text', 'text', 'root']]);
  assert.equal(link.parts[1]!.characters, 'Link');
  assert.deepEqual(link.variants[0]!.values, { root: { paddingLeft: 2 }, 'root-text': { fontSize: 14, textFill: 'rgb(15, 98, 254)' } });
});

test('literals build in Figma: a font weight, a line height in px, a letter spacing and an rgb() color', async () => {
  const sim = new SimFigma();
  sim.install();
  const files: Record<string, string> = {};
  for (const [rel, text] of Object.entries(realFiles())) files[`${DEFAULT_SETTINGS.tokensPath}/${rel}`] = text;
  files[`${DEFAULT_SETTINGS.tokensPath}/contrast.checks.json`] = realChecksText();
  files['bridge.config.json'] = realConfigText();
  const client = new FakeGitHub(files).client();
  const a = await analyze(client, DEFAULT_SETTINGS, {}, await takeSnapshot());
  await applyPullPlan(buildPull(a, new Map()).plan);
  const spec = {
    name: 'Acme Chip',
    hash: 'x',
    source: ['https://storybook.acme.dev'],
    axes: [],
    properties: [],
    parts: [
      { id: 'root', name: 'Root', kind: 'frame' as const, layout: { direction: 'HORIZONTAL' as const, primary: 'CENTER' as const, counter: 'CENTER' as const } },
      { id: 'label', name: 'Label', kind: 'text' as const, parent: 'root', characters: 'Chip' },
    ],
    variants: [{ props: {}, values: { root: { fill: 'rgb(255, 0, 170)', paddingLeft: 12 }, label: { textFill: '#1f2937', fontFamily: '"Inter", sans-serif', fontSize: 14, fontWeight: 600, lineHeight: 18.9, letterSpacing: 0.5 } } }],
    unmapped: [],
  };
  const plan = buildComponentPlan({ version: 1, generated: '', components: [spec] }, 'measured-specs.json', await scanGenerated(), a.head);
  assert.deepEqual(plan.problems, []);
  const report = await applyComponentPlan(writablePlan(plan));
  assert.deepEqual(report.failed, []);
  assert.deepEqual(report.problems ?? [], []);
  const set = sim.sets().find((s) => s.name === 'Acme Chip')!;
  const label = set.children[0]!.findOne((n) => n.type === 'TEXT')!;
  assert.deepEqual(label.lineHeight, { unit: 'PIXELS', value: 18.9 });
  assert.deepEqual(label.letterSpacing, { unit: 'PIXELS', value: 0.5 });
  assert.equal((label.fontName as { style: string }).style.toLowerCase().includes('semi') || (label.fontName as { style: string }).style.toLowerCase().includes('bold'), true, JSON.stringify(label.fontName));
  const fill = (set.children[0]!.fills as { color: { r: number; b: number } }[])[0]!;
  assert.ok(fill.color.r > 0.99 && fill.color.b > 0.6, JSON.stringify(fill));
});

test('measured only: an icon the measure gives as SVG is drawn as vectors, not an empty frame', async () => {
  const sim = new SimFigma();
  sim.install();
  const files: Record<string, string> = {};
  for (const [rel, text] of Object.entries(realFiles())) files[`${DEFAULT_SETTINGS.tokensPath}/${rel}`] = text;
  files[`${DEFAULT_SETTINGS.tokensPath}/contrast.checks.json`] = realChecksText();
  files['bridge.config.json'] = realConfigText();
  const client = new FakeGitHub(files).client();
  const a = await analyze(client, DEFAULT_SETTINGS, {}, await takeSnapshot());
  await applyPullPlan(buildPull(a, new Map()).plan);
  const m = fixture();
  const story = m.stories.find((s) => s.title.endsWith('/Card') && s.spec)!;
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16"><path d="M12 4.7 11.3 4 8 7.3 4.7 4 4 4.7 7.3 8 4 11.3l.7.7L8 8.7l3.3 3.3.7-.7L8.7 8z" fill="rgb(22, 22, 22)"/></svg>';
  m.stories = [
    {
      ...story,
      title: 'Components/Tag',
      spec: {
        ...story.spec!,
        parts: [
          { id: 'root', name: 'Root', kind: 'frame', layout: { direction: 'HORIZONTAL', primary: 'MIN', counter: 'CENTER' } },
          { id: 'close', name: 'Close', kind: 'icon', parent: 'root' },
        ],
        values: { root: { paddingLeft: 8 }, close: { width: 16, height: 16 } },
        raw: {},
        vectors: { close: { svg, strokes: ['acme.unknown'] } },
      },
    },
  ];
  const tag = specsFromMeasure(m, { known: (p) => p !== 'acme.unknown' }).specs.components[0]!;
  assert.equal(tag.parts.find((p) => p.id === 'close')!.kind, 'vector');
  assert.deepEqual(tag.variants[0]!.vectors, { close: { svg, strokes: [] } });
  const report = await applyComponentPlan(writablePlan(buildComponentPlan({ version: 1, generated: '', components: [tag] }, 'measured-specs.json', await scanGenerated(), a.head)));
  assert.deepEqual(report.failed, []);
  const close = sim.sets().find((s) => s.name === 'Tag')!.children[0]!.findOne((n) => n.name === 'Close')!;
  assert.ok(close.findAll((n) => n.type === 'VECTOR').length > 0, 'the close icon draws its shape');
});

test('measured only: a positioned part (a pseudo-element knob) follows its offset in each variant', async () => {
  const sim = new SimFigma();
  sim.install();
  const files: Record<string, string> = {};
  for (const [rel, text] of Object.entries(realFiles())) files[`${DEFAULT_SETTINGS.tokensPath}/${rel}`] = text;
  files[`${DEFAULT_SETTINGS.tokensPath}/contrast.checks.json`] = realChecksText();
  files['bridge.config.json'] = realConfigText();
  const client = new FakeGitHub(files).client();
  const a = await analyze(client, DEFAULT_SETTINGS, {}, await takeSnapshot());
  await applyPullPlan(buildPull(a, new Map()).plan);
  const m = fixture();
  const base = m.stories.find((s) => s.title.endsWith('/Card') && s.spec)!;
  const toggle = (checked: boolean, left: number) => ({
    ...base,
    id: `toggle-${checked}`,
    title: 'Components/Toggle',
    props: { checked },
    state: undefined,
    spec: {
      ...base.spec!,
      parts: [
        { id: 'root', name: 'Root', kind: 'frame' as const, layout: { direction: 'HORIZONTAL' as const, primary: 'MIN' as const, counter: 'MIN' as const } },
        { id: 'knob', name: 'Knob', kind: 'frame' as const, parent: 'root', pin: { top: 3, left } },
      ],
      values: { root: { width: 48, height: 24, fill: checked ? 'rgb(36, 161, 72)' : 'rgb(141, 141, 141)', cornerRadius: 12 }, knob: { width: 18, height: 18, fill: 'rgb(255, 255, 255)', cornerRadius: 9 } },
      raw: {},
    },
  });
  m.stories = [toggle(false, 3), toggle(true, 27)];
  m.components = [{ title: 'Components/Toggle', name: 'Toggle', argTypes: { checked: { kind: 'boolean', default: false } } }];
  const spec = specsFromMeasure(m).specs.components[0]!;
  const on = spec.variants.find((v) => v.props.Checked === 'true')!;
  assert.deepEqual(on.pins, { knob: { top: 3, left: 27 } });
  const report = await applyComponentPlan(writablePlan(buildComponentPlan({ version: 1, generated: '', components: [spec] }, 'measured-specs.json', await scanGenerated(), a.head)));
  assert.deepEqual(report.failed, []);
  const set = sim.sets().find((s) => s.name === 'Toggle')!;
  const knobOf = (checked: string) => set.children.find((v) => v.name.includes(`Checked=${checked}`))!.findOne((n) => n.name === 'Knob')!;
  assert.equal(knobOf('false').layoutPositioning, 'ABSOLUTE');
  assert.deepEqual([knobOf('false').x, knobOf('true').x], [3, 27]);
});

test('measured only: booleans every story sets are how the component is shown, and an axis that draws nothing goes', () => {
  const m = fixture();
  const base = m.stories.find((s) => s.title.endsWith('/Card') && s.spec)!;
  const story = (props: Record<string, unknown>, state?: 'hover', fill = state ? 'rgb(1, 83, 233)' : 'rgb(15, 98, 254)') => ({
    ...base,
    id: `icon-button-${JSON.stringify(props)}-${state}`,
    name: 'Default',
    title: 'Components/IconButton',
    props: { highContrast: true, ...props },
    state,
    spec: { ...base.spec!, parts: [{ id: 'root', name: 'Root', kind: 'frame' as const }], values: { root: { fill, width: props.size === 'lg' ? 48 : 40, height: 40 } }, raw: {} },
  });
  // Carbon: every story sets highContrast; an inputMode-like prop changes nothing, and its default has no hover story
  // (NumberInput): the other values stand in for it.
  m.stories = [
    story({ size: 'sm', mode: 'none' }),
    story({ size: 'lg', mode: 'none' }),
    story({ size: 'sm', mode: 'tel' }),
    story({ size: 'sm', mode: 'url' }),
    story({ size: 'sm', mode: 'tel' }, 'hover'),
    story({ size: 'sm', mode: 'url' }, 'hover'),
  ];
  m.components = [
    {
      title: 'Components/IconButton',
      name: 'IconButton',
      argTypes: { highContrast: { kind: 'boolean', default: false }, size: { kind: 'enum', options: ['sm', 'lg'] }, mode: { kind: 'enum', options: ['none', 'tel', 'url'], default: 'none' } },
    },
  ];
  const { specs, report } = specsFromMeasure(m);
  assert.deepEqual(report.skipped, []);
  assert.deepEqual(axesOf(specs.components[0]!), ['Size=sm|lg', 'State=Default|Hover']);
});

test('measured only: every variant keeps its SVG icon, a fill root its measured width, and a skeleton is no variant', () => {
  const m = fixture();
  const base = m.stories.find((s) => s.title.endsWith('/Card') && s.spec)!;
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><path d="M0 0h16v16H0z"/></svg>';
  const story = (name: string, size: string, parts = true) => ({
    ...base,
    id: `copy-${name}-${size}`,
    name,
    title: 'Components/CopyButton',
    props: { size },
    state: undefined,
    spec: {
      ...base.spec!,
      parts: [
        { id: 'root', name: 'Root', kind: 'frame' as const, fill: true, layout: { direction: 'HORIZONTAL' as const, primary: 'MIN' as const, counter: 'CENTER' as const } },
        ...(parts ? [{ id: 'icon', name: 'Icon', kind: 'icon' as const, parent: 'root' }] : []),
      ],
      values: { root: { width: 400, height: 40 }, ...(parts ? { icon: { width: size === 'lg' ? 20 : 16, height: 16 } } : {}) },
      raw: {},
      ...(parts ? { vectors: { icon: { svg, strokes: [] } } } : {}),
    },
  });
  m.stories = [story('Skeleton', 'sm', false), story('Default', 'md'), story('Large', 'lg')];
  m.components = [{ title: 'Components/CopyButton', name: 'CopyButton', argTypes: { size: { kind: 'enum', options: ['sm', 'md', 'lg'], default: 'md' } } }];
  const c = specsFromMeasure(m).specs.components[0]!;
  assert.deepEqual(axesOf(c), ['Size=md|lg']);
  for (const v of c.variants) {
    assert.equal(v.hidden, undefined, JSON.stringify(v.props));
    assert.deepEqual(Object.keys(v.vectors ?? {}), ['icon']);
    assert.equal(v.values.root!.width, 400);
  }
});

test('measured only with screenshots: each variant keeps the render of the story it was built from', () => {
  const m = fixture();
  m.stories = m.stories.filter((s) => s.title.endsWith('/Tabs'));
  m.stories.forEach((s, i) => (s.shot = { file: `measured-shots/tabs-${i}.png`, width: 320, height: 40 }));
  const { specs, shots } = specsFromMeasure(m);
  const tabs = specs.components.find((c) => c.name === 'Tabs')!;
  const keys = Object.keys(shots.Tabs ?? {});
  assert.equal(keys.length, tabs.variants.length, 'one render per variant');
  for (const v of tabs.variants) assert.ok(shots.Tabs![variantKeyOf(v.props)]?.file.startsWith('measured-shots/'));
});
