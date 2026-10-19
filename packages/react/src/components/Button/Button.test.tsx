import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Plus } from 'lucide-react';
import { describe, expect, it, vi } from 'vitest';
import { expectNoAxeViolations } from '../../test/axe';
import { IconButton } from '../IconButton';
import { Button } from './Button';

describe('Button', () => {
  it('is a native button named by its label, activated by Enter and Space', async () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick} iconStart={Plus}>New token</Button>);
    const button = screen.getByRole('button', { name: 'New token' });
    expect(button).toHaveAttribute('type', 'button');
    await userEvent.tab();
    expect(button).toHaveFocus();
    await userEvent.keyboard('{Enter}');
    await userEvent.keyboard(' ');
    expect(onClick).toHaveBeenCalledTimes(2);
  });

  it('loading keeps focus, sets aria-busy and ignores clicks', async () => {
    const onClick = vi.fn();
    render(<Button loading onClick={onClick}>Publishing</Button>);
    const button = screen.getByRole('button', { name: 'Publishing' });
    expect(button).toHaveAttribute('aria-busy', 'true');
    expect(button).toHaveAttribute('aria-disabled', 'true');
    await userEvent.tab();
    expect(button).toHaveFocus();
    await userEvent.click(button);
    await userEvent.keyboard('{Enter}');
    expect(onClick).not.toHaveBeenCalled();
  });

  it('disabled leaves the tab order', async () => {
    render(
      <>
        <Button disabled>Publish</Button>
        <Button>Cancel</Button>
      </>,
    );
    await userEvent.tab();
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus();
  });

  it('renders as a link through render', () => {
    render(<Button render={<a href="/tokens" />}>Open tokens</Button>);
    expect(screen.getByRole('link', { name: 'Open tokens' })).toHaveAttribute('href', '/tokens');
  });

  it('pressed makes a toggle: aria-pressed follows the prop, unset stays a plain button', async () => {
    const { rerender } = render(<Button variant="secondary" pressed={false}>Compare</Button>);
    const button = screen.getByRole('button', { name: 'Compare' });
    expect(button).toHaveAttribute('aria-pressed', 'false');
    rerender(<Button variant="secondary" pressed>Compare</Button>);
    expect(button).toHaveAttribute('aria-pressed', 'true');
    rerender(<Button variant="secondary">Compare</Button>);
    expect(button).not.toHaveAttribute('aria-pressed');
    await expectNoAxeViolations();
  });

  it('link and inverse variants stay native buttons', async () => {
    const onClick = vi.fn();
    render(
      <p>
        Two components need guidance. <Button variant="link" pressed={false} onClick={onClick}>Show only these</Button>
        <Button variant="inverse">Copy command</Button>
      </p>,
    );
    const link = screen.getByRole('button', { name: 'Show only these' });
    expect(link.tagName).toBe('BUTTON');
    await userEvent.click(link);
    expect(onClick).toHaveBeenCalledOnce();
    expect(screen.getByRole('button', { name: 'Copy command' })).toHaveAttribute('type', 'button');
    await expectNoAxeViolations();
  });

  it('IconButton pressed sets aria-pressed', () => {
    render(<IconButton icon={Plus} label="Show outlines" pressed />);
    expect(screen.getByRole('button', { name: 'Show outlines' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('IconButton takes its accessible name from label', async () => {
    render(<IconButton icon={Plus} label="Add token" />);
    const button = screen.getByRole('button', { name: 'Add token' });
    expect(button.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    await expectNoAxeViolations();
  });

  it('has no axe violations across variants', async () => {
    render(
      <div>
        <Button>Publish</Button>
        <Button variant="secondary">Save draft</Button>
        <Button variant="ghost">View diff</Button>
        <Button variant="danger">Delete</Button>
        <Button loading>Saving</Button>
        <Button disabled>Disabled</Button>
      </div>,
    );
    await expectNoAxeViolations();
  });
});
