import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { expectNoAxeViolations } from '../../test/axe';
import { Alert } from './Alert';

describe('Alert', () => {
  it('danger and warning interrupt (role alert), others are polite (role status)', async () => {
    render(
      <>
        <Alert tone="danger" title="Publish failed">2 broken aliases.</Alert>
        <Alert tone="success" title="Tokens published">Version 1.4.0.</Alert>
      </>,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Publish failed');
    expect(screen.getByRole('status')).toHaveTextContent('Tokens published');
    await expectNoAxeViolations();
  });

  it('announce="off" renders static content without a live region', () => {
    render(<Alert tone="danger" announce="off" title="Read only" />);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('the dismiss button is named and calls onDismiss from the keyboard', async () => {
    const onDismiss = vi.fn();
    render(<Alert title="Sync running" onDismiss={onDismiss} dismissLabel="Dismiss sync message" />);
    await userEvent.tab();
    expect(screen.getByRole('button', { name: 'Dismiss sync message' })).toHaveFocus();
    await userEvent.keyboard('{Enter}');
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
