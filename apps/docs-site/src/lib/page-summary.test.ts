// @vitest-environment jsdom
// The live summary sentence of a Studio page header: what each page says about its own state, and how an island
// writes it into the header.
import { describe, expect, it } from 'vitest';
import { changesSummary, setPageSummary, tokensSummary } from './page-summary';

describe('page summary', () => {
  it('says what is open on Changes, by where it stands', () => {
    expect(changesSummary({ exploring: 2, code: 1 })).toBe('2 explorations running, 1 waiting for a developer.');
    expect(changesSummary({ exploring: 1, review: 3, draft: 1, 'not-started': 2 })).toBe('1 exploration running, 2 not started, 1 draft, 3 in review.');
    expect(changesSummary({})).toBe('Nothing in progress right now.');
  });

  it('counts tokens and names their themes', () => {
    expect(tokensSummary(119, ['Light', 'Dark'])).toBe('119 tokens, light and dark.');
    expect(tokensSummary(1, ['Light'])).toBe('1 token.');
    expect(tokensSummary(40, ['Light', 'Dark', 'Dim'])).toBe('40 tokens, light, dark and dim.');
  });

  it('writes into the header slot, and does nothing without one', () => {
    document.body.innerHTML = '<header><p data-st-summary></p></header>';
    setPageSummary('53 components in 8 families, each with usage guidance.');
    expect(document.querySelector('[data-st-summary]')!.textContent).toBe('53 components in 8 families, each with usage guidance.');
    setPageSummary(null);
    expect(document.querySelector('[data-st-summary]')!.textContent).toBe('');
    document.body.innerHTML = '';
    expect(() => setPageSummary('x')).not.toThrow();
  });
});
