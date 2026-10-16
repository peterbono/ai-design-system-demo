import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { buildUsageIndex, componentForPath, cssVarsIn, impactedModules, importsIn, tokenUsage } from '../src/usage';

const DIR = 'lib/components';
const files = [
  { path: `${DIR}/Button/Button.tsx`, text: "import styles from './Button.module.css';\nimport { Spinner } from '../Spinner';" },
  { path: `${DIR}/Button/Button.module.css`, text: '.root { background: var(--button-bg); color: var(--button-fg, var(--color-text)); }\n.danger { background: var( --color-danger ); }' },
  { path: `${DIR}/Button/Button.test.tsx`, text: "import { Dialog } from '../Dialog';\nconst s = 'var(--from-test)';" },
  { path: `${DIR}/Spinner/Spinner.tsx`, text: "import styles from './Spinner.module.css';" },
  { path: `${DIR}/Spinner/Spinner.module.css`, text: '.root { border-color: var(--color-accent); }' },
  { path: `${DIR}/Dialog/Dialog.tsx`, text: "import { Button } from '../Button/Button';\nexport { DialogClose } from './parts';" },
  { path: `${DIR}/Dialog/Dialog.module.css`, text: '.root { background: var(--surface-overlay); }' },
  { path: `${DIR}/Dialog/Dialog.stories.tsx`, text: "import { Input } from '../Input';\nimport { Dialog } from './Dialog';" },
  { path: `${DIR}/Input/Input.module.css`, text: '.root { border-color: var(--input-border-invalid); }' },
  { path: `${DIR}/Input/Input.tsx`, text: "const x = import('../Spinner');" },
  { path: 'lib/styles/base.css', text: 'body { background: var(--color-bg); color: var(--color-text); }' },
];

describe('usage index', () => {
  it('scans var() references and import specifiers', () => {
    expect(cssVarsIn('a{b:var(--x);c:var( --y , var(--z))}')).toEqual(['--x', '--y', '--z']);
    expect(importsIn("import a from './a';\nexport * from '../b';\nconst c = import('../c');\nimport type { D } from '@x/d';")).toEqual(['./a', '../b', '../c', '@x/d']);
    expect(componentForPath('lib/components/Button/Button.tsx', 'lib/components')).toBe('Button');
    expect(componentForPath('lib/components/index.ts', 'lib/components')).toBeNull();
    expect(componentForPath('lib/styles/base.css', 'lib/components')).toBeNull();
  });

  it('records vars and renders-edges per component, tests excluded, stories kept apart', () => {
    const idx = buildUsageIndex(files, DIR);
    expect(idx.modules.Button!.vars).toEqual(['--button-bg', '--button-fg', '--color-danger', '--color-text']);
    expect(idx.modules.Button!.imports).toEqual(['Spinner']);
    expect(idx.modules.Dialog!.imports).toEqual(['Button']);
    expect(idx.modules.Dialog!.storyImports).toEqual(['Input']);
    expect(idx.modules.Input!.imports).toEqual(['Spinner']);
    expect(idx.byVar['--from-test']).toBeUndefined();
    expect(idx.byVar['--color-text']).toEqual(['Button']);
    expect(idx.globalVars['lib/styles/base.css']).toEqual(['--color-bg', '--color-text']);
  });

  it('closes impact over "renders" and reports global stylesheet hits', () => {
    const idx = buildUsageIndex(files, DIR);
    const r = impactedModules(idx, { vars: ['--color-accent', '--color-text'] });
    expect(r.modules.map((m) => [m.id, m.indirect])).toEqual([
      ['Button', false],
      ['Spinner', false],
      ['Dialog', true],
      ['Input', true],
    ]);
    expect(r.modules.find((m) => m.id === 'Button')!.reasons).toEqual(['uses --color-text', 'renders Spinner']);
    expect(r.globalHits).toEqual([{ file: 'lib/styles/base.css', vars: ['--color-text'] }]);
  });

  it('maps changed files to their component', () => {
    const r = impactedModules(buildUsageIndex(files, DIR), { files: [`${DIR}/Dialog/Dialog.module.css`, 'README.md'] });
    expect(r.modules).toEqual([{ id: 'Dialog', reasons: [`file changed: ${DIR}/Dialog/Dialog.module.css`], indirect: false }]);
  });

  it('indexes this repo: Alert reads the danger feedback tokens', () => {
    const root = join(dirname(fileURLToPath(import.meta.url)), '../../..');
    const lib = join(root, 'packages/react/src');
    const all: { path: string; text: string }[] = [];
    const walk = (d: string) => {
      for (const n of readdirSync(d)) {
        const f = join(d, n);
        if (statSync(f).isDirectory()) walk(f);
        else if (/\.(css|tsx?)$/.test(n)) all.push({ path: relative(root, f), text: readFileSync(f, 'utf8') });
      }
    };
    walk(lib);
    const idx = buildUsageIndex(all, 'packages/react/src/components');
    expect(idx.byVar['--color-feedback-danger-icon']).toContain('Alert');
    expect(impactedModules(idx, { vars: ['--color-feedback-danger-icon'] }).modules.map((m) => m.id)).toContain('Alert');
  });
});

describe('token usage', () => {
  const tokens = [
    { path: 'color.neutral.0', cssVar: '--color-neutral-0', refs: [] },
    { path: 'color.neutral.900', cssVar: '--color-neutral-900', refs: [] },
    { path: 'color.neutral.500', cssVar: '--color-neutral-500', refs: [] },
    { path: 'palette.neutral.0', cssVar: '--palette-neutral-0', refs: ['color.neutral.0'] },
    { path: 'palette.neutral.900', cssVar: '--palette-neutral-900', refs: ['color.neutral.900'] },
    // Read only by the base stylesheet (body background), never by a component.
    { path: 'color.bg.default', cssVar: '--color-bg-default', refs: ['color.bg.default', 'palette.neutral.0', 'color.neutral.0', 'palette.neutral.900'] },
    // Read by nobody directly, aliased by a component token that a component reads.
    { path: 'color.border.default', cssVar: '--color-border-default', refs: ['color.neutral.500'] },
    { path: 'input.border', cssVar: '--input-border', refs: ['color.border.default'] },
    // Aliased only by an unused token: still unused.
    { path: 'color.bg.ghost', cssVar: '--color-bg-ghost', refs: [] },
    { path: 'color.bg.orphan', cssVar: '--color-bg-orphan', refs: ['color.bg.ghost'] },
  ];
  const reads = {
    byVar: { '--input-border': ['Input'], '--color-unknown': ['Input'] },
    globalVars: { 'lib/styles/base.css': ['--color-bg-default'] },
  };

  it('counts tokens read by components, by global stylesheets, and aliased by a used token', () => {
    const { used, direct } = tokenUsage(tokens, reads);
    expect([...direct].sort()).toEqual(['color.bg.default', 'input.border']);
    expect(used.has('color.bg.default')).toBe(true);
    expect(used.has('palette.neutral.900')).toBe(true);
    expect(used.has('color.neutral.900')).toBe(true);
    expect(used.has('color.border.default')).toBe(true);
    expect(used.has('color.neutral.500')).toBe(true);
    expect(used.has('color.bg.orphan')).toBe(false);
    expect(used.has('color.bg.ghost')).toBe(false);
  });

  it('builds the same answer from a usage index', () => {
    const index = buildUsageIndex(
      [
        { path: 'lib/components/Input/Input.module.css', text: '.root { border-color: var(--input-border); }' },
        { path: 'lib/styles/base.css', text: 'body { background: var(--color-bg-default); }' },
      ],
      'lib/components',
    );
    const { used } = tokenUsage(tokens, index);
    expect(used.has('color.bg.default')).toBe(true);
    expect(used.has('color.border.default')).toBe(true);
    expect(used.has('color.bg.orphan')).toBe(false);
  });
});
