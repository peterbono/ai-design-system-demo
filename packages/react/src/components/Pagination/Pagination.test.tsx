import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { expectNoAxeViolations } from '../../test/axe';
import { Pagination, getPageItems } from './Pagination';

describe('Pagination', () => {
  it('builds page ranges with ellipses', () => {
    expect(getPageItems(1, 5)).toEqual([1, 2, 3, 4, 5]);
    expect(getPageItems(1, 12)).toEqual([1, 2, 3, 4, 5, 'end-ellipsis', 12]);
    expect(getPageItems(6, 12)).toEqual([1, 'start-ellipsis', 5, 6, 7, 'end-ellipsis', 12]);
    expect(getPageItems(12, 12)).toEqual([1, 'start-ellipsis', 8, 9, 10, 11, 12]);
  });

  it('marks the current page and calls onPageChange from previous, next and page buttons', async () => {
    const onPageChange = vi.fn();
    render(<Pagination page={6} pageCount={12} onPageChange={onPageChange} />);
    expect(screen.getByRole('navigation', { name: 'Pagination' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Page 6' })).toHaveAttribute('aria-current', 'page');
    await userEvent.click(screen.getByRole('button', { name: 'Next page' }));
    expect(onPageChange).toHaveBeenLastCalledWith(7);
    await userEvent.click(screen.getByRole('button', { name: 'Previous page' }));
    expect(onPageChange).toHaveBeenLastCalledWith(5);
    screen.getByRole('button', { name: 'Page 12' }).focus();
    await userEvent.keyboard('{Enter}');
    expect(onPageChange).toHaveBeenLastCalledWith(12);
    await expectNoAxeViolations();
  });

  it('disables previous on the first page and next on the last', () => {
    const { rerender } = render(<Pagination page={1} pageCount={4} />);
    expect(screen.getByRole('button', { name: 'Previous page' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Next page' })).toBeEnabled();
    rerender(<Pagination page={4} pageCount={4} />);
    expect(screen.getByRole('button', { name: 'Next page' })).toBeDisabled();
  });

  it('uncontrolled compact variant moves between pages', async () => {
    render(<Pagination variant="compact" pageCount={12} defaultPage={3} />);
    expect(screen.getByRole('navigation')).toHaveTextContent('Page 3 of 12');
    await userEvent.click(screen.getByRole('button', { name: 'Next page' }));
    expect(screen.getByRole('navigation')).toHaveTextContent('Page 4 of 12');
    await expectNoAxeViolations();
  });
});
