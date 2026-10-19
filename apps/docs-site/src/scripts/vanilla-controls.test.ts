// @vitest-environment jsdom
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { initVanillaControls, paintVanilla } from './vanilla-controls';

// The markup Base UI renders on the server for a DS Switch, Checkbox and RadioGroup (trimmed to what matters).
const html = `
<form>
  <label data-pseudo-root=""><span role="switch" tabindex="0" aria-checked="false" data-unchecked="" data-vanilla="" id="sw"><span data-unchecked=""></span></span><input type="checkbox" tabindex="-1" aria-hidden="true" /><span id="sw-text">Exact match</span></label>
  <label data-pseudo-root=""><span role="checkbox" tabindex="0" aria-checked="false" data-unchecked="" data-vanilla="" id="cb"><span data-unchecked=""></span></span><input type="checkbox" name="xp-ft" value="core" tabindex="-1" aria-hidden="true" /><span id="cb-text">Core</span></label>
  <fieldset><div role="radiogroup" data-vanilla="">
    <label data-pseudo-root=""><span role="radio" tabindex="-1" aria-checked="true" data-checked="" id="r0"></span><input type="radio" name="u" value="" checked aria-hidden="true" /><span>Any</span></label>
    <label data-pseudo-root=""><span role="radio" tabindex="-1" aria-checked="false" data-unchecked="" id="r1"></span><input type="radio" name="u" value="used" aria-hidden="true" /><span id="r1-text">In use</span></label>
  </div></fieldset>
  <div role="radiogroup" data-vanilla="" data-segmented-control=""><div data-segment-track="">
    <button role="radio" aria-checked="true" data-value="all" id="s0"></button><input type="radio" value="all" checked aria-hidden="true" />
    <button role="radio" aria-checked="false" data-value="color" id="s1"></button><input type="radio" value="color" aria-hidden="true" />
  </div></div>
</form>`;

const $ = (id: string) => document.getElementById(id)!;
const input = (name: string, value: string) => document.querySelector<HTMLInputElement>(`input[name="${name}"][value="${value}"]`)!;

beforeAll(() => {
  document.body.innerHTML = html;
  initVanillaControls();
});

beforeEach(() => {
  document.body.innerHTML = html;
  paintVanilla();
});

describe('static checkbox', () => {
  it('toggles its hidden input on a click on the box or the label, and sends change', () => {
    const changed = vi.fn();
    document.querySelector('form')!.addEventListener('change', (e) => changed((e.target as HTMLInputElement).value));
    $('cb').click();
    expect(input('xp-ft', 'core').checked).toBe(true);
    expect($('cb').getAttribute('aria-checked')).toBe('true');
    expect($('cb').hasAttribute('data-checked')).toBe(true);
    $('cb-text').click();
    expect(input('xp-ft', 'core').checked).toBe(false);
    expect(changed).toHaveBeenCalledTimes(2);
  });

  it('toggles with Space', () => {
    $('cb').dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
    expect(input('xp-ft', 'core').checked).toBe(true);
  });

  it('paints from a checked state a script set', () => {
    input('xp-ft', 'core').checked = true;
    paintVanilla();
    expect($('cb').getAttribute('aria-checked')).toBe('true');
  });
});

describe('static radio group', () => {
  it('selects one radio and moves with the arrow keys', () => {
    $('r1-text').click();
    expect(input('u', 'used').checked).toBe(true);
    expect($('r0').getAttribute('aria-checked')).toBe('false');
    expect($('r1').tabIndex).toBe(0);
    $('r1').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(input('u', '').checked).toBe(true);
  });
});

describe('static switch', () => {
  it('leaves the state to the page script, forwards label clicks and follows aria-checked', async () => {
    const clicks = vi.fn();
    $('sw').addEventListener('click', () => {
      clicks();
      $('sw').setAttribute('aria-checked', String($('sw').getAttribute('aria-checked') !== 'true'));
    });
    $('sw-text').click();
    expect(clicks).toHaveBeenCalledTimes(1);
    await Promise.resolve();
    expect($('sw').hasAttribute('data-checked')).toBe(true);
    $('sw').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(clicks).toHaveBeenCalledTimes(2);
  });
});

describe('static segmented control', () => {
  it('is left to scripts/shell.ts', () => {
    paintVanilla();
    expect($('s1').getAttribute('aria-checked')).toBe('false');
  });
});
