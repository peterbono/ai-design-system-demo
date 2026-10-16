import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { expectNoAxeViolations } from '../../test/axe';
import { Switch } from './Switch';

describe('Switch', () => {
  it('has role switch, toggles with Space and click, exposes aria-checked', async () => {
    const onChange = vi.fn();
    render(<Switch label="Auto-publish tokens" description="Publishes after two approvals." onCheckedChange={onChange} />);
    const sw = screen.getByRole('switch', { name: 'Auto-publish tokens' });
    expect(sw).toHaveAttribute('aria-checked', 'false');
    expect(sw).toHaveAccessibleDescription('Publishes after two approvals.');
    await userEvent.tab();
    expect(sw).toHaveFocus();
    await userEvent.keyboard(' ');
    expect(sw).toHaveAttribute('aria-checked', 'true');
    await userEvent.click(screen.getByText('Auto-publish tokens'));
    expect(sw).toHaveAttribute('aria-checked', 'false');
    expect(onChange).toHaveBeenCalledTimes(2);
    await expectNoAxeViolations();
  });

  it('disabled cannot be toggled', async () => {
    render(<Switch label="Locked" disabled defaultChecked />);
    const sw = screen.getByRole('switch', { name: 'Locked' });
    await userEvent.click(sw);
    expect(sw).toHaveAttribute('aria-checked', 'true');
  });
});
