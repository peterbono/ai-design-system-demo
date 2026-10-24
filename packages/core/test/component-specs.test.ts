// Component specs are derived from code: the committed packages/react/component-specs.json must match what the
// generator reads from the component TSX and CSS modules today. Run `npm run specs` after changing a component.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseComponentSpecs, validateComponentSpec } from '../src/component-spec';
import { generateComponentSpec, generateRepoComponentSpecs, repoSpecOptions, serializeComponentSpecs } from '../src/node/component-specs';
import { DEFAULT_STATE, declaredFor, parseCssModule, parseSelector } from '../src/node/spec-css';

const ROOT = join(__dirname, '../../..');

describe('component specs', () => {
  it('packages/react/component-specs.json is up to date (run `npm run specs`)', () => {
    const committed = readFileSync(join(ROOT, 'packages/react/component-specs.json'), 'utf8');
    const file = generateRepoComponentSpecs(ROOT);
    expect(committed).toBe(serializeComponentSpecs(file));
    // Every component folder is in the coverage list; every generated folder has its sets in the file.
    const parsed = parseComponentSpecs(committed);
    const names = new Set(parsed.components.map((c) => c.component ?? c.name));
    for (const c of parsed.coverage!) expect(names.has(c.name) || (c.status !== 'generated' && c.status !== 'drafted') || c.name === 'Icon').toBe(true);
  });

  it('every set, generated or drafted, matches the format and names tokens of the repo; drafts only where the generator cannot read', () => {
    const parsed = parseComponentSpecs(readFileSync(join(ROOT, 'packages/react/component-specs.json'), 'utf8'));
    const { opts } = repoSpecOptions(ROOT);
    const types = new Map([...opts.tokens.values()].map((t) => [t.path, t.type]));
    for (const spec of parsed.components) expect(validateComponentSpec(spec, types)).toEqual([]);
    const drafts = readdirSync(join(ROOT, 'packages/react/component-spec-overrides')).filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, ''));
    expect(parsed.coverage!.filter((c) => c.status === 'drafted').map((c) => c.name)).toEqual(drafts);
    for (const name of drafts) {
      const spec = parsed.components.find((c) => (c.component ?? c.name) === name)!;
      expect(spec.drafted).toBeDefined();
      // Drafted from the code as it is: when the code changes, redraft and update codeHash (see the file's $comment).
      expect(spec.drafted!.stale).toBeUndefined();
    }
    // Every visual component is in Figma (generated or drafted with Claude); drafted ones are never counted as generated.
    expect(parsed.coverage!.filter((c) => c.status === 'unsupported')).toEqual([]);
  });

  it('Button: axes from union props, State from the CSS, a text and two icon properties', () => {
    const [button] = generateRepoComponentSpecs(ROOT, ['Button']).components;
    expect(button!.axes.map((a) => [a.name, a.values, a.default])).toEqual([
      ['Variant', ['primary', 'secondary', 'ghost', 'danger', 'link', 'inverse'], 'primary'],
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
    expect(button!.unmapped.map((u) => u.property)).toEqual(['prop loading', 'prop fullWidth', 'prop pressed']);
  });

  it('swaps: icon parts default to the docs or story icon, Card body is a content slot, icons and slots sections', () => {
    const file = generateRepoComponentSpecs(ROOT);
    const swap = (c: string, part: string) => file.components.find((x) => x.name === c)!.parts.find((p) => p.id === part)!.swap;
    expect(swap('IconButton', 'icon')).toEqual({ property: 'Icon', default: 'Icon/Pencil', prop: 'icon' });
    expect(swap('Button', 'icon-start')).toEqual({ property: 'Icon start', default: 'Icon/Plus', prop: 'iconStart' });
    expect(swap('Button', 'icon-end')!.default).toBe('Icon/ChevronDown');
    expect(swap('Badge', 'icon')!.default).toBe('Icon/CircleCheck');
    expect(swap('Card', 'body-text')).toEqual({ property: 'Body', default: 'Slot/Card body text', options: ['Slot/Card body text', 'Slot/Media'] });
    const card = file.components.find((c) => c.name === 'Card')!;
    expect(card.variants.map((v) => `${v.props.Padding}:${v.slots!['body-text']}`)).toEqual(['none:Slot/Media', 'compact:Slot/Card body text', 'default:Slot/Card body text']);
    expect(card.properties.map((p) => p.name)).toEqual(['Header', 'Footer']);
    // The required icon of IconButton is drawn now: no longer reported as unmapped. Loading and the toggle state are not drawn.
    expect(file.components.find((c) => c.name === 'IconButton')!.unmapped.map((u) => u.property)).toEqual(['prop loading', 'prop pressed']);
    const names = file.icons!.map((i) => i.name);
    for (const n of ['Pencil', 'Plus', 'ChevronDown', 'CircleCheck', 'Layers', 'Image', 'Info', 'MoreHorizontal']) expect(names).toContain(n);
    expect(names).toEqual([...names].sort());
    expect(file.icons!.find((i) => i.name === 'TriangleAlert')!.aliases).toEqual(['AlertTriangle']);
    expect(file.icons!.find((i) => i.name === 'Plus')!.svg).toBe(
      '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="M12 5v14"/></svg>',
    );
    expect(file.iconStyle).toEqual({ size: 'icon.size.lg', color: 'color.text.default', stroke: 'icon.stroke' });
    expect(file.slots!.map((s) => [s.name, s.kind])).toEqual([
      ['Slot/Card body text', 'text'],
      ['Slot/Media', 'media'],
    ]);
    expect(file.slots![0]!.values).toMatchObject({ textFill: 'color.text.default', fontSize: 'font.size.200' });
  });

  it('cascade: specificity, :not(), :has() and combinators', () => {
    const { rules } = parseCssModule('m', '.a { color: var(--x); } .a:hover:not([data-disabled]) { color: var(--y); } .p:has(> .c) .c { color: var(--z); } @media (pointer: coarse) { .a { color: var(--w); } }');
    const root = { tag: 'span', classes: new Set(['m|a']), children: [], present: true, isRoot: true, inputLike: false };
    expect(declaredFor(rules, root, DEFAULT_STATE).get('color')?.value).toBe('var(--x)');
    expect(declaredFor(rules, root, { hover: true, active: false, disabled: false }).get('color')?.value).toBe('var(--y)');
    expect(declaredFor(rules, root, { hover: true, active: false, disabled: true }).get('color')?.value).toBe('var(--x)');
    expect(parseSelector('.p:has(> .c) .c').parts.length).toBe(2);
  });

  it('a content-box minimum counts its padding and border, as CSS draws it (Figma includes them)', () => {
    const row = (name: string, extra: string): Record<string, string> => ({
      [`c/${name}/${name}.tsx`]: `import styles from './${name}.module.css';
export interface ${name}Props { children?: ReactNode }
export const ${name} = forwardRef(function ${name}({ children }, ref) {
  return <label className={styles.row}>{children}</label>;
});`,
      [`c/${name}/${name}.module.css`]: `.row { display: inline-flex; min-height: var(--size-6); padding-block: var(--space-0-5); border: var(--size-1) solid;${extra} }`,
    });
    const files = { ...row('Row', ''), ...row('Tight', ' box-sizing: border-box;') };
    const tokens = new Map(['size-6', 'space-0-5', 'size-1'].map((n) => [`--${n}`, { path: n.replace('-', '.'), type: 'dimension' }]));
    const root = (name: string) => generateComponentSpec(name, { componentsDir: 'c', read: (p) => files[p], tokens }).variants[0]!.values.root;
    expect(root('Row')).toMatchObject({ minHeight: 'calc(size.6 + space.0-5 + space.0-5 + size.1 + size.1)' });
    expect(root('Tight')).toMatchObject({ minHeight: 'size.6' });
  });

  it('rows set inline under a computed key, and 1lh, become a calc() of the font size and line height tokens', () => {
    const files: Record<string, string> = {
      'c/Area/Area.tsx': `import styles from './Area.module.css';
export interface AreaProps { rows?: number }
export const Area = forwardRef(function Area({ rows = 3 }, ref) {
  return <div className={styles.area} style={{ ['--_rows' as string]: rows }} />;
});`,
      'c/Area/Area.module.css': `.area { box-sizing: border-box; display: flex; font-size: var(--font-size-200); line-height: var(--font-line-height-normal); min-height: calc(var(--_rows) * 1lh + var(--space-2) * 2); }`,
    };
    const tokens = new Map([
      ['--font-size-200', { path: 'font.size.200', type: 'dimension' }],
      ['--font-line-height-normal', { path: 'font.line-height.normal', type: 'number' }],
      ['--space-2', { path: 'space.2', type: 'dimension' }],
    ]);
    const spec = generateComponentSpec('Area', { componentsDir: 'c', read: (p) => files[p], tokens });
    expect(spec.variants[0]!.values.root).toMatchObject({ minHeight: 'calc(3 * (font.size.200 * font.line-height.normal) + space.2 * 2)' });
    expect(spec.unmapped.filter((u) => u.property === 'min-height')).toEqual([]);
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
