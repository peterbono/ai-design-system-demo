import { render, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { FigmaReference } from './FigmaReference';

// The renderer behind the Figma fidelity check: a render plan (planReference in @bridge-ds/core) drawn from code.
const draw = (plan: unknown) => render(<FigmaReference plan={JSON.stringify(plan)} />);
const error = () => document.querySelector('[data-fidelity-error]')?.textContent ?? null;

describe('FigmaReference', () => {
  it('draws HTML elements of a popup example as HTML, not as design system exports', async () => {
    draw({
      component: 'Popover',
      props: { defaultOpen: true },
      children: [
        { c: 'PopoverTrigger', children: ['Open'] },
        {
          c: 'PopoverContent',
          children: [
            { c: 'p', children: ['Share this token'] },
            { c: 'ul', children: [{ c: 'li', children: ['One'] }] },
            { c: 'div', children: ['Footer'] },
          ],
        },
      ],
      popup: { className: 'popup' },
    });
    expect(error()).toBeNull();
    await waitFor(() => expect(document.body).toHaveTextContent('Share this token'));
    expect(document.querySelector('ul li')).toHaveTextContent('One');
  });

  it('refuses elements that run or embed content', () => {
    draw({ component: 'Card', props: {}, children: [{ c: 'script', children: ['x'] }] });
    expect(error()).toBe('<script> is not drawn from an example');
  });

  it('gives a component that takes one element (a tooltip trigger) that element, not a list', async () => {
    draw({
      component: 'Tooltip',
      props: { content: 'Copy token name', defaultOpen: true },
      children: [{ c: 'Button', children: ['Copy'] }],
      popup: { className: 'tooltip' },
    });
    expect(error()).toBeNull();
    await waitFor(() => expect(document.body).toHaveTextContent('Copy token name'));
  });

  it('still names a component the package does not export', () => {
    draw({ component: 'Card', props: {}, children: [{ c: 'Nope', children: ['x'] }] });
    expect(error()).toBe('Nope is not exported by @bridge-ds/react');
  });
});
