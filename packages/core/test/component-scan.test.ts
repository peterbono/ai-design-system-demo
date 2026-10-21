import assert from 'node:assert/strict';
import { test } from 'vitest';
import { componentSlug, parseComponentCss, parseComponentFamilies, parseComponentStories, parseComponentTsx, scanComponents } from '../src/component-scan';

const TSX = `import styles from './Chip.module.css';
import buttonStyles from '../Button/Button.module.css';

export type ChipTone = 'neutral' | 'accent';

export interface ChipProps extends Omit<React.HTMLAttributes<HTMLSpanElement>, 'color' | 'title'> {
  /** Color role. */
  tone?: ChipTone;
  /** Visible text. */
  label: string;
}

/** A compact label. */
export function Chip({ tone = 'neutral', label, ...rest }: ChipProps) {
  return null;
}

export function ChipGroup() {
  return null;
}
`;

const CSS = `/* chip */
.root { color: var(--color-text-default); padding: var(--_local); }
.root:hover { background: var(--color-bg-muted); }
@media (hover: hover) { .root:focus-visible { outline-color: var(--focus-ring-color); } }
@keyframes spin { to { opacity: var(--color-text-default); } }
.unknown { color: var(--not-a-token); }
`;

const STORIES = `const meta = { title: 'Data display/Chip' };
export const Default: Story = {};
export const AllStates: Story = {};
`;

const TOKENS: Record<string, { path: string; kind: 'semantic' | 'component' }> = {
  '--color-text-default': { path: 'color.text.default', kind: 'semantic' },
  '--color-bg-muted': { path: 'color.bg.muted', kind: 'semantic' },
  '--focus-ring-color': { path: 'focus.ring.color', kind: 'semantic' },
  '--button-bg': { path: 'button.bg', kind: 'component' },
};
const describeVar = (v: string) => (TOKENS[v] ? { ...TOKENS[v]!, href: `/t/${v}` } : undefined);

test('componentSlug kebab-cases component names', () => {
  assert.equal(componentSlug('IconButton'), 'icon-button');
  assert.equal(componentSlug('HTMLView'), 'html-view');
});

test('parseComponentTsx reads props, defaults, JSDoc, the native element and sub-components', () => {
  const out = parseComponentTsx('Chip', TSX);
  assert.deepEqual(out.props, [
    { name: 'label', type: 'string', required: true, description: 'Visible text.' },
    { name: 'tone', type: "'neutral' | 'accent'", required: false, description: 'Color role.', defaultValue: "'neutral'" },
  ]);
  assert.equal(out.inherits, 'span');
  assert.deepEqual(out.omitted, ['color', 'title']);
  assert.deepEqual(out.subcomponents, ['ChipGroup']);
  // The description is the JSDoc right before the component.
  assert.equal(parseComponentTsx('Tag', '/** A small label. */\nexport function Tag() {}').description, 'A small label.');
});

test('parseComponentTsx reads only the JSDoc right before the component, not the one of the props above', () => {
  const src = `/** Props of Tag. */\nexport interface TagProps {\n  /** Visible text. */\n  label: string;\n}\n\n/** A small label. */\nexport function Tag({ label }: TagProps) {}`;
  assert.equal(parseComponentTsx('Tag', src).description, 'A small label.');
  // A plain comment or code right before the component: no description, even with JSDoc higher up.
  assert.equal(parseComponentTsx('Tag', '/** Props. */\ninterface TagProps {}\n/* not docs */\nexport function Tag() {}').description, undefined);
  assert.equal(parseComponentTsx('Tag', '/** Props. */\ninterface TagProps {}\nexport function Tag() {}').description, undefined);
});

test('parseComponentCss maps selectors to tokens, labels states and skips keyframes and runtime vars', () => {
  const rules = parseComponentCss(CSS, { root: 'Container' }, describeVar);
  assert.deepEqual(
    rules.map((r) => [r.selector, r.label, r.vars.map((v) => v.name)]),
    [
      ['.root', 'Container', ['--color-text-default']],
      ['.root:hover', 'Container, hover', ['--color-bg-muted']],
      ['@media (hover: hover) .root:focus-visible', 'Container, focus', ['--focus-ring-color']],
      ['.unknown', 'unknown', ['--not-a-token']],
    ],
  );
  assert.deepEqual(rules[0]!.vars[0], { name: '--color-text-default', href: '/t/--color-text-default', known: true, path: 'color.text.default', kind: 'semantic' });
  assert.equal(rules[3]!.vars[0]!.known, false);
});

test('parseComponentStories derives Storybook ids from the title', () => {
  assert.deepEqual(parseComponentStories(STORIES), [
    { name: 'Default', id: 'data-display-chip--default' },
    { name: 'AllStates', id: 'data-display-chip--all-states' },
  ]);
  assert.deepEqual(parseComponentStories('export const A: Story = {};'), []);
});

test('parseComponentFamilies groups barrel exports under their comment headings', () => {
  const index = `// Actions\nexport * from './components/Button';\nexport * from './hooks/useX';\n// Data display\nexport * from './components/Chip';\n// Empty\n`;
  assert.deepEqual(parseComponentFamilies(index), [
    { name: 'Actions', members: ['Button'] },
    { name: 'Data display', members: ['Chip'] },
  ]);
  assert.deepEqual(parseComponentFamilies(index.replace(/components/g, 'ui')), []);
  assert.deepEqual(parseComponentFamilies(index.replace(/components/g, 'ui'), 'ui')[0], { name: 'Actions', members: ['Button'] });
});

test('scanComponents reads any folder and suffixes, inherits tokens from imported stylesheets and reports bad docs', () => {
  const dir = 'lib/ui';
  const files: Record<string, string> = {
    [`${dir}/Button/Button.tsx`]: 'export function Button() {}',
    [`${dir}/Button/Button.css`]: '.root { background: var(--button-bg); }',
    [`${dir}/Button/Button.guide.json`]: '{ "summary": "Acts", "category": "Actions" }',
    [`${dir}/Chip/Chip.tsx`]: TSX.replace('Button.module.css', 'Button.css'),
    [`${dir}/Chip/Chip.css`]: CSS,
    [`${dir}/Chip/Chip.stories.tsx`]: STORIES,
    [`${dir}/Chip/Chip.guide.json`]: '{ not json',
    [`${dir}/helpers/util.ts`]: '',
  };
  const problems: string[] = [];
  const list = scanComponents({
    dir,
    files: Object.keys(files),
    readText: (p) => files[p],
    indexText: '// Actions\nexport * from \'./ui/Button\';\n',
    indexRel: 'ui',
    docsSuffix: '.guide.json',
    styleSuffix: '.css',
    describeVar,
    problems,
  });
  assert.deepEqual(
    list.map((c) => [c.name, c.category, c.slug]),
    [
      ['Button', 'Actions', 'button'],
      ['Chip', 'Core', 'chip'],
    ],
  );
  const chip = list[1]!;
  assert.deepEqual(chip.files, { tsx: `${dir}/Chip/Chip.tsx`, css: `${dir}/Chip/Chip.css`, stories: `${dir}/Chip/Chip.stories.tsx`, docs: `${dir}/Chip/Chip.guide.json` });
  assert.deepEqual(chip.tokenPaths, ['color.bg.muted', 'color.text.default', 'focus.ring.color']);
  assert.deepEqual(chip.inherited, [{ from: 'Button', slug: 'button', paths: ['button.bg'] }]);
  assert.deepEqual(chip.allTokenPaths, ['button.bg', 'color.bg.muted', 'color.text.default', 'focus.ring.color']);
  assert.equal(chip.stories.length, 2);
  assert.equal(chip.docs, null);
  assert.equal(problems.length, 1);
  assert.match(problems[0]!, /Chip\.guide\.json/);
  assert.ok(!('reuses' in chip));
});
