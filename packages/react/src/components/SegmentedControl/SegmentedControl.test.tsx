import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { expectNoAxeViolations } from '../../test/axe';
import { SegmentedControl, type SegmentedControlItem } from './SegmentedControl';

const items: SegmentedControlItem[] = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'both', label: 'Both', attributes: { 'data-view': 'both' } },
];

describe('SegmentedControl', () => {
  it('is a labelled radiogroup; Tab enters on the selection, arrow keys move it', async () => {
    const onChange = vi.fn();
    render(
      <>
        <SegmentedControl label="Themes shown" items={items} defaultValue="dark" onValueChange={onChange} />
        <button type="button">After</button>
      </>,
    );
    expect(screen.getByRole('radiogroup', { name: 'Themes shown' })).toBeInTheDocument();
    const dark = screen.getByRole('radio', { name: 'Dark' });
    expect(dark).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: 'Light' })).toHaveAttribute('aria-checked', 'false');

    await userEvent.tab();
    expect(dark).toHaveFocus();
    await userEvent.keyboard('{ArrowRight}');
    const both = screen.getByRole('radio', { name: 'Both' });
    expect(both).toHaveFocus();
    expect(both).toHaveAttribute('aria-checked', 'true');
    expect(onChange).toHaveBeenLastCalledWith('both');

    await userEvent.keyboard('{ArrowLeft}{ArrowLeft}');
    expect(screen.getByRole('radio', { name: 'Light' })).toHaveAttribute('aria-checked', 'true');
    expect(onChange).toHaveBeenLastCalledWith('light');

    await userEvent.tab();
    expect(screen.getByRole('button', { name: 'After' })).toHaveFocus();
    await expectNoAxeViolations();
  });

  it('selects on click and skips disabled segments', async () => {
    const onChange = vi.fn();
    render(<SegmentedControl label="Density" items={[{ value: 'comfortable', label: 'Comfortable' }, { value: 'compact', label: 'Compact', disabled: true }]} defaultValue="comfortable" onValueChange={onChange} />);
    await userEvent.click(screen.getByRole('radio', { name: 'Compact' }));
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole('radio', { name: 'Comfortable' })).toHaveAttribute('aria-checked', 'true');
  });

  it('accepts aria-labelledby and spreads segment attributes', () => {
    render(
      <>
        <p id="brand-label">Brand</p>
        <SegmentedControl aria-labelledby="brand-label" items={items} defaultValue="light" />
      </>,
    );
    expect(screen.getByRole('radiogroup', { name: 'Brand' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Both' })).toHaveAttribute('data-view', 'both');
  });

  it('takes its name from a visible label outside the track; the track holds only the options', async () => {
    render(
      <div>
        <span id="preview-brand-label">Preview brand</span>
        <SegmentedControl aria-labelledby="preview-brand-label" items={items} defaultValue="light" />
      </div>,
    );
    const group = screen.getByRole('radiogroup', { name: 'Preview brand' });
    expect(group).toHaveAttribute('aria-labelledby', 'preview-brand-label');
    expect(group).not.toHaveAttribute('aria-label');
    expect(group).not.toHaveTextContent('Preview brand');
    expect(screen.getAllByRole('radio')).toHaveLength(items.length);
    await expectNoAxeViolations();
  });

  it('renders a static contract a script can drive', () => {
    const html = renderToStaticMarkup(<SegmentedControl label="Brand" items={items} defaultValue="dark" />);
    expect(html).toContain('data-segmented-control=""');
    expect(html).toMatch(/<button[^>]*role="radio"[^>]*aria-checked="true"[^>]*data-value="dark"|<button[^>]*data-value="dark"[^>]*aria-checked="true"|aria-checked="true"[^>]*data-value="dark"/);
    expect(html.match(/data-segment=""/g)).toHaveLength(3);
  });
});
