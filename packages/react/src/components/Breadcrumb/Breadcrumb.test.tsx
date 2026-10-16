import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { expectNoAxeViolations } from '../../test/axe';
import { Breadcrumb } from './Breadcrumb';

const items = [
  { label: 'Library', href: '/library' },
  { label: 'Components', href: '/library/components' },
  { label: 'Forms', href: '/library/components/forms' },
  { label: 'Input', href: '/library/components/forms/input' },
  { label: 'Accessibility' },
];

describe('Breadcrumb', () => {
  it('is a named navigation landmark with an ordered list and the current page marked', async () => {
    render(<Breadcrumb items={items} />);
    const nav = screen.getByRole('navigation', { name: 'Breadcrumb' });
    expect(nav.querySelector('ol')).not.toBeNull();
    expect(screen.getAllByRole('listitem')).toHaveLength(5);
    expect(screen.getByText('Accessibility')).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Components' })).toHaveAttribute('href', '/library/components');
    expect(nav.querySelectorAll('svg[aria-hidden="true"]')).toHaveLength(4);
    await expectNoAxeViolations();
  });

  it('collapses the middle and expands it from the keyboard', async () => {
    render(<Breadcrumb items={items} maxItems={3} />);
    expect(screen.queryByRole('link', { name: 'Components' })).toBeNull();
    const more = screen.getByRole('button', { name: 'Show 2 more levels' });
    await userEvent.tab();
    await userEvent.tab();
    expect(more).toHaveFocus();
    await userEvent.keyboard('{Enter}');
    expect(screen.getByRole('link', { name: 'Components' })).toBeInTheDocument();
    await expectNoAxeViolations();
  });
});
