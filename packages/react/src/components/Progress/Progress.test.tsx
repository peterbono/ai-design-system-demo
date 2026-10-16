import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { expectNoAxeViolations } from '../../test/axe';
import { Progress } from './Progress';

describe('Progress', () => {
  it('exposes a named progressbar with its value', async () => {
    render(<Progress value={64} label="Publishing tokens" />);
    const bar = screen.getByRole('progressbar', { name: 'Publishing tokens' });
    expect(bar).toHaveAttribute('aria-valuenow', '64');
    expect(bar).toHaveAttribute('aria-valuemin', '0');
    expect(bar).toHaveAttribute('aria-valuemax', '100');
    expect(screen.getByText(/64\s?%/)).toBeInTheDocument();
    await expectNoAxeViolations();
  });

  it('indeterminate has no aria-valuenow', async () => {
    render(<Progress value={null} label="Syncing from Figma" />);
    const bar = screen.getByRole('progressbar', { name: 'Syncing from Figma' });
    expect(bar).not.toHaveAttribute('aria-valuenow');
    expect(bar).toHaveAttribute('data-indeterminate');
    await expectNoAxeViolations();
  });

  it('circular ring takes aria-label and custom value text', async () => {
    render(<Progress variant="circular" value={12} max={40} aria-label="Contrast checks" getAriaValueText={(_, v) => `${v} of 40 pairs`} />);
    const bar = screen.getByRole('progressbar', { name: 'Contrast checks' });
    expect(bar).toHaveAttribute('aria-valuetext', '12 of 40 pairs');
    await expectNoAxeViolations();
  });
});
