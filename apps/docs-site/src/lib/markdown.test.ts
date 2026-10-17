import { describe, expect, it } from 'vitest';
import { mdTitleHtml, mdTitleText, oneLineTitle, truncateWords } from './markdown';

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
