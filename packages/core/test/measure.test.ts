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
  isUtilityClass,
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
    expect(localClassName('cds--toggle__switch')).toBe('cds--toggle__switch');
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
    const answers: unknown[] = ['url', 'rendered', 'click', tree, props];
    const page: MeasurePage = { goto: async (u) => void urls.push(u), evaluate: async <T>(e: string) => (exprs.push(e), answers.shift() as T) };
    const m = await measureStory(page, 'https://sb.example.com', 'overlays-menu--actions', { open: true, args: { size: 'lg', modal: false } });
    expect(urls[0]).toBe('https://sb.example.com/iframe.html?id=overlays-menu--actions&viewMode=story&args=size:lg;modal:!false');
    expect(exprs[0]).toContain('updateStoryArgs');
    expect(exprs[3]).toContain('"target":"portal"');
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

describe('fill and shots', () => {
  const tree = { root: { tag: 'div', kind: 'frame', box: { x: 0, y: 0, width: 360, height: 40 }, style: {}, tokens: {}, children: [] }, portals: [], wrappers: 0, nodes: 1, rules: 1, sheets: { read: 1, blocked: 0 }, rootVariables: 0, viewport: { width: 1200, height: 800 }, rootFill: true };

  it('marks a root that spans its container as fill', () => {
    expect(measuredToSpec({ id: 'x', root: tree.root as MeasuredNode, rootFill: true }).parts[0]!.fill).toBe(true);
    expect(measuredToSpec({ id: 'x', root: tree.root as MeasuredNode }).parts[0]!.fill).toBeUndefined();
  });

  it('shoots the measured root when the page can, and says where', async () => {
    const shots: [string, string][] = [];
    const answers: unknown[] = ['rendered', tree, { marked: true }, null];
    const page: MeasurePage = {
      goto: async () => undefined,
      evaluate: async <T>() => answers.shift() as T,
      screenshot: async (sel, file) => (shots.push([sel, file]), { width: 360, height: 40 }),
    };
    const m = await measureStory(page, 'https://sb.example.com', 'forms-input--default', { shot: '/tmp/x/forms-input-default.png' });
    expect(shots).toEqual([['[data-bridge-measure-root]', '/tmp/x/forms-input-default.png']]);
    expect(m.shot).toEqual({ file: '/tmp/x/forms-input-default.png', width: 360, height: 40 });
    expect(m.rootFill).toBe(true);
  });
});

describe('controls drawn in CSS: pseudo-elements, grids, SVG', () => {
  const box = (x: number, y: number, width: number, height: number) => ({ x, y, width, height });
  const frame = (tag: string, b: ReturnType<typeof box>, style: Record<string, string>, children: MeasuredNode[] = [], extra: Partial<MeasuredNode> = {}): MeasuredNode => ({ tag, kind: 'frame', classes: [], box: b, style, tokens: {}, children, ...extra });

  it('reads a toggle: a grid label above a switch, its knob a ::before pinned where it sits', () => {
    const knob = frame('::before', box(27, 27, 18, 18), { position: 'absolute', 'background-color': 'rgb(255, 255, 255)', 'border-top-left-radius': '50%', top: '3px', left: '3px' }, [], { pseudo: 'before' });
    const track = frame('span', box(24, 24, 48, 24), { display: 'block', 'background-color': 'rgb(36, 161, 72)', 'border-top-left-radius': '12px' }, [knob], { classes: ['cds--toggle__switch'] });
    const label = { tag: '#text', kind: 'text' as const, text: 'Label', box: box(0, 0, 40, 16), style: {}, tokens: {}, children: [] };
    const root = frame('div', box(0, 0, 120, 48), { display: 'grid', 'grid-template-columns': 'none', 'grid-template-rows': 'none', 'row-gap': '8px', 'column-gap': '0px' }, [label, track]);
    const spec = measuredToSpec({ id: 'toggle', root });
    expect(spec.parts[0]!.layout?.direction).toBe('VERTICAL');
    expect(spec.values.root?.itemSpacing).toBe(8);
    const k = spec.parts.find((x) => x.id === 'cds--toggle-switch-before')!;
expect(k).toMatchObject({ kind: 'frame' });
    expect(k.pin).toBeUndefined();
    // The knob rides the track's auto layout: aligned start, the track's padding carries the 3 px.
    const trackPart = spec.parts.find((x) => x.id === k.parent)!;
    expect(trackPart.layout).toEqual({ direction: 'HORIZONTAL', primary: 'MIN', counter: 'CENTER', align: { [k.id]: { primary: 'MIN', counter: 'CENTER' } } });
    expect(spec.values[trackPart.id]).toMatchObject({ paddingLeft: 3 });
    expect(spec.raw[k.id]).toMatchObject({ fill: 'rgb(255, 255, 255)', width: 18, height: 18 });
  });

  it('gives a grid a direction from its tracks or where its children sit', () => {
    expect(measuredLayout({ display: 'grid', 'grid-template-columns': '48px 24px', 'grid-template-rows': '24px' })?.direction).toBe('HORIZONTAL');
    expect(measuredLayout({ display: 'inline-grid', 'grid-auto-flow': 'column' })?.direction).toBe('HORIZONTAL');
    expect(measuredLayout({ display: 'grid' }, [box(0, 0, 48, 24), box(56, 4, 20, 16)])?.direction).toBe('HORIZONTAL');
    expect(measuredLayout({ display: 'grid' }, [box(0, 0, 40, 16), box(0, 24, 48, 24)])?.direction).toBe('VERTICAL');
  });

  it('draws a grid of columns and rows as a row that wraps at its width, each item at its track width', () => {
    const style = { display: 'grid', 'grid-template-columns': '16px 376px', 'grid-template-rows': '16px 16px', 'column-gap': '8px', 'row-gap': '8px', 'align-items': 'center' };
    const kids = [box(0, 0, 16, 16), box(24, 0, 376, 16), box(0, 24, 16, 16), box(24, 24, 376, 16)];
    expect(measuredLayout(style, kids)).toEqual({ direction: 'HORIZONTAL', primary: 'MIN', counter: 'CENTER', wrap: true });
    // One row of tracks stays a plain row.
    expect(measuredLayout({ ...style, 'grid-template-rows': '16px' }, kids.slice(0, 2))).toEqual({ direction: 'HORIZONTAL', primary: 'MIN', counter: 'CENTER' });
    const radio = (x: number, y: number) => frame('button', box(x, y, 16, 16), { 'border-top-style': 'solid', 'border-top-width': '1px' });
    const label = (y: number, t: string): MeasuredNode => ({ tag: 'label', kind: 'text', text: t, box: box(24, y, 376, 16), style: {}, tokens: {}, children: [] });
    const spec = measuredToSpec({ id: 'radios', root: frame('div', box(0, 0, 400, 40), style, [radio(0, 0), label(0, 'Default'), radio(0, 24), label(24, 'Compact')]) });
    expect(spec.parts[0]!.layout).toMatchObject({ direction: 'HORIZONTAL', wrap: true });
    expect(spec.values.root).toMatchObject({ itemSpacing: 8, counterAxisSpacing: 8 });
    expect(Object.values(spec.sized ?? {}).map((s) => s.width)).toEqual([400, 16, 376, 16, 376]);
  });

  it('covers its parent at inset 0, and carries an SVG with its strokes', () => {
    const cover = frame('::after', box(0, 0, 20, 20), { position: 'absolute', top: '0px', right: '0px', bottom: '0px', left: '0px', 'border-top-style': 'solid', 'border-top-width': '1px', 'border-top-color': 'rgb(0, 0, 0)' }, [], { pseudo: 'after' });
    const icon: MeasuredNode = { tag: 'svg', kind: 'icon', box: box(2, 2, 16, 16), style: { fill: 'rgb(22, 22, 22)' }, tokens: {}, children: [], svg: '<svg width="16" height="16"><path fill="rgb(22, 22, 22)"/></svg>', svgStrokes: [] };
    const spec = measuredToSpec({ id: 'tag', root: frame('button', box(0, 0, 20, 20), { display: 'flex' }, [icon, cover]) });
    expect(spec.parts.find((x) => x.id === 'root-after')).toMatchObject({ cover: true });
    expect(spec.vectors?.icon).toEqual({ svg: '<svg width="16" height="16"><path fill="rgb(22, 22, 22)"/></svg>', strokes: [] });
  });
});

describe('form fields as Carbon draws them: margins, declared sizes, round radii, block flow', () => {
  const box = (x: number, y: number, width: number, height: number) => ({ x, y, width, height });
  const el = (tag: string, cls: string, b: ReturnType<typeof box>, style: Record<string, string>, children: MeasuredNode[] = [], extra: Partial<MeasuredNode> = {}): MeasuredNode => ({ tag, kind: 'frame', classes: [cls], box: b, style: { 'border-top-style': 'none', ...style }, tokens: {}, children, ...extra });
  const text = (t: string, b: ReturnType<typeof box>, style: Record<string, string> = {}): MeasuredNode => ({ tag: 'span', kind: 'text', classes: [`t-${t}`], text: t, box: b, style, tokens: {}, children: [] });

  it('turns a label margin and a helper margin into the auto layout gaps of the field', () => {
    // Label 16 px tall with margin-bottom 8, field 40 px, helper 4 px below it.
    const field = el('div', 'wrapper', box(0, 0, 400, 84), { display: 'flex', 'flex-direction': 'column', 'align-items': 'flex-start', 'row-gap': '0px' }, [
      text('Label', box(0, 0, 60, 16), { 'margin-bottom': '8px' }),
      el('div', 'field', box(0, 24, 400, 40), { display: 'block' }),
      text('Helper', box(0, 68, 80, 16), { 'margin-top': '4px' }),
    ]);
    const spec = measuredToSpec({ id: 'textinput', root: field });
    expect(spec.values.root?.itemSpacing).toBe(4);
    expect(spec.spacers).toEqual({ field: 4 });
  });

  it('keeps declared sizes, and reads a 50% radius in px', () => {
    const icon: MeasuredNode = { tag: 'svg', kind: 'icon', box: box(12, 12, 16, 16), style: {}, tokens: {}, children: [], sized: { width: true, height: true } };
    const button = el('button', 'copy', box(0, 0, 40, 40), { display: 'flex', 'border-top-left-radius': '50%' }, [icon], { sized: { width: true, height: true } });
    const spec = measuredToSpec({ id: 'copybutton', root: button });
    expect(spec.sized).toEqual({ root: { width: 40, height: 40 }, icon: { width: 16, height: 16 } });
    expect(spec.values.root?.cornerRadius).toBe(999);
  });

  it('lays an inline label holding blocks out by its boxes', () => {
    const label = el('label', 'toggle__label', box(0, 0, 74, 56), { display: 'inline' }, [text('Label', box(0, 0, 74, 16)), el('div', 'appearance', box(0, 32, 74, 24), { display: 'flex' })]);
    expect(measuredToSpec({ id: 't', root: label }).parts[0]!.layout?.direction).toBe('VERTICAL');
  });
});

describe('auto layout everywhere: overlays, margin wrappers, full radii', () => {
  const box = (x: number, y: number, width: number, height: number) => ({ x, y, width, height });
  const el = (cls: string, b: ReturnType<typeof box>, style: Record<string, string>, children: MeasuredNode[] = []): MeasuredNode => ({ tag: 'div', kind: 'frame', classes: [cls], box: b, style: { 'border-top-style': 'none', ...style }, tokens: {}, children });

  it('flags an out-of-flow badge over its sibling as an overlay, and keeps the root its own size', () => {
    const avatar = el('avatar', box(0, 0, 40, 40), { display: 'block', 'background-color': 'rgb(0, 0, 0)' });
    const badge = el('badge', box(30, -4, 14, 14), { position: 'absolute', top: '-4px', left: '30px', 'background-color': 'rgb(255, 0, 0)' });
    const spec = measuredToSpec({ id: 'avatar', root: el('wrap', box(0, 0, 40, 40), { display: 'inline-block', position: 'relative' }, [avatar, badge]) });
    expect(spec.parts.find((x) => x.id === 'badge')).toMatchObject({ overlay: true, pin: { top: -4, left: 30 } });
    expect(spec.boxes.root).toEqual(box(0, 0, 40, 40));
  });

  it('wraps a child whose margin makes an uneven gap, and records margins', () => {
    const field = el('field', box(0, 0, 400, 100), { display: 'flex', 'flex-direction': 'column', 'align-items': 'flex-start', 'row-gap': '0px' }, [
      el('label', box(0, 0, 60, 16), { 'margin-bottom': '8px' }),
      el('control', box(0, 24, 400, 40), {}),
      el('helper', box(0, 68, 80, 16), { 'margin-top': '4px' }),
    ]);
    const spec = measuredToSpec({ id: 'field', root: field });
    expect(spec.values.root?.itemSpacing).toBe(4);
    expect(spec.parts.find((x) => x.id === 'label')).toMatchObject({ margins: { bottom: 8 }, wrap: { padding: { bottom: 4 } } });
  });

  it('reads a pill radius as full', () => {
    const pill = el('tag', box(0, 0, 80, 24), { display: 'flex', 'border-top-left-radius': '9999px' });
    const spec = measuredToSpec({ id: 'tag', root: pill });
    expect(spec.parts[0]).toMatchObject({ fullRadius: true });
    expect(spec.values.root?.cornerRadius).toBe(999);
  });
});


describe('utility classes never name or pair a part', () => {
  it('tells a utility or a generated class from a BEM, semantic or module class, by its shape', () => {
    for (const c of ['flex', 'relative', 'px-4', 'gap-x-1', 'w-full', 'rounded-medium', 'text-small', 'hover:bg-default-100', 'data-[open=true]:flex', 'w-[12px]', '-mt-1', 'py-2.5', 'css-1g7m1fs', 'css-kqzqgg'])
      expect(isUtilityClass(c), c).toBe(true);
    for (const c of ['cds--btn', 'cds--toggle__switch', 'data-container', 'chakra-alert__title', 'Banner', 'BannerTitle', 'octicon', 'label', 'control', 'is-filled'])
      expect(isUtilityClass(c), c).toBe(false);
  });

  it('a Tailwind tree: parts named by tag and order, the same in two variants whose classes differ', () => {
    const box = { x: 0, y: 0, width: 100, height: 40 };
    const tree = (look: string[]): MeasuredNode => ({
      tag: 'button',
      kind: 'frame',
      classes: ['inline-flex', 'items-center', ...look],
      box,
      style: { display: 'flex' },
      tokens: {},
      children: [
        { tag: 'span', kind: 'frame', classes: ['relative', 'flex', ...look], box, style: {}, tokens: {}, children: [{ tag: '#text', kind: 'text', text: 'Save', box, style: {}, tokens: {}, children: [] }] },
        { tag: 'span', kind: 'frame', classes: ['cds--btn__icon', 'w-4'], box, style: {}, tokens: {}, children: [] },
      ],
    });
    const a = measuredToSpec({ id: 'a', root: tree(['bg-primary', 'px-4']) });
    const b = measuredToSpec({ id: 'b', root: tree(['bg-danger', 'px-3', 'hover:opacity-80']) });
    expect(a.parts.map((p) => p.id)).toEqual(b.parts.map((p) => p.id));
    expect(a.parts.map((p) => p.id)).toEqual(['root', 'span', 'span-text', 'cds--btn-icon']);
    // The named class is kept for pairing, the utilities are not.
    expect(a.parts.find((p) => p.id === 'cds--btn-icon')?.source).toBe('cds--btn__icon');
    expect(a.parts.find((p) => p.id === 'span')?.source).toBeUndefined();
  });
});
