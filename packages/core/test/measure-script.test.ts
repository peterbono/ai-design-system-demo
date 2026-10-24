// @vitest-environment jsdom
// The in-page measure script on a DOM: which CSS variable each value was declared with, through private aliases and
// box shorthands. jsdom has no layout, so boxes are stubbed; the cascade and CSSOM it reads are real.
import { beforeEach, describe, expect, it } from 'vitest';
import { MEASURE_SCRIPT, type MeasureResult } from '../src/node/measure';

const run = (arg: Record<string, unknown> = {}) => (0, eval)(`(${MEASURE_SCRIPT})`)(arg) as MeasureResult;

beforeEach(() => {
  // A box for every element and text range: the script skips zero-size leaves as not drawn.
  const box = { left: 0, top: 0, right: 80, bottom: 32, width: 80, height: 32, x: 0, y: 0, toJSON() {} } as DOMRect;
  Element.prototype.getBoundingClientRect = () => box;
  (Range.prototype as unknown as { getBoundingClientRect: () => DOMRect }).getBoundingClientRect = () => box;
  // jsdom does not substitute var() in computed values: a declared-but-unresolved value reads as a stand-in, which is
  // all the script needs to look up the declaration behind it.
  const real = window.getComputedStyle.bind(window);
  window.getComputedStyle = ((el: Element) => {
    const cs = real(el);
    return new Proxy(cs, {
      get(target, key) {
        if (key === 'getPropertyValue') return (p: string) => {
          const v = target.getPropertyValue(p);
          return v === '' || v.includes('var(') ? '1px' : v;
        };
        const v = Reflect.get(target, key);
        return typeof v === 'function' ? v.bind(target) : v;
      },
    });
  }) as typeof window.getComputedStyle;
  document.head.innerHTML = `<style>
    :root { --space-2: 8px; --space-3: 12px; --color-blue-600: #2563eb; --color-action-bg: var(--color-blue-600); --radius-control: 6px; }
    ._button_a1b2c { display: inline-flex; border: 1px solid; gap: var(--space-2); padding: 0 var(--space-3); padding-top: 2px; border-radius: var(--radius-control); --_bg: var(--color-action-bg); background-color: var(--_bg); }
    ._button_a1b2c._ghost_x9y8z { background-color: transparent; }
    ._label_q1w2e { font-weight: 600; }
  </style>`;
  document.body.innerHTML = `<div id="storybook-root"><div class="decorator"><button class="_button_a1b2c"><span class="_label_q1w2e">Save</span></button></div></div>`;
});

describe('MEASURE_SCRIPT', () => {
  it('goes down plain wrappers to the component and reads its tree', () => {
    const r = run();
    expect(r.error).toBeUndefined();
    expect(r.wrappers).toBe(2); // the root's own div, then the decorator
    expect(r.root?.tag).toBe('button');
    expect(r.root?.children.map((c) => [c.tag, c.kind, c.text])).toEqual([['span', 'text', 'Save']]);
    expect(r.rules).toBeGreaterThan(0);
  });

  it('ties values to the variable the winning declaration names, following private aliases', () => {
    const t = run().root!.tokens;
    expect(t['background-color']).toMatchObject({ via: 'declared', chain: ['--_bg', '--color-action-bg', '--color-blue-600'], exact: true });
    expect(t['border-top-left-radius']).toMatchObject({ via: 'declared', chain: ['--radius-control'] });
    // `padding: 0 var(--space-3)`: the sides read the second value, top and bottom the literal 0.
    expect(t['padding-left']?.chain).toEqual(['--space-3']);
    expect(t['padding-top']?.via).not.toBe('declared');
  });

  it('lets a more specific rule win over the token rule', () => {
    document.querySelector('button')!.classList.add('_ghost_x9y8z');
    expect(run().root!.tokens['background-color']).toBeUndefined();
  });

  it('measures the root element itself when unwrap is off, and says when the root is missing', () => {
    expect(run({ root: '.decorator', unwrap: false }).root?.tag).toBe('div');
    expect(run({ root: '#nope' })).toMatchObject({ error: expect.stringContaining('#nope') });
  });
});
