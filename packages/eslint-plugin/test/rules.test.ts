import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadDesignSystem } from '@bridge-ds/core/node';
import plugin, { noHardcodedStyleValues, preferDsComponents } from '../src/index';
import { runRule } from './harness';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const ds = { designSystem: REPO };
// Tests read the live tokens, which a designer may change in Studio: literals and expected tokens come from them.
const { set, index } = loadDesignSystem(REPO);
const live = (path: string) => set.resolve(path, set.defaultCombo).css;
const text = live('color.text.default');
const textFix = index.suggest('color', text, 'color')!;
const space4 = live('space.4');
const space4n = parseFloat(space4);
const step = `${parseFloat(live('space.3')) + 1}px`;
const stepFix = index.suggest('spacing', step, 'margin-top')!;
const dropdown = Number(live('layer.dropdown'));

describe('bridge/no-hardcoded-style-values', () => {
  it('reports raw values in style, sx, styled() and theme objects with the token to use', () => {
    const code = [
      `const Header = styled('header')({ padding: ${space4n}, color: theme.palette.text.primary });`,
      'export const A = () => (',
      `  <Box sx={{ p: 2, color: '${text}', marginTop: '${step}', bgcolor: 'background.paper' }}>`,
      `    <div style={{ zIndex: ${dropdown}, width: '50%', boxShadow: '0 1px 2px #000' }} />`,
      '  </Box>',
      ');',
      "const theme = createTheme({ palette: { primary: { main: '#1976d2' } } });",
      "const config = { color: '#ff0000' };",
    ].join('\n');
    const { reports } = runRule(noHardcodedStyleValues, code, [ds]);
    expect(reports.map((r) => `${r.line} ${r.messageId} ${r.message}`)).toEqual([
      `1 exact Use var(--space-4) instead of ${space4n}: it is the same spacing (${space4}).`,
      `3 exact Use var(${textFix.cssVar}) instead of ${text}: it is the same color (${textFix.value}).`,
      `3 near Raw spacing ${step}: use a token, closest is var(--space-3) (${stepFix.value}, ${stepFix.level} match).`,
      `4 exact Use var(--layer-dropdown) instead of ${dropdown}: it is the same z-index (${dropdown}).`,
      expect.stringMatching(/^4 near Raw shadow 0 1px 2px #000: use a token, closest is var\(--[\w-]+\)/),
      expect.stringMatching(/^7 near Raw color #1976d2: use a token, closest is var\(--[\w-]+\)/),
    ]);
  });

  it('fixes exact whole-value matches only', () => {
    const { output } = runRule(noHardcodedStyleValues, `const styles = { root: { padding: ${space4n}, color: '${text}', margin: '${space4} ${step}' } };\n<div style={{ zIndex: ${dropdown} }} />;`, [ds]);
    expect(output).toBe(`const styles = { root: { padding: 'var(--space-4)', color: 'var(${textFix.cssVar})', margin: '${space4} ${step}' } };\n<div style={{ zIndex: 'var(--layer-dropdown)' }} />;`);
  });

  it('minConfidence and categories narrow the report', () => {
    const code = `<div style={{ padding: '${step}', color: '${text}', width: 1234 }} />`;
    expect(runRule(noHardcodedStyleValues, code, [ds]).reports).toHaveLength(3);
    expect(runRule(noHardcodedStyleValues, code, [{ ...ds, minConfidence: 'exact' }]).reports).toHaveLength(1);
    expect(runRule(noHardcodedStyleValues, code, [{ ...ds, categories: ['color'] }]).reports).toHaveLength(1);
  });

  it('reads the design system from settings.bridge.designSystem', () => {
    const { reports } = runRule(noHardcodedStyleValues, `<div style={{ color: '${text}' }} />`, [], { bridge: { designSystem: REPO } });
    expect(reports[0]!.messageId).toBe('exact');
  });
});

describe('bridge/prefer-ds-components', () => {
  it('flags foreign UI library components with the DS equivalent, and native elements', () => {
    const code = [
      "import { Button, TextField, ThemeProvider, useMediaQuery, Box } from '@mui/material';",
      "import * as Dialog from '@radix-ui/react-dialog';",
      "import { Card } from '@/components/ui/card';",
      "import DeleteIcon from '@mui/icons-material/Delete';",
      "import { Button as DsButton } from '@bridge-ds/react';",
      'export const A = () => (<form><button type="submit">Go</button><input type="checkbox" /><input type="hidden" /><select /></form>);',
    ].join('\n');
    const { reports } = runRule(preferDsComponents, code, [ds]);
    expect(reports.map((r) => r.message)).toEqual([
      'Button from @mui/material: use the design system Button instead.',
      'TextField from @mui/material: use the design system Input instead.',
      'Box from @mui/material is not a design system component. Use DS components (@bridge-ds/react) or ask for one.',
      'Dialog from @radix-ui/react-dialog: use the design system Dialog instead.',
      'Card from shadcn/ui (local): use the design system Card instead.',
      'Native <button>: use the design system Button (accessible states, tokens, focus ring).',
      'Native <input>: use the design system Checkbox (accessible states, tokens, focus ring).',
      'Native <select>: use the design system Select (accessible states, tokens, focus ring).',
    ]);
  });

  it('options: allow, nativeElements, packages, foreignLibraries', () => {
    const code = "import { Button } from '@mui/material';\nimport { Fancy } from 'fancy-ui';\nconst A = () => <><button /><table /></>;";
    const msgs = (o: object) => runRule(preferDsComponents, code, [{ ...ds, ...o }]).reports.map((r) => r.message.split(':')[0]);
    expect(msgs({ allow: ['@mui/material', 'button'] })).toEqual(['Native <table>']);
    expect(msgs({ nativeElements: ['table'] })).toEqual(['Button from @mui/material', 'Native <table>']);
    expect(msgs({ foreignLibraries: ['fancy-ui'], nativeElements: [] })).toEqual(['Button from @mui/material', expect.stringMatching(/^Fancy from fancy-ui/)]);
  });

  it('exports a flat config preset', () => {
    expect(plugin.configs.recommended).toMatchObject({ rules: { 'bridge/no-hardcoded-style-values': 'warn', 'bridge/prefer-ds-components': 'warn' } });
    expect(Object.keys(plugin.rules)).toEqual(['no-hardcoded-style-values', 'prefer-ds-components']);
  });
});
