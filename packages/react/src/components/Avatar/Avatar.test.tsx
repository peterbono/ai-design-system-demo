import { renderToStaticMarkup } from 'react-dom/server';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { expectNoAxeViolations } from '../../test/axe';
import { AGENT_MARK, Avatar as PlainAvatar, AvatarGroup, CLAUDE_MARK, initials } from './index';
import { Avatar, illustratedAvatarSvg, illustratedAvatarUri } from '../../avatar-illustrated';

describe('Avatar', () => {
  it('keeps initials as the default fallback', () => {
    render(<PlainAvatar name="Ana Lima" />);
    expect(screen.getByRole('img', { name: 'Ana Lima' })).toHaveTextContent('AL');
    expect(initials('  kenji  ')).toBe('K');
  });

  it('draws the same face for the same seed, and a different one for another seed', () => {
    expect(illustratedAvatarSvg('peterbono')).toBe(illustratedAvatarSvg('peterbono'));
    expect(illustratedAvatarSvg('PeterBono ')).toBe(illustratedAvatarSvg('peterbono'));
    expect(illustratedAvatarSvg('peterbono')).not.toBe(illustratedAvatarSvg('analima'));
    expect(illustratedAvatarUri('peterbono')).toMatch(/^data:image\/svg\+xml;charset=utf-8,%3Csvg/);
    // Transparent: the only rect is DiceBear's view box mask, no background fill.
    expect(illustratedAvatarSvg('peterbono').match(/<rect/g)).toHaveLength(1);
    expect(illustratedAvatarSvg('peterbono')).toContain('<mask id="viewboxMask"><rect');
  });

  it('renders the illustrated fallback with the name as accessible name', async () => {
    const { container } = render(<Avatar name="Peter Bono" seed="peterbono" fallback="illustrated" />);
    const root = screen.getByRole('img', { name: 'Peter Bono' });
    const img = container.querySelector('img')!;
    expect(img.getAttribute('src')).toBe(illustratedAvatarUri('peterbono'));
    expect(img).toHaveAttribute('alt', '');
    expect(root.className).toContain('illustrated');
    await expectNoAxeViolations(container);
  });

  it('falls back to initials in the main entry when no illustration is given', () => {
    render(<PlainAvatar name="Peter Bono" fallback="illustrated" />);
    expect(screen.getByRole('img', { name: 'Peter Bono' })).toHaveTextContent('PB');
  });

  it('shows the illustrated face when the photo fails to load', async () => {
    const { container } = render(<Avatar name="Maya Okafor" src="https://invalid.example/maya.png" fallback="illustrated" />);
    const photo = container.querySelector('img[src^="https://invalid"]');
    if (photo) fireEvent.error(photo);
    await waitFor(() => expect(container.querySelector('img[src^="data:image/svg+xml"]')).not.toBeNull());
    expect(container.querySelector('img[src^="https://invalid"]')).toBeNull();
  });

  it('shows Claude as an agent named "Claude AI"', async () => {
    const { container } = render(<Avatar kind="agent" brand="claude" />);
    const root = screen.getByRole('img', { name: 'Claude AI' });
    expect(root.className).toContain('agent');
    expect(root.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    expect(root).not.toHaveTextContent(/./);
    await expectNoAxeViolations(container);
  });

  it('draws the Bridge agent mark (the Field Guide robot), not a vendor logo', () => {
    const { container } = render(<PlainAvatar kind="agent" brand="claude" />);
    const path = container.querySelector('svg path');
    // The rendered path is AGENT_MARK.path, written out in the TSX for the Figma specs.
    expect(path).toHaveAttribute('d', AGENT_MARK.path);
    expect(path).not.toHaveAttribute('fill');
    expect(container.querySelector('svg')).toHaveAttribute('viewBox', AGENT_MARK.viewBox);
    expect(CLAUDE_MARK).toBe(AGENT_MARK);
  });

  it('takes a custom mark, keeping the agent name', () => {
    render(<PlainAvatar kind="agent" brand="claude" mark={<svg data-testid="logo" />} />);
    const root = screen.getByRole('img', { name: 'Claude AI' });
    expect(root.querySelector('[data-testid="logo"]')).not.toBeNull();
    expect(root.querySelectorAll('svg')).toHaveLength(1);
  });

  it('lets the agent preset be decorative next to its written name', () => {
    const { container } = render(<p><PlainAvatar kind="agent" brand="claude" decorative /> Claude drafted this</p>);
    expect(screen.queryByRole('img')).toBeNull();
    expect(container.querySelector('[aria-hidden="true"]')).not.toBeNull();
  });

  it('names agents in the +N counter of a group', () => {
    render(
      <AvatarGroup aria-label="Authors" max={1}>
        <PlainAvatar name="Ana Lima" />
        <PlainAvatar kind="agent" brand="claude" />
      </AvatarGroup>,
    );
    expect(screen.getByRole('img', { name: '1 more: Claude AI' })).toBeInTheDocument();
  });

  it('renders the same markup on the server', () => {
    expect(renderToStaticMarkup(<Avatar name="Peter Bono" seed="peterbono" fallback="illustrated" />)).toContain(illustratedAvatarUri('peterbono').slice(0, 60));
  });
});
