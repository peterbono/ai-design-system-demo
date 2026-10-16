import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { expectNoAxeViolations } from '../../test/axe';
import { Tab, Tabs, TabsList, TabsPanel } from './Tabs';

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
