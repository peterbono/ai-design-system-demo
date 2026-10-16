import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { expectNoAxeViolations } from '../../test/axe';
import { Textarea } from './Textarea';

describe('Textarea', () => {
  it('is a labelled multi-line textbox with hint and error', async () => {
    render(<Textarea label="Change summary" hint="Reviewers see this first." error="Add a summary before you request review." maxLength={280} showCount />);
    const box = screen.getByRole('textbox', { name: 'Change summary' });
    expect(box.tagName).toBe('TEXTAREA');
    expect(box).toHaveAttribute('aria-invalid', 'true');
    await userEvent.type(box, 'Darker steel');
    expect(screen.getByText('12 / 280')).toBeInTheDocument();
    await expectNoAxeViolations();
  });
});
