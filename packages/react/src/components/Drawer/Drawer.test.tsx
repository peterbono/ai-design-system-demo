import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { expectNoAxeViolations } from '../../test/axe';
import { Button } from '../Button';
import { Drawer, DrawerContent, DrawerTrigger } from './Drawer';

function stubHeights(scrollHeight: number, clientHeight: number) {
  vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(scrollHeight);
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(clientHeight);
}

function Changes() {
  return (
    <Drawer>
      <DrawerTrigger render={<Button variant="secondary" />}>Review changes</DrawerTrigger>
      <DrawerContent title="Token changes" description="Read them all before you approve.">
        <p>color.surface.default moved to the new neutral ramp.</p>
      </DrawerContent>
    </Drawer>
  );
}

async function open() {
  const user = userEvent.setup();
  render(<Changes />);
  await user.click(screen.getByRole('button', { name: 'Review changes' }));
  const dialog = await screen.findByRole('dialog', { name: 'Token changes' });
  return { user, dialog };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Drawer', () => {
  it('opens named by its title and keeps focus inside', async () => {
    stubHeights(100, 100);
    const { dialog } = await open();
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
    await expectNoAxeViolations(dialog);
  });

  it('a body that overflows is a focusable region named by the title', async () => {
    stubHeights(2000, 400);
    const { user, dialog } = await open();
    const region = await screen.findByRole('region', { name: 'Token changes' });
    expect(region).toHaveAttribute('tabindex', '0');
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
    // Initial focus is unchanged (Base UI decides); from the close button, Tab reaches the body next.
    screen.getByRole('button', { name: 'Close panel' }).focus();
    await user.tab();
    expect(region).toHaveFocus();
    await expectNoAxeViolations(dialog);
  });

  it('a body that fits adds no tab stop', async () => {
    stubHeights(200, 400);
    const { dialog } = await open();
    const body = screen.getByText(/color.surface.default/).parentElement!;
    expect(body).not.toHaveAttribute('tabindex');
    expect(screen.queryByRole('region')).not.toBeInTheDocument();
    await expectNoAxeViolations(dialog);
  });
});
