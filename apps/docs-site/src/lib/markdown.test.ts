import { describe, expect, it } from 'vitest';
import { mdTitleHtml, mdTitleText } from './markdown';

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
