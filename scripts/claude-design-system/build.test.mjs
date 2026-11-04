import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildBundle, generate, loadBundle, parseDefaults } from './build.mjs';
import { INDEX_PATH, NAMESPACE, buildManifest, isComponentExport, parseFamilies, parseValueExports, treeToXImport } from './lib.mjs';
import { createHash } from 'node:crypto';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const SRC = join(ROOT, 'packages/react/src');
const read = (p) => readFileSync(p, 'utf8');

/** Every value export of @bridge-ds/react that starts with a capital, read from the sources (not from the bundle). */
function sourceComponentExports() {
  const names = [];
  for (const { folder } of parseFamilies(read(join(SRC, 'index.ts')))) {
    const idx = folder === 'theme' ? join(SRC, 'theme/index.ts') : join(SRC, 'components', folder, 'index.ts');
    names.push(...parseValueExports(read(idx)).filter((n) => /^[A-Z]/.test(n) && !/^[A-Z_]+$/.test(n)));
  }
  return names;
}

describe('lib', () => {
  it('reads families and value exports from the entry files', () => {
    const fams = parseFamilies("// Actions\nexport * from './components/Button';\n// Foundations\nexport * from './theme';\n");
    expect(fams).toEqual([
      { family: 'Actions', folder: 'Button' },
      { family: 'Foundations', folder: 'theme' },
    ]);
    expect(parseValueExports("export { Card, CardBody } from './Card';\nexport type { CardProps } from './Card';")).toEqual(['Card', 'CardBody']);
  });

  it('turns an example tree into x-import markup with holes for non-string props', () => {
    const vals = {};
    const html = treeToXImport({ c: 'Row', children: [{ c: 'Button', p: { variant: 'primary', loading: true, iconStart: 'Check' }, children: ['Publish'] }] }, new Set(['Button']), vals);
    expect(html).toContain('<x-import component-from-global-scope="Bridge.Button" variant="primary" loading="{{loading}}" icon-start="Check">Publish</x-import>');
    expect(html).toContain('<div style="display: flex;');
    expect(vals).toEqual({ loading: true });
  });

  it('builds a manifest that is the same for the same files, sorted, with the index last', () => {
    const sha256 = (b) => createHash('sha256').update(b).digest('hex');
    const files = new Map([
      ['design-system.json', '{"v":3}'],
      ['tokens.css', ':root{}'],
      ['README.md', '# Bridge Library'],
      ['api/components/Button.md', '# Button'],
    ]);
    const one = buildManifest({ files, version: '1.8.4', revision: 'abc1234', sha256 });
    const two = buildManifest({ files: new Map([...files].reverse()), version: '1.8.4', revision: 'abc1234', sha256 });
    expect(JSON.stringify(two)).toBe(JSON.stringify(one));
    expect(one.files.map((f) => f.path)).toEqual(['project/README.md', 'project/api/components/Button.md', 'project/tokens.css', INDEX_PATH]);
    expect(one).toMatchObject({ format: 1, name: 'Bridge Library', version: '1.8.4', base: '/claude-design-system/1.8.4/', count: 4, bytes: 7 + 7 + 16 + 8 });
    expect(one.files[0]).toEqual({ path: 'project/README.md', size: 16, sha256: sha256(Buffer.from('# Bridge Library')) });
  });

  it('reads destructuring defaults', () => {
    expect(parseDefaults("function Button({ variant = 'primary', size = \"md\", loading = false, ...rest }").get('Button')).toEqual(
      new Map([
        ['variant', 'primary'],
        ['size', 'md'],
        ['loading', 'false'],
      ]),
    );
  });
});

describe('bundle', () => {
  let js;
  let dom;
  beforeAll(async () => {
    ({ js } = await buildBundle());
    dom = await loadBundle(js);
  }, 120000);
  afterAll(() => dom?.window.close());

  it('exposes every component @bridge-ds/react exports on window.Bridge', () => {
    const ns = dom.window[NAMESPACE];
    const expected = sourceComponentExports();
    expect(expected.length).toBeGreaterThan(80);
    const missing = expected.filter((n) => !isComponentExport(n, ns[n]));
    expect(missing).toEqual([]);
    expect(Object.keys(ns.Icons).length).toBeGreaterThan(1000);
  });

  it('carries no copy of React: no React source, and hooks run on the page React', () => {
    expect(js).not.toMatch(/@license React|react\.production|__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED\s*=/);
    expect(js).not.toMatch(/<\/script|<!--/i);
    const { React, ReactDOM, document } = dom.window;
    const B = dom.window[NAMESPACE];
    const errors = [];
    const origError = dom.window.console.error;
    dom.window.console.error = (...a) => errors.push(a.join(' '));
    const root = ReactDOM.createRoot(document.getElementById('root'));
    ReactDOM.flushSync(() =>
      root.render(
        React.createElement(
          B.ThemeProvider,
          { theme: 'dark' },
          React.createElement(B.PageHeader, { title: 'Tokens', lead: 'Every color, space and radius.' }),
          React.createElement(
            B.Card,
            null,
            React.createElement(B.CardBody, null, React.createElement(B.Badge, { tone: 'success', icon: 'CircleCheck' }, 'Published')),
          ),
          React.createElement(B.Button, { variant: 'primary', iconStart: 'Check' }, 'Publish tokens'),
        ),
      ),
    );
    dom.window.console.error = origError;
    expect(errors).toEqual([]);
    expect(document.querySelector('[data-theme="dark"][data-brand="bridge"][data-density="comfortable"]')).not.toBeNull();
    expect(document.querySelector('h1').textContent).toBe('Tokens');
    const button = document.querySelector('button');
    expect(button.textContent).toBe('Publish tokens');
    // String icon names resolve to the Lucide glyph through the real Icon.
    expect(button.querySelector('svg')).not.toBeNull();
    expect(document.querySelectorAll('svg').length).toBeGreaterThanOrEqual(2);
    root.unmount();
  });
});

describe('generated design system', () => {
  let out;
  let result;
  beforeAll(async () => {
    out = mkdtempSync(join(tmpdir(), 'claude-ds-'));
    result = await generate({ outDir: out });
  }, 180000);
  afterAll(() => rmSync(out, { recursive: true, force: true }));

  it('writes a card and an Index line for every component, and the bundle header names them', () => {
    const readme = result.files.get('README.md');
    const header = JSON.parse(/^\/\* @ds-bundle: (.*) \*\//.exec(result.files.get('components/bundle.js'))[1]);
    expect(header.namespace).toBe(NAMESPACE);
    for (const name of sourceComponentExports()) {
      expect(result.files.has(`api/components/${name}.md`), name).toBe(true);
      expect(readme).toContain(`](api/components/${name}.md)`);
      expect(header.components.some((c) => c.name === name), name).toBe(true);
    }
    expect(readme).toContain('## Consuming this system');
    expect(readme).toContain(`window.${NAMESPACE}`);
  });

  it('writes tokens.json in the type shape: lists, both themes, valid names', () => {
    const tokens = JSON.parse(result.files.get('tokens.json'));
    expect(tokens.color.themes.map((t) => t.id)).toEqual(['light', 'dark']);
    expect(Array.isArray(tokens.color.tokens)).toBe(true);
    const bg = tokens.color.tokens.find((t) => t.name === 'color-bg-default');
    expect(bg.value.light).toMatch(/^#[0-9a-f]{6}$/);
    expect(bg.value.dark).toMatch(/^#[0-9a-f]{6}$/);
    const names = [...tokens.color.tokens, ...tokens.spacing.tokens, ...tokens.radius.tokens, ...tokens.shadow.tokens].map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
    for (const n of names) expect(n).toMatch(/^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/);
    expect(tokens.spacing.tokens.find((t) => t.name === 'space-4').value).toBe('16px');
    expect(tokens.type.groups[0].styles.map((s) => s.name)).toContain('body');
    for (const stack of Object.values(tokens.type.families)) expect(stack).not.toMatch(/[;{}<>\\()]/);
  });

  it('stays inside the type caps and is deterministic', async () => {
    expect(result.files.size).toBeLessThan(1008);
    for (const [path, text] of result.files) expect(Buffer.byteLength(text), path).toBeLessThan(6 * 1024 * 1024);
    const index = JSON.parse(result.files.get('design-system.json'));
    expect(index).toMatchObject({ v: 3, layout: 'files', title: 'Bridge Library', namespace: NAMESPACE, editing: 'code' });
    const again = await generate({ outDir: out });
    for (const [path, text] of result.files) expect(again.files.get(path), path).toBe(text);
  }, 180000);
});
