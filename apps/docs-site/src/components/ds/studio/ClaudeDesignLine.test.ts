// @vitest-environment jsdom
// Settings > Your AI tools: the Claude Design line shows for an admin (with the copy action on the same line) and
// never for a member.
import '../../../../../../packages/react/src/test/setup';
import { createElement } from 'react';
import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { expectNoAxeViolations } from '../../../../../../packages/react/src/test/axe';
import { ClaudeDesignLineView } from './ClaudeDesignLine';

const served = { name: 'Bridge Library', version: '1.8.4' };
const team = { url: 'https://claude.ai/artifact/YZ1z4WxSWErcMHVDcbFmkW', version: '1.8.3' };

describe('ClaudeDesignLineView', () => {
  it('shows an admin the line and copies the request for Claude', async () => {
    // userEvent installs its own clipboard: replace it after setup.
    const user = userEvent.setup();
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const { container } = render(createElement(ClaudeDesignLineView, { admin: true, served, team }));
    expect(screen.getByText('Claude Design')).toBeTruthy();
    expect(screen.getByText('Bridge Library 1.8.4 · Update available')).toBeTruthy();
    const button = screen.getByRole('button', { name: 'Copy the request for Claude' });
    // Proximity: the action sits on the same row as the line it acts on.
    expect(button.closest('.set-row')).toBe(screen.getByText('Bridge Library 1.8.4 · Update available').closest('.set-row'));
    await user.click(button);
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining(team.url));
    expect(await screen.findByText('Copied. Paste it in Claude with Bridge connected.')).toBeTruthy();
    await expectNoAxeViolations(container);
  });

  it('shows a member nothing', () => {
    const { container } = render(createElement(ClaudeDesignLineView, { admin: false, served, team }));
    expect(container.textContent).toBe('');
  });

  it('has no action when the team is up to date', () => {
    render(createElement(ClaudeDesignLineView, { admin: true, served, team: { ...team, version: '1.8.4' } }));
    expect(screen.getByText('Bridge Library 1.8.4 · Up to date')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });
});
