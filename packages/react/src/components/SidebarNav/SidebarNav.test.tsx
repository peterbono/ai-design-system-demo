import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { expectNoAxeViolations } from '../../test/axe';
import { SidebarNav, SidebarNavItem, SidebarNavSection } from './SidebarNav';

describe('SidebarNav', () => {
  it('marks the active item and folds a collapsible section from the keyboard', async () => {
    render(
      <SidebarNav aria-label="Library">
        <SidebarNavSection title="Library">
          <SidebarNavItem href="/tokens" active>Tokens</SidebarNavItem>
          <SidebarNavItem href="/components" count={4}>Components</SidebarNavItem>
        </SidebarNavSection>
        <SidebarNavSection title="Governance" collapsible>
          <SidebarNavItem href="/reviews">Reviews</SidebarNavItem>
        </SidebarNavSection>
      </SidebarNav>,
    );
    expect(screen.getByRole('navigation', { name: 'Library' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Tokens' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: /Components/ })).not.toHaveAttribute('aria-current');
    const trigger = screen.getByRole('button', { name: 'Governance' });
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    trigger.focus();
    await userEvent.keyboard('{Enter}');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await expectNoAxeViolations();
  });
});
