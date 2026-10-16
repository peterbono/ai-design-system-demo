import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { expectNoAxeViolations } from '../../test/axe';
import { Button } from '../Button';
import { Menu, MenuCheckboxItem, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from './Menu';

function TokenMenu({ onRename = () => {} }: { onRename?: () => void }) {
  return (
    <Menu>
      <MenuTrigger render={<Button variant="secondary" />}>Token actions</MenuTrigger>
      <MenuContent>
        <MenuItem onClick={onRename}>Rename</MenuItem>
        <MenuItem>Duplicate</MenuItem>
        <MenuCheckboxItem defaultChecked={false}>Show deprecated</MenuCheckboxItem>
        <MenuSeparator />
        <MenuItem tone="danger">Delete</MenuItem>
      </MenuContent>
    </Menu>
  );
}

describe('Menu', () => {
  it('opens with the keyboard and moves the highlight with arrows', async () => {
    const user = userEvent.setup();
    render(<TokenMenu />);
    const trigger = screen.getByRole('button', { name: 'Token actions' });
    trigger.focus();
    await user.keyboard('{ArrowDown}');
    const menu = await screen.findByRole('menu');
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    await waitFor(() => expect(screen.getByRole('menuitem', { name: 'Rename' })).toHaveFocus());
    await user.keyboard('{ArrowDown}');
    await waitFor(() => expect(screen.getByRole('menuitem', { name: 'Duplicate' })).toHaveFocus());
    await expectNoAxeViolations(menu);
  });

  it('Enter activates the highlighted item and closes the menu', async () => {
    const user = userEvent.setup();
    const onRename = vi.fn();
    render(<TokenMenu onRename={onRename} />);
    screen.getByRole('button', { name: 'Token actions' }).focus();
    await user.keyboard('{ArrowDown}');
    await waitFor(() => expect(screen.getByRole('menuitem', { name: 'Rename' })).toHaveFocus());
    await user.keyboard('{Enter}');
    expect(onRename).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());
  });

  it('a checkbox item toggles aria-checked and keeps the menu open', async () => {
    const user = userEvent.setup();
    render(<TokenMenu />);
    await user.click(screen.getByRole('button', { name: 'Token actions' }));
    const item = await screen.findByRole('menuitemcheckbox', { name: 'Show deprecated' });
    expect(item).toHaveAttribute('aria-checked', 'false');
    await user.click(item);
    expect(item).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('menu')).toBeInTheDocument();
  });

  it('Escape closes it and returns focus to the trigger', async () => {
    const user = userEvent.setup();
    render(<TokenMenu />);
    const trigger = screen.getByRole('button', { name: 'Token actions' });
    trigger.focus();
    await user.keyboard('{ArrowDown}');
    await screen.findByRole('menu');
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());
    await waitFor(() => expect(trigger).toHaveFocus());
  });
});
