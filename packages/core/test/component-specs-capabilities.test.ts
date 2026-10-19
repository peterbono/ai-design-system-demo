// Generator capabilities, one per test, on small components written for the test (not the repo's): content props as
// text properties, Base UI checked states, hidden parts per variant, transforms read as auto layout, lists from the docs
// preview, the page's base stylesheet, and the coverage list (generated, unsupported with a reason, layout helper).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { UnsupportedComponentError, generateAllComponentSpecs, generateComponentSpec, type SpecGeneratorOptions } from '../src/node/component-specs';
import { DEFAULT_STATE, declaredFor, parseCssModule } from '../src/node/spec-css';

const ROOT = join(__dirname, '../../..');

const TOKENS = [
  'space-0-5', 'space-1', 'space-2', 'space-3', 'space-6', 'size-4', 'size-5', 'size-9', 'size-10', 'radius-pill',
  'border-width-default', 'font-size-100', 'font-size-200', 'font-family-sans', 'color-text-default', 'color-text-muted',
  'color-text-link', 'color-bg', 'color-bg-checked', 'color-fg', 'color-border', 'color-thumb', 'color-danger',
];
const tokens = new Map(TOKENS.map((n) => [`--${n}`, { path: n.replace(/-(?=\d|[a-z])/, '.'), type: /^(color)/.test(n) ? 'color' : /family/.test(n) ? 'fontFamily' : 'dimension' }]));

/** Options over in-memory component files ("c/Name/Name.tsx"...), lucide-react read from the repo. */
function options(files: Record<string, string>, extra: Partial<SpecGeneratorOptions> = {}): SpecGeneratorOptions {
  const read = (p: string) => files[p] ?? (p.startsWith('node_modules/') ? safeRead(join(ROOT, p)) : undefined);
  const components = [...new Set(Object.keys(files).filter((p) => p.endsWith('.tsx')).map((p) => p.split('/')[1]!))];
  return { componentsDir: 'c', read, tokens, components, ...extra };
}
function safeRead(path: string): string | undefined {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return undefined;
  }
}

describe('generator capabilities', () => {
  it('content props are TEXT properties; optional ones and what derives from them are behind a BOOLEAN', () => {
    const files = {
      'c/Note/Note.tsx': `import styles from './Note.module.css';
export interface NoteProps { label: ReactNode; description?: ReactNode; error?: ReactNode }
export const Note = forwardRef(function Note({ label, description, error }, ref) {
  const invalid = error != null && error !== '';
  return <div className={styles.note}><span className={styles.label}>{label}</span>{description && <span className={styles.description}>{description}</span>}{invalid && <p className={styles.error}>{error}</p>}</div>;
});`,
      'c/Note/Note.module.css': `.note { display: flex; flex-direction: column; gap: var(--space-1); color: var(--color-text-default); }
.description { color: var(--color-text-muted); } .error { color: var(--color-danger); margin: 0; }`,
    };
    const spec = generateComponentSpec('Note', options(files));
    expect(spec.properties).toEqual([
      { name: 'Label', type: 'TEXT', default: 'Label', prop: 'label' },
      { name: 'Description', type: 'TEXT', default: 'Description', prop: 'description' },
      { name: 'Error', type: 'TEXT', default: 'Error', prop: 'error' },
      { name: 'Show description', type: 'BOOLEAN', default: false, prop: 'description' },
      { name: 'Show error', type: 'BOOLEAN', default: false, prop: 'error' },
    ]);
    expect(spec.parts.find((p) => p.id === 'error')).toMatchObject({ kind: 'frame', visible: 'Show error' });
    expect(spec.variants[0]!.values.description).toMatchObject({ textFill: 'color.text-muted' });
  });

  it('Base UI checked states: a Checked axis (with mixed when the component has indeterminate), glyphs hidden per variant', () => {
    const files = {
      'c/Tick/Tick.tsx': `import { Checkbox as BaseCheckbox } from '@base-ui/react/checkbox';
import { Check, Minus } from 'lucide-react';
import styles from './Tick.module.css';
export interface TickProps { label: ReactNode; checked?: boolean; indeterminate?: boolean; disabled?: boolean }
export const Tick = forwardRef(function Tick({ label, indeterminate, ...rest }, ref) {
  return <label className={styles.item}><BaseCheckbox.Root className={styles.box} indeterminate={indeterminate} {...rest}><BaseCheckbox.Indicator className={styles.indicator}><Icon icon={Check} className={styles.check} /><Icon icon={Minus} className={styles.mixed} /></BaseCheckbox.Indicator></BaseCheckbox.Root><span>{label}</span></label>;
});`,
      'c/Tick/Tick.module.css': `.item { display: inline-flex; gap: var(--space-2); }
.box { display: inline-flex; width: var(--size-4); height: var(--size-4); background-color: var(--color-bg); border: var(--border-width-default) solid var(--color-border); color: var(--color-fg); }
.box[data-checked], .box[data-indeterminate] { background-color: var(--color-bg-checked); }
.box[data-disabled] { background-color: var(--color-border); }
.indicator { display: flex; opacity: 0; transform: scale(0.6); }
.indicator[data-checked], .indicator[data-indeterminate] { opacity: 1; transform: none; }
.check { stroke-width: 3; }
.indicator[data-indeterminate] .check, .indicator:not([data-indeterminate]) .mixed { display: none; }`,
      'c/Icon/Icon.tsx': `import styles from './Icon.module.css';
export interface IconProps { icon: LucideIcon }
export const Icon = forwardRef(function Icon({ icon: Glyph, className }, ref) { return <Glyph className={cx(styles.icon, className)} />; });`,
      'c/Icon/Icon.module.css': `.icon { width: var(--size-4); height: var(--size-4); }`,
    };
    const spec = generateComponentSpec('Tick', options(files));
    expect(spec.axes.map((a) => `${a.name}=${a.values.join('|')}`)).toEqual(['Checked=false|true|mixed', 'State=Default|Disabled']);
    const v = (checked: string, state = 'Default') => spec.variants.find((x) => x.props.Checked === checked && x.props.State === state)!;
    expect(v('false').values.box!.fill).toBe('color.bg');
    expect(v('true').values.box!.fill).toBe('color.bg-checked');
    expect(v('false', 'Disabled').values.box!.fill).toBe('color.border');
    // Unchecked: the indicator is hidden (opacity 0); checked shows the check mark; mixed shows the minus.
    expect(v('false').hidden).toEqual(expect.arrayContaining(['indicator']));
    expect(v('true').hidden).toEqual(['icon-2']);
    expect(v('mixed').hidden).toEqual(['icon']);
    // Icons written in code are instances of that icon; a unitless stroke width is set as a number.
    expect(spec.parts.find((p) => p.id === 'icon')!.icon).toBe('Icon/Check');
    expect(v('true').values.icon!.strokeWeight).toBe(3);
    expect(spec.unmapped.map((u) => u.property)).not.toContain('prop checked');
  });

  it('a switch thumb moved by translateX: the row padding at the start, the end alignment when on; row-reverse', () => {
    const files = {
      'c/Toggle/Toggle.tsx': `import { Switch as BaseSwitch } from '@base-ui/react/switch';
import styles from './Toggle.module.css';
export interface ToggleProps { label: ReactNode; placement?: 'end' | 'start'; checked?: boolean }
export const Toggle = forwardRef(function Toggle({ label, placement = 'end' }, ref) {
  return <label className={cx(styles.item, styles[placement])}><BaseSwitch.Root className={styles.track}><BaseSwitch.Thumb className={styles.thumb} /></BaseSwitch.Root><span>{label}</span></label>;
});`,
      'c/Toggle/Toggle.module.css': `.item { --_w: var(--size-9); --_t: var(--size-4); --_i: var(--space-0-5); display: inline-flex; gap: var(--space-3); }
.start { display: flex; flex-direction: row-reverse; justify-content: space-between; }
.track { display: inline-flex; align-items: center; width: var(--_w); height: var(--size-5); background-color: var(--color-border); }
.track[data-checked] { background-color: var(--color-bg-checked); }
.thumb { width: var(--_t); height: var(--_t); background-color: var(--color-thumb); transform: translateX(var(--_i)); }
.thumb[data-checked] { transform: translateX(calc(var(--_w) - var(--_t) - var(--_i))); }`,
    };
    const spec = generateComponentSpec('Toggle', options(files));
    const v = (checked: string, placement = 'end') => spec.variants.find((x) => x.props.Checked === checked && x.props.Placement === placement)!;
    expect(v('false').values.track).toMatchObject({ paddingLeft: 'space.0-5' });
    expect(spec.parts.find((p) => p.id === 'track')!.layout).toMatchObject({ primary: 'MIN' });
    expect(v('true').values.track).toMatchObject({ paddingRight: 'space.0-5' });
    expect(v('true').layout!.track).toMatchObject({ primary: 'MAX' });
    expect(v('false', 'start').layout!.root).toMatchObject({ reverse: true, primary: 'SPACE_BETWEEN' });
  });

  it('lists from the docs preview are drawn with .map(); the preview defaultValue checks its option', () => {
    const files = {
      'c/Segments/Segments.tsx': `import { RadioGroup as BaseRadioGroup } from '@base-ui/react/radio-group';
import { Radio as BaseRadio } from '@base-ui/react/radio';
import styles from './Segments.module.css';
export interface SegmentsProps { items: Item[]; defaultValue?: string }
export const Segments = forwardRef(function Segments({ items, defaultValue }, ref) {
  return <BaseRadioGroup className={styles.root}>{items.map((item, i) => { const last = i === items.length - 1; return <BaseRadio.Root key={item.value} value={item.value} className={cx(styles.segment, last && styles.last)}><span className={styles.label}>{item.label}</span></BaseRadio.Root>; })}</BaseRadioGroup>;
});`,
      'c/Segments/Segments.module.css': `.root { display: inline-flex; gap: var(--space-1); } .segment { padding: var(--space-1); color: var(--color-text-muted); } .segment[data-checked] { background-color: var(--color-bg-checked); color: var(--color-fg); } .last { padding: var(--space-2); }`,
      'c/Segments/Segments.docs.json': JSON.stringify({ preview: { c: 'Segments', p: { defaultValue: 'b', items: [{ value: 'a', label: 'Alpha' }, { value: 'b', label: 'Beta' }] } } }),
    };
    const spec = generateComponentSpec('Segments', options(files));
    expect(spec.parts.filter((p) => p.kind === 'text').map((p) => p.characters)).toEqual(['Alpha', 'Beta']);
    const values = spec.variants[0]!.values;
    expect(values.segment).not.toHaveProperty('fill');
    expect(values['segment-2']).toMatchObject({ fill: 'color.bg-checked', paddingLeft: 'space.2' });
  });

  it('what cannot be drawn faithfully throws a plain reason: computed content, CSS grid, popups', () => {
    const files = {
      'c/Pages/Pages.tsx': `import styles from './Pages.module.css';
export interface PagesProps { count: number }
export const Pages = forwardRef(function Pages({ count }, ref) { return <nav className={styles.nav}>{pagesOf(count)}</nav>; });`,
      'c/Pages/Pages.module.css': `.nav { display: flex; background-color: var(--color-bg); }`,
      'c/Tiles/Tiles.tsx': `import styles from './Tiles.module.css';
export interface TilesProps { label: ReactNode }
export const Tiles = forwardRef(function Tiles({ label }, ref) { return <div className={styles.grid}><span>{label}</span></div>; });`,
      'c/Tiles/Tiles.module.css': `.grid { display: grid; background-color: var(--color-bg); }`,
      'c/Tip/Tip.tsx': `import { Tooltip as BaseTooltip } from '@base-ui/react/tooltip';
import styles from './Tip.module.css';
export interface TipProps { label: ReactNode }
export const Tip = forwardRef(function Tip({ label }, ref) { return <BaseTooltip.Portal><BaseTooltip.Popup className={styles.popup}>{label}</BaseTooltip.Popup></BaseTooltip.Portal>; });`,
      'c/Tip/Tip.module.css': `.popup { display: flex; background-color: var(--color-bg); }`,
    };
    const reason = (name: string) => {
      try {
        generateComponentSpec(name, options(files));
        return 'generated';
      } catch (err) {
        return err instanceof UnsupportedComponentError ? err.reason : String(err);
      }
    };
    expect(reason('Pages')).toBe('shows content computed while the page runs');
    expect(reason('Tiles')).toBe('uses CSS grid');
    expect(reason('Tip')).toBe('opens a popup');
  });

  it('coverage: every folder, generated, unsupported with its reason, or a layout helper', () => {
    const files = {
      'c/Pill/Pill.tsx': `import styles from './Pill.module.css';
export interface PillProps { children?: ReactNode }
export const Pill = forwardRef(function Pill({ children }, ref) { return <span className={styles.pill}>{children}</span>; });`,
      'c/Pill/Pill.module.css': `.pill { display: inline-flex; padding: var(--space-1); background-color: var(--color-bg); }`,
      'c/Row/Row.tsx': `import styles from './Row.module.css';
export interface RowProps { children?: ReactNode }
export const Row = forwardRef(function Row({ children }, ref) { return <div className={styles.row}>{children}</div>; });`,
      'c/Row/Row.module.css': `.row { display: flex; gap: var(--space-2); }`,
      'c/Board/Board.tsx': `import styles from './Board.module.css';
export interface BoardProps { children?: ReactNode }
export const Board = forwardRef(function Board({ children }, ref) { return <div className={styles.board}>{children}</div>; });`,
      'c/Board/Board.module.css': `.board { display: grid; background-color: var(--color-bg); }`,
    };
    const file = generateAllComponentSpecs(['Pill', 'Row', 'Board'], options(files));
    expect(file.coverage).toEqual([
      { name: 'Board', status: 'unsupported', reason: 'uses CSS grid' },
      { name: 'Pill', status: 'generated' },
      { name: 'Row', status: 'layout', reason: 'layout only, use auto layout' },
    ]);
    expect(file.components.map((c) => c.name)).toEqual(['Pill']);
  });

  it('page base stylesheet, em sizes, flex grow, wrapping rows, underlines, useRender links and helper text', () => {
    const files = {
      'styles/base.css': `:where(html) { color: var(--color-text-default); font-family: var(--font-family-sans); font-size: var(--font-size-200); }`,
      'c/Chip/Chip.tsx': `import styles from './Chip.module.css';
export function initialsOf(name: string) { return name.split(' ').map((w) => w[0]).join(''); }
export interface ChipProps { name: string; children?: ReactNode }
export const Chip = forwardRef(function Chip({ name, children }, ref) {
  return <div className={styles.row}><span className={styles.mark}>{initialsOf(name)}</span><span className={styles.fill}>{children}</span></div>;
});`,
      'c/Chip/Chip.module.css': `.row { display: flex; flex-flow: row wrap; gap: var(--space-1) var(--space-6); }
.mark { height: 1em; font-size: 0.5em; } .fill { flex: 1; text-decoration: underline; }`,
      'c/Chip/Chip.docs.json': JSON.stringify({ preview: { c: 'Chip', p: { name: 'Ada Lovelace' } } }),
      'c/Anchor/Anchor.tsx': `import { useRender } from '@base-ui/react/use-render';
import { mergeProps } from '@base-ui/react/merge-props';
import styles from './Anchor.module.css';
export interface AnchorProps { children?: ReactNode }
export const Anchor = forwardRef(function Anchor({ children, ...rest }, ref) {
  const content = <>{children}</>;
  return useRender({ defaultTagName: 'a', props: mergeProps({ className: styles.link, ...({}), children: content }, rest) });
});`,
      'c/Anchor/Anchor.module.css': `.link { color: var(--color-text-link); text-decoration-line: underline; }`,
    };
    const opts = options(files, { baseCss: 'styles/base.css' });
    const chip = generateComponentSpec('Chip', opts);
    const values = chip.variants[0]!.values;
    expect(chip.parts.find((p) => p.id === 'root')!.layout).toMatchObject({ direction: 'HORIZONTAL', wrap: true });
    expect(values.root).toMatchObject({ itemSpacing: 'space.6', counterAxisSpacing: 'space.1' });
    expect(chip.parts.find((p) => p.characters === 'AL')).toBeTruthy();
    const mark = chip.parts.find((p) => p.characters === 'AL')!;
    expect(values[mark.id]).toMatchObject({ fontSize: 'calc(font.size-200 * 0.5)', textFill: 'color.text-default', fontFamily: 'font.family-sans' });
    expect(chip.parts.find((p) => p.text === 'Label')).toBeTruthy();
    expect(chip.parts.find((p) => p.grow)?.kind).toBe('text');
    const anchor = generateComponentSpec('Anchor', opts);
    expect(anchor.parts.map((p) => `${p.id}:${p.kind}`)).toEqual(['root:frame', 'text:text']);
    expect(anchor.variants[0]!.values.text).toMatchObject({ textFill: 'color.text-link', textDecoration: 'UNDERLINE' });
  });

  it('cascade: data-* and aria-* attributes the JSX sets, Base UI checked attributes', () => {
    const { rules } = parseCssModule('m', '.a[data-invalid] { color: var(--x); } .a[aria-checked="mixed"] { color: var(--y); }');
    const el = { tag: 'span', classes: new Set(['m|a']), children: [], present: true, isRoot: true, inputLike: false };
    expect(declaredFor(rules, { ...el, attrs: new Map([['data-invalid', 'true']]) }, DEFAULT_STATE).get('color')?.value).toBe('var(--x)');
    expect(declaredFor(rules, el, DEFAULT_STATE).get('color')).toBeUndefined();
    expect(declaredFor(rules, { ...el, baseUi: true, checked: 'state' as const }, { ...DEFAULT_STATE, checked: 'mixed' }).get('color')?.value).toBe('var(--y)');
  });
});
