import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { expectNoAxeViolations } from '../../test/axe';
import { Input } from '../Input';
import { Field } from './Field';

describe('Field + Input', () => {
  it('labels the control and describes it with the description and the error', async () => {
    render(
      <Field label="Token name" description="Lowercase, dot separated." error="Use dots, not spaces.">
        <Input defaultValue="color primary" />
      </Field>,
    );
    const input = screen.getByRole('textbox', { name: 'Token name' });
    expect(input).toHaveAttribute('aria-invalid', 'true');
    const describedBy = input.getAttribute('aria-describedby') ?? '';
    const text = describedBy.split(' ').map((id) => document.getElementById(id)?.textContent).join(' ');
    expect(text).toContain('Lowercase, dot separated.');
    expect(text).toContain('Use dots, not spaces.');
    await expectNoAxeViolations();
  });

  it('Input with label wraps itself in a Field; required reaches the input', async () => {
    render(<Input label="Repository" required hint="Owner and name." />);
    const input = screen.getByRole('textbox', { name: /Repository/ });
    expect(input).toBeRequired();
    await userEvent.type(input, 'acme/tokens');
    expect(input).toHaveValue('acme/tokens');
    await expectNoAxeViolations();
  });

  it('disabled Field disables the control', () => {
    render(
      <Field label="Locked" disabled>
        <Input defaultValue="x" />
      </Field>,
    );
    expect(screen.getByRole('textbox', { name: 'Locked' })).toBeDisabled();
  });
});
