import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { expectNoAxeViolations } from '../../test/axe';
import { Slider } from './Slider';

describe('Slider', () => {
  it('is a labelled slider moved with arrow keys', async () => {
    render(<Slider label="Contrast threshold" defaultValue={45} min={0} max={100} />);
    const slider = screen.getByRole('slider', { name: 'Contrast threshold' });
    slider.focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(slider).toHaveAttribute('aria-valuenow', '46');
    await expectNoAxeViolations();
  });

  it('range names both thumbs', () => {
    render(<Slider label="Spacing range" defaultValue={[8, 32]} min={0} max={64} />);
    expect(screen.getByRole('slider', { name: 'Spacing range minimum' })).toBeInTheDocument();
    expect(screen.getByRole('slider', { name: 'Spacing range maximum' })).toBeInTheDocument();
  });
});
