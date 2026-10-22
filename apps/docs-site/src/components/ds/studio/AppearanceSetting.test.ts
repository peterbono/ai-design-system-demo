// @vitest-environment jsdom
// Settings, Appearance: a DS SegmentedControl (Light, Dark) that shows the theme on screen and applies a pick at
// once, without any GitHub call. No System option and no helper line.
import '../../../../../../packages/react/src/test/setup';
import { createElement } from 'react';
import { act, render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { expectNoAxeViolations } from '../../../../../../packages/react/src/test/axe';
import { THEME_KEY } from '../../../lib/theme-pref';
import AppearanceSetting from './AppearanceSetting';

let dark = false;
beforeEach(() => {
  dark = false;
  localStorage.clear();
  document.documentElement.setAttribute('data-theme', 'light');
  window.matchMedia = ((query: string) => ({
    get matches() {
      return query.includes('dark') && dark;
    },
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  })) as unknown as typeof window.matchMedia;
});

describe('AppearanceSetting', () => {
  it('offers Light and Dark only, with the OS theme selected when this browser has no choice', async () => {
    dark = true;
    const { container } = render(createElement(AppearanceSetting));
    const group = screen.getByRole('radiogroup', { name: 'Theme' });
    expect(screen.getAllByRole('radio').map((r) => r.textContent)).toEqual(['Light', 'Dark']);
    expect(screen.getByRole('radio', { name: 'Dark' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.queryByRole('radio', { name: 'System' })).toBeNull();
    expect(group.closest('.set-row')?.querySelector('.set-row-help')).toBeNull();
    expect(container.textContent).not.toMatch(/System follows/);
    await expectNoAxeViolations(container);
  });

  it("shows an older stored 'system' as the theme on screen", () => {
    localStorage.setItem(THEME_KEY, 'system');
    render(createElement(AppearanceSetting));
    expect(screen.getByRole('radio', { name: 'Light' }).getAttribute('aria-checked')).toBe('true');
  });

  it('shows the stored choice', () => {
    localStorage.setItem(THEME_KEY, 'dark');
    render(createElement(AppearanceSetting));
    expect(screen.getByRole('radio', { name: 'Dark' }).getAttribute('aria-checked')).toBe('true');
  });

  it('applies and stores a pick', async () => {
    const user = userEvent.setup();
    render(createElement(AppearanceSetting));
    await user.click(screen.getByRole('radio', { name: 'Dark' }));
    expect(localStorage.getItem(THEME_KEY)).toBe('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(screen.getByRole('radio', { name: 'Dark' }).getAttribute('aria-checked')).toBe('true');
    await user.click(screen.getByRole('radio', { name: 'Light' }));
    expect(localStorage.getItem(THEME_KEY)).toBe('light');
    expect(document.documentElement.dataset.theme).toBe('light');
  });

  it('moves with a choice made in another tab', () => {
    render(createElement(AppearanceSetting));
    act(() => {
      localStorage.setItem(THEME_KEY, 'dark');
      document.dispatchEvent(new CustomEvent('bridge:theme-pref', { detail: 'dark' }));
    });
    expect(screen.getByRole('radio', { name: 'Dark' }).getAttribute('aria-checked')).toBe('true');
  });
});
