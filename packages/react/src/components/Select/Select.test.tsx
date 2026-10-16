import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { expectNoAxeViolations } from '../../test/axe';
import { Field } from '../Field';
import { Select, type SelectOption } from './Select';

const THEMES: SelectOption[] = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'contrast', label: 'High contrast', disabled: true },
];

describe('Select', () => {
  it('is labelled by its Field label and shows the placeholder', async () => {
    render(<Select label="Theme" options={THEMES} placeholder="No theme" />);
    const trigger = screen.getByRole('combobox', { name: 'Theme' });
    expect(trigger).toHaveTextContent('No theme');
    await expectNoAxeViolations();
  });

  it('opens with the keyboard, moves with arrows and selects with Enter', async () => {
    const onValueChange = vi.fn();
    render(<Select label="Theme" options={THEMES} onValueChange={onValueChange} />);
    const trigger = screen.getByRole('combobox', { name: 'Theme' });
    await userEvent.tab();
    expect(trigger).toHaveFocus();
    await userEvent.keyboard('{ArrowDown}');
    const listbox = await screen.findByRole('listbox');
    expect(listbox).toBeInTheDocument();
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    await waitFor(() => expect(screen.getByRole('option', { name: 'System' })).toHaveAttribute('data-highlighted'));
    await userEvent.keyboard('{ArrowDown}');
    await waitFor(() => expect(screen.getByRole('option', { name: 'Light' })).toHaveAttribute('data-highlighted'));
    await userEvent.keyboard('{Enter}');
    expect(onValueChange).toHaveBeenCalledWith('light');
    await waitFor(() => expect(trigger).toHaveTextContent('Light'));
    await waitFor(() => expect(trigger).toHaveAttribute('aria-expanded', 'false'));
  });

  it('marks disabled options and skips them with arrows', async () => {
    render(<Select label="Theme" options={THEMES} defaultValue="dark" />);
    await userEvent.click(screen.getByRole('combobox', { name: 'Theme' }));
    const disabled = await screen.findByRole('option', { name: 'High contrast' });
    expect(disabled).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByRole('option', { name: 'Dark' })).toHaveAttribute('aria-selected', 'true');
  });

  it('works inside a Field and exposes the error', async () => {
    render(
      <Field label="Brand" error="Pick a brand before publishing.">
        <Select options={[{ value: 'bridge', label: 'Bridge' }, { value: 'ocean', label: 'Ocean' }]} />
      </Field>,
    );
    const trigger = screen.getByRole('combobox', { name: 'Brand' });
    expect(trigger).toHaveAttribute('aria-invalid', 'true');
    const describedBy = trigger.getAttribute('aria-describedby') ?? '';
    const text = describedBy.split(' ').map((id) => document.getElementById(id)?.textContent).join(' ');
    expect(text).toContain('Pick a brand before publishing.');
  });

  it('renders group labels', async () => {
    render(
      <Select
        label="Token"
        defaultOpen
        options={[
          { value: 'bg', label: 'Background', group: 'Color' },
          { value: 'gap', label: 'Gap', group: 'Space' },
        ]}
      />,
    );
    expect(await screen.findByText('Color')).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Space' })).toBeInTheDocument();
  });
});
