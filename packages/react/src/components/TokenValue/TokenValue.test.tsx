import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { expectNoAxeViolations } from '../../test/axe';
import { TokenValue } from './TokenValue';

const swatchOf = (root: HTMLElement) => root.querySelector('[aria-hidden="true"]') as HTMLElement | null;

describe('TokenValue', () => {
  it('shows the name, the alias and the resolved color, with a decorative swatch', async () => {
    const { container } = render(<TokenValue name="color.action.primary.bg" value="{color.harbor.700}" resolved="#0B4A8B" />);
    const root = container.firstElementChild as HTMLElement;
    expect(root).toHaveTextContent('color.action.primary.bg{color.harbor.700}#0B4A8B');
    const swatch = swatchOf(root);
    expect(swatch).not.toBeNull();
    expect(swatch!.style.backgroundColor).not.toBe('');
    await expectNoAxeViolations();
  });

  it('shows a swatch only for colors', () => {
    const { container, rerender } = render(<TokenValue name="space.4" value="16px" />);
    expect(swatchOf(container)).toBeNull();
    rerender(<TokenValue name="radius.control" value="{radius.md}" resolved="8px" />);
    expect(swatchOf(container)).toBeNull();
    rerender(<TokenValue value="oklch(0.55 0.12 250)" />);
    expect(swatchOf(container)).not.toBeNull();
    rerender(<TokenValue value="{color.harbor.700}" resolved="#0B4A8B" swatch={false} />);
    expect(swatchOf(container)).toBeNull();
    rerender(<TokenValue value="{color.action.primary.bg}" swatch="var(--color-action-primary-bg)" />);
    expect(swatchOf(container)).not.toBeNull();
  });

  it('does not repeat a resolved value equal to the value', () => {
    const { container } = render(<TokenValue value="#0B4A8B" resolved="#0B4A8B" />);
    expect(container.textContent).toBe('#0B4A8B');
  });

  it('renders a previous value as a deletion', async () => {
    const { container, rerender } = render(<TokenValue value="{color.harbor.600}" resolved="#1B5C9E" previous />);
    const del = container.querySelector('del');
    expect(del).not.toBeNull();
    expect(del).toHaveTextContent('{color.harbor.600}#1B5C9E');
    await expectNoAxeViolations();
    rerender(<TokenValue value="{color.harbor.700}" resolved="#0B4A8B" />);
    expect(container.querySelector('del')).toBeNull();
  });
});
