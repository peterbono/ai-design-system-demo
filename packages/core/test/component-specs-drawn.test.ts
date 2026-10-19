// Generator capabilities added to draw every component (third coverage pass), one per test, on small components written
// for the test: CSS grid rows and subgrid, ::before/::after decorations, indicators Base UI sizes to the selected item,
// panels, sliders, tables, forms, functions as values, string and list methods, helpers that return elements, plain
// modules, React's JSX text spacing, example texts, and specs drafted with Claude (validated, never counted as generated).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { validateComponentSpec, type ComponentSpec } from '../src/component-spec';
import { planReference } from '../src/fidelity-references';
import { draftedCodeHash, generateAllComponentSpecs, generateComponentSpec, jsxText, type SpecGeneratorOptions } from '../src/node/component-specs';

const ROOT = join(__dirname, '../../..');

const TOKENS = ['space-1', 'space-2', 'space-3', 'size-4', 'size-6', 'radius-pill', 'border-width-default', 'border-width-indicator', 'color-bg', 'color-fg', 'color-border', 'color-line', 'color-mark', 'color-thumb', 'color-danger', 'color-muted'];
const tokens = new Map(TOKENS.map((n) => [`--${n}`, { path: n.replace(/-(?=\d|[a-z])/, '.'), type: /^color/.test(n) ? 'color' : 'dimension' }]));

function options(files: Record<string, string>, extra: Partial<SpecGeneratorOptions> = {}): SpecGeneratorOptions {
  const read = (p: string) => files[p] ?? (p.startsWith('node_modules/') ? safeRead(join(ROOT, p)) : undefined);
  const components = [...new Set(Object.keys(files).filter((p) => /^c\/\w+\/\w+\.tsx$/.test(p)).map((p) => p.split('/')[1]!))];
  return { componentsDir: 'c', read, tokens, components, ...extra };
}
function safeRead(path: string): string | undefined {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return undefined;
  }
}

describe('drawing what the generator could not read before', () => {
  it('CSS grid: rows spanning every column stack; a subgrid row lines its items up, 0 edge tracks become the gap, fr tracks grow', () => {
    const files = {
      'c/Steps/Steps.tsx': `import styles from './Steps.module.css';
export interface StepsProps { children?: ReactNode }
export const Steps = forwardRef(function Steps({ children }, ref) { return <ul className={styles.list}>{children}</ul>; });
export interface StepProps { title: ReactNode; detail?: ReactNode }
export const Step = forwardRef(function Step({ title, detail }, ref) {
  return <li className={styles.row}><span className={styles.dot} /><span className={styles.title}>{title}</span><span className={styles.detail}>{detail}</span></li>;
});`,
      'c/Steps/Steps.module.css': `.list { display: grid; grid-template-columns: 0 var(--size-6) max-content minmax(0, 1fr) 0; column-gap: var(--space-3); background-color: var(--color-bg); }
.row { display: grid; grid-column: 1 / -1; grid-template-columns: subgrid; align-items: center; }
.dot { grid-column: 2; width: var(--size-4); height: var(--size-4); background-color: var(--color-mark); } .title { grid-column: 3; } .detail { grid-column: 4; color: var(--color-muted); }`,
      'c/Steps/Steps.docs.json': JSON.stringify({ preview: { c: 'Steps', children: [{ c: 'Step', p: { title: 'Design', detail: 'Done' } }, { c: 'Step', p: { title: 'Tests', detail: 'Waiting' } }] } }),
    };
    const spec = generateComponentSpec('Steps', options(files));
    expect(spec.parts[0]!.layout).toEqual({ direction: 'VERTICAL', primary: 'MIN', counter: 'STRETCH' });
    expect(spec.parts.find((p) => p.id === 'row')).toMatchObject({ layout: { direction: 'HORIZONTAL', primary: 'MIN', counter: 'CENTER' } });
    expect(spec.variants[0]!.values.row).toMatchObject({ itemSpacing: 'space.3', paddingLeft: 'space.3', paddingRight: 'space.3' });
    expect(spec.parts.find((p) => p.id === 'detail')).toMatchObject({ grow: true });
    expect(spec.parts.find((p) => p.id === 'title')!.grow).toBeUndefined();
    expect(spec.unmapped).toContainEqual(expect.objectContaining({ part: 'row', property: 'grid-template-columns', value: 'subgrid' }));
    // The example's rows are recorded for the fidelity check.
    expect(spec.example).toEqual({ c: 'Steps', children: [{ c: 'Step', p: { title: 'Design', detail: 'Done' } }, { c: 'Step', p: { title: 'Tests', detail: 'Waiting' } }] });
  });

  it('::before / ::after with empty content that paint are a Decoration layer, pinned from its rules; text content still blocks', () => {
    const files = {
      'c/Rail/Rail.tsx': `import styles from './Rail.module.css';
export interface RailProps { kind?: 'line' | 'none' }
export const Rail = forwardRef(function Rail({ kind = 'line' }, ref) { return <div className={cx(styles.rail, styles[kind])}><span className={styles.item}>One</span></div>; });`,
      'c/Rail/Rail.module.css': `.rail { position: relative; display: flex; padding: var(--space-2); }
.line::after { content: ""; position: absolute; z-index: -1; inset: auto 0 0; height: var(--border-width-default); background-color: var(--color-line); }`,
    };
    const spec = generateComponentSpec('Rail', options(files));
    const deco = spec.parts.find((p) => p.name === 'Decoration')!;
    // Under its siblings (negative z-index): the first child; across the bottom of the rail.
    expect(spec.parts.filter((p) => p.parent === 'root').map((p) => p.id)).toEqual(['decoration', 'item']);
    expect(deco.pin).toEqual({ right: 0, bottom: 0, left: 0 });
    expect(spec.variants.find((v) => v.props.Kind === 'line')!.values.decoration).toEqual({ fill: 'color.line', height: 'border.width-default' });
    expect(spec.variants.find((v) => v.props.Kind === 'none')!.hidden).toContain('decoration');
    const withText = { ...files, 'c/Rail/Rail.module.css': `.rail { display: flex; } .line::after { content: "+"; background-color: var(--color-line); }` };
    expect(() => generateComponentSpec('Rail', options(withText))).toThrow(/::before or ::after/);
  });

  it('a Base UI indicator sized at run time follows the selected item; unselected panels hidden; parts carry the orientation; pins per variant', () => {
    const files = {
      'c/Seg/Seg.tsx': `import { Tabs as BaseTabs } from '@base-ui/react/tabs';
import styles from './Seg.module.css';
export interface SegProps { orientation?: 'horizontal' | 'vertical'; defaultValue?: string; children?: ReactNode }
export const Seg = forwardRef(function Seg({ orientation = 'horizontal', defaultValue, children }, ref) {
  return <BaseTabs.Root orientation={orientation} defaultValue={defaultValue} className={cx(styles.root, styles[orientation])}>{children}</BaseTabs.Root>;
});
export const SegList = forwardRef(function SegList({ children }, ref) { return <BaseTabs.List className={styles.list}>{children}<BaseTabs.Indicator className={styles.indicator} /></BaseTabs.List>; });
export const SegTab = forwardRef(function SegTab({ value, children }, ref) { return <BaseTabs.Tab value={value} className={styles.tab}>{children}</BaseTabs.Tab>; });
export const SegPanel = forwardRef(function SegPanel({ value, children }, ref) { return <BaseTabs.Panel value={value} className={styles.panel}>{children}</BaseTabs.Panel>; });`,
      'c/Seg/Seg.module.css': `.root { display: flex; flex-direction: column; } .vertical { flex-direction: row; } .list { position: relative; display: flex; } .list[data-orientation="vertical"] { flex-direction: column; }
.tab { position: relative; display: flex; padding: var(--space-2); } .tab[data-active] { color: var(--color-fg); }
.indicator { position: absolute; bottom: 0; left: var(--active-tab-left); width: var(--active-tab-width); height: var(--border-width-indicator); background-color: var(--color-mark); }
.list[data-orientation="vertical"] .indicator { top: var(--active-tab-top); bottom: auto; left: 0; width: var(--border-width-indicator); height: var(--active-tab-height); }`,
      'c/Seg/Seg.docs.json': JSON.stringify({ preview: { c: 'Seg', p: { defaultValue: 'b' }, children: [{ c: 'SegList', children: [{ c: 'SegTab', p: { value: 'a' }, children: ['A'] }, { c: 'SegTab', p: { value: 'b' }, children: ['B'] }] }, { c: 'SegPanel', p: { value: 'a' }, children: ['Panel A'] }, { c: 'SegPanel', p: { value: 'b' }, children: ['Panel B'] }] } }),
    };
    const spec = generateComponentSpec('Seg', options(files));
    // In the selected tab (the second), first, along its bottom; the vertical list puts it along the tab's start edge.
    const indicator = spec.parts.find((p) => p.id === 'indicator')!;
    expect(spec.parts.find((p) => p.id === indicator.parent)!.parent).toBe('list');
    expect(spec.parts.filter((p) => p.parent === indicator.parent)[0]!.id).toBe('indicator');
    expect(spec.parts.find((p) => p.characters === 'B')!.parent).toBe(indicator.parent);
    expect(indicator.pin).toEqual({ right: 0, bottom: 0, left: 0 });
    const vertical = spec.variants.find((v) => v.props.Orientation === 'vertical')!;
    expect(vertical.pins).toEqual({ indicator: { top: 0, bottom: 0, left: 0 } });
    expect(vertical.layout!.list!.direction).toBe('VERTICAL');
    // Only the selected panel is drawn.
    expect(spec.parts.filter((p) => p.kind === 'text').map((p) => p.characters)).toEqual(['A', 'B', 'Panel B']);
  });

  it('a slider: value from a spread, thumb at the value, the range as tall as its track, the value render function called', () => {
    const files = {
      'c/Range/Range.tsx': `import { Slider as BaseSlider } from '@base-ui/react/slider';
import styles from './Range.module.css';
export interface RangeProps { defaultValue?: number; min?: number; max?: number }
export const Range = forwardRef(function Range({ ...rest }, ref) {
  const count = Array.isArray(rest.defaultValue) ? rest.defaultValue.length : 1;
  return <BaseSlider.Root className={styles.root} {...rest}><BaseSlider.Control className={styles.control}><BaseSlider.Track className={styles.track}>
    <BaseSlider.Indicator className={styles.range} />{Array.from({ length: count }, (_, i) => <BaseSlider.Thumb key={i} className={styles.thumb} />)}
  </BaseSlider.Track></BaseSlider.Control><BaseSlider.Value className={styles.value}>{(formatted) => formatted.join(' to ')}</BaseSlider.Value></BaseSlider.Root>;
});`,
      'c/Range/Range.module.css': `.root { display: flex; gap: var(--space-2); } .control { display: flex; flex: 1; } .track { position: relative; width: 100%; height: var(--space-1); background-color: var(--color-line); }
.range { background-color: var(--color-mark); } .thumb { width: var(--size-4); height: var(--size-4); background-color: var(--color-thumb); } .value { color: var(--color-fg); }`,
      'c/Range/Range.docs.json': JSON.stringify({ preview: { c: 'Range', p: { defaultValue: 30, min: 20, max: 60 } } }),
    };
    const spec = generateComponentSpec('Range', options(files));
    expect(spec.parts.find((p) => p.id === 'range')).toMatchObject({ fraction: 0.25, stretch: { height: true } });
    expect(spec.parts.find((p) => p.id === 'thumb')).toMatchObject({ at: 0.25 });
    expect(spec.parts.find((p) => p.parent === 'value')).toMatchObject({ kind: 'text', characters: '30' });
    expect(spec.example).toEqual({ c: 'Range', p: { defaultValue: 30, min: 20, max: 60 } });
  });

  it('tables: rows of cells, cells sharing their row, middle-aligned, a custom property reset to initial leaves the width unset', () => {
    const files = {
      'c/Grid2/Grid2.tsx': `import styles from './Grid2.module.css';
export interface Grid2Props { children?: ReactNode }
export const Grid2 = forwardRef(function Grid2(props, ref) {
  return <table className={styles.table}><tbody><tr><td className={styles.cell}>Token</td><td className={cx(styles.cell, styles.num)}>12</td></tr></tbody></table>;
});`,
      'c/Grid2/Grid2.module.css': `.table { --_w: initial; width: 100%; background-color: var(--color-bg); } .cell { width: var(--_w); height: var(--size-6); padding: 0 var(--space-2); color: var(--color-fg); } .num { text-align: end; }`,
    };
    const spec = generateComponentSpec('Grid2', options(files));
    // The unstyled tbody adds nothing: merged into the table, the row sits in it.
    const tr = spec.parts.find((p) => p.parent === 'root')!;
    expect(tr.layout).toEqual({ direction: 'HORIZONTAL', primary: 'MIN', counter: 'STRETCH' });
    const cells = spec.parts.filter((p) => p.parent === tr.id);
    expect(cells.map((c) => [c.grow, c.layout!.primary, c.layout!.counter])).toEqual([
      [true, 'CENTER', 'MIN'],
      [true, 'CENTER', 'MAX'],
    ]);
    expect(spec.unmapped.filter((u) => u.property === 'width' && u.part !== 'root')).toEqual([]);
  });

  it('forms: errors reach the field of the same name; an error message without match is drawn only then; a typed value is drawn', () => {
    const files = {
      'c/Box/Box.tsx': `import { Form as BaseForm } from '@base-ui/react/form';
import styles from './Box.module.css';
export interface BoxProps { errors?: Record<string, string>; title?: (n: number) => ReactNode; children?: ReactNode }
const defaultTitle = (n: number) => (n === 1 ? 'Fix 1 field' : \`Fix \${n} fields\`);
export const Box = forwardRef(function Box({ errors, title = defaultTitle, children }, ref) {
  const entries = Object.entries(errors ?? {}).flatMap(([name, msg]) => (Array.isArray(msg) ? msg : [msg]).map((m) => [name, m]));
  return <BaseForm errors={errors} className={styles.form}>{entries.length > 0 && <p className={styles.summary}>{title(entries.length)}</p>}{children}</BaseForm>;
});`,
      'c/Box/Box.module.css': `.form { display: flex; flex-direction: column; gap: var(--space-2); } .summary { margin: 0; color: var(--color-danger); background-color: var(--color-bg); }`,
      'c/Fld/Fld.tsx': `import { Field as BaseField } from '@base-ui/react/field';
import styles from './Fld.module.css';
export interface FldProps { name?: string; error?: ReactNode; children?: ReactNode }
export const Fld = forwardRef(function Fld({ name, error, children }, ref) {
  return <BaseField.Root name={name} className={styles.field}>{children}{error ? <BaseField.Error match className={styles.error}>{error}</BaseField.Error> : <BaseField.Error className={styles.error} />}</BaseField.Root>;
});`,
      'c/Fld/Fld.module.css': `.field { display: flex; flex-direction: column; } .error { display: flex; gap: var(--space-1); color: var(--color-danger); }`,
      'c/Txt/Txt.tsx': `import styles from './Txt.module.css';
export interface TxtProps { defaultValue?: string }
export const Txt = forwardRef(function Txt({ ...rest }, ref) { return <input className={styles.input} {...rest} />; });`,
      'c/Txt/Txt.module.css': `.input { padding: var(--space-1); color: var(--color-fg); background-color: var(--color-bg); } .input::placeholder { color: var(--color-muted); }`,
      'c/Box/Box.docs.json': JSON.stringify({ preview: { c: 'Box', p: { errors: { repo: 'Not found.' } }, children: [{ c: 'Fld', p: { name: 'repo' }, children: [{ c: 'Txt', p: { defaultValue: 'acme/tokens' } }] }] } }),
    };
    const spec = generateComponentSpec('Box', options(files));
    expect(spec.parts.filter((p) => p.kind === 'text').map((p) => p.characters)).toEqual(['Fix 1 field', 'acme/tokens', 'Not found.']);
    expect(spec.variants[0]!.values[spec.parts.find((p) => p.characters === 'acme/tokens')!.id]).toMatchObject({ textFill: 'color.fg' });
    // Alone, with no error, the field draws no empty error layer.
    expect(generateComponentSpec('Fld', options(files)).parts.some((p) => p.id.startsWith('error'))).toBe(false);
  });

  it('values: string and list methods, helpers returning elements, plain modules, React text spacing, screen reader text left out', () => {
    const files = {
      'c/Tok/Tok.tsx': `import { Fragment } from 'react';
import { pick } from '../../utils/pick';
import { VisuallyHidden } from '../VisuallyHidden';
import styles from './Tok.module.css';
export interface TokProps { value: string; name?: string }
export function dots(text: string) {
  const parts = text.split('.');
  if (parts.length < 2) return text;
  return parts.map((p, i) => <Fragment key={i}>{p}{i < parts.length - 1 && <>.<wbr /></>}</Fragment>);
}
export const Tok = forwardRef(function Tok({ value, name }, ref) {
  return <span className={styles.root}><span className={styles.value}><VisuallyHidden>Value: </VisuallyHidden>{dots(value)}</span>{pick(value) && <span className={styles.badge}>Page {value.length} of {pick(value)}</span>}{name && <span className={styles.name}>{name}</span>}</span>;
});`,
      'c/Tok/Tok.module.css': `.root { display: flex; gap: var(--space-1); color: var(--color-fg); } .badge { color: var(--color-muted); }`,
      'c/VisuallyHidden/VisuallyHidden.tsx': `import styles from './VisuallyHidden.module.css';
export interface VisuallyHiddenProps { children?: ReactNode }
export function VisuallyHidden({ ...rest }) { return <span className={styles.hidden} {...rest} />; }`,
      'c/VisuallyHidden/VisuallyHidden.module.css': `.hidden { position: absolute; clip-path: inset(50%); }`,
      'utils/pick.ts': `export function pick(v: string): number { return v.split('.').length * 10; }`,
      'c/Tok/Tok.docs.json': JSON.stringify({ preview: { c: 'Tok', p: { value: 'color.action.bg', name: 'brand' } } }),
    };
    const spec = generateComponentSpec('Tok', options(files));
    expect(spec.parts.filter((p) => p.kind === 'text').map((p) => p.characters)).toEqual(['color.action.bg', 'Page 15 of 30', 'brand']);
    // An optional text the example gives is drawn with it, shown by default.
    expect(spec.properties).toContainEqual({ name: 'Show name', type: 'BOOLEAN', default: true, prop: 'name' });
    expect(spec.example).toEqual({ c: 'Tok', p: { value: 'color.action.bg', name: 'brand' } });
    expect(jsxText('\n  Page ')).toBe('Page ');
    expect(jsxText(' of ')).toBe(' of ');
    expect(jsxText('\n   \n')).toBe('');
    expect(jsxText('a\n  b')).toBe('a b');
  });

  it('specs drafted with Claude: loaded where the generator cannot read, validated against the tokens, never counted as generated, stale once the code changes', () => {
    const tsx = `export function Pop() { return null; }\nexport function usePop() { return null; }`;
    const draft = {
      source: 'drafted',
      files: ['c/Pop/Pop.tsx'],
      reason: 'is shown from a hook or a provider, not placed as a component',
      name: 'Pop',
      axes: [{ name: 'Tone', prop: 'tone', values: ['quiet', 'loud'], default: 'quiet' }],
      properties: [{ name: 'Title', type: 'TEXT', default: 'Saved', prop: 'title' }],
      parts: [
        { id: 'root', name: 'Pop', kind: 'frame', layout: { direction: 'HORIZONTAL', primary: 'MIN', counter: 'CENTER' } },
        { id: 'title', name: 'Title', kind: 'text', parent: 'root', text: 'Title' },
      ],
      variants: ['quiet', 'loud'].map((tone) => ({ props: { Tone: tone }, values: { root: { fill: tone === 'loud' ? 'color.danger' : 'color.bg', paddingLeft: 'space.2' }, title: { textFill: 'color.fg' } } })),
      unmapped: [],
    };
    const files = { 'c/Pop/Pop.tsx': tsx, 'c/Pop/Pop.module.css': '.pop { color: var(--color-fg); }', 'component-spec-overrides/Pop.json': JSON.stringify({ ...draft, codeHash: '' }) };
    const opts = (f: Record<string, string>) => options(f, { overridesDir: 'component-spec-overrides' });
    files['component-spec-overrides/Pop.json'] = JSON.stringify({ ...draft, codeHash: draftedCodeHash(['c/Pop/Pop.tsx'], (p) => (files as Record<string, string>)[p]) });
    const file = generateAllComponentSpecs(['Pop'], opts(files));
    expect(file.coverage).toEqual([{ name: 'Pop', status: 'drafted', reason: 'is shown from a hook or a provider, not placed as a component' }]);
    const spec = file.components[0]!;
    expect(spec.drafted).toEqual({ reason: 'is shown from a hook or a provider, not placed as a component' });
    expect(spec.source).toEqual(['c/Pop/Pop.tsx']);
    expect(spec.hash).toMatch(/^[0-9a-f]{8}$/);
    // The fidelity check renders it like a generated set: the variant's props and texts.
    expect(planReference(spec, spec.variants[1]!)).toEqual({ ok: true, render: { component: 'Pop', props: { tone: 'loud', title: 'Saved' } } });
    // The code changed since it was drafted: kept, marked stale.
    const changed = generateAllComponentSpecs(['Pop'], opts({ ...files, 'c/Pop/Pop.tsx': `${tsx}\n// changed` }));
    expect(changed.components[0]!.drafted).toEqual({ reason: draft.reason, stale: true });
    // A draft that does not match the format, or names a token that does not exist, fails the generation.
    const bad = { ...draft, variants: [{ ...draft.variants[0]!, values: { root: { fill: 'color.nope' } } }] };
    expect(() => generateAllComponentSpecs(['Pop'], opts({ ...files, 'component-spec-overrides/Pop.json': JSON.stringify(bad) }))).toThrow(/1 variants for 2 combinations[\s\S]*color\.nope is not a token/);
    expect(() => generateAllComponentSpecs(['Pop'], opts({ ...files, 'component-spec-overrides/Pop.json': JSON.stringify({ ...draft, source: 'generated' }) }))).toThrow(/"source": "drafted"/);
  });

  it('the format check: one root, known parents and properties, a variant per axis combination, fields and token types', () => {
    const base: Omit<ComponentSpec, 'hash'> = {
      name: 'X',
      source: [],
      axes: [{ name: 'Size', prop: 'size', values: ['sm', 'md'], default: 'md' }],
      properties: [{ name: 'Show icon', type: 'BOOLEAN', default: false }],
      parts: [
        { id: 'root', name: 'X', kind: 'frame' },
        { id: 'icon', name: 'Icon', kind: 'icon', parent: 'root', visible: 'Show icon' },
      ],
      variants: [
        { props: { Size: 'sm' }, values: { root: { width: 'size.4' } } },
        { props: { Size: 'md' }, values: { root: { width: 'size.6', fill: null } } },
      ],
      unmapped: [],
    };
    const types = new Map([['size.4', 'dimension'], ['size.6', 'dimension'], ['color.bg', 'color']]);
    expect(validateComponentSpec(base, types)).toEqual([]);
    const problems = validateComponentSpec(
      {
        ...base,
        parts: [...base.parts, { id: 'label', name: 'Label', kind: 'text', parent: 'ghost' }],
        variants: [{ props: { Size: 'lg' }, values: { root: { width: 'color.bg', paddingTop: null }, nope: {} }, hidden: ['missing'] }],
      },
      types,
    );
    expect(problems).toEqual([
      'X: part label: parent "ghost" is not a part listed before it',
      'X: part label: a text part needs a TEXT property or its characters',
      'X: variants: 1 variants for 2 combinations of the axes',
      'X: variant Size=lg: Size is not one of its values',
      'X: variant Size=lg, root: color.bg is a color token, width needs dimension or number',
      'X: variant Size=lg, root: paddingTop cannot be empty (only colors can be none)',
      'X: variant Size=lg: values for "nope", which is not a part',
      'X: variant Size=lg: hides "missing", which is not a part',
    ]);
  });
});
