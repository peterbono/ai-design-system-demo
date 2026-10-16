import { buildUsageIndex } from '@bridge/core';
import { describe, expect, it } from 'vitest';
import { selectImpact, storiesFromSource, storyId, type SelectInput } from '../src/select';
import type { StoryEntry } from '../src/types';

const LIB = 'lib';
const DIR = 'lib/components';
const usage = buildUsageIndex(
  [
    { path: `${DIR}/Alert/Alert.tsx`, text: "import { Button } from '../Button';" },
    { path: `${DIR}/Alert/Alert.module.css`, text: '.danger { border-color: var(--color-feedback-danger-border); }' },
    { path: `${DIR}/Button/Button.tsx`, text: "import styles from './Button.module.css';" },
    { path: `${DIR}/Button/Button.module.css`, text: '.danger { background: var(--color-action-danger-bg); }' },
    { path: `${DIR}/Card/Card.module.css`, text: '.root { background: var(--color-surface-raised); }' },
    { path: `${DIR}/Card/Card.stories.tsx`, text: "import { Badge } from '../Badge';" },
    { path: `${DIR}/Badge/Badge.module.css`, text: '.danger { color: var(--color-feedback-danger-text); }' },
    { path: `${DIR}/Tabs/Tabs.module.css`, text: '.root { color: var(--color-text); }' },
    { path: `${LIB}/styles/base.css`, text: 'body { color: var(--color-text); }' },
  ],
  DIR,
);

const story = (component: string, family: string, name: string): StoryEntry => ({
  id: storyId(`${family}/${component}`, name.replace(/ /g, '')),
  title: `${family}/${component}`,
  name,
  importPath: `./${DIR}/${component}/${component}.stories.tsx`,
});
const STORIES: StoryEntry[] = [
  story('Alert', 'Feedback', 'Info'),
  story('Alert', 'Feedback', 'Danger'),
  story('Alert', 'Feedback', 'All States'),
  story('Button', 'Actions', 'Primary'),
  story('Button', 'Actions', 'Danger'),
  story('Button', 'Actions', 'Sizes'),
  story('Button', 'Actions', 'Loading'),
  story('Button', 'Actions', 'Icon Only'),
  story('Button', 'Actions', 'All States'),
  story('Card', 'Layout', 'Default'),
  story('Card', 'Layout', 'All States'),
  story('Badge', 'Data display', 'All States'),
  story('Tabs', 'Navigation', 'All States'),
  { id: 'foundations-colors--palette', title: 'Foundations/Colors', name: 'Palette', importPath: `./${LIB}/stories/Colors.stories.tsx` },
];

const input = (over: Partial<SelectInput>): SelectInput => ({
  files: [],
  tokens: [],
  cssVar: (p) => `--${p.split('.').join('-')}`,
  usage,
  stories: STORIES,
  librarySrc: LIB,
  globalPaths: ['.storybook', 'tokens/build.mjs'],
  appDir: 'apps/admin',
  ...over,
});

describe('impact selection', () => {
  it('maps a changed token to the components that read it, then to their stories, AllStates first', () => {
    const s = selectImpact(input({ tokens: [{ path: 'color.feedback.danger.border', kind: 'direct', modes: ['brand=bridge,theme=light'] }], files: ['tokens/semantic/light.tokens.json'] }));
    expect(s.vars).toEqual(['--color-feedback-danger-border']);
    expect(s.components.map((c) => c.id)).toEqual(['Alert']);
    expect(s.stories).toEqual(['feedback-alert--all-states', 'feedback-alert--info', 'feedback-alert--danger', 'foundations-colors--palette']);
    expect(s.fallback).toBeNull();
    expect(s.app).toEqual({ include: true, reason: '1 token value changed' });
  });

  it('follows "renders": a Button token reaches Alert, which gets only its AllStates story', () => {
    const s = selectImpact(input({ tokens: [{ path: 'color.action.danger.bg', kind: 'alias', modes: [] }] }));
    expect(s.components).toEqual([
      { id: 'Button', reasons: ['uses --color-action-danger-bg'], indirect: false },
      { id: 'Alert', reasons: ['renders Button'], indirect: true },
    ]);
    // Button: capped at 4, AllStates first. Alert: AllStates only.
    expect(s.stories.slice(0, 5)).toEqual(['actions-button--all-states', 'actions-button--primary', 'actions-button--danger', 'actions-button--sizes', 'feedback-alert--all-states']);
  });

  it('includes stories that render an impacted component (Card story with a Badge)', () => {
    const s = selectImpact(input({ tokens: [{ path: 'color.feedback.danger.text', kind: 'direct', modes: [] }] }));
    expect(s.components.map((c) => [c.id, c.reasons[0]])).toEqual([
      ['Badge', 'uses --color-feedback-danger-text'],
      ['Card', 'story renders Badge'],
    ]);
    expect(s.stories).toContain('layout-card--all-states');
    expect(s.stories).not.toContain('layout-card--default');
  });

  it('maps changed component files to their stories; tests and docs do not count', () => {
    const s = selectImpact(input({ files: [`${DIR}/Tabs/Tabs.module.css`, `${DIR}/Card/Card.test.tsx`, `${DIR}/Card/Card.docs.json`] }));
    expect(s.components.map((c) => c.id)).toEqual(['Tabs']);
    expect(s.stories).toEqual(['navigation-tabs--all-states']);
    expect(s.app.reason).toBe('Component code changed');
  });

  it('falls back to every AllStates story when shared code, global config or global styles change', () => {
    const allStates = STORIES.filter((x) => x.id.endsWith('--all-states')).map((x) => x.id);
    const shared = selectImpact(input({ files: [`${LIB}/theme/ThemeProvider.tsx`] }));
    expect(shared.fallback).toMatch(/Shared library code changed \(lib\/theme\/ThemeProvider.tsx\)/);
    expect(shared.stories).toEqual(allStates);
    expect(selectImpact(input({ files: ['.storybook/preview.tsx'] })).fallback).toMatch(/^\.storybook\/preview.tsx changed/);
    const global = selectImpact(input({ tokens: [{ path: 'color.text', kind: 'direct', modes: [] }] }));
    expect(global.fallback).toMatch(/lib\/styles\/base.css reads changed tokens \(--color-text\)/);
    expect(global.stories).toEqual(expect.arrayContaining(allStates));
  });

  it('selects nothing for a docs-only change, and the app only for app code', () => {
    const none = selectImpact(input({ files: ['README.md', 'docs/AI.md', `${DIR}/Alert/Alert.docs.json`] }));
    expect(none.stories).toEqual([]);
    expect(none.components).toEqual([]);
    expect(none.app.include).toBe(false);
    const app = selectImpact(input({ files: ['apps/admin/src/App.tsx'] }));
    expect(app.stories).toEqual([]);
    expect(app.app).toEqual({ include: true, reason: 'App code changed (apps/admin/src/App.tsx)' });
  });
});

describe('story ids from source', () => {
  it('follows Storybook id rules', () => {
    expect(storyId('Feedback/Alert', 'AllStates')).toBe('feedback-alert--all-states');
    expect(storyId('Data display/Badge', 'WithDot')).toBe('data-display-badge--with-dot');
    expect(storyId('Forms/Checkbox Group', 'SelectAll')).toBe('forms-checkbox-group--select-all');
  });

  it('reads title and named exports from CSF files', () => {
    const s = storiesFromSource([
      { path: `${DIR}/Alert/Alert.stories.tsx`, text: "const meta = { title: 'Feedback/Alert', component: Alert };\nexport default meta;\nexport const Info: Story = {};\nexport const AllStates: Story = { render: () => null };\nexport const helper = 1;" },
      { path: `${DIR}/Nope/Nope.tsx`, text: 'export const X = 1;' },
    ]);
    expect(s.map((x) => x.id)).toEqual(['feedback-alert--info', 'feedback-alert--all-states']);
    expect(s[1]).toMatchObject({ name: 'All States', importPath: `./${DIR}/Alert/Alert.stories.tsx` });
  });
});
