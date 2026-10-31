// The Library's doc pages as Confluence models, from the repo model the Library renders: every component and token
// page, live parts replaced by code and a link, colors with their hex and a swatch, links absolute, no em dash.
import { describe, expect, it } from 'vitest';
import { repoModel } from '../../model';
import type { LibraryData } from '../../../components/ds/library/library-data';
import { loadComponents } from '../components';
import { componentDocPage, exampleJsx, exportPath, indexDocPage, libraryDocPages } from './pages';
import { toConfluenceHtml, toMarkdown } from './render';

const data: LibraryData = { model: repoModel, team: null, extras: { version: '1.0.0' } };
const O = { origin: 'https://bridge.example.com', date: '2026-10-31' };
const pages = libraryDocPages(data);
const byRoute = (r: string) => pages.find((p) => p.route === r)!;

describe('libraryDocPages', () => {
  it('has every token page and every component', () => {
    const routes = pages.map((p) => p.route);
    for (const r of ['/foundations/color/', '/foundations/typography/', '/foundations/spacing/', '/foundations/radius/', '/foundations/elevation/', '/foundations/accessibility/', '/tokens/']) expect(routes).toContain(r);
    for (const c of loadComponents(repoModel)) expect(routes).toContain(`/components/${c.slug}/`);
  });

  it('the color page lists tokens with a hex per theme and a painted swatch', () => {
    const html = toConfluenceHtml(byRoute('/foundations/color/'), O);
    expect(html).toContain('<th>Token</th><th>Light</th><th>Swatch</th><th>Dark</th><th>Swatch</th><th>Description</th>');
    expect(html).toMatch(/<td><code>color\.bg\.default<\/code><\/td><td><code>#[0-9a-f]{6}<\/code><\/td><td data-highlight-colour="#[0-9a-f]{6}"/);
    expect(html).toContain('<h2>Primitive palette</h2>');
    // A translucent color reads as its CSS value, with no opaque swatch.
    expect(html).toMatch(/<td><code>color\.alpha\.steel-8<\/code><\/td><td><code>rgb\(13 24 37 \/ 0\.08\)<\/code><\/td><td><\/td>/);
  });

  it('non-color token pages give the CSS variable and the value', () => {
    const md = toMarkdown(byRoute('/foundations/spacing/'), O);
    expect(md).toContain('| Token | CSS variable | Value | Description |');
    expect(md).toMatch(/\| `space\.\d+` \| `var\(--space-\d+\)` \|/);
  });

  it('a component page has its example as code with a link to see it live, props and tokens, no live demo', () => {
    const button = loadComponents(repoModel).find((c) => c.name === 'Button')!;
    const page = componentDocPage(data, button);
    const html = toConfluenceHtml(page, O);
    expect(html).toContain('<h2>Example</h2>');
    expect(html).toMatch(/<pre><code class="language-tsx"[^>]*>[\s\S]*&lt;Button variant=/);
    expect(html).toContain('<a href="https://bridge.example.com/components/button/">See it live in Bridge</a>');
    expect(html).toContain('<th>Prop</th><th>Type</th><th>Default</th><th>Required</th><th>Description</th>');
    expect(html).toContain('<td><code>variant</code></td>');
    expect(html).toContain('<h2>Anatomy and tokens</h2>');
    expect(html).not.toMatch(/<(iframe|script|button)\b/);
  });

  it('every page renders without an em dash, with absolute links and the footer', () => {
    for (const p of pages) {
      for (const out of [toConfluenceHtml(p, O), toMarkdown(p, O)]) {
        expect(out, p.route).not.toContain('\u2014');
        expect(out.replace(/<[^>]+>|\*/g, ''), p.route).toContain(`Generated from Bridge on 2026-10-31. Edit it in Bridge: https://bridge.example.com${p.route}`);
        // No root-relative link or image (code samples may hold any text, escaped in HTML and fenced in Markdown).
      }
      expect(toConfluenceHtml(p, O), p.route).not.toMatch(/(href|src)="\//);
      expect(toMarkdown(p, O), p.route).not.toMatch(/\]\(\//);
    }
  });
});

describe('export', () => {
  it('maps routes to Markdown files and lists them in an index', () => {
    expect(exportPath(byRoute('/foundations/color/'))).toBe('foundations/color.md');
    expect(exportPath(byRoute('/tokens/'))).toBe('tokens.md');
    expect(exportPath(byRoute('/components/button/'))).toBe('components/button.md');
    const md = toMarkdown(indexDocPage(data, pages), O);
    expect(md).toContain('`components/button.md`');
    expect(md).toContain('[Open in Bridge](https://bridge.example.com/components/button/)');
    expect(md).toContain('Edit it in Bridge: https://bridge.example.com/library/');
  });
});

describe('exampleJsx', () => {
  it('writes props and nested children as JSX', () => {
    expect(exampleJsx({ c: 'Button', p: { variant: 'primary', disabled: true, count: 2, hidden: false }, children: ['Save'] })).toBe('<Button variant="primary" disabled count={2}>Save</Button>');
    expect(exampleJsx({ c: 'Stack', children: [{ c: 'Input', p: { label: 'Name' } }, 'Text'] })).toBe('<Stack>\n  <Input label="Name" />\n  Text\n</Stack>');
  });
});
