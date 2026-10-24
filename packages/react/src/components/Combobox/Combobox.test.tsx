import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { expectNoAxeViolations } from '../../test/axe';
import { Dialog, DialogContent } from '../Dialog';
import { Field } from '../Field';
import { Combobox, type ComboboxOption } from './Combobox';

const REVIEWERS: ComboboxOption[] = [
  { value: 'ada', label: 'Ada Moreau', description: 'Design owner' },
  { value: 'bao', label: 'Bao Tran', description: 'Tech owner' },
  { value: 'chloe', label: 'Chloe Martin' },
  { value: 'dev', label: 'Dev Patel', disabled: true },
];

describe('Combobox', () => {
  it('is labelled by its Field label and reflects aria-expanded', async () => {
    render(<Combobox label="Reviewer" options={REVIEWERS} placeholder="Search people" />);
    const input = screen.getByRole('combobox', { name: 'Reviewer' });
    expect(input).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(input);
    await waitFor(() => expect(input).toHaveAttribute('aria-expanded', 'true'));
    expect(await screen.findByRole('listbox', { name: 'Reviewer' })).toBeInTheDocument();
    await expectNoAxeViolations();
  });

  it('names its listbox after the field, so it is never an anonymous list while it closes', async () => {
    render(
      <>
        <label id="who-label" htmlFor="who">
          Work email
        </label>
        <Combobox id="who" aria-labelledby="who-label" multiple options={REVIEWERS} />
      </>,
    );
    await userEvent.click(screen.getByRole('combobox', { name: 'Work email' }));
    expect(await screen.findByRole('listbox', { name: 'Work email' })).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.getByRole('combobox')).toHaveAttribute('aria-expanded', 'false'));
    // Mid exit motion, the input no longer points at the list: the list still has its own name.
    const closing = document.querySelector('[role="listbox"]');
    if (closing) expect(closing).toHaveAttribute('aria-labelledby', 'who-label');
    await expectNoAxeViolations();
  });

  it('filters while typing', async () => {
    render(<Combobox label="Reviewer" options={REVIEWERS} />);
    const input = screen.getByRole('combobox', { name: 'Reviewer' });
    await userEvent.type(input, 'tra');
    await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(1));
    expect(screen.getByRole('option', { name: /Bao Tran/ })).toBeInTheDocument();
  });

  it('selects with arrows and Enter and reports the value', async () => {
    const onValueChange = vi.fn();
    render(<Combobox label="Reviewer" options={REVIEWERS} onValueChange={onValueChange} />);
    const input = screen.getByRole('combobox', { name: 'Reviewer' });
    await userEvent.type(input, 'chl');
    await userEvent.keyboard('{ArrowDown}');
    await waitFor(() => expect(screen.getByRole('option', { name: /Chloe Martin/ })).toHaveAttribute('data-highlighted'));
    await userEvent.keyboard('{Enter}');
    expect(onValueChange).toHaveBeenCalledWith('chloe');
    await waitFor(() => expect(input).toHaveValue('Chloe Martin'));
  });

  it('shows the empty message when nothing matches', async () => {
    render(<Combobox label="Reviewer" options={REVIEWERS} emptyMessage="No reviewer by that name." />);
    await userEvent.type(screen.getByRole('combobox', { name: 'Reviewer' }), 'zzz');
    expect(await screen.findByText('No reviewer by that name.')).toBeInTheDocument();
  });

  it('loading announces a status and marks the popup busy', async () => {
    render(<Combobox label="Reviewer" options={[]} filter={null} loading loadingMessage="Searching reviewers" defaultOpen />);
    expect(await screen.findByText('Searching reviewers')).toBeInTheDocument();
    expect(document.querySelector('[aria-busy="true"]')).not.toBeNull();
  });

  it('multiple selection renders removable chips', async () => {
    const onValueChange = vi.fn();
    render(
      <Field label="Reviewers">
        <Combobox multiple options={REVIEWERS} defaultValue={['ada']} onValueChange={onValueChange} />
      </Field>,
    );
    expect(screen.getByRole('button', { name: 'Remove Ada Moreau' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Remove Ada Moreau' }));
    expect(onValueChange).toHaveBeenCalledWith([]);
  });
  it('works inside a Dialog: the list opens, a pick lands in the input and focus stays in the dialog', async () => {
    render(
      <Dialog defaultOpen>
        <DialogContent title="Start a change">
          <Combobox label="Component" options={[{ value: 'button', label: 'Button', description: 'Actions' }, { value: 'select', label: 'Select', description: 'Forms' }]} />
        </DialogContent>
      </Dialog>,
    );
    const input = await screen.findByRole('combobox', { name: 'Component' });
    await userEvent.click(input);
    const option = await screen.findByRole('option', { name: /Select/ });
    expect(option).toHaveTextContent('Forms');
    await userEvent.click(option);
    await waitFor(() => expect(input).toHaveValue('Select'));
    expect(screen.getByRole('dialog')).toContainElement(document.activeElement as HTMLElement);
  });
});
