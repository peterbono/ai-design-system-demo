import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { expectNoAxeViolations } from '../../test/axe';
import { Accordion, AccordionItem } from './Accordion';

function Example({ multiple = false }: { multiple?: boolean }) {
  return (
    <Accordion multiple={multiple} headingLevel={2}>
      <AccordionItem value="color" title="Color tokens">48 semantic tokens.</AccordionItem>
      <AccordionItem value="space" title="Spacing tokens">16 steps.</AccordionItem>
      <AccordionItem value="legacy" title="Legacy tokens" disabled>Removed in 2.0.</AccordionItem>
    </Accordion>
  );
}

describe('Accordion', () => {
  it('triggers are buttons inside headings at the requested level', () => {
    render(<Example />);
    const heading = screen.getByRole('heading', { level: 2, name: 'Color tokens' });
    expect(heading.querySelector('button')).toHaveAttribute('aria-expanded', 'false');
  });

  it('Enter and Space toggle the panel and aria-expanded; the panel is labelled by its trigger', async () => {
    render(<Example />);
    const trigger = screen.getByRole('button', { name: 'Color tokens' });
    trigger.focus();
    await userEvent.keyboard('{Enter}');
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    const panel = screen.getByRole('region', { name: 'Color tokens' });
    expect(panel).toHaveTextContent('48 semantic tokens.');
    expect(trigger).toHaveAttribute('aria-controls', panel.id);
    await userEvent.keyboard(' ');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });

  it('single mode closes the other item; multiple keeps both open', async () => {
    const { unmount } = render(<Example />);
    await userEvent.click(screen.getByRole('button', { name: 'Color tokens' }));
    await userEvent.click(screen.getByRole('button', { name: 'Spacing tokens' }));
    expect(screen.getByRole('button', { name: 'Color tokens' })).toHaveAttribute('aria-expanded', 'false');
    unmount();
    render(<Example multiple />);
    await userEvent.click(screen.getByRole('button', { name: 'Color tokens' }));
    await userEvent.click(screen.getByRole('button', { name: 'Spacing tokens' }));
    expect(screen.getByRole('button', { name: 'Color tokens' })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('button', { name: 'Spacing tokens' })).toHaveAttribute('aria-expanded', 'true');
  });

  it('a disabled item does not open', async () => {
    render(<Example />);
    const trigger = screen.getByRole('button', { name: 'Legacy tokens' });
    await userEvent.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });

  it('has no axe violations when open', async () => {
    render(<Example />);
    await userEvent.click(screen.getByRole('button', { name: 'Color tokens' }));
    await expectNoAxeViolations();
  });
});
