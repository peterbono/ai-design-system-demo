// Library health on Studio Quality: the three figures, the verdict, the shared text and the header image.
import { describe, expect, it } from 'vitest';
import { combinedAdoption, escapeXml, healthFigures, healthSentence, qualityShareText, qualitySvg, wrapWords, type ShareColors } from './library-health';

const m = (ds: number, ui: number) => ({ dsComponentInstances: ds, uiComponentInstances: ui });
const healthy = () =>
  healthFigures({
    contrast: { total: 296, fail: 0, brands: 2 },
    adoption: [
      { now: m(239, 265), before: m(0, 526) },
      { now: m(210, 210), before: m(47, 89) },
    ],
    guidance: { total: 48, reviewed: 46, drafted: 1, missing: 1 },
  });
const colors: ShareColors = { page: '#ffffff', zone: '#cfe8ff', ink: '#15202b', muted: '#5b6672', line: '#e3e8ee', danger: '#b42318' };

describe('combinedAdoption', () => {
  it('sums instances over products, with a before value only when every product has one', () => {
    const a = combinedAdoption([{ now: m(239, 265), before: m(0, 526) }, { now: m(210, 210), before: m(47, 89) }])!;
    expect(a.products).toBe(2);
    expect(Math.round(a.now * 10) / 10).toBe(94.5);
    expect(Math.round(a.before! * 10) / 10).toBe(7.6);
    expect(combinedAdoption([{ now: m(1, 2) }, { now: m(1, 1), before: m(0, 1) }])!.before).toBeNull();
    expect(combinedAdoption([])).toBeNull();
  });
});

describe('healthFigures', () => {
  it('gives three figures, each pointing at its section of the page', () => {
    expect(healthy().map((x) => [x.value, x.label, x.detail, x.href])).toEqual([
      ['0 failing', 'contrast checks', '296 checked in 2 brands, light and dark.', '#ql-contrast'],
      ['94.5%', 'of components come from Bridge', 'Up from 7.6% before Bridge, across 2 products.', '#ql-adoption'],
      ['46 of 48', 'components have reviewed guidance', '1 drafted by Claude to review, 1 not written yet.', '#ql-guidance'],
    ]);
  });

  it('says each figure as one plain sentence', () => {
    expect(healthy().map((x) => x.sentence)).toEqual([
      'All 296 contrast checks pass in 2 brands, light and dark.',
      '94.5% of components in 2 products come from Bridge, up from 7.6% before Bridge.',
      '46 of 48 components have reviewed usage guidance: 1 drafted by Claude to review, 1 not written yet.',
    ]);
  });

  it('leads with the failures when contrast fails, and leaves adoption out without reports', () => {
    const f = healthFigures({ contrast: { total: 296, fail: 3, brands: 1 }, adoption: [], guidance: { total: 2, reviewed: 2, drafted: 0, missing: 0 } });
    expect(f.map((x) => x.id)).toEqual(['contrast', 'guidance']);
    expect(f[0]).toMatchObject({ value: '3 failing', detail: '293 of 296 pass. The token build waits until every pair passes.', tone: 'fail' });
    expect(f[0]!.sentence).toBe('3 of 296 contrast checks fail, so the token build waits until they pass.');
    expect(f[1]!.detail).toBe('Every component is documented.');
    expect(f[1]!.sentence).toBe('2 of 2 components have reviewed usage guidance.');
  });
});

describe('healthSentence', () => {
  it('gives the verdict without repeating the figures', () => {
    expect(healthSentence(0, 0)).toBe('Nothing blocks the library and nothing needs you.');
    expect(healthSentence(0, 1)).toBe('Nothing blocks the library. 1 finding needs a look.');
    expect(healthSentence(0, 2)).toBe('Nothing blocks the library. 2 findings need a look.');
    expect(healthSentence(3, 4)).toBe('Failing contrast checks block the token build. 4 findings need a fix.');
  });
});

describe('qualityShareText', () => {
  it('reads as a short list with the link last', () => {
    const text = qualityShareText({ figures: healthy(), sentence: 'Nothing blocks the library. 2 findings need a look.', url: 'https://bridge.example/studio/quality/' });
    expect(text).toBe(
      [
        'Bridge library health',
        'Nothing blocks the library. 2 findings need a look.',
        '',
        '- All 296 contrast checks pass in 2 brands, light and dark.',
        '- 94.5% of components in 2 products come from Bridge, up from 7.6% before Bridge.',
        '- 46 of 48 components have reviewed usage guidance: 1 drafted by Claude to review, 1 not written yet.',
        '',
        'Details: https://bridge.example/studio/quality/',
      ].join('\n'),
    );
    expect(text).not.toContain(String.fromCharCode(0x2014));
  });
});

describe('wrapWords', () => {
  it('wraps on words within the budget', () => {
    expect(wrapWords('of components come from Bridge', 14)).toEqual(['of components', 'come from', 'Bridge']);
    expect(wrapWords('averyveryverylongword short', 5)).toEqual(['averyveryverylongword', 'short']);
    expect(wrapWords('  ', 10)).toEqual([]);
  });
});

describe('qualitySvg', () => {
  it('draws the Harbor block, the figures and the fonts in the given colors', () => {
    const svg = qualitySvg({ figures: healthy(), sentence: 'Nothing blocks the library.', colors, caption: 'bridge.example/studio/quality/', fontCss: '@font-face{font-family:"Fraunces"}' });
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630"')).toBe(true);
    expect(svg).toContain('<rect width="1200" height="236" fill="#cfe8ff"/>');
    expect(svg).toContain('>Library health</text>');
    expect(svg).toContain('>94.5%</text>');
    expect(svg).toContain('>46 of 48</text>');
    expect(svg).toContain("font-family=\"'Fraunces', Georgia, serif\"");
    expect(svg).toContain("font-family=\"'Instrument Sans', system-ui, sans-serif\"");
    expect(svg).toContain('<defs><style>@font-face{font-family:"Fraunces"}</style></defs>');
    expect(svg).toContain('fill="#15202b">0 failing</text>');
    expect(svg.endsWith('</svg>')).toBe(true);
  });

  it('paints a failing figure in the danger color and escapes text', () => {
    const f = healthFigures({ contrast: { total: 10, fail: 1, brands: 1 }, adoption: [], guidance: { total: 1, reviewed: 1, drafted: 0, missing: 0 } });
    const svg = qualitySvg({ figures: f, sentence: 'A <b> & "c"', colors, caption: 'x' });
    expect(svg).toContain('fill="#b42318">1 failing</text>');
    expect(svg).toContain('A &lt;b&gt; &amp; &quot;c&quot;');
    expect(svg).not.toContain('<defs>');
    expect(escapeXml("it's")).toBe('it&apos;s');
  });
});

describe('healthSentence names a single finding', () => {
  it('says what the one open finding is', () => {
    expect(healthSentence(0, 1, 'VisuallyHidden guidance is a draft')).toBe('Nothing blocks the library. VisuallyHidden guidance is a draft.');
    expect(healthSentence(0, 2, 'ignored')).toBe('Nothing blocks the library. 2 findings need a look.');
  });
});
