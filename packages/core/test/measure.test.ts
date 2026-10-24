// Storybook measure, Node side: the spec shape a measure becomes, the comparison with the static specs, and the
// story driver over an injected page. Fixtures are real measures of our own Storybook (bridge-storybook), recorded with
// `bridge specs --measure` and the Figma reference story, so the assertions are about what Chrome drew.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ComponentSpecsFile } from '../src/component-spec';
import { parseStorybookIndex } from '../src/storybook';
import {
  compareSpecToMeasured,
  evalCalc,
  localClassName,
  measuredLayout,
  measuredToSpec,
  measureStory,
  pickStoriesToMeasure,
  OPEN_SCRIPT,
  PROPS_SCRIPT,
  repoSpecOptions,
  splitInstances,
  type MeasuredNode,
  type MeasurePage,
  type MeasuredStory,
} from '../src/node';

const ROOT = join(__dirname, '../../..');
const fixture = <T>(name: string): T => JSON.parse(readFileSync(join(__dirname, 'fixtures/measure', name), 'utf8')) as T;
const { opts } = repoSpecOptions(ROOT);
const tokenOf = (v: string) => opts.tokens.get(v)?.path;

describe('measuredToSpec on our Storybook', () => {
  const button = fixture<MeasuredStory>('actions-button--primary.json');

  it('draws the primary Button as the pull would: one frame with its label, bound to our token paths', () => {
    const spec = measuredToSpec(button, { tokenOf });
    expect(spec.parts.map((p) => [p.id, p.kind, p.parent])).toEqual([
      ['root', 'frame', undefined],
      ['label', 'text', 'root'],
    ]);
    expect(spec.parts[0]!.layout).toEqual({ direction: 'HORIZONTAL', primary: 'CENTER', counter: 'CENTER' });
    expect(spec.parts[1]!.characters).toBe('Publish tokens');
    // Private variables (--_bg, --_px) hand over to the token they alias.
    expect(spec.values.root).toMatchObject({
      fill: 'button.primary.bg',
      cornerRadius: 'button.radius',
      paddingLeft: 'control.padding-x.md',
      minHeight: 'control.height.md',
      itemSpacing: 'control.gap',
      height: 44,
    });
    expect(spec.values.label).toMatchObject({ textFill: 'button.primary.text', fontSize: 'font.size.200', fontWeight: 'button.font-weight' });
    expect(spec.tokens.root?.fill?.chain.slice(0, 3)).toEqual(['--_bg', '--button-primary-bg', '--color-action-primary-bg']);
    expect(spec.raw.root?.fill).toMatch(/^rgb/);
  });

  it('keeps a border shorthand mixing a width and a color as a number, not a binding', () => {
    const spec = measuredToSpec(button, { tokenOf });
    expect(spec.tokens.root?.strokeWeight).toMatchObject({ via: 'declared', exact: false });
    expect(spec.values.root?.strokeWeight).toBe(1);
  });

  it('counts the values tied to tokens', () => {
    const { coverage } = measuredToSpec(button, { tokenOf });
    expect(coverage.fields).toBe(coverage.declared + coverage.matched + coverage.literal);
    expect(coverage.declared / coverage.fields).toBeGreaterThan(0.7);
  });

  it('reads a CSS variable as a dotted path outside a Bridge repo', () => {
    expect(measuredToSpec(button).values.root?.fill).toBe('button.primary.bg');
    expect(measuredToSpec(button).values.root?.paddingLeft).toBe('control.padding.x.md');
  });
});

describe('compareSpecToMeasured: the static guess against the measured truth', () => {
  const specs = JSON.parse(readFileSync(join(ROOT, 'packages/react/component-specs.json'), 'utf8')) as ComponentSpecsFile;
  const button = specs.components.find((c) => c.name === 'Button')!;
  const variant = button.variants.find((v) => v.props.Variant === 'primary' && v.props.Size === 'md' && v.props.State === 'Default')!;
  const ref = fixture<{ measured: Pick<MeasuredStory, 'id' | 'root'>; resolved: Record<string, string> }>('reference-button-primary-md.json');

  it('agrees with the static Button spec on every value it can see', () => {
    const measured = measuredToSpec(ref.measured, { tokenOf });
    const c = compareSpecToMeasured(button.parts, variant.values, measured, (p) => ref.resolved[p]);
    expect(c.compared).toBeGreaterThan(10);
    expect(c.diffs.filter((d) => d.measured !== undefined)).toEqual([]);
    expect(c.same).toBe(c.compared);
    // The optional icons are not shown by default: missing parts, not wrong values.
    expect(c.unmatchedParts).toEqual(['icon-start', 'icon-end']);
  });

  it('reports a value the static spec guessed wrong', () => {
    const measured = measuredToSpec(ref.measured, { tokenOf });
    const wrong = { ...variant.values, root: { ...variant.values.root, paddingLeft: 'space.2' } };
    const c = compareSpecToMeasured(button.parts, wrong, measured, (p) => ref.resolved[p] ?? (p === 'space.2' ? '8px' : undefined));
    expect(c.diffs).toContainEqual({ part: 'root', field: 'paddingLeft', static: 'space.2', measured: 'control.padding-x.md', same: false });
  });
});

describe('helpers', () => {
  it('evaluates a spec calc() from resolved tokens, without eval', () => {
    const r = (p: string) => ({ 'control.height.sm': '32px', 'border-width.default': '1px' })[p];
    expect(evalCalc('calc(control.height.sm - border-width.default * 2)', r)).toBe(30);
    expect(evalCalc('calc(unknown.token + 2)', r)).toBeUndefined();
    expect(evalCalc('space.2', r)).toBeUndefined();
  });

  it('recovers CSS module local names', () => {
    expect(localClassName('_label_aukrr_131')).toBe('label');
    expect(localClassName('_label_1x2y3')).toBe('label');
    expect(localClassName('Button_label__a1b2c')).toBe('label');
    expect(localClassName('Button-module__label__a1b2c')).toBe('label');
    expect(localClassName('prc-Button-Label-pTQ3x')).toBe('Label');
    expect(localClassName('cds--btn')).toBe('cds--btn');
  });

  it('reads auto layout from computed flex values', () => {
    expect(measuredLayout({ display: 'flex', 'flex-direction': 'column', 'justify-content': 'space-between', 'align-items': 'normal' })).toEqual({ direction: 'VERTICAL', primary: 'SPACE_BETWEEN', counter: 'STRETCH' });
    expect(measuredLayout({ display: 'inline-flex', 'flex-direction': 'row-reverse', 'flex-wrap': 'wrap', 'align-items': 'center' })).toEqual({ direction: 'HORIZONTAL', primary: 'MIN', counter: 'CENTER', reverse: true, wrap: true });
    expect(measuredLayout({ display: 'inline' })).toBeUndefined();
  });

  it('picks the first stories of each component, or given ids', () => {
    const index = parseStorybookIndex({
      v: 5,
      entries: {
        'actions-button--primary': { id: 'actions-button--primary', title: 'Actions/Button', name: 'Primary', type: 'story', importPath: 'b' },
        'actions-button--ghost': { id: 'actions-button--ghost', title: 'Actions/Button', name: 'Ghost', type: 'story', importPath: 'b' },
        'forms-input--default': { id: 'forms-input--default', title: 'Forms/Input', name: 'Default', type: 'story', importPath: 'i' },
      },
    });
    expect(pickStoriesToMeasure(index, { perComponent: 1 }).map((s) => s.id)).toEqual(['actions-button--primary', 'forms-input--default']);
    expect(pickStoriesToMeasure(index, { only: ['button'] }).map((s) => s.id)).toEqual(['actions-button--primary', 'actions-button--ghost']);
    expect(pickStoriesToMeasure(index, { ids: ['forms-input--default'] })).toEqual([{ id: 'forms-input--default', title: 'Forms/Input', name: 'Default' }]);
  });
});

describe('measureStory over an injected page', () => {
  const page = (answers: unknown[]): MeasurePage & { urls: string[] } => {
    const urls: string[] = [];
    return {
      urls,
      goto: async (url) => void urls.push(url),
      evaluate: async <T>() => answers.shift() as T,
    };
  };

  it('opens the story iframe and returns the measure', async () => {
    const p = page(['rendered', { root: { tag: 'button', kind: 'frame', box: { x: 0, y: 0, width: 10, height: 10 }, style: {}, tokens: {}, children: [] }, portals: [], wrappers: 0, nodes: 1, rules: 1, sheets: { read: 1, blocked: 0 }, rootVariables: 0, viewport: { width: 1200, height: 800 } }]);
    const m = await measureStory(p, 'https://sb.example.com/', 'actions-button--primary', { iframe: { globals: { theme: 'dark' } } });
    expect(p.urls).toEqual(['https://sb.example.com/iframe.html?id=actions-button--primary&viewMode=story&globals=theme:dark']);
    expect(m.root?.tag).toBe('button');
    expect(m.error).toBeUndefined();
  });

  it('says when a story threw or never rendered', async () => {
    const threw = await measureStory(page(['error', { error: 'no element matches #storybook-root, #root in the page' }]), 'https://sb.example.com', 'x--y');
    expect(threw.root).toBeNull();
    expect(threw.error).toContain('no element matches');
    const slow = await measureStory(page(['timeout', { root: null, portals: [], wrappers: 0, nodes: 0, rules: 0, sheets: { read: 0, blocked: 0 }, rootVariables: 0, viewport: { width: 0, height: 0 } }]), 'https://sb.example.com', 'x--y', { timeout: 500 });
    expect(slow.error).toBe('the story did not render within 500 ms');
  });
});

describe('splitInstances: stories that render the component many times', () => {
  const n = (tag: string, classes: string[], children: MeasuredNode[] = [], style: Record<string, string> = {}, extra: Partial<MeasuredNode> = {}): MeasuredNode => ({
    tag,
    kind: 'frame',
    classes,
    box: { x: 10, y: 10, width: 80, height: 32 },
    style: { 'background-color': 'rgba(0, 0, 0, 0)', 'border-top-style': 'none', ...style },
    tokens: {},
    children,
    ...extra,
  });
  const button = (size: string) => n('button', ['chakra-button', `css-${size}`], [], { 'background-color': 'rgb(0, 0, 0)' });
  const caption = (t: string): MeasuredNode => ({ tag: 'span', kind: 'text', text: t, box: { x: 0, y: 0, width: 10, height: 10 }, style: {}, tokens: {}, children: [] });

  it('finds the instances in a matrix of rows and captions, boxes on their own corner', () => {
    const story = n('div', ['stack'], [n('table', ['t'], [n('tbody', [], [n('tr', [], [n('td', [], [caption('sm')]), n('td', [], [button('a')]), n('td', [], [button('b')])]), n('tr', [], [n('td', [], [button('c')])])])])]);
    const inst = splitInstances(story);
    expect(inst).toHaveLength(3);
    expect(inst[0]!.box).toMatchObject({ x: 0, y: 0 });
  });

  it('keeps a component with repeated parts whole: a group with a role, a single instance', () => {
    expect(splitInstances(n('div', ['g'], [button('a'), button('b')], {}, { role: 'radiogroup' }))).toEqual([]);
    expect(splitInstances(n('div', ['wrap'], [button('a')]))).toEqual([]);
    expect(splitInstances(n('fieldset', ['f'], [button('a'), button('b')]))).toEqual([]);
    // An empty state draws nothing itself: its sentence and media are content, its two buttons are its actions.
    const sentence: MeasuredNode = { ...caption('Connect a repository to see its tokens here.'), text: 'Connect a repository to see its tokens here.' };
    expect(splitInstances(n('div', ['emptyState'], [n('div', ['media'], [], { 'background-color': 'rgb(1, 1, 1)' }), sentence, n('div', ['actions'], [button('a'), button('b')])]))).toEqual([]);
  });
});

describe('in-page scripts', () => {
  it('are valid JavaScript', () => {
    expect(() => new Function(`return ${OPEN_SCRIPT('#storybook-root')}`)).not.toThrow();
    expect(() => new Function(`return ${PROPS_SCRIPT('actions-button--primary')}`)).not.toThrow();
  });
});

describe('measureStory: popups, args, states and props', () => {
  const tree = { root: { tag: 'div', kind: 'frame', role: 'menu', box: { x: 0, y: 0, width: 10, height: 10 }, style: {}, tokens: {}, children: [] }, portals: [], wrappers: 0, nodes: 1, rules: 1, sheets: { read: 1, blocked: 0 }, rootVariables: 0, viewport: { width: 1200, height: 800 } };
  const props = { props: { size: 'lg', disabled: false }, args: { size: 'lg' }, argTypes: { size: { kind: 'enum', options: ['sm', 'lg'] } } };

  it('opens the popup, measures the portal, and reads the props the story rendered with', async () => {
    const exprs: string[] = [];
    const urls: string[] = [];
    const answers: unknown[] = ['rendered', 'click', tree, props];
    const page: MeasurePage = { goto: async (u) => void urls.push(u), evaluate: async <T>(e: string) => (exprs.push(e), answers.shift() as T) };
    const m = await measureStory(page, 'https://sb.example.com', 'overlays-menu--actions', { open: true, args: { size: 'lg', modal: false } });
    expect(urls[0]).toBe('https://sb.example.com/iframe.html?id=overlays-menu--actions&viewMode=story&args=size:lg;modal:!false');
    expect(exprs[2]).toContain('"target":"portal"');
    expect(m).toMatchObject({ opened: 'click', props });
  });

  it('forces a pseudo state on the component when the browser can, and says so', async () => {
    const forced: [string, string[]][] = [];
    const answers: unknown[] = ['rendered', { marked: true }, undefined, tree, props];
    const page: MeasurePage = {
      goto: async () => undefined,
      evaluate: async <T>() => answers.shift() as T,
      forcePseudo: async (sel, states) => (forced.push([sel, states]), true),
    };
    const m = await measureStory(page, 'https://sb.example.com', 'b--c', { state: 'hover' });
    const all = '[data-bridge-measure-root], [data-bridge-measure-root] *';
    expect(forced).toEqual([[all, ['hover']], [all, []]]);
    expect(m.state).toBe('hover');
  });
});

