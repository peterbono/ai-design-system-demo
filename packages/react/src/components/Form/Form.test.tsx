import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { expectNoAxeViolations } from '../../test/axe';
import { Button } from '../Button';
import { Field } from '../Field';
import { Input } from '../Input';
import { Form, FormActions } from './Form';

describe('Form', () => {
  it('shows a server error under its field, links it from the summary, and moves focus there', async () => {
    render(
      <Form errors={{ repository: 'Repository not found. Check the owner and the name.' }}>
        <Field label="Repository" name="repository">
          <Input defaultValue="acme/desing-tokens" />
        </Field>
        <FormActions>
          <Button type="submit">Connect repository</Button>
        </FormActions>
      </Form>,
    );
    const input = screen.getByRole('textbox', { name: 'Repository' });
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAccessibleDescription('Repository not found. Check the owner and the name.');
    const summary = screen.getByRole('alert');
    expect(summary).toHaveFocus();
    expect(summary).toHaveTextContent('Fix 1 field to continue');
    await userEvent.click(screen.getByRole('link', { name: 'Repository not found. Check the owner and the name.' }));
    expect(input).toHaveFocus();
    await expectNoAxeViolations();
  });

  it('blocks submit and shows the native message when a required field is empty', async () => {
    const onSubmit = vi.fn();
    render(
      <Form onFormSubmit={onSubmit}>
        <Field label="Token name" name="name" required>
          <Input />
        </Field>
        <Button type="submit">Create token</Button>
      </Form>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Create token' }));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByRole('textbox', { name: /Token name/ })).toHaveAttribute('aria-invalid', 'true');
  });
});
