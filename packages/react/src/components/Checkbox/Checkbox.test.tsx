import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { expectNoAxeViolations } from '../../test/axe';
import { Checkbox } from './Checkbox';

describe('Checkbox', () => {
  it('toggles with a click on the label and with Space', async () => {
    const onChange = vi.fn();
    render(<Checkbox label="Notify reviewers" description="Sends an email per pull request." onCheckedChange={onChange} />);
    const box = screen.getByRole('checkbox', { name: 'Notify reviewers' });
    expect(box).toHaveAttribute('aria-checked', 'false');
    expect(box).toHaveAccessibleDescription('Sends an email per pull request.');
    await userEvent.click(screen.getByText('Notify reviewers'));
    expect(box).toHaveAttribute('aria-checked', 'true');
    box.focus();
    await userEvent.keyboard(' ');
    expect(box).toHaveAttribute('aria-checked', 'false');
    expect(onChange).toHaveBeenCalledTimes(2);
    await expectNoAxeViolations();
  });

  it('announces the indeterminate state as mixed', () => {
    render(<Checkbox label="All tokens" indeterminate />);
    expect(screen.getByRole('checkbox', { name: 'All tokens' })).toHaveAttribute('aria-checked', 'mixed');
  });

  it('disabled ignores clicks', async () => {
    render(<Checkbox label="Locked" disabled />);
    const box = screen.getByRole('checkbox', { name: 'Locked' });
    await userEvent.click(box);
    expect(box).toHaveAttribute('aria-checked', 'false');
  });
});
