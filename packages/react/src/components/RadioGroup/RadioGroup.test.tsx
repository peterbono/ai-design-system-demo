import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { expectNoAxeViolations } from '../../test/axe';
import { Radio, RadioGroup } from './RadioGroup';

function Example(props: { onValueChange?: (v: string) => void; error?: string }) {
  return (
    <RadioGroup label="Merge strategy" defaultValue="squash" {...props}>
      <Radio value="merge" label="Merge commit" />
      <Radio value="squash" label="Squash and merge" description="One commit per pull request." />
      <Radio value="rebase" label="Rebase and merge" />
    </RadioGroup>
  );
}

describe('RadioGroup', () => {
  it('is a labelled radiogroup; arrow keys move the selection', async () => {
    const onChange = vi.fn();
    render(<Example onValueChange={onChange} />);
    expect(screen.getByRole('radiogroup', { name: 'Merge strategy' })).toBeInTheDocument();
    const squash = screen.getByRole('radio', { name: 'Squash and merge' });
    expect(squash).toHaveAttribute('aria-checked', 'true');
    await userEvent.tab();
    expect(squash).toHaveFocus();
    await userEvent.keyboard('{ArrowDown}');
    const rebase = screen.getByRole('radio', { name: 'Rebase and merge' });
    expect(rebase).toHaveFocus();
    expect(rebase).toHaveAttribute('aria-checked', 'true');
    await userEvent.keyboard('{ArrowUp}{ArrowUp}');
    expect(screen.getByRole('radio', { name: 'Merge commit' })).toHaveAttribute('aria-checked', 'true');
    expect(onChange).toHaveBeenLastCalledWith('merge');
    await expectNoAxeViolations();
  });

  it('links the group error', () => {
    render(<Example error="Pick a merge strategy before you publish." />);
    expect(screen.getByRole('radiogroup')).toHaveAccessibleDescription('Pick a merge strategy before you publish.');
  });
});
