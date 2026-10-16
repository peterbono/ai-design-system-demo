import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Copy } from 'lucide-react';
import { describe, expect, it } from 'vitest';
import { expectNoAxeViolations } from '../../test/axe';
import { IconButton } from '../IconButton';
import { Tooltip, TooltipProvider } from './Tooltip';

// Base UI tooltips are visual labels: the trigger carries the accessible name (aria-label matching the
// tooltip text), so screen readers never depend on the popup. See Tooltip.docs.json.
describe('Tooltip', () => {
  it('shows on keyboard focus, matches the trigger name, and Escape hides it', async () => {
    const user = userEvent.setup();
    render(
      <TooltipProvider delay={0}>
        <Tooltip content="Copy token name">
          <IconButton icon={Copy} label="Copy token name" />
        </Tooltip>
      </TooltipProvider>,
    );
    await user.tab();
    const trigger = screen.getByRole('button', { name: 'Copy token name' });
    expect(trigger).toHaveFocus();
    await waitFor(() => expect(document.querySelector('[data-base-ui-portal] [data-open]')).toBeInTheDocument());
    const popup = document.querySelector('[data-base-ui-portal] [data-open] [data-open]');
    expect(popup).toHaveTextContent('Copy token name');
    expect(trigger).toHaveAttribute('data-popup-open');
    await expectNoAxeViolations();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(trigger).not.toHaveAttribute('data-popup-open'));
  });

  it('opens on hover', async () => {
    const user = userEvent.setup();
    render(
      <TooltipProvider delay={0}>
        <Tooltip content="Copy token name">
          <IconButton icon={Copy} label="Copy token name" />
        </Tooltip>
      </TooltipProvider>,
    );
    const trigger = screen.getByRole('button', { name: 'Copy token name' });
    await user.hover(trigger);
    await waitFor(() => expect(trigger).toHaveAttribute('data-popup-open'));
  });
});
