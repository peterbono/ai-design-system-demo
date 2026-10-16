import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { expectNoAxeViolations } from '../../test/axe';
import { Tag } from './Tag';

describe('Tag', () => {
  it('static tag is plain text', () => {
    render(<Tag>color.signal</Tag>);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('remove button is named "Remove <label>" and calls onRemove', async () => {
    const onRemove = vi.fn();
    render(<Tag onRemove={onRemove}>Button</Tag>);
    const remove = screen.getByRole('button', { name: 'Remove Button' });
    await userEvent.tab();
    expect(remove).toHaveFocus();
    await userEvent.keyboard('{Enter}');
    expect(onRemove).toHaveBeenCalledTimes(1);
  });

  it('toggle tag exposes aria-pressed and flips it with Space', async () => {
    const onSelectedChange = vi.fn();
    render(<Tag defaultSelected={false} onSelectedChange={onSelectedChange}>Dark theme</Tag>);
    const toggle = screen.getByRole('button', { name: 'Dark theme' });
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    toggle.focus();
    await userEvent.keyboard(' ');
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    expect(onSelectedChange).toHaveBeenCalledWith(true);
  });

  it('has no axe violations', async () => {
    render(
      <div>
        <Tag>Static</Tag>
        <Tag selected onSelectedChange={() => {}}>Selected</Tag>
        <Tag onRemove={() => {}} removeLabel="ocean brand">Ocean</Tag>
      </div>,
    );
    await expectNoAxeViolations();
  });
});
