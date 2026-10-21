import { describe, expect, it } from 'vitest';
import { inline, mdTitleHtml, mdTitleText, oneLineTitle, truncateWords } from './markdown';

describe('mdTitleText', () => {
  it('drops backticks, bold markers and link targets', () => {
    expect(mdTitleText('**Breaking:** `Button` now uses [`--radius-control`](https://x.dev/a_(b)) for its corners')).toBe(
      'Breaking: Button now uses --radius-control for its corners',
    );
  });
  it('keeps the text of plain links and collapses whitespace and line breaks', () => {
    expect(mdTitleText('See [the guide](/docs/guide/)\n  for   details')).toBe('See the guide for details');
  });
  it('keeps underscores and stars that are not emphasis', () => {
    expect(mdTitleText('Rename snake_case_name and color.* tokens')).toBe('Rename snake_case_name and color.* tokens');
    expect(mdTitleText('Make it _clear_ and *quick*')).toBe('Make it clear and quick');
  });
  it('leaves Markdown inside code spans untouched', () => {
    expect(mdTitleText('Allow `**` in `a_b_c`')).toBe('Allow ** in a_b_c');
  });
  it('handles empty input', () => {
    expect(mdTitleText('')).toBe('');
    expect(mdTitleText(null)).toBe('');
  });
});

describe('mdTitleHtml', () => {
  it('renders inline code as <code> and strips the rest', () => {
    expect(mdTitleHtml('**New** `Tabs` component, see [docs](/c/tabs/)')).toBe('New <code>Tabs</code> component, see docs');
  });
  it('escapes HTML in prose and in code', () => {
    expect(mdTitleHtml('Fix <Select> and `a < b && "c"`')).toBe('Fix &lt;Select&gt; and <code>a &lt; b &amp;&amp; &quot;c&quot;</code>');
  });
});

describe('oneLineTitle', () => {
  it('keeps the first sentence as plain text', () => {
    expect(oneLineTitle('`bridge audit` counts every instance. Router links outside a DS component now count too.')).toBe('bridge audit counts every instance.');
  });
  it('does not stop inside dotted names', () => {
    expect(oneLineTitle('One `bridge.config.json` and one schema for every package')).toBe('One bridge.config.json and one schema for every package');
  });
  it('cuts long sentences at a word boundary with an ellipsis', () => {
    const t = oneLineTitle('Packages are publishable under the scope with provenance and a changelog per package so teams can pin them', 60);
    expect(t.length).toBeLessThanOrEqual(60);
    expect(t.endsWith('…')).toBe(true);
    expect(t).toBe('Packages are publishable under the scope with provenance…');
  });
  it('handles empty input', () => {
    expect(oneLineTitle(null)).toBe('');
  });
});

describe('truncateWords', () => {
  it('returns short text unchanged', () => {
    expect(truncateWords('Short title', 40)).toBe('Short title');
  });
  it('drops trailing punctuation before the ellipsis', () => {
    expect(truncateWords('Alpha beta, gamma delta epsilon', 13)).toBe('Alpha beta…');
  });
  it('cuts a single long word hard', () => {
    expect(truncateWords('abcdefghijklmnopqrstuvwxyz', 10)).toBe('abcdefghi…');
  });
});

describe('inline (XSS)', () => {
  it('keeps safe links and marks external ones as user content', () => {
    expect(inline('See [the guide](/docs/guide/) or [GitHub](https://github.com/a/b)')).toBe(
      'See <a href="/docs/guide/">the guide</a> or <a href="https://github.com/a/b" rel="noopener noreferrer nofollow ugc">GitHub</a>',
    );
  });
  it('renders javascript:, data: and vbscript: links as plain text', () => {
    for (const url of ['javascript:void%200', 'JaVaScRiPt:alert`1`', 'data:text/html;base64,PHNjcmlwdD4=', 'vbscript:msgbox'])
      expect(inline(`[click](${url})`)).toBe('click');
    // The target ends at the first closing parenthesis: still no link.
    expect(inline('[click](javascript:alert(1))')).toBe('click)');
  });
  it('cannot break out of the href attribute', () => {
    const out = inline('[x](https://a.dev/"onmouseover="alert(1))');
    expect(out).not.toContain('"onmouseover');
    expect(out).toContain('&quot;onmouseover=&quot;alert(1');
    expect(inline(`[x](/a'onclick='alert(1))`)).not.toContain(`'onclick`);
  });
  it('escapes raw HTML in text, code and bold', () => {
    const out = inline('<img src=x onerror=alert(1)> `<script>` **<b>**');
    expect(out).toBe('&lt;img src=x onerror=alert(1)&gt; <code>&lt;script&gt;</code> <strong>&lt;b&gt;</strong>');
  });
  it('keeps escaped entities in a link target as the literal URL', () => {
    expect(inline('[q](https://x.dev/?a=1&b=2)')).toContain('href="https://x.dev/?a=1&amp;b=2"');
  });
});

describe('mdTitleHtml (XSS)', () => {
  it('drops links and escapes HTML from PR and changeset titles', () => {
    const out = mdTitleHtml('[x](javascript:alert(1)) <img src=x onerror=alert(1)> `"><svg onload=alert(1)>`');
    expect(out).not.toMatch(/<(img|svg|a)\b/);
    expect(out).not.toContain('javascript:');
  });
});
