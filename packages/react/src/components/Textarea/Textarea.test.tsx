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

describe('Textarea appearance="inline"', () => {
  it('stays a labelled multi-line textbox that reads like the page', async () => {
    render(
      <p>
        <Textarea appearance="inline" aria-label="Summary" placeholder="One or two sentences" defaultValue="Multi-line text." />
      </p>,
    );
    const box = screen.getByRole('textbox', { name: 'Summary' });
    expect(box.tagName).toBe('TEXTAREA');
    expect(box).toHaveAttribute('rows', '1');
    expect(box.className).toMatch(/inline/);
    await expectNoAxeViolations();
  });

  it('is reached with Tab and edited with the keyboard, Enter adding a line', async () => {
    const user = userEvent.setup();
    const seen: string[] = [];
    render(
      <>
        <button type="button">Before</button>
        <Textarea appearance="inline" aria-label="Why" defaultValue="" onValueChange={(v) => seen.push(v)} />
      </>,
    );
    await user.tab();
    await user.tab();
    const box = screen.getByRole('textbox', { name: 'Why' });
    expect(box).toHaveFocus();
    await user.keyboard('One{Enter}Two');
    expect(box).toHaveValue('One\nTwo');
    expect(seen.at(-1)).toBe('One\nTwo');
  });

  it('exposes invalid, disabled and read-only states', async () => {
    render(
      <>
        <Textarea appearance="inline" label="Title" hideLabel error="Add a title." />
        <Textarea appearance="inline" aria-label="Locked" disabled defaultValue="Locked" />
        <Textarea appearance="inline" aria-label="Shipped" readOnly defaultValue="Shipped" />
      </>,
    );
    expect(screen.getByRole('textbox', { name: 'Title' })).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText('Add a title.')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Locked' })).toBeDisabled();
    const shipped = screen.getByRole('textbox', { name: 'Shipped' });
    expect(shipped).toHaveAttribute('readonly');
    await userEvent.type(shipped, 'x');
    expect(shipped).toHaveValue('Shipped');
    await expectNoAxeViolations();
  });
});
