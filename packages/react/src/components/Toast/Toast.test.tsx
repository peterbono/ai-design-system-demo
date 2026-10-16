import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { expectNoAxeViolations } from '../../test/axe';
import { ToastProvider, useToast, type UseToastReturn } from './Toast';

let api: UseToastReturn;
function Capture() {
  api = useToast();
  return null;
}

function setup() {
  return render(
    <ToastProvider>
      <Capture />
    </ToastProvider>,
  );
}

describe('Toast', () => {
  it('add() shows a toast with title and description inside a live region', async () => {
    setup();
    act(() => {
      api.add({ title: 'Tokens published', description: 'Version 1.4.0 is live.', timeout: 0 });
    });
    const toast = await screen.findByRole('dialog', { name: 'Tokens published' });
    expect(toast).toHaveTextContent('Version 1.4.0 is live.');
    expect(toast.closest('[aria-live="polite"]')).toHaveAttribute('role', 'region');
    await expectNoAxeViolations();
  });

  it('the close button dismisses the toast', async () => {
    setup();
    act(() => {
      api.success('Link copied', { timeout: 0 });
    });
    await screen.findByRole('dialog', { name: 'Link copied' });
    // Base UI hides the close button from the accessibility tree until the stack is expanded (hover, focus or F6).
    await userEvent.click(await screen.findByLabelText('Dismiss notification'));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Link copied' })).toBeNull());
  });

  it('the action button fires its handler', async () => {
    setup();
    const onClick = vi.fn();
    act(() => {
      api.add({ title: 'Token deleted', action: { label: 'Undo', onClick } });
    });
    await userEvent.click(await screen.findByRole('button', { name: 'Undo', hidden: true }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('error() marks the toast with the danger tone', async () => {
    setup();
    act(() => {
      api.error('Publish failed', { timeout: 0 });
    });
    // High priority (danger) toasts are announced assertively.
    await waitFor(() => expect(document.querySelector('[role="alertdialog"]')).not.toBeNull());
    const toast = document.querySelector('[role="alertdialog"]');
    expect(toast).toHaveAttribute('data-type', 'danger');
    expect(toast).toHaveTextContent('Publish failed');
  });
});
