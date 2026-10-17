// Component specs are derived from code: the committed packages/react/component-specs.json must match what the
// generator reads from the component TSX and CSS modules today. Run `npm run specs` after changing a component.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseComponentSpecs } from '../src/component-spec';
import { SPEC_COMPONENTS, generateComponentSpec, generateRepoComponentSpecs, serializeComponentSpecs } from '../src/node/component-specs';
import { DEFAULT_STATE, declaredFor, parseCssModule, parseSelector } from '../src/node/spec-css';

const ROOT = join(__dirname, '../../..');

describe('component specs', () => {
  it('packages/react/component-specs.json is up to date (run `npm run specs`)', () => {
    const committed = readFileSync(join(ROOT, 'packages/react/component-specs.json'), 'utf8');
    expect(committed).toBe(serializeComponentSpecs(generateRepoComponentSpecs(ROOT, SPEC_COMPONENTS)));
    expect(parseComponentSpecs(committed).components.map((c) => c.name)).toEqual(SPEC_COMPONENTS);
  });

  it('Button: axes from union props, State from the CSS, a text and two icon properties', () => {
    const [button] = generateRepoComponentSpecs(ROOT, ['Button']).components;
    expect(button!.axes.map((a) => [a.name, a.values, a.default])).toEqual([
      ['Variant', ['primary', 'secondary', 'ghost', 'danger'], 'primary'],
      ['Size', ['sm', 'md', 'lg'], 'md'],
      ['State', ['Default', 'Hover', 'Pressed', 'Disabled'], 'Default'],
    ]);
    expect(button!.properties).toEqual([
      { name: 'Label', type: 'TEXT', default: 'Button', prop: 'children' },
      { name: 'Icon start', type: 'BOOLEAN', default: false, prop: 'iconStart' },
      { name: 'Icon end', type: 'BOOLEAN', default: false, prop: 'iconEnd' },
    ]);
    const v = (props: Record<string, string>) => button!.variants.find((x) => JSON.stringify(x.props) === JSON.stringify(props))!.values;
    const secondaryHover = v({ Variant: 'secondary', Size: 'lg', State: 'Hover' });
    expect(secondaryHover.root).toMatchObject({
      fill: 'button.secondary.bg-hover',
      stroke: 'button.secondary.border',
      strokeWeight: 'border-width.default',
      cornerRadius: 'button.radius',
      paddingLeft: 'control.padding-x.lg',
      minHeight: 'control.height.lg',
      itemSpacing: 'control.gap',
    });
    expect(secondaryHover.text).toMatchObject({ textFill: 'button.secondary.text', fontSize: 'font.size.300', fontWeight: 'button.font-weight' });
    expect(v({ Variant: 'primary', Size: 'md', State: 'Disabled' }).root).toMatchObject({ fill: 'color.action.disabled.bg', stroke: null });
    expect(v({ Variant: 'ghost', Size: 'md', State: 'Disabled' }).root!.fill).toBeNull();
    expect(button!.unmapped.map((u) => u.property)).toEqual(['prop loading', 'prop fullWidth']);
  });

  it('cascade: specificity, :not(), :has() and combinators', () => {
    const { rules } = parseCssModule('m', '.a { color: var(--x); } .a:hover:not([data-disabled]) { color: var(--y); } .p:has(> .c) .c { color: var(--z); } @media (pointer: coarse) { .a { color: var(--w); } }');
    const root = { tag: 'span', classes: new Set(['m|a']), children: [], present: true, isRoot: true, inputLike: false };
    expect(declaredFor(rules, root, DEFAULT_STATE).get('color')?.value).toBe('var(--x)');
    expect(declaredFor(rules, root, { hover: true, active: false, disabled: false }).get('color')?.value).toBe('var(--y)');
    expect(declaredFor(rules, root, { hover: true, active: false, disabled: true }).get('color')?.value).toBe('var(--x)');
    expect(parseSelector('.p:has(> .c) .c').parts.length).toBe(2);
  });

  it('calc() of tokens becomes an expression of token paths; a single token stays a token', () => {
    const files: Record<string, string> = {
      'c/Pill/Pill.tsx': `import styles from './Pill.module.css';
export interface PillProps { size?: 'sm' | 'md'; children?: ReactNode }
export const Pill = forwardRef(function Pill({ size = 'md', children }, ref) {
  return <span className={cx(styles.pill, styles[size])}><span className={styles.wrap}><i className={styles.dot} />{children}</span></span>;
});`,
      'c/Pill/Pill.module.css': `.pill { display: inline-flex; align-items: stretch; }
.dot { width: var(--space-1); }
.wrap { display: inline-flex; align-items: center; gap: var(--space-1); padding: 0 calc(var(--space-2)); }
.md .wrap { padding: 0 calc(var(--space-2) + var(--space-0-5)); min-height: 0; }
.md { min-height: calc((var(--size-6) - var(--space-1)) * 2); }
.sm { min-height: calc(var(--size-6) + 1rem); }`,
    };
    const tokens = new Map(['space-1', 'space-2', 'space-0-5', 'size-6'].map((n) => [`--${n}`, { path: n.replace('-', '.'), type: 'dimension' }]));
    const spec = generateComponentSpec('Pill', { componentsDir: 'c', read: (p) => files[p], tokens });
    const v = (size: string) => spec.variants.find((x) => x.props.Size === size)!.values;
    expect(v('md').root).toMatchObject({ paddingLeft: 'calc(space.2 + space.0-5)', minHeight: 'calc((size.6 - space.1) * 2)' });
    expect(v('sm').root).toMatchObject({ paddingLeft: 'space.2' });
    expect(spec.unmapped).toContainEqual(expect.objectContaining({ property: 'min-height', reason: 'calc() with 1rem: only tokens, numbers and px are mapped' }));
    // The wrapper only added padding and gap: merged into the root, its children move up.
    expect(spec.parts.map((p) => `${p.id}<${p.parent ?? ''}`)).toEqual(['root<', 'dot<root', 'text<root']);
    expect(spec.parts[0]!.layout).toEqual({ direction: 'HORIZONTAL', primary: 'MIN', counter: 'CENTER' });
    expect(v('sm').root).toMatchObject({ itemSpacing: 'space.1' });
    expect(spec.parts[0]!.fill).toBeUndefined();
  });

  it('Card: a block-level root that clips; Tag: its label wrapper is merged into the root', () => {
    const [tag, card] = generateRepoComponentSpecs(ROOT, ['Tag', 'Card']).components;
    expect(card!.parts[0]).toMatchObject({ id: 'root', clip: true, fill: true });
    expect(card!.parts.filter((p) => p.clip).map((p) => p.id)).toEqual(['root']);
    expect(tag!.parts.map((p) => p.id)).toEqual(['root', 'icon', 'text']);
    expect(tag!.parts[0]!.fill).toBeUndefined();
  });
});
