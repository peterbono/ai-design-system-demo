import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import stylelint from 'stylelint';
import { describe, expect, it } from 'vitest';
import { loadDesignSystem } from '@bridge-ds/core/node';
import plugin from '../src/index';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const lint = async (code: string, options: Record<string, unknown> = {}, fix = false) => {
  const r = await stylelint.lint({ code, codeFilename: join(REPO, 'app/x.css'), config: { plugins: [plugin], rules: { 'bridge/use-tokens': [true, { designSystem: REPO, ...options }] } }, fix });
  return { warnings: r.results[0]!.warnings.map((w) => ({ text: w.text, line: w.line, column: w.column })), code: (r as { code?: string }).code ?? r.output };
};
// Tests read the live tokens, which a designer may change in Studio: literals and expected tokens come from them.
const { set, index } = loadDesignSystem(REPO);
const live = (path: string) => set.resolve(path, set.defaultCombo).css;
const text = live('color.text.default');
const textFix = index.suggest('color', text, 'color')!;
const step = `${parseFloat(live('space.3')) + 1}px`;
const stepFix = index.suggest('spacing', step, 'padding')!;

describe('bridge/use-tokens', () => {
  it('reports raw values with the token to use, exact and nearest', async () => {
    const { warnings } = await lint(`.card {\n  color: ${text};\n  padding: ${step};\n  margin: var(--space-4);\n  width: 50%;\n}`);
    expect(textFix.level).toBe('exact');
    expect(stepFix).toMatchObject({ token: 'space.3' });
    expect(stepFix.level).not.toBe('exact');
    expect(warnings).toEqual([
      { text: `Use var(${textFix.cssVar}) instead of ${text}: it is the same color (${textFix.value}). (bridge/use-tokens)`, line: 2, column: 10 },
      { text: `Use a token instead of the raw spacing ${step}: closest is var(--space-3) (${stepFix.value}, ${stepFix.level} match). (bridge/use-tokens)`, line: 3, column: 12 },
    ]);
  });

  it('autofixes exact matches only, and keeps the rest of the value', async () => {
    const [width, border, space4, dropdown] = ['border-width.default', 'color.border.default', 'space.4', 'layer.dropdown'].map(live) as [string, string, string, string];
    const borderFix = index.suggest('color', border, 'border')!;
    expect(borderFix.level).toBe('exact');
    const { code, warnings } = await lint(`.a { border: ${width} solid ${border}; padding: ${space4} ${step}; z-index: ${dropdown}; box-shadow: 0 1px 2px rgba(0,0,0,.2); }`, {}, true);
    expect(code).toBe(`.a { border: var(--border-width-default) solid var(${borderFix.cssVar}); padding: var(--space-4) ${step}; z-index: var(--layer-dropdown); box-shadow: 0 1px 2px rgba(0,0,0,.2); }`);
    expect(warnings.map((w) => w.text.split(':')[0])).toEqual([`Use a token instead of the raw spacing ${step}`]);
    const loose = await lint('.a { box-shadow: 0 1px 2px rgba(0,0,0,.2); }', { minConfidence: 'low' });
    expect(loose.warnings[0]!.text).toMatch(/raw shadow 0 1px 2px rgba\(0,0,0,.2\): closest is var\(--[\w-]+\)/);
  });

  it('options: minConfidence, categories, ignoreProperties', async () => {
    expect((await lint(`.a { padding: ${step}; color: ${text}; }`, { minConfidence: 'exact' })).warnings).toHaveLength(1);
    expect((await lint(`.a { padding: ${step}; color: ${text}; }`, { categories: ['spacing'] })).warnings).toHaveLength(1);
    expect((await lint(`.a { padding: ${step}; color: ${text}; }`, { ignoreProperties: ['/^pad/', 'color'] })).warnings).toHaveLength(0);
  });

  it('warns once when no design system is found', async () => {
    const r = await stylelint.lint({ code: '.a { color: red; }', codeFilename: '/tmp/x.css', config: { plugins: [plugin], rules: { 'bridge/use-tokens': [true, { designSystem: '/nonexistent-ds' }] } } });
    expect(r.results[0]!.invalidOptionWarnings.map((w) => w.text).join()).toMatch(/No bridge.config.json in \/nonexistent-ds/);
  });
});
