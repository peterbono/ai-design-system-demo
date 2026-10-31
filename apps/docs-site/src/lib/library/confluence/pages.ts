// The Library's doc pages as plain document models (render.ts turns one into Confluence HTML or Markdown): every
// component page, the token pages of Foundations, Accessibility and All tokens, and an index. Built from the same
// LibraryData the Library views render (components/ds/library/views/), with the same groups, titles and notes, so a
// copy says what the page says. Live parts become text: a preview is its code and a "See it live in Bridge" link, a
// swatch is a hex (and a painted cell). Pure and browser-safe.
import { storybookManagerUrl, type ExampleNode } from '@bridge-ds/core';
import { buildGroups, combos as makeCombos, resultFor, shortName, statusLabel, statusOf } from '../../a11y-checks';
import { allTokenRows, ALL_TYPE_LABEL, ALL_TYPE_ORDER } from '../../all-tokens';
import { groupTitle } from '../../library-rows';
import { mdTitleText } from '../../markdown';
import { contrastPairs } from '../contrast';
import { componentNotes, exampleCode, mainStory, readableDocs, STATUS_LABEL, statusOf as componentStatus } from '../component-page';
import { loadComponents, playgroundSpec, type ComponentInfo } from '../components';
import { foundationRow, groupRows, primitiveRows, type FoundationRow } from '../foundations';
import { colorRamps, tokenAxes, tokenRows } from '../tokens';
import { componentHref, pageHref, type LibraryData } from '../../../components/ds/library/library-data';
import { COLOR_PAGE } from '../../../components/ds/library/views/ColorView';
import { TYPOGRAPHY_PAGE, TYPE_LEADING, TYPE_STEPS, TYPE_WEIGHTS } from '../../../components/ds/library/views/TypographyView';
import { SPACING_PAGE } from '../../../components/ds/library/views/SpacingView';
import { RADIUS_PAGE } from '../../../components/ds/library/views/RadiusView';
import { ELEVATION_PAGE } from '../../../components/ds/library/views/ElevationView';
import { ACCESSIBILITY_PAGE } from '../../../components/ds/library/views/AccessibilityView';
import { ALL_TOKENS_PAGE } from '../../../components/ds/library/views/AllTokensView';
import type { Block, Cell, DocPage, Inline, Rich } from './render';

const code = (text: string) => ({ text, code: true });
const link = (text: string, href: string) => ({ text, href });
const LIVE = 'See it live in Bridge';

// ------------------------------------------------------------------------------------------------------------- tokens

/**
 * A color value per theme as text and as a swatch: an opaque color reads as its hex and paints the cell; a translucent
 * one reads as its CSS value and paints nothing (an opaque swatch would mislead).
 */
function colorValues(data: LibraryData, path: string): { light: ColorValue; dark: ColorValue } {
  const { all, primitives } = tokenRows(data.model);
  const sem = all.find((t) => t.path === path);
  const prim = primitives.find((p) => p.path === path);
  const of = (m: { css: string; hex?: string } | undefined): ColorValue => {
    const css = m?.css ?? '';
    const opaque = Boolean(m?.hex) && (/^#[0-9a-f]{6}$/i.test(css) || css.toLowerCase() === m!.hex!.toLowerCase());
    return opaque ? { text: m!.hex!.toLowerCase(), swatch: m!.hex!.toLowerCase() } : { text: css };
  };
  if (sem) return { light: of(sem.modes.light), dark: of(sem.modes.dark) };
  return { light: of(prim), dark: of(prim) };
}
interface ColorValue {
  text: string;
  swatch?: string;
}
const swatchCell = (v: ColorValue): Cell => ({ text: '', ...(v.swatch ? { swatch: v.swatch } : {}) });

const valueOf = (r: FoundationRow) => (r.values.light === r.values.dark ? r.values.light : `${r.values.light} (light), ${r.values.dark} (dark)`);
const describe = (r: FoundationRow) => [r.role, r.alias ? `Alias: ${r.alias}.` : ''].filter(Boolean).join(' ');

/**
 * A token table. Colors: the hex per theme beside a painted swatch cell (Confluence keeps the background, or the cell
 * stays empty and the hex still reads). Anything else: the CSS variable and the value.
 */
export function tokenTable(data: LibraryData, rows: FoundationRow[]): Block {
  const colors = rows.length > 0 && rows.every((r) => r.type === 'color');
  if (colors) {
    return {
      kind: 'table',
      head: ['Token', 'Light', 'Swatch', 'Dark', 'Swatch', 'Description'],
      rows: rows.map((r) => {
        const v = colorValues(data, r.path);
        return [[code(r.path)], [code(v.light.text || r.values.light)], swatchCell(v.light), [code(v.dark.text || r.values.dark)], swatchCell(v.dark), describe(r)];
      }),
    };
  }
  return {
    kind: 'table',
    head: ['Token', 'CSS variable', 'Value', 'Description'],
    rows: rows.map((r) => [[code(r.path)], [code(`var(${r.cssVar})`)], [code(valueOf(r))], describe(r)]),
  };
}

const section = (title: string, note: string | undefined, table: Block | null): Block[] =>
  table && table.kind === 'table' && table.rows.length === 0 ? [] : [{ kind: 'heading', level: 2, text: title }, ...(note ? [{ kind: 'paragraph', text: note } as Block] : []), ...(table ? [table] : [])];

const CSS_VAR_NOTE: Block = {
  kind: 'paragraph',
  text: ['In code, a token is a CSS variable: its path with dots as dashes, for example ', code('var(--color-bg-default)'), '.'],
};

function colorPage(data: LibraryData): DocPage {
  const { model } = data;
  const colors = tokenRows(model).semantic.filter((s) => s.type === 'color');
  const groups = [...new Set(colors.map((s) => s.group))];
  const blocks: Block[] = [CSS_VAR_NOTE];
  for (const g of groups) {
    const rows = groupRows(model, g).filter((r) => r.type === 'color');
    if (rows.length) blocks.push(...section(groupTitle(g), data.extras.groupNotes?.[g], tokenTable(data, rows)));
  }
  blocks.push(
    { kind: 'heading', level: 2, text: 'Primitive palette' },
    { kind: 'paragraph', text: 'Raw values. Components never use these directly; semantic tokens point to them. Use them when you propose a new semantic token, not when you design a screen.' },
  );
  for (const { hue, steps } of colorRamps(model)) {
    blocks.push({ kind: 'heading', level: 3, text: hue });
    blocks.push({
      kind: 'table',
      head: ['Step', 'Value', 'Swatch', 'CSS variable'],
      rows: steps.map((p) => {
        const v = colorValues(data, p.path).light;
        return [[code(p.path)], [code(v.text)], swatchCell(v), [code(`var(${p.cssVar})`)]];
      }),
    });
  }
  return { route: pageHref(data, 'foundations/color/'), title: COLOR_PAGE.title, summary: COLOR_PAGE.lead, blocks };
}

const withRole = (rows: FoundationRow[], roles: Record<string, string>) => rows.map((r) => ({ ...r, role: r.role || roles[r.path] || '' }));

function typographyPage(data: LibraryData): DocPage {
  const { model } = data;
  const sizes = [...primitiveRows(model, 'font.size')].reverse();
  const sizeRows = withRole(sizes, Object.fromEntries(sizes.map((r) => [r.path, TYPE_STEPS[r.path.split('.').pop()!] ? `${TYPE_STEPS[r.path.split('.').pop()!]!.role}.` : ''])));
  const families = [...groupRows(model, 'font.family'), ...primitiveRows(model, 'font.family')];
  return {
    route: pageHref(data, 'foundations/typography/'),
    title: TYPOGRAPHY_PAGE.title,
    summary: data.team ? TYPOGRAPHY_PAGE.teamLead : TYPOGRAPHY_PAGE.lead,
    blocks: [
      ...section('Type scale', 'Each step at its size, with the line height and tracking it pairs with.', tokenTable(data, sizeRows)),
      ...section('Weights', undefined, tokenTable(data, withRole(primitiveRows(model, 'font.weight'), TYPE_WEIGHTS))),
      ...section('Line heights', undefined, tokenTable(data, withRole(primitiveRows(model, 'font.line-height'), TYPE_LEADING))),
      ...section('Tracking', 'Tighter as type gets bigger, slightly open at caption size. Values are in em, so they scale with the text.', tokenTable(data, primitiveRows(model, 'font.tracking'))),
      ...section('Families', 'Brands pick their faces through the font roles font.family.display, font.family.sans and font.family.mono.', tokenTable(data, families)),
    ],
  };
}

const DENSITY = ['layout.inset', 'layout.gap', 'control.gap', 'control.padding-x.sm', 'control.padding-x.md', 'control.padding-x.lg', 'table.cell-padding-x'];

function spacingPage(data: LibraryData): DocPage {
  const { model } = data;
  const num = (css: string) => parseFloat(css) || 0;
  const known = new Set([...tokenRows(model).all, ...tokenRows(model).primitives].map((t) => t.path));
  const density = DENSITY.filter((p) => known.has(p)).map((p) => foundationRow(model, p));
  const steps = primitiveRows(model, 'space').sort((a, b) => num(a.values.light) - num(b.values.light));
  return {
    route: pageHref(data, 'foundations/spacing/'),
    title: SPACING_PAGE.title,
    summary: data.team ? SPACING_PAGE.teamLead : SPACING_PAGE.lead,
    blocks: [
      ...section('Density spacing', 'Card padding, the gap between blocks and the gap inside a row of controls come from density tokens: Compact tightens them.', tokenTable(data, density)),
      ...section('Scale', 'Inside a control: space 2 to 4. Between related items: space 1 to 3. Inside a card or panel: space 4 to 5. Between sections: space 8 and up.', tokenTable(data, steps)),
    ],
  };
}

function radiusPage(data: LibraryData): DocPage {
  const { model } = data;
  return {
    route: pageHref(data, 'foundations/radius/'),
    title: RADIUS_PAGE.title,
    summary: RADIUS_PAGE.lead,
    blocks: [
      ...section('Radius roles', 'Nested corners stay concentric: outer = inner + padding.', tokenTable(data, groupRows(model, 'radius'))),
      ...section('Radius scale', 'The raw values the roles point to. Reach for a role first; use the scale when you propose a new one.', tokenTable(data, primitiveRows(model, 'radius'))),
      ...section('Border widths', '1 px for edges, 2 px for emphasis, selected states and active indicators.', tokenTable(data, [...groupRows(model, 'border-width'), ...primitiveRows(model, 'border.width')])),
      ...section('Focus ring', 'Every focusable component draws the same ring, so keyboard users always know where they are. Its color is on the Color page.', tokenTable(data, groupRows(model, 'focus').filter((r) => r.type !== 'color'))),
    ],
  };
}

function elevationPage(data: LibraryData): DocPage {
  const { model } = data;
  return {
    route: pageHref(data, 'foundations/elevation/'),
    title: ELEVATION_PAGE.title,
    summary: ELEVATION_PAGE.lead,
    blocks: [
      ...section('Levels', data.extras.groupNotes?.elevation, tokenTable(data, groupRows(model, 'elevation'))),
      ...section('Shadow primitives', 'The raw two-layer shadows. The dark variants exist because a light shadow disappears on a dark surface.', tokenTable(data, primitiveRows(model, 'shadow'))),
    ],
  };
}

function accessibilityPage(data: LibraryData): DocPage {
  const { model } = data;
  const { brands, modes, brandLabels } = tokenAxes(model);
  const list = makeCombos(brands, modes, brandLabels);
  const groups = buildGroups(contrastPairs(model), list);
  const blocks: Block[] = [
    { kind: 'paragraph', text: 'Each pair is a foreground token on a background token, with its contrast ratio in every brand and theme. AAA: text at 7:1 or more. AA: meets the pair\'s minimum. Fails: below the minimum.' },
  ];
  for (const g of groups) {
    blocks.push({ kind: 'heading', level: 2, text: g.label });
    blocks.push({
      kind: 'table',
      head: ['Pair', 'Minimum', ...list.map((c) => c.label)],
      rows: g.pairs.map((p) => [
        [code(shortName(p.fg)), ' on ', code(shortName(p.bg))],
        `${p.min}:1`,
        ...list.map((c) => {
          const r = resultFor(p, c);
          return `${r.ratio.toFixed(2)}:1, ${statusLabel(statusOf(r), p.min)}`;
        }),
      ]),
    });
  }
  return { route: pageHref(data, 'foundations/accessibility/'), title: ACCESSIBILITY_PAGE.title, summary: ACCESSIBILITY_PAGE.lead, blocks };
}

function allTokensPage(data: LibraryData): DocPage {
  const rows = allTokenRows(tokenRows(data.model).all);
  const blocks: Block[] = [CSS_VAR_NOTE];
  for (const type of ALL_TYPE_ORDER) {
    const list = rows.filter((r) => r.type === type);
    if (!list.length) continue;
    blocks.push({ kind: 'heading', level: 2, text: ALL_TYPE_LABEL[type] });
    if (type === 'color') {
      blocks.push({
        kind: 'table',
        head: ['Token', 'Light', 'Swatch', 'Dark', 'Swatch', 'Description'],
        rows: list.map((r) => {
          const v = colorValues(data, r.path);
          return [[code(r.path)], [code(v.light.text)], swatchCell(v.light), [code(v.dark.text)], swatchCell(v.dark), r.description];
        }),
      });
    } else {
      blocks.push({
        kind: 'table',
        head: ['Token', 'Light', 'Dark', 'Description'],
        rows: list.map((r) => [[code(r.path)], [code(r.light.css)], [code(r.dark.css)], r.description]),
      });
    }
  }
  const version = data.extras.version;
  return {
    route: pageHref(data, 'tokens/'),
    title: ALL_TOKENS_PAGE.title,
    summary: version ? `Every semantic token in the latest release, ${version}, with its light and dark value.` : 'Every semantic token with its light and dark value.',
    blocks,
  };
}

// --------------------------------------------------------------------------------------------------------- components

const attr = (k: string, v: unknown) => (v === true ? k : typeof v === 'string' ? `${k}="${v.replace(/"/g, '&quot;')}"` : `${k}={${JSON.stringify(v)}}`);

/** A docs.json example as the JSX it stands for, indented two spaces per level. */
export function exampleJsx(node: ExampleNode | undefined, depth = 0): string {
  const pad = '  '.repeat(depth);
  if (node === undefined || node === null) return '';
  if (typeof node === 'string') return `${pad}${node}`;
  const props = Object.entries(node.p ?? {})
    .filter(([, v]) => v !== false && v !== undefined && v !== null)
    .map(([k, v]) => ` ${attr(k, v)}`)
    .join('');
  const kids = node.children ?? [];
  if (!kids.length) return `${pad}<${node.c}${props} />`;
  if (kids.length === 1 && typeof kids[0] === 'string') return `${pad}<${node.c}${props}>${kids[0]}</${node.c}>`;
  return [`${pad}<${node.c}${props}>`, ...kids.map((k) => exampleJsx(k, depth + 1)), `${pad}</${node.c}>`].join('\n');
}

export function componentDocPage(data: LibraryData, c: ComponentInfo): DocPage {
  const d = readableDocs(c.docs);
  const route = componentHref(data, c.slug);
  const story = mainStory(c);
  const storybook = data.extras.storybook;
  const blocks: Block[] = [];
  const resources: Inline[] = [`Status: ${STATUS_LABEL[componentStatus(c)]}. Family: ${c.category}. `, link(LIVE, route)];
  if (storybook && story) resources.push('. ', link('Open in Storybook', storybookManagerUrl(storybook, story.id)));
  resources.push('.');
  blocks.push({ kind: 'paragraph', text: resources });

  const example = d?.preview ? exampleJsx(d.preview) : exampleCode(c.name, playgroundSpec(c)?.children);
  blocks.push({ kind: 'heading', level: 2, text: 'Example' }, { kind: 'code', code: example, lang: 'tsx' }, { kind: 'paragraph', text: [link(LIVE, route), ', rendered with the real component in light and dark.'] });

  if (!d) {
    blocks.push({ kind: 'paragraph', text: ['No usage guidance yet. Props and tokens below are generated from the code.'] });
  } else {
    if (d.whenToUse.length + d.whenNotToUse.length) {
      blocks.push({ kind: 'heading', level: 2, text: 'When to use' });
      if (d.whenToUse.length) blocks.push({ kind: 'heading', level: 3, text: 'Use it for' }, { kind: 'list', items: d.whenToUse });
      if (d.whenNotToUse.length) blocks.push({ kind: 'heading', level: 3, text: 'Not for' }, { kind: 'list', items: d.whenNotToUse });
    }
    if (d.dos.length + d.donts.length) {
      blocks.push({ kind: 'heading', level: 2, text: "Do and don't" });
      for (const [label, list] of [['Do', d.dos], ["Don't", d.donts]] as const) {
        for (const g of list) {
          blocks.push({ kind: 'heading', level: 3, text: `${label}: ${g.title}` }, { kind: 'paragraph', text: g.text });
          if (g.example) blocks.push({ kind: 'code', code: exampleJsx(g.example), lang: 'tsx' });
        }
      }
    }
    if (d.accessibility.length) blocks.push({ kind: 'heading', level: 2, text: 'Accessibility' }, { kind: 'list', items: d.accessibility });
    if (d.contentGuidelines?.length) blocks.push({ kind: 'heading', level: 2, text: 'Content guidelines' }, { kind: 'list', items: d.contentGuidelines });
  }

  blocks.push({ kind: 'heading', level: 2, text: 'Props' });
  const inherits: Inline[] = c.inherits ? [' It also accepts every native ', code(`<${c.inherits}>`), ' attribute', ...(c.omitted.length ? [' except ', code(c.omitted.join(', '))] : []), '.'] : [];
  blocks.push({ kind: 'paragraph', text: ['Parsed from the TypeScript types, so this table cannot drift from the code.', ...inherits] });
  if (c.props.length) {
    blocks.push({
      kind: 'table',
      head: ['Prop', 'Type', 'Default', 'Required', 'Description'],
      rows: c.props.map((p) => [[code(p.name)], [code(p.type)], p.defaultValue ? [code(p.defaultValue)] : '', p.required ? 'Yes' : 'No', p.description ?? '']),
    });
  } else {
    blocks.push({ kind: 'paragraph', text: `No props of its own.${c.description ? ` ${c.description}` : ''}` });
  }
  if (c.subcomponents.length) blocks.push({ kind: 'paragraph', text: ['Parts: ', ...c.subcomponents.flatMap((s, i) => [...(i ? [', '] : []), code(s)]), '.'] });

  if (c.rules.length) {
    blocks.push({ kind: 'heading', level: 2, text: 'Anatomy and tokens' });
    blocks.push({ kind: 'paragraph', text: 'Read from the component stylesheet. Every value is a token.' });
    blocks.push({
      kind: 'table',
      head: ['Part', 'Selector', 'Tokens'],
      rows: c.rules.map((r) => [r.label, [code(r.selector)], r.vars.flatMap((v, i) => [...(i ? [', '] : []), code(v.path ?? v.name)])]),
    });
    for (const i of c.inherited.filter((x) => x.paths.length)) {
      blocks.push({ kind: 'paragraph', text: [`${c.name} reuses the stylesheet of `, link(i.from, componentHref(data, i.slug)), `, so it also paints with: `, ...i.paths.flatMap((p, n) => [...(n ? [', '] : []), code(p)]), '.'] });
    }
  }

  const notes = componentNotes(c.name, data.extras.releases ?? []);
  if (notes.length) {
    blocks.push({ kind: 'heading', level: 2, text: 'Changelog' });
    blocks.push({ kind: 'list', items: notes.map((n) => `${n.release}${n.date ? ` (${n.date.slice(0, 10)})` : ''}: ${mdTitleText(n.title)}`) });
  }
  return { route, title: c.name, summary: d?.summary || c.description, blocks };
}

// -------------------------------------------------------------------------------------------------------------- index

/** The token and guidance pages, in nav order. */
export function foundationDocPages(data: LibraryData): DocPage[] {
  return [colorPage(data), typographyPage(data), spacingPage(data), radiusPage(data), elevationPage(data), accessibilityPage(data), allTokensPage(data)];
}

/** Every Library doc page: foundations, All tokens, then every component. */
export function libraryDocPages(data: LibraryData): DocPage[] {
  const components = data.model.components ? loadComponents(data.model) : [];
  return [...foundationDocPages(data), ...components.map((c) => componentDocPage(data, c))];
}

/** Where a page goes in the export zip: its route as a Markdown path ("components/button.md"). */
export const exportPath = (page: DocPage): string => `${page.route.replace(/^\/+|\/+$/g, '').replace(/^library\/[^/]+\/[^/]+\//, '') || 'home'}.md`;

/** The export's index page: every page with its file in the zip and its Bridge address. */
export function indexDocPage(data: LibraryData, pages: DocPage[]): DocPage {
  const row = (p: DocPage) => [p.title, [code(exportPath(p))], [link('Open in Bridge', p.route)]] as Rich[];
  const foundations = pages.filter((p) => !p.route.includes('/components/'));
  const components = pages.filter((p) => p.route.includes('/components/'));
  return {
    route: data.team ? pageHref(data, '') : '/library/',
    title: 'Design system docs',
    summary: `Every page of the Library${data.extras.version ? ` at release ${data.extras.version}` : ''}, as Markdown. Bridge stays the source of truth: edit there, then export again.`,
    blocks: [
      { kind: 'heading', level: 2, text: 'Foundations and tokens' },
      { kind: 'table', head: ['Page', 'File', 'In Bridge'], rows: foundations.map(row) },
      { kind: 'heading', level: 2, text: 'Components' },
      { kind: 'table', head: ['Page', 'File', 'In Bridge'], rows: components.map(row) },
    ],
  };
}
