import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { expectNoAxeViolations } from '../../test/axe';
import { TokenValue } from '../TokenValue';
import { ChoiceCard, ChoiceCardGroup } from './ChoiceCard';

function Conflict(props: { onValueChange?: (v: string) => void; disabledLibrary?: boolean; error?: string }) {
  return (
    <ChoiceCardGroup
      label="Which value should this change keep?"
      description="color.action.primary.bg changed in both places."
      defaultValue="mine"
      onValueChange={props.onValueChange}
      error={props.error}
    >
      <ChoiceCard value="mine" title="Keep mine" description={<TokenValue value="{color.harbor.600}" resolved="#1B5C9E" />} />
      <ChoiceCard value="library" title="Use the library's" description={<TokenValue value="{color.harbor.700}" resolved="#0B4A8B" />} disabled={props.disabledLibrary} />
      <ChoiceCard value="other" title="Pick another value" />
    </ChoiceCardGroup>
  );
}

describe('ChoiceCard', () => {
  it('the legend names the group; the description names nothing but describes', async () => {
    render(<Conflict />);
    const group = screen.getByRole('radiogroup', { name: 'Which value should this change keep?' });
    expect(group).toHaveAccessibleDescription('color.action.primary.bg changed in both places.');
    expect(screen.getByRole('group', { name: 'Which value should this change keep?' }).tagName).toBe('FIELDSET');
    await expectNoAxeViolations();
  });

  it('each card is a radio named by its title and described by its description', () => {
    render(<Conflict />);
    const mine = screen.getByRole('radio', { name: 'Keep mine' });
    expect(mine).toHaveAccessibleDescription('{color.harbor.600}#1B5C9E');
    expect(screen.getByRole('radio', { name: 'Pick another value' })).not.toHaveAttribute('aria-describedby');
  });

  it('Tab enters on the selection, arrow keys move it and call onValueChange', async () => {
    const onChange = vi.fn();
    render(
      <>
        <Conflict onValueChange={onChange} />
        <button type="button">After</button>
      </>,
    );
    const mine = screen.getByRole('radio', { name: 'Keep mine' });
    expect(mine).toHaveAttribute('aria-checked', 'true');
    await userEvent.tab();
    expect(mine).toHaveFocus();
    await userEvent.keyboard('{ArrowRight}');
    const library = screen.getByRole('radio', { name: "Use the library's" });
    expect(library).toHaveFocus();
    expect(library).toHaveAttribute('aria-checked', 'true');
    expect(mine).toHaveAttribute('aria-checked', 'false');
    expect(onChange).toHaveBeenLastCalledWith('library');
    await userEvent.keyboard('{ArrowDown}');
    expect(onChange).toHaveBeenLastCalledWith('other');
    await userEvent.tab();
    expect(screen.getByRole('button', { name: 'After' })).toHaveFocus();
  });

  it('a click anywhere on the card selects it', async () => {
    const onChange = vi.fn();
    render(<Conflict onValueChange={onChange} />);
    await userEvent.click(screen.getByText("Use the library's"));
    expect(screen.getByRole('radio', { name: "Use the library's" })).toHaveAttribute('aria-checked', 'true');
    expect(onChange).toHaveBeenLastCalledWith('library');
  });

  it('a disabled card cannot be picked and is skipped by the arrow keys', async () => {
    const onChange = vi.fn();
    render(<Conflict onValueChange={onChange} disabledLibrary />);
    const library = screen.getByRole('radio', { name: "Use the library's" });
    expect(library).toHaveAttribute('aria-disabled', 'true');
    await userEvent.click(screen.getByText("Use the library's"));
    expect(library).toHaveAttribute('aria-checked', 'false');
    await userEvent.tab();
    await userEvent.keyboard('{ArrowRight}');
    expect(screen.getByRole('radio', { name: 'Pick another value' })).toHaveAttribute('aria-checked', 'true');
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenLastCalledWith('other');
    await expectNoAxeViolations();
  });

  it('links the group error and marks the group invalid', () => {
    render(<Conflict error="Pick a value before you merge." />);
    const group = screen.getByRole('radiogroup');
    expect(group).toHaveAttribute('aria-invalid', 'true');
    expect(group).toHaveAccessibleDescription('color.action.primary.bg changed in both places. Pick a value before you merge.');
  });
});
