// Components pushed from Figma: the routing rules (exact token change, Claude draft, fix in Figma), the contrast pairs
// a component token swap moves, the "From Figma" origin block, the spec file and where a branch stands.
import { describe, expect, it } from 'vitest';
import {
  componentContrastPairs,
  figmaDraftBrief,
  figmaOriginSection,
  figmaPushStatus,
  figmaSpecPath,
  formatFigmaSpec,
  parseFigmaOrigin,
  parseFigmaSpec,
  planComponentPush,
  withFigmaOrigin,
  type ComponentPushDiff,
  type ContrastPair,
  type PushTokenContext,
  type Rebind,
} from '../src';

const TIERS: Record<string, string> = {
  'button.primary.bg': 'component',
  'button.radius': 'component',
  'color.action.primary.bg': 'semantic',
  'color.action.primary.bg-active': 'semantic',
  'color.bg.default': 'semantic',
  'radius.control': 'brand',
};

const ctx = (elsewhere: Record<string, string[]> = {}, components: Record<string, string[]> = {}): PushTokenContext => ({ tierOf: (p) => TIERS[p], usedElsewhere: (p) => ({ variants: elsewhere[p] ?? [], components: components[p] ?? [] }) });

const rebind = (before: string[], after: string[], kind = 'fill', variants = ['Size=md, Variant=primary']): Rebind => ({ kind, variants, allVariants: false, before, after });

function diff(over: Partial<ComponentPushDiff> = {}): ComponentPushDiff {
  return { v: 1, component: 'Button', figmaName: 'Button', coded: true, kind: 'token-binding', title: 'Use the active fill', summary: 'Changed in Figma.', changes: [], rebinds: [], needsCode: false, unknown: [], variantAxes: { Size: ['md'] }, properties: [], bindings: {}, anatomy: {}, source: 'figma', ...over };
}

describe('planComponentPush', () => {
  it('a component token swap used nowhere else is an exact token change', () => {
    const p = planComponentPush(diff({ rebinds: [rebind(['button.primary.bg'], ['color.action.primary.bg-active'])] }), ctx());
    expect(p.route).toBe('token-change');
    expect(p.edits).toEqual([{ op: 'set', path: 'button.primary.bg', value: '{color.action.primary.bg-active}' }]);
    expect(p.said).toBe('Exact, no AI: button.primary.bg points to the new variable, checked for contrast and reviewed like any token change.');
    expect(p.said).not.toMatch(/\u2014/);
  });

  it('other components that share the component token change with it: still exact, and said', () => {
    const p = planComponentPush(diff({ rebinds: [rebind(['button.primary.bg'], ['color.action.primary.bg-active'])] }), ctx({}, { 'button.primary.bg': ['IconButton', 'AlertDialog/Popup'] }));
    expect(p.route).toBe('token-change');
    expect(p.alsoChanges).toEqual(['IconButton', 'AlertDialog/Popup']);
    expect(p.said).toMatch(/ It also repaints IconButton and AlertDialog\/Popup: they use the same token\.$/);
  });

  it('goes to Claude AI when a token alone cannot say it, with one reason each', () => {
    const p = planComponentPush(
      diff({
        rebinds: [
          rebind(['color.action.primary.bg'], ['color.bg.default']),
          rebind(['button.radius'], ['radius.control'], 'radius'),
          rebind([], ['color.bg.default'], 'stroke'),
          rebind(['button.primary.bg', 'color.bg.default'], ['color.action.primary.bg'], 'fill', ['Size=sm, Variant=primary']),
        ],
      }),
      ctx({ 'button.radius': ['Size=sm, Variant=primary', 'Size=lg, Variant=primary'] }),
    );
    expect(p.route).toBe('claude-draft');
    expect(p.edits).toEqual([]);
    expect(p.reasons).toEqual([
      'Code paints fill with color.action.primary.bg directly, not through a Button token: the CSS needs to change to color.bg.default.',
      'button.radius also paints primary sm and primary lg: pointing it to radius.control would change them too, so it needs a new token for primary md.',
      'Stroke in primary md is bound to color.bg.default where code paints nothing: the CSS needs it added.',
      'Fill in primary sm moved from button.primary.bg, color.bg.default to color.action.primary.bg: several variables on one property, so the CSS needs writing.',
    ]);
  });

  it('a change that needs code goes to Claude AI and carries its exact token swaps with it', () => {
    const p = planComponentPush(diff({ needsCode: true, kind: 'new-variant', rebinds: [rebind(['button.primary.bg'], ['color.action.primary.bg-active'])] }), ctx());
    expect(p.route).toBe('claude-draft');
    expect(p.edits).toHaveLength(1);
    expect(p.said).toBe('A developer builds it with Claude from what you changed, then a person reviews it. Its token swap goes with it.');
  });

  it('the same token moved to two variables is split by Claude AI', () => {
    const p = planComponentPush(diff({ rebinds: [rebind(['button.primary.bg'], ['color.action.primary.bg-active']), rebind(['button.primary.bg'], ['color.bg.default'], 'fill', ['Size=sm, Variant=primary'])] }), ctx());
    expect(p.route).toBe('claude-draft');
    expect(p.edits).toEqual([]);
    expect(p.reasons[0]).toMatch(/^button\.primary\.bg moved to two different variables/);
  });

  it('raw values and variables code lacks are listed with what to do, never sent', () => {
    const p = planComponentPush(diff({ rebinds: [rebind(['button.primary.bg'], []), rebind(['button.radius'], ['radius.new-one'], 'radius')], unknown: [{ what: '"Icon" was detached.', todo: 'Reset it.' }] }), ctx());
    expect(p.route).toBe('manual');
    expect(p.said).toBe('Fix it in Figma first: nothing is sent until Bridge can read it.');
    expect(p.issues.map((i) => i.what)).toEqual([
      '"Icon" was detached.',
      'Fill in primary md is no longer bound to a variable: it uses a raw value.',
      'Radius in primary md uses radius.new-one, a variable the library does not have yet.',
    ]);
  });
});

describe('componentContrastPairs', () => {
  const pairs: ContrastPair[] = [
    { foreground: 'color.action.primary.text', background: 'color.action.primary.bg', min: 4.5, kind: 'text' },
    { foreground: 'color.action.primary.bg', background: 'color.surface.default', min: 3, kind: 'ui' },
  ];
  const alias: Record<string, string> = { 'button.primary.bg': 'color.action.primary.bg', 'button.primary.text': 'color.action.primary.text' };
  it('checks a component token in place of the semantic token it aliases, against its sibling token when there is one', () => {
    const out = componentContrastPairs([{ path: 'button.primary.bg' }], pairs, { aliasOf: (p) => alias[p], paths: Object.keys(alias) });
    expect(out.map((p) => `${p.foreground} on ${p.background} ${p.min}`)).toEqual(['button.primary.text on button.primary.bg 4.5', 'button.primary.bg on color.surface.default 3']);
    expect(componentContrastPairs([{ path: 'button.radius' }], pairs, { aliasOf: (p) => alias[p], paths: [] })).toEqual([]);
  });
});

describe('the library branch', () => {
  it('says where it came from, and tools read it back', () => {
    const o = { component: 'Button', figmaName: 'Button', route: 'claude-draft' as const, kind: 'new-variant' as const, url: 'https://www.figma.com/design/F/?node-id=1-1', spec: '.bridge/figma/button-add-a-lg-size.json', status: 'spec' as const };
    const body = withFigmaOrigin('Body.', o);
    expect(body.startsWith('**From Figma:** [Button](https://www.figma.com/design/F/?node-id=1-1). Once it ships, a pull in the Bridge Figma plugin rebuilds the component from this code.')).toBe(true);
    expect(body).toMatch(/\*\*Waiting for a developer:\*\*/);
    expect(body.endsWith('Body.')).toBe(true);
    expect(parseFigmaOrigin(body)).toEqual(o);
    const drafted = withFigmaOrigin(body, { ...o, status: 'drafted' });
    expect(drafted.match(/\*\*From Figma:\*\*/g)).toHaveLength(1);
    expect(drafted).toMatch(/\*\*Drafted with Claude\*\* from the Figma spec/);
    expect(figmaOriginSection({ ...o, route: 'token-change' })).toMatch(/Exact token change, no AI/);
    expect(body).not.toMatch(/\u2014/);
  });

  it('keeps the spec as a file Claude reads, with a brief to draft the code', () => {
    const d = diff({ kind: 'new-variant', title: 'Add a lg size', needsCode: true, changes: [{ field: 'Variant Size', before: 'md', after: 'lg, md' }], variantAxes: { Size: ['lg', 'md'] }, properties: [{ name: 'Label', type: 'TEXT', default: 'Button' }] });
    expect(figmaSpecPath(d)).toBe('.bridge/figma/button-add-a-lg-size.json');
    const spec = parseFigmaSpec(formatFigmaSpec(d, { edits: [], reasons: ['Why.'], issues: [] }))!;
    expect(spec.reasons).toEqual(['Why.']);
    expect(parseFigmaSpec('{"v":2}')).toBeUndefined();
    const brief = figmaDraftBrief(spec, { pr: 7, branch: 'bridge/figma-button-add-a-lg-size', specPath: figmaSpecPath(d) });
    expect(brief).toMatch(/^Draft the code for a component change made in Figma, on the library branch bridge\/figma-button-add-a-lg-size \(draft pull request #7\)\./);
    expect(brief).toContain('- Size: lg, md');
    expect(brief).toContain('- Label (text, default Button)');
    expect(brief).toContain('bridge_mark_figma_change_drafted { pr: 7 }');
    expect(brief).not.toMatch(/\u2014/);
  });

  it('says where it stands, and when the Figma component is rebuilt', () => {
    expect(figmaPushStatus({ state: 'open', labels: ['from-figma', 'waiting-for-claude'] }).key).toBe('waiting-for-claude');
    expect(figmaPushStatus({ state: 'open', labels: ['drafted-by-claude'] }).label).toBe('Drafted with Claude');
    expect(figmaPushStatus({ state: 'open', labels: [], route: 'token-change' }).sentence).toBe('Owners review the token change.');
    expect(figmaPushStatus({ state: 'merged' })).toMatchObject({ key: 'shipped', rebuild: true });
    expect(figmaPushStatus({ state: 'closed' })).toMatchObject({ key: 'closed', rebuild: true });
  });
});
