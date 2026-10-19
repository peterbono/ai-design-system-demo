// `bridge audit` on Astro, Vue and Svelte files, and the escape hatches (ignore comments, allowlist).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, test } from 'vitest';
import { auditFile, auditMarkdown, buildAuditReport, ignoreDirectives, isAuditable, markupBlocks, parseAllowlist } from '../src/audit';
import { loadDesignSystem, runAudit } from '../src/node/audit';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const FIX = join(dirname(fileURLToPath(import.meta.url)), 'fixtures/audit');
const ds = () => loadDesignSystem(REPO).index;
const audit = (app: string) => runAudit(join(FIX, app), { ds: REPO, displayPath: app, label: app });
/** 1-based line of the first line containing `needle` in a fixture file. */
const lineIn = (file: string, needle: string) => readFileSync(join(FIX, file), 'utf8').split('\n').findIndex((l) => l.includes(needle)) + 1;
const comps = (f: { components: { line: number; kind: string; name: string; suggestion?: string }[] }) => f.components.map((c) => `${c.line}:${c.kind}:${c.name}${c.suggestion ? `>${c.suggestion}` : ''}`);

describe('Astro, Vue and Svelte markup', () => {
  test('the audit reads .astro, .vue and .svelte files', () => {
    for (const p of ['src/pages/index.astro', 'src/App.vue', 'src/App.svelte']) assert.ok(isAuditable(p), p);
  });

  test('Astro: DS tags from the frontmatter imports, native elements, a homemade look-alike, styles, scripts', () => {
    const r = audit('astro-app');
    const F = 'astro-app/src/pages/index.astro';
    const page = r.files.find((f) => f.path === 'src/pages/index.astro')!;
    assert.equal(page.lang, 'astro');
    assert.deepEqual(r.components.ds, { Card: 1, Button: 1 }, 'Layout is a local component, not UI');
    assert.deepEqual(comps(page), [
      `${lineIn(F, '<button type="button" class="raw"')}:native:button>Button`,
      `${lineIn(F, 'type="email"')}:native:input>Input`,
      `${lineIn(F, '<select')}:native:select>Select`,
      `${lineIn(F, 'href="/docs"')}:native:a>Link`,
      `${lineIn(F, '<Badge')}:recreated:Badge>Badge`,
      `${lineIn(F, '<dialog')}:native:dialog>Dialog`,
      `${lineIn(F, '.map((n)')}:native:button>Button`,
    ]);
    // Hidden input, anchor without href and the <noscript> fallback are not violations.
    for (const legit of ['type="hidden"', 'id="top"', '<noscript>']) assert.ok(!page.components.some((c) => c.line === lineIn(F, legit)), legit);
    assert.ok(r.components.recreated.some((x) => x.name === 'Badge' && x.file === 'src/components/Badge.astro' && x.instances === 1));
    const at = (v: string, src: string) => page.findings.find((f) => f.value === v && f.source === src);
    const styleLine = lineIn(F, 'style="padding: 13px');
    assert.equal(at('13px', 'style')!.line, styleLine, 'static style attribute');
    assert.equal(at('13px', 'style')!.column, readFileSync(join(FIX, F), 'utf8').split('\n')[styleLine - 1]!.indexOf('13px') + 1);
    assert.ok(page.findings.some((f) => f.line === lineIn(F, "margin: '13px'") && f.source === 'style'), 'style={{ ... }} object');
    assert.equal(at('10px', 'css')!.line, lineIn(F, 'border-radius: 10px'), '<style> block');
    assert.equal(at('#15202b', 'js')!.line, lineIn(F, "color: '#15202b'"), 'frontmatter');
    assert.equal(at('#123456', 'js')!.line, lineIn(F, '#123456'), '<script> block');
    assert.equal(at('#ff0000', 'jsx-attr')!.property, 'fill');
    assert.equal(page.tokenUsages, 2, 'var() in a style attribute and in the <style> block');
    // The escape hatch: with a reason it ignores the next line and keeps it listed; without one it ignores nothing.
    assert.deepEqual(page.ignored, [{ line: lineIn(F, '<textarea'), column: 5, kind: 'component', what: 'textarea', reason: 'rich text field, the DS Textarea has no autosize yet', via: 'comment' }]);
    assert.equal(page.ignoreErrors!.length, 1);
    assert.match(page.ignoreErrors![0]!.message, /needs a reason/);
    assert.equal(r.ignored!.comment, 1);
    assert.match(auditMarkdown(r), /### Ignored on purpose[\s\S]*src\/pages\/index\.astro:\d+.*textarea.*no autosize yet/);
    const badge = r.files.find((f) => f.path === 'src/components/Badge.astro')!;
    assert.deepEqual(badge.findings.map((f) => f.value), ['2px', '6px']);
  });

  test('Vue: <script setup> imports, kebab-case components, bound attributes, scoped SCSS', () => {
    const r = audit('vue-app');
    const F = 'vue-app/src/App.vue';
    const app = r.files[0]!;
    assert.equal(app.lang, 'vue');
    assert.deepEqual(r.components.ds, { Button: 2 }, '<Button> and <ds-button> (Button as DsButton)');
    assert.deepEqual(comps(app), [`${lineIn(F, '<button @click')}:native:button>Button`, `${lineIn(F, 'v-model="q"')}:native:input>Input`, `${lineIn(F, ':href="url"')}:native:a>Link`]);
    assert.deepEqual(
      app.findings.map((f) => `${f.line}:${f.source}:${f.value}`),
      [`${lineIn(F, 'p-[13px]')}:tailwind:p-[13px]`, `${lineIn(F, ':style=')}:style:#15202b`, `${lineIn(F, 'margin: 13px')}:css:13px`],
    );
    assert.equal(app.tokenUsages, 2);
    assert.deepEqual(app.ignored!.map((x) => [x.what, x.reason]), [['select', 'third-party embed reads this native select']]);
  });

  test('Svelte: script imports, foreign components, directives, blocks, noscript', () => {
    const r = audit('svelte-app');
    const F = 'svelte-app/src/App.svelte';
    const app = r.files[0]!;
    assert.equal(app.lang, 'svelte');
    assert.deepEqual(r.components.ds, { Button: 1 });
    assert.deepEqual(comps(app), [
      `${lineIn(F, '<Dialog')}:foreign:Dialog>Dialog`,
      `${lineIn(F, '<button on:click')}:native:button>Button`,
      `${lineIn(F, 'type="checkbox"')}:native:input>Checkbox`,
      `${lineIn(F, '<a href')}:native:a>Link`,
      `${lineIn(F, '<textarea')}:native:textarea>Textarea`,
    ]);
    assert.deepEqual(
      app.findings.map((f) => `${f.line}:${f.source}:${f.value}`),
      [`${lineIn(F, 'style:color')}:style:#15202b`, `${lineIn(F, 'font-size: 13px')}:style:13px`, `${lineIn(F, 'padding: 13px')}:css:13px`],
    );
  });

  test('homemade look-alikes in markup: pill and tooltip classes, data-tip; an app class containing the word is not one', () => {
    const f = auditFile('x.astro', '<span class="pill is-pass">Pass</span>\n<span class="cm-pill-row">x</span>\n<span data-tip="Approved">ok</span>\n<span class:list={["pill", x]}>y</span>\n', ds());
    assert.deepEqual(comps(f), ['1:recreated:.pill>Badge', '3:recreated:[data-tip]>Tooltip', '4:recreated:.pill>Badge']);
  });

  test('markup blocks keep positions: frontmatter, scripts, styles and comments are not template', () => {
    const text = '---\nconst a = 1;\n---\n<!-- <button> -->\n<p>x</p>\n<script type="application/ld+json">{"@type":"Thing"}</script>\n<style lang="scss">a { b: c; }</style>\n';
    const b = markupBlocks(text, 'astro');
    assert.equal(text.slice(b.frontmatter!.start, b.frontmatter!.end), 'const a = 1;\n');
    assert.equal(text.slice(b.scripts[0]!.start, b.scripts[0]!.end), '{"@type":"Thing"}');
    assert.equal(text.slice(b.styles[0]!.start, b.styles[0]!.end), 'a { b: c; }');
    assert.equal(auditFile('x.astro', text, ds()).components.length, 0, 'a commented-out element does not count');
  });
});

describe('ignore comments and allowlist', () => {
  test('every comment syntax; the reason follows a colon; the directive targets the line after the comment', () => {
    const text = [
      '/* bridge-audit-ignore-next-line: brand red from the partner guidelines */',
      '.a { color: #ff0000; }',
      '// bridge-audit-ignore-next-line: legacy embed',
      '{/* bridge-audit-ignore-next-line: print only */}',
      '<!--',
      '  bridge-audit-ignore-next-line: spans lines',
      '-->',
      'const s = "bridge-audit-ignore-next-line: in a string, not a comment";',
    ].join('\n');
    assert.deepEqual(
      ignoreDirectives(text).map((d) => [d.line, d.target, d.reason]),
      [
        [1, 2, 'brand red from the partner guidelines'],
        [3, 4, 'legacy embed'],
        [4, 5, 'print only'],
        [6, 8, 'spans lines'],
      ],
    );
  });

  test('works in CSS and TSX too; a comment that matches nothing is reported', () => {
    const css = auditFile('a.css', '.a {\n  /* bridge-audit-ignore-next-line: partner brand color */\n  color: #ff0000;\n  padding: 13px;\n}\n/* bridge-audit-ignore-next-line: stale */\n.b { color: var(--color-text-default); }\n', ds());
    assert.deepEqual(css.findings.map((f) => f.value), ['13px']);
    assert.deepEqual(css.ignored!.map((x) => [x.kind, x.what, x.reason]), [['value', '#ff0000', 'partner brand color']]);
    assert.match(css.ignoreErrors![0]!.message, /ignores nothing/);
    const tsx = auditFile('a.tsx', 'export const A = () => (\n  <>\n    {/* bridge-audit-ignore-next-line: file picker, no DS equivalent */}\n    <input type="file" />\n    <input />\n  </>\n);\n', ds());
    assert.deepEqual(tsx.components.map((c) => c.line), [5]);
    assert.equal(tsx.otherComponents, 1);
    assert.equal(tsx.ignored![0]!.what, 'input');
  });

  test('allowlist: entries need a reason, matched items leave the counts and stay listed, unmatched ones are stale', () => {
    assert.throws(() => parseAllowlist({ entries: [{ file: 'a.astro', line: 3 }] }), /needs a "reason"/);
    assert.throws(() => parseAllowlist([]), /expected/);
    const allowlist = parseAllowlist({
      entries: [
        { file: 'p.astro', line: 2, what: 'select', reason: 'replaced by the Select migration' },
        { file: 'p.astro', line: 9, reason: 'already fixed' },
      ],
    });
    const r = buildAuditReport({ target: '.', files: [{ path: 'p.astro', text: '<p>\n<select></select><button>Go</button>\n</p>\n' }], allowlist }, ds());
    assert.deepEqual(r.files[0]!.components.map((c) => c.name), ['button'], '"what" narrows the entry to the select');
    assert.equal(r.metrics.uiComponentInstances, 1);
    assert.deepEqual(r.ignored!.items.map((x) => [x.file, x.line, x.what, x.via]), [['p.astro', 2, 'select', 'allowlist']]);
    assert.deepEqual(r.ignored!.staleAllowlist, [allowlist[1]]);
    assert.match(auditMarkdown(r), /match nothing any more[\s\S]*p\.astro:9/);
    // Two links on one line: one entry per link, or one entry for both; neither is stale.
    const two = '<p><a href="/a">A</a> <a href="/b">B</a></p>\n';
    const entry = { file: 'l.astro', line: 1, what: 'a', reason: 'prose links, Link migration next' };
    for (const entries of [[entry, entry], [entry]]) {
      const x = buildAuditReport({ target: '.', files: [{ path: 'l.astro', text: two }], allowlist: entries }, ds());
      assert.equal(x.metrics.uiComponentInstances, 0);
      assert.equal(x.ignored!.total, 2);
      assert.deepEqual(x.ignored!.staleAllowlist, []);
    }
  });
});
