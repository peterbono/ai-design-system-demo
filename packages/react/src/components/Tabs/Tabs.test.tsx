import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { expectNoAxeViolations } from '../../test/axe';
import { Tab, Tabs, TabsList, TabsPanel, watchOverflowEdges } from './Tabs';

function Example({ activateOnFocus = false, onValueChange }: { activateOnFocus?: boolean; onValueChange?: (v: unknown) => void }) {
  return (
    <Tabs defaultValue="tokens" onValueChange={onValueChange}>
      <TabsList aria-label="Library views" activateOnFocus={activateOnFocus}>
        <Tab value="tokens">Tokens</Tab>
        <Tab value="components">Components</Tab>
        <Tab value="archived" disabled>Archived</Tab>
        <Tab value="changelog">Changelog</Tab>
      </TabsList>
      <TabsPanel value="tokens">Token table</TabsPanel>
      <TabsPanel value="components">Component list</TabsPanel>
      <TabsPanel value="archived">Archived items</TabsPanel>
      <TabsPanel value="changelog">Release notes</TabsPanel>
    </Tabs>
  );
}

describe('Tabs', () => {
  it('exposes tablist, tabs and a labelled panel', async () => {
    render(<Example />);
    expect(screen.getByRole('tablist', { name: 'Library views' })).toBeInTheDocument();
    const tokens = screen.getByRole('tab', { name: 'Tokens' });
    expect(tokens).toHaveAttribute('aria-selected', 'true');
    const panel = screen.getByRole('tabpanel');
    expect(panel).toHaveTextContent('Token table');
    expect(tokens.getAttribute('aria-controls')).toBe(panel.id);
    expect(panel.getAttribute('aria-labelledby')).toBe(tokens.id);
    await expectNoAxeViolations();
  });

  it('arrow keys move focus, disabled tabs cannot be selected, Enter selects', async () => {
    const onValueChange = vi.fn();
    render(<Example onValueChange={onValueChange} />);
    await userEvent.tab();
    expect(screen.getByRole('tab', { name: 'Tokens' })).toHaveFocus();
    await userEvent.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'Components' })).toHaveFocus();
    await userEvent.keyboard('{ArrowRight}');
    const archived = screen.getByRole('tab', { name: 'Archived' });
    if (document.activeElement === archived) {
      await userEvent.keyboard('{Enter}');
      expect(archived).toHaveAttribute('aria-selected', 'false');
      await userEvent.keyboard('{ArrowRight}');
    }
    expect(screen.getByRole('tab', { name: 'Changelog' })).toHaveFocus();
    await userEvent.keyboard('{Enter}');
    expect(screen.getByRole('tab', { name: 'Changelog' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel')).toHaveTextContent('Release notes');
    expect(onValueChange).toHaveBeenCalledWith('changelog');
  });

  it('activateOnFocus selects on arrow', async () => {
    render(<Example activateOnFocus />);
    await userEvent.tab();
    await userEvent.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'Components' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel')).toHaveTextContent('Component list');
  });
});

describe('watchOverflowEdges', () => {
  const list = (scrollWidth: number, clientWidth: number) => {
    const el = document.createElement('div');
    Object.defineProperty(el, 'scrollWidth', { configurable: true, value: scrollWidth });
    Object.defineProperty(el, 'clientWidth', { configurable: true, value: clientWidth });
    return el;
  };

  it('marks the end of a row that scrolls, then both edges, then the start once at the end', () => {
    const el = list(600, 390);
    const stop = watchOverflowEdges(el);
    expect(el.hasAttribute('data-overflow-end')).toBe(true);
    expect(el.hasAttribute('data-overflow-start')).toBe(false);
    el.scrollLeft = 100;
    el.dispatchEvent(new Event('scroll'));
    expect(el.hasAttribute('data-overflow-start')).toBe(true);
    expect(el.hasAttribute('data-overflow-end')).toBe(true);
    el.scrollLeft = 210;
    el.dispatchEvent(new Event('scroll'));
    expect(el.hasAttribute('data-overflow-end')).toBe(false);
    stop();
  });

  it('marks nothing when every tab fits', () => {
    const el = list(300, 390);
    watchOverflowEdges(el)();
    expect(el.hasAttribute('data-overflow-start') || el.hasAttribute('data-overflow-end')).toBe(false);
  });
});
