import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ThemeProvider } from '@bridge-ds/react';
import { expectNoAxeViolations } from '../../react/src/test/axe';
import { ChangeNav, type ChangeNavProps } from './ChangeNav';

const setup = (over: Partial<ChangeNavProps> = {}) => {
  const props: ChangeNavProps = {
    countText: '13 changed',
    tip: '1 token changed: Avatar bg, on 13 surfaces. Press C to hide the outlines.',
    outlinesOn: true,
    disabled: false,
    total: 13,
    isolate: false,
    announce: '',
    onToggle: vi.fn(),
    onStep: vi.fn(),
    onIsolate: vi.fn(),
    ...over,
  };
  const view = render(
    <ThemeProvider theme="light" brand="bridge" density="compact">
      <ChangeNav {...props} />
    </ThemeProvider>,
  );
  return { props, view };
};

describe('ChangeNav', () => {
  it('shows the count as the outlines toggle, with Previous, Next and Isolate', () => {
    setup();
    const count = screen.getByRole('button', { name: '13 changed' });
    expect(count).toHaveAttribute('aria-pressed', 'true');
    expect(count).toHaveAttribute('aria-keyshortcuts', 'C');
    expect(screen.getByRole('button', { name: 'Previous changed element' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next changed element' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Isolate' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('group', { name: 'What changed on this screen' })).toBeInTheDocument();
  });

  it('steps, toggles and isolates from the keyboard', async () => {
    const user = userEvent.setup();
    const { props } = setup();
    await user.tab();
    expect(screen.getByRole('button', { name: '13 changed' })).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(props.onToggle).toHaveBeenCalledTimes(1);
    await user.tab();
    await user.keyboard('{Enter}');
    expect(props.onStep).toHaveBeenLastCalledWith(-1);
    await user.tab();
    await user.keyboard(' ');
    expect(props.onStep).toHaveBeenLastCalledWith(1);
    await user.tab();
    await user.keyboard('{Enter}');
    expect(props.onIsolate).toHaveBeenLastCalledWith(true);
  });

  it('hides stepping and Isolate while outlines are off or nothing changed here', () => {
    setup({ outlinesOn: false, total: null, countText: 'Show what changed' });
    expect(screen.getByRole('button', { name: 'Show what changed' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.queryByRole('button', { name: 'Next changed element' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Isolate' })).toBeNull();
  });

  it('announces each step and says Esc turns Isolate off', () => {
    setup({ isolate: true, announce: 'Changed element 2 of 13: Avatar', countText: '2 / 13 changed' });
    expect(screen.getByRole('status')).toHaveTextContent('Changed element 2 of 13: Avatar');
    expect(screen.getByRole('button', { name: 'Isolate' })).toHaveAttribute('aria-keyshortcuts', 'Escape');
    expect(screen.getByRole('button', { name: 'Isolate' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('has no axe violations, on and off', async () => {
    const { view } = setup({ isolate: true });
    await expectNoAxeViolations(view.container);
    view.unmount();
    const off = setup({ outlinesOn: false, total: null, countText: 'Show what changed' });
    await expectNoAxeViolations(off.view.container);
  });
});
