import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import stylelint from 'stylelint';
import { describe, expect, it } from 'vitest';
import plugin from '../src/index';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const lint = async (code: string, options: Record<string, unknown> = {}, fix = false) => {
  const r = await stylelint.lint({ code, codeFilename: join(REPO, 'app/x.css'), config: { plugins: [plugin], rules: { 'bridge/use-tokens': [true, { designSystem: REPO, ...options }] } }, fix });
  return { warnings: r.results[0]!.warnings.map((w) => ({ text: w.text, line: w.line, column: w.column })), code: (r as { code?: string }).code ?? r.output };
};

describe('bridge/use-tokens', () => {
  it('reports raw values with the token to use, exact and nearest', async () => {
    const { warnings } = await lint('.card {\n  color: #1c2735;\n  padding: 13px;\n  margin: var(--space-4);\n  width: 50%;\n}');
    expect(warnings).toEqual([
      { text: 'Use var(--color-text-default) instead of #1c2735: it is the same color (#1c2735). (bridge/use-tokens)', line: 2, column: 10 },
      { text: 'Use a token instead of the raw spacing 13px: closest is var(--space-3) (12px, high match). (bridge/use-tokens)', line: 3, column: 12 },
    ]);
  });

  it('autofixes exact matches only, and keeps the rest of the value', async () => {
    const { code, warnings } = await lint('.a { border: 1px solid #dce3eb; padding: 16px 13px; z-index: 1000; box-shadow: 0 1px 2px rgba(0,0,0,.2); }', {}, true);
    expect(code).toBe('.a { border: var(--border-width-default) solid var(--color-border-default); padding: var(--space-4) 13px; z-index: var(--layer-dropdown); box-shadow: 0 1px 2px rgba(0,0,0,.2); }');
    expect(warnings.map((w) => w.text.split(':')[0])).toEqual(['Use a token instead of the raw spacing 13px']);
    const loose = await lint('.a { box-shadow: 0 1px 2px rgba(0,0,0,.2); }', { minConfidence: 'low' });
    expect(loose.warnings[0]!.text).toMatch(/raw shadow 0 1px 2px rgba\(0,0,0,.2\): closest is var\(--[\w-]+\)/);
  });

  it('options: minConfidence, categories, ignoreProperties', async () => {
    expect((await lint('.a { padding: 13px; color: #1c2735; }', { minConfidence: 'exact' })).warnings).toHaveLength(1);
    expect((await lint('.a { padding: 13px; color: #1c2735; }', { categories: ['spacing'] })).warnings).toHaveLength(1);
    expect((await lint('.a { padding: 13px; color: #1c2735; }', { ignoreProperties: ['/^pad/', 'color'] })).warnings).toHaveLength(0);
  });

  it('warns once when no design system is found', async () => {
    const r = await stylelint.lint({ code: '.a { color: red; }', codeFilename: '/tmp/x.css', config: { plugins: [plugin], rules: { 'bridge/use-tokens': [true, { designSystem: '/nonexistent-ds' }] } } });
    expect(r.results[0]!.invalidOptionWarnings.map((w) => w.text).join()).toMatch(/No bridge.config.json in \/nonexistent-ds/);
  });
});
