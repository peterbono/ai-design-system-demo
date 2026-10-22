// @vitest-environment jsdom
// Settings, Appearance: a DS SegmentedControl (Light, Dark, System) that shows this browser's choice and applies a
// pick at once, without any GitHub call.
import '../../../../../../packages/react/src/test/setup';
import { createElement } from 'react';
import { act, render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { expectNoAxeViolations } from '../../../../../../packages/react/src/test/axe';
import { THEME_KEY } from '../../../lib/theme-pref';
import AppearanceSetting from './AppearanceSetting';

beforeEach(() => {
  localStorage.clear();
  document.documentElement.setAttribute('data-theme', 'light');
});

describe('AppearanceSetting', () => {
  it('starts on System when this browser has no choice', async () => {
    const { container } = render(createElement(AppearanceSetting));
    const group = screen.getByRole('radiogroup', { name: 'Theme' });
    expect(group).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'System' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByText(/System follows the light or dark setting/)).toBeTruthy();
    await expectNoAxeViolations(container);
  });

  it('shows the stored choice', () => {
    localStorage.setItem(THEME_KEY, 'dark');
    render(createElement(AppearanceSetting));
    expect(screen.getByRole('radio', { name: 'Dark' }).getAttribute('aria-checked')).toBe('true');
  });

  it('applies and stores a pick, and System clears it', async () => {
    const user = userEvent.setup();
    render(createElement(AppearanceSetting));
    await user.click(screen.getByRole('radio', { name: 'Dark' }));
    expect(localStorage.getItem(THEME_KEY)).toBe('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(screen.getByRole('radio', { name: 'Dark' }).getAttribute('aria-checked')).toBe('true');
    await user.click(screen.getByRole('radio', { name: 'System' }));
    expect(localStorage.getItem(THEME_KEY)).toBeNull();
    expect(screen.getByRole('radio', { name: 'System' }).getAttribute('aria-checked')).toBe('true');
  });

  it('moves with a choice made in another tab', () => {
    render(createElement(AppearanceSetting));
    act(() => {
      document.dispatchEvent(new CustomEvent('bridge:theme-pref', { detail: 'light' }));
    });
    expect(screen.getByRole('radio', { name: 'Light' }).getAttribute('aria-checked')).toBe('true');
  });
});
