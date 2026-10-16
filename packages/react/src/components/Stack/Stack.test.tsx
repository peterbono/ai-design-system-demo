import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Container } from '../Container';
import { Grid } from '../Grid';
import { Inline } from '../Inline';
import { Stack } from './Stack';

describe('Layout utilities', () => {
  it('map gap and widths to tokens, never raw values', () => {
    render(
      <>
        <Stack data-testid="stack" gap="0-5" />
        <Inline data-testid="inline" />
        <Grid data-testid="grid" minItemWidth="80" gap="6" />
        <Grid data-testid="cols" columns={20} />
      </>,
    );
    expect(screen.getByTestId('stack').style.getPropertyValue('--_gap')).toBe('var(--space-0-5)');
    expect(screen.getByTestId('inline').style.getPropertyValue('--_gap')).toBe('var(--space-2)');
    expect(screen.getByTestId('grid').style.getPropertyValue('--_min')).toBe('var(--size-80)');
    expect(screen.getByTestId('cols').style.getPropertyValue('--_columns')).toBe('12');
  });

  it('render swaps the element', () => {
    render(
      <Container render={<main />}>
        <Stack render={<ul />}>
          <li>Tokens</li>
        </Stack>
      </Container>,
    );
    expect(screen.getByRole('main')).toBeInTheDocument();
    expect(screen.getByRole('list')).toBeInTheDocument();
  });
});
