// @vitest-environment jsdom
// The home tour never sits on a dialog: a floating step waits while any dialog of the page is open (Add a product,
// Start an exploration, Account...) and comes back at the same step once it closes.
import '../../../../../../packages/react/src/test/setup';
import { createElement, useEffect, useState } from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { Dialog, DialogContent } from '@bridge-ds/react';
import { dialogOpen, useTour } from './HomeTour';

const KEY = 'bridge.test.tour';
const words = (at: 'one' | 'two') => (at === 'one' ? { title: 'Changes wait for the lead', text: 'They review it.' } : { title: 'Start here', text: 'Pick a product.' });

// A home with a tour step and a dialog the page opens on its own (a link, a repaint), never through the tour.
function Home({ dialog = false }: { dialog?: boolean }) {
  const [open, setOpen] = useState(dialog);
  useEffect(() => setOpen(dialog), [dialog]);
  const tour = useTour<'one' | 'two'>(KEY, ['one', 'two'], words, true);
  return createElement(
    'div',
    null,
    tour('one'),
    tour('two'),
    createElement(Dialog, { open, onOpenChange: setOpen }, createElement(DialogContent, { title: 'Add a product' }, createElement('p', null, 'Pick a product.'))),
  );
}

afterEach(() => {
  cleanup();
  localStorage.clear();
  document.body.innerHTML = '';
});

describe('HomeTour under dialogs', () => {
  it('hides the floating step while a dialog is open, then shows the same step again', async () => {
    const { rerender } = render(createElement(Home));
    expect(await screen.findByText('Changes wait for the lead')).toBeTruthy();

    rerender(createElement(Home, { dialog: true }));
    expect(await screen.findByRole('dialog', { name: 'Add a product' })).toBeTruthy();
    await waitFor(() => expect(screen.queryByText('Changes wait for the lead')).toBeNull());

    await userEvent.keyboard('{Escape}');
    expect(await screen.findByText('Changes wait for the lead')).toBeTruthy();
    expect(screen.queryByRole('dialog', { name: 'Add a product' })).toBeNull();
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it('counts open dialogs only: not popovers, not a dialog kept closed, not the tour itself', () => {
    const add = (html: string) => {
      const el = document.createElement('div');
      el.innerHTML = html;
      document.body.append(el);
      return el;
    };
    expect(dialogOpen()).toBe(false);
    add('<div role="dialog" data-open data-side="bottom">A popover</div>');
    add('<div hidden><div role="dialog" aria-modal="true">Search, closed</div></div>');
    add('<div class="dh-tour" role="dialog" data-open>The tour</div>');
    expect(dialogOpen()).toBe(false);
    const alert = add('<div role="alertdialog" data-open>Delete the team?</div>');
    expect(dialogOpen()).toBe(true);
    alert.remove();
    add('<div role="dialog" aria-modal="true">Account</div>');
    expect(dialogOpen()).toBe(true);
  });
});
