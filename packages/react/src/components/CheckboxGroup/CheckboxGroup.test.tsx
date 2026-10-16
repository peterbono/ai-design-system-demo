import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { expectNoAxeViolations } from '../../test/axe';
import { Checkbox } from '../Checkbox';
import { CheckboxGroup } from './CheckboxGroup';

describe('CheckboxGroup', () => {
  it('a parent checkbox selects all and shows mixed when partly checked', async () => {
    render(
      <CheckboxGroup label="Notify me about" allValues={['reviews', 'merges', 'releases']} defaultValue={['reviews']}>
        <Checkbox parent label="All activity" />
        <Checkbox value="reviews" label="Review requests" />
        <Checkbox value="merges" label="Merged pull requests" />
        <Checkbox value="releases" label="Releases" />
      </CheckboxGroup>,
    );
    expect(screen.getByRole('group', { name: 'Notify me about' })).toBeInTheDocument();
    const all = screen.getByRole('checkbox', { name: 'All activity' });
    expect(all).toHaveAttribute('aria-checked', 'mixed');
    await userEvent.click(all);
    for (const name of ['Review requests', 'Merged pull requests', 'Releases']) {
      expect(screen.getByRole('checkbox', { name })).toHaveAttribute('aria-checked', 'true');
    }
    await expectNoAxeViolations();
  });
});
