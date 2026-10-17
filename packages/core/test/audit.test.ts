import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, test } from 'vitest';
import { auditFile, auditMarkdown, compareWithBaseline, deltaE, parseCssColor, planCssFixes, scanClassString, scanCssValue, scanJsStyle } from '../src/audit';
import { fixCss, loadDesignSystem, runAudit } from '../src/node/audit';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const FIX = join(dirname(fileURLToPath(import.meta.url)), 'fixtures/audit');
const ds = () => loadDesignSystem(REPO).index;
const audit = (app: string) => runAudit(join(FIX, app), { ds: REPO, displayPath: app, label: app });
const tmp: string[] = [];
afterAll(() => tmp.forEach((d) => rmSync(d, { recursive: true, force: true })));

describe('colors', () => {
  test('parses hex, rgb, hsl, named and bare HSL channels', () => {
    assert.deepEqual(parseCssColor('#fff'), { r: 1, g: 1, b: 1, a: 1 });
    assert.equal(parseCssColor('rgba(0, 0, 0, .5)')!.a, 0.5);
    assert.equal(parseCssColor('rgb(0 0 0 / 50%)')!.a, 0.5);
    assert.ok(deltaE(parseCssColor('hsl(0, 100%, 50%)')!, parseCssColor('red')!) < 0.01);
    assert.ok(parseCssColor('222.2 47.4% 11.2%'));
    assert.equal(parseCssColor('solid'), undefined);
  });

  test('deltaE OK: identical is 0, a just noticeable step is about 2, black to white is 100', () => {
    assert.equal(deltaE(parseCssColor('#1c2735')!, parseCssColor('#1C2735')!), 0);
    assert.ok(Math.abs(deltaE(parseCssColor('#000')!, parseCssColor('#fff')!) - 100) < 0.1);
    const near = deltaE(parseCssColor('#1c2735')!, parseCssColor('#202b3a')!);
    assert.ok(near > 0 && near < 2, String(near));
  });
});

describe('declarations', () => {
  test('CSS values: colors, lengths by property, shadows, motion, z-index, DS vars', () => {
    const s = scanCssValue('border', '1px solid #dce3eb');
    assert.deepEqual(s.hits.map((h) => [h.category, h.text]), [['border-width', '1px'], ['color', '#dce3eb']]);
    assert.deepEqual(scanCssValue('padding', 'var(--space-4) 13px').hits.map((h) => h.text), ['13px']);
    assert.deepEqual(scanCssValue('padding', 'var(--space-4) 13px').vars, ['--space-4']);
    assert.equal(scanCssValue('box-shadow', '0 1px 2px rgba(0,0,0,.2)').hits[0]!.category, 'shadow');
    assert.equal(scanCssValue('box-shadow', 'inset 0 0 0 var(--border-width-default) var(--color-border-default)').hits.length, 0);
    assert.equal(scanCssValue('box-shadow', '0 0 0 1px var(--color-border-default)').hits[0]!.category, 'shadow');
    assert.deepEqual(scanCssValue('transition', 'color 150ms cubic-bezier(0.2, 0, 0, 1)').hits.map((h) => h.category), ['duration', 'easing']);
    assert.equal(scanCssValue('z-index', '1').hits.length, 0, 'local stacking (0, 1, -1) is not drift');
    assert.equal(scanCssValue('color', 'var(--x, #fff)').hits.length, 0, 'fallbacks inside var() are ignored');
    assert.equal(scanCssValue('width', '50%').hits.length, 0);
  });

  test('JS style objects: React px numbers, MUI sx spacing units and palette paths', () => {
    assert.deepEqual(scanJsStyle('padding', 16, 'style').hits.map((h) => [h.category, h.text]), [['spacing', '16']]);
    assert.equal(scanJsStyle('p', 2, 'sx').themeRef, true);
    assert.equal(scanJsStyle('color', 'text.secondary', 'sx').themeRef, true);
    assert.equal(scanJsStyle('color', 'red', 'sx').hits[0]!.category, 'color');
    assert.equal(scanJsStyle('width', 0.5, 'sx').hits.length, 0, 'MUI fractions are percentages');
    assert.equal(scanJsStyle('main', '#1976d2', 'theme').hits[0]!.category, 'color');
  });

  test('Tailwind classes: arbitrary values, palette classes, scale classes, DS var arbitrary values', () => {
    const hits = scanClassString('hover:bg-[#1c2735] p-[13px] text-gray-500 p-4 rounded-lg text-[color:var(--color-text-muted)] md:!text-[13px]');
    assert.deepEqual(hits.map((h) => [h.cls, h.kind]), [['bg-[#1c2735]', 'arbitrary'], ['p-[13px]', 'arbitrary'], ['text-gray-500', 'palette'], ['p-4', 'scale'], ['rounded-lg', 'scale'], ['text-[color:var(--color-text-muted)]', 'token'], ['text-[13px]', 'arbitrary']]);
    assert.equal(hits[2]!.value, '#6b7280');
  });
});

describe('suggestions', () => {
  test('exact token values, nearest by deltaE across modes, nearest scale step', () => {
    const i = ds();
    const exact = i.suggest('color', '#15202b', 'color')!;
    assert.equal(exact.level, 'exact');
    assert.equal(exact.token, 'color.text.default', 'semantic text token for a text color');
    const near = i.suggest('color', '#18232f', 'color')!;
    assert.equal(near.level, 'high');
    assert.ok(near.distance > 0 && near.distance < 2);
    assert.match(i.suggest('color', '#15202b', 'background-color')!.token, /(bg|surface|solid|primary\.bg)/, 'a background token for a background');
    assert.deepEqual([i.suggest('spacing', '16px')!.token, i.suggest('spacing', '16px')!.level], ['space.4', 'exact']);
    const step = i.suggest('spacing', '13px')!;
    assert.equal(step.token, 'space.3');
    assert.notEqual(step.level, 'exact');
    assert.equal(i.suggest('radius', '10px')!.level, 'exact');
    assert.equal(i.suggest('z-index', '1000')!.token, 'layer.dropdown', 'the semantic layer over the z scale');
    assert.equal(i.suggest('duration', '150ms')!.level, 'exact');
    assert.equal(i.suggest('font-weight', '600')!.level, 'exact');
  });

  test('a dark theme color matches a semantic token in the dark mode, not only a primitive', () => {
    const i = ds();
    const set = loadDesignSystem(REPO).set;
    const def = set.defaultCombo;
    const dark = set.combos().find((c) => c.theme === 'dark' && c.brand === def.brand && c.density === def.density)!;
    const css = set.resolve('color.bg.default', dark).css;
    assert.notEqual(css, set.resolve('color.bg.default', def).css);
    const s = i.suggest('color', css, 'background')!;
    assert.equal(s.level, 'exact');
    assert.notEqual(set.tierOf(s.token), 'primitive');
    if (s.mode) assert.match(s.mode, /theme=dark/);
  });
});

describe('bridge audit on fixtures', () => {
  test('MUI app: hardcoded values in sx, styled, style, theme and CSS; MUI and react-admin components; native button', () => {
    const r = audit('mui-app');
    assert.equal(r.schemaVersion, 1);
    assert.equal(r.target.files, 3);
    assert.equal(r.metrics.componentAdoption, 0);
    assert.ok(r.metrics.tokenAdoption! > 0 && r.metrics.tokenAdoption! < 25, String(r.metrics.tokenAdoption));
    assert.ok(r.components.foreign['@mui/material']!.instances >= 6);
    assert.ok(r.components.foreign['react-admin']!.components.Datagrid);
    assert.equal(r.components.native.button, 1);
    assert.equal(r.components.foreign['@mui/icons-material'], undefined, 'icons are not UI components');
    const app = r.files.find((f) => f.path === 'src/App.tsx')!;
    const byValue = (v: string) => app.findings.find((f) => f.value === v);
    assert.deepEqual([byValue('#15202b')!.source, byValue('#15202b')!.line, byValue('#15202b')!.suggestion!.token], ['sx', 18, 'color.text.default']);
    assert.equal(byValue('13px')!.category, 'spacing');
    assert.equal(byValue('16')!.source, 'styled');
    assert.equal(byValue('red')!.source, 'style');
    assert.equal(byValue('1200')!.suggestion!.token, 'layer.modal');
    assert.ok(!app.findings.some((f) => f.value === '2'), 'sx p: 2 is a theme spacing unit, not a hardcoded value');
    assert.equal(app.components.find((c) => c.name === 'TextField')!.suggestion, 'Input');
    assert.equal(app.components.filter((c) => c.name === 'Card').length, 2, 'styled(Card) renders a MUI Card');
    assert.equal(app.components.find((c) => c.name === 'button')!.suggestion, 'Button');
    const theme = r.files.find((f) => f.path === 'src/theme.ts')!;
    assert.deepEqual(theme.findings.map((f) => f.category).sort(), ['color', 'color', 'font-family', 'radius']);
    const css = r.files.find((f) => f.path === 'src/styles.css')!;
    assert.equal(css.tokenUsages, 2);
    assert.deepEqual(css.findings.filter((f) => f.autofix).map((f) => f.value), ['#15202b', '16px', '12px', '150ms', '1000']);
    assert.match(auditMarkdown(r), /Token adoption \| \*\*\d/);
  });

  test('Tailwind and shadcn/ui app: arbitrary values, palette classes, local ui components, Radix, native input and select', () => {
    const r = audit('tailwind-app');
    const page = r.files.find((f) => f.path === 'app/page.tsx')!;
    const vals = page.findings.map((f) => f.value);
    for (const v of ['bg-[#15202b]', 'text-[13px]', 'p-[13px]', 'rounded-[10px]', 'shadow-[0_1px_2px_rgba(0,0,0,0.2)]', 'z-[1300]', 'border-[#dce3eb]', 'bg-gray-100']) assert.ok(vals.includes(v), v);
    assert.equal(page.findings.find((f) => f.value === 'bg-[#15202b]')!.suggestion!.level, 'exact');
    assert.equal(page.findings.find((f) => f.value === 'bg-gray-100')!.suggestion!.level !== 'exact', true, 'palette classes are capped below exact');
    assert.equal(page.tokenUsages, 2);
    assert.ok(page.themeRefs >= 1);
    assert.deepEqual(page.components.map((c) => `${c.kind}:${c.name}:${c.library}`).sort(), ['foreign:Button:shadcn/ui (local)', 'foreign:Dialog.Root:@radix-ui/react-dialog', 'foreign:Dialog.Trigger:@radix-ui/react-dialog', 'native:input:native', 'native:select:native']);
    assert.ok(r.components.recreated.some((x) => x.name === 'Button' && x.file === 'components/ui/button.tsx' && x.instances === 1));
    const ui = r.files.find((f) => f.path === 'components/ui/button.tsx')!;
    assert.deepEqual(ui.findings.map((f) => f.value).sort(), ['bg-red-600', 'h-[34px]', 'text-white']);
    const css = r.files.find((f) => f.path === 'app/globals.css')!;
    assert.deepEqual(css.findings.map((f) => `${f.category}:${f.value}`), ['color:222.2 47.4% 11.2%', 'radius:0.5rem', 'color:bg-blue-500', 'radius:rounded-[6px]']);
    assert.equal(r.metrics.componentAdoption, 0);
  });

  test('clean DS app: 100% token and component adoption', () => {
    const r = audit('clean-app');
    assert.equal(r.metrics.tokenAdoption, 100);
    assert.equal(r.metrics.componentAdoption, 100);
    assert.deepEqual(r.components.ds, { Card: 1, Input: 1, Button: 1 });
    assert.equal(r.metrics.tokenUsages, 4);
    assert.equal(r.metrics.hardcoded, 0);
  });

  test('baseline: progress per metric, category and file; history carries over', () => {
    const before = audit('mui-app');
    const after = compareWithBaseline(audit('clean-app'), before);
    assert.equal(after.baseline!.tokenAdoption.after, 100);
    assert.ok(after.baseline!.tokenAdoption.delta! > 50);
    assert.ok(after.baseline!.hardcoded.delta < 0);
    assert.deepEqual(after.baseline!.removedFiles, ['src/App.tsx', 'src/styles.css', 'src/theme.ts']);
    assert.equal(after.history.length, 1);
    const third = compareWithBaseline(audit('clean-app'), after);
    assert.equal(third.history.length, 2);
    assert.match(auditMarkdown(after), /Progress since mui-app/);
  });
});

describe('autofix', () => {
  test('replaces exact token matches in CSS only, keeps everything else byte for byte', () => {
    const src = readFileSync(join(FIX, 'mui-app/src/styles.css'), 'utf8');
    const { edits, output } = planCssFixes(src, 'css', ds());
    assert.deepEqual(edits.map((e) => `${e.line}:${e.from}->${e.to}`), ['3:#15202b->var(--color-text-default)', '4:16px->var(--space-4)', '5:12px->var(--radius-control)', '7:150ms->var(--motion-duration-fast)', '8:1000->var(--layer-dropdown)']);
    assert.match(output, /padding: var\(--space-4\) 13px;/);
    assert.match(output, /box-shadow: 0 1px 2px rgba\(0, 0, 0, 0.2\);/);
    assert.equal(output.replace(/var\(--[\w-]+\)/g, 'X').split('\n').length, src.split('\n').length);
    const again = planCssFixes(output, 'css', ds());
    assert.equal(again.edits.length, 0, 'idempotent');
  });

  test('fixCss writes only with write=true', () => {
    const dir = mkdtempSync(join(tmpdir(), 'bridge-audit-'));
    tmp.push(dir);
    cpSync(join(FIX, 'mui-app'), dir, { recursive: true });
    const dry = fixCss(dir, ds(), false);
    assert.equal(dry[0]!.edits.length, 5);
    assert.equal(readFileSync(join(dir, 'src/styles.css'), 'utf8'), readFileSync(join(FIX, 'mui-app/src/styles.css'), 'utf8'));
    fixCss(dir, ds(), true);
    assert.match(readFileSync(join(dir, 'src/styles.css'), 'utf8'), /var\(--layer-dropdown\)/);
    assert.equal(fixCss(dir, ds(), false).length, 0);
  });

  test('a single file can be audited on its own', () => {
    const f = auditFile('x.tsx', 'export const A = () => <div style={{ color: "#15202b" }} />;', ds());
    assert.equal(f.findings[0]!.suggestion!.token, 'color.text.default');
  });
});

describe('what counts as a UI component instance', () => {
  const app = [
    "import { Button, Link, ThemeProvider, SidebarNavItem } from '@bridge-ds/react';",
    "import { LinkBase } from 'ra-core';",
    "import { Link as RouterLink } from 'react-router-dom';",
    "import { AreaChart, Area, ResponsiveContainer } from 'recharts';",
    'export const A = () => (',
    '  <ThemeProvider>',
    '    <Button>Save</Button>',
    '    <SidebarNavItem render={<LinkBase to="/orders" />}>Orders</SidebarNavItem>',
    '    <Link render={<RouterLink to="/" />}>Home</Link>',
    '    <Button render={<a href="/tokens" />}>Tokens</Button>',
    '    <LinkBase to="/customers/1" className="row">Ada</LinkBase>',
    '    <a href="#main">Skip</a>',
    '    <a id="top" />',
    '    <img src="/p.png" alt="" />',
    '    <ResponsiveContainer><AreaChart data={[]}><Area dataKey="v" /></AreaChart></ResponsiveContainer>',
    '  </ThemeProvider>',
    ');',
  ].join('\n');

  test('providers do not count; router links and anchors in a render prop do not; standalone links, anchors, images and charts do', () => {
    const f = auditFile('app.tsx', app, ds());
    assert.equal(f.dsComponents, 4);
    const other = f.components.map((c) => `${c.kind}:${c.library}:${c.name}${c.suggestion ? `>${c.suggestion}` : ''}`);
    assert.deepEqual(other, [
      'foreign:ra-core:LinkBase>Link',
      'native:native:a>Link',
      'native:native:img',
      'foreign:recharts:AreaChart',
      'foreign:recharts:Area',
    ]);
  });
});
