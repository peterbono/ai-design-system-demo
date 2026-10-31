// The Confluence renderings of a Library doc page: HTML for the editor and Markdown for the export, from one model.
import { describe, expect, it } from 'vitest';
import { absoluteUrl, confluenceKey, confluenceSrc, noEmDash, toConfluenceHtml, toMarkdown, type DocPage } from './render';

const O = { origin: 'https://bridge.example.com', date: '2026-10-31' };
const PAGE: DocPage = {
  route: '/components/button/',
  title: 'Button',
  summary: 'Starts an action \u2014 one per view.',
  blocks: [
    { kind: 'heading', level: 2, text: 'Props' },
    { kind: 'paragraph', text: ['Read ', { text: 'Link', href: '/components/link/' }, ' and ', { text: 'size', code: true }, '.'] },
    {
      kind: 'table',
      head: ['Prop', 'Type', 'Description'],
      rows: [
        [[{ text: 'variant', code: true }], [{ text: "'primary' | 'secondary'", code: true }], 'Visual weight <b>'],
        [[{ text: 'size', code: true }], [{ text: "'sm' | 'md'", code: true }], ''],
      ],
    },
    { kind: 'heading', level: 2, text: 'Color' },
    { kind: 'table', head: ['Token', 'Light', 'Swatch'], rows: [[[{ text: 'color.bg.default', code: true }], '#ffffff', { text: '', swatch: '#FFFFFF' }], ['bad', 'x', { text: '', swatch: 'red;background:url(x)' }]] },
    { kind: 'code', code: '<Button variant="primary">Save</Button>', lang: 'tsx' },
    { kind: 'list', items: ['One', ['Two ', { text: 'Storybook', href: 'https://storybook.example.com/?path=/story/x' }]] },
    { kind: 'image', src: '/og.png', alt: 'Preview' },
    { kind: 'paragraph', text: [{ text: 'bad', href: 'javascript:alert(1)' }] },
  ],
};

describe('toConfluenceHtml', () => {
  const html = toConfluenceHtml(PAGE, O);
  it('writes headings, paragraphs and lists', () => {
    expect(html).toContain('<h1>Button</h1>');
    expect(html).toContain('<h2>Props</h2>');
    expect(html).toContain('<ul><li>One</li><li>Two <a href="https://storybook.example.com/?path=/story/x">Storybook</a></li></ul>');
  });
  it('writes tables with a header row and escaped cells', () => {
    expect(html).toContain('<table><thead><tr><th>Prop</th><th>Type</th><th>Description</th></tr></thead><tbody>');
    expect(html).toContain('<td><code>&#39;primary&#39; | &#39;secondary&#39;</code></td><td>Visual weight &lt;b&gt;</td>');
  });
  it('paints a color swatch cell from a checked hex only', () => {
    expect(html).toContain('<td data-highlight-colour="#ffffff" style="background-color: #ffffff">&nbsp;</td>');
    expect(html).not.toContain('url(x)');
  });
  it('writes code blocks as pre code, escaped', () => {
    expect(html).toContain('<pre><code class="language-tsx" data-language="tsx">&lt;Button variant=&quot;primary&quot;&gt;Save&lt;/Button&gt;</code></pre>');
  });
  it('makes links and images absolute and drops unsafe ones', () => {
    expect(html).toContain('<a href="https://bridge.example.com/components/link/">Link</a>');
    expect(html).toContain('<img src="https://bridge.example.com/og.png" alt="Preview" />');
    expect(html).not.toContain('javascript:');
  });
  it('never writes an em dash', () => {
    expect(html).not.toContain('\u2014');
    expect(html).toContain('Starts an action, one per view.');
  });
  it('ends with the source of truth footer', () => {
    expect(html.trim().endsWith('<p><em>Generated from Bridge on 2026-10-31. Edit it in Bridge: <a href="https://bridge.example.com/components/button/">https://bridge.example.com/components/button/</a></em></p>')).toBe(true);
  });
  it('carries no script and no interactive element', () => {
    expect(html).not.toMatch(/<(script|iframe|button|input|style)\b/i);
  });
});

describe('toMarkdown', () => {
  const md = toMarkdown(PAGE, O);
  it('writes headings and GFM tables with escaped pipes', () => {
    expect(md).toContain('# Button\n');
    expect(md).toContain('## Props');
    expect(md).toContain('| Prop | Type | Description |\n| --- | --- | --- |');
    expect(md).toContain("| `variant` | `'primary' \\| 'secondary'` | Visual weight \\<b\\> |");
  });
  it('keeps the hex of a color and leaves the swatch cell empty', () => {
    expect(md).toContain('| `color.bg.default` | #ffffff |   |');
  });
  it('fences code with its language', () => {
    expect(md).toContain('```tsx\n<Button variant="primary">Save</Button>\n```');
  });
  it('makes links and images absolute', () => {
    expect(md).toContain('[Link](https://bridge.example.com/components/link/)');
    expect(md).toContain('![Preview](https://bridge.example.com/og.png)');
    expect(md).not.toContain('javascript:');
  });
  it('never writes an em dash and ends with the footer', () => {
    expect(md).not.toContain('\u2014');
    expect(md.trim().endsWith('*Generated from Bridge on 2026-10-31. Edit it in Bridge: https://bridge.example.com/components/button/*')).toBe(true);
  });
});

describe('helpers', () => {
  it('noEmDash turns a spaced dash into a comma and a bare one into a hyphen', () => {
    expect(noEmDash('a \u2014 b')).toBe('a, b');
    expect(noEmDash('a\u2014b')).toBe('a-b');
  });
  it('absoluteUrl keeps absolute https links, resolves relative ones, drops unsafe schemes', () => {
    expect(absoluteUrl('https://x.dev/a', O.origin)).toBe('https://x.dev/a');
    expect(absoluteUrl('/tokens/?t=color.bg', O.origin)).toBe('https://bridge.example.com/tokens/?t=color.bg');
    expect(absoluteUrl('data:text/html,x', O.origin)).toBe('');
  });
  it('one copy file per page route', () => {
    expect(confluenceKey('/components/button/')).toBe('components-button');
    expect(confluenceSrc('/foundations/color/')).toBe('/confluence/foundations-color.json');
    expect(confluenceKey('/tokens/')).toBe('tokens');
  });
});
