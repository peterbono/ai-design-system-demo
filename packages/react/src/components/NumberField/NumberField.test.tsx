import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { expectNoAxeViolations } from '../../test/axe';
import { NumberField } from './NumberField';

describe('NumberField', () => {
  it('steps with arrow keys and buttons within min and max', async () => {
    render(<NumberField label="Required approvals" defaultValue={2} min={1} max={3} />);
    const input = screen.getByRole('textbox', { name: 'Required approvals' });
    input.focus();
    await userEvent.keyboard('{ArrowUp}');
    expect(input).toHaveValue('3');
    await userEvent.keyboard('{ArrowUp}');
    expect(input).toHaveValue('3');
    await userEvent.click(screen.getByRole('button', { name: 'Decrease' }));
    expect(input).toHaveValue('2');
    await expectNoAxeViolations();
  });
});
