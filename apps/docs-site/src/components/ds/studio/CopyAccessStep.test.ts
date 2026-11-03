// @vitest-environment jsdom
// "Make my copy" when Bridge may not open the new copy yet (CopyAccessStep.tsx): one sentence naming the copy and
// "Open GitHub", which opens the account's page in a centered window; Bridge waits, reads again, and goes on once the
// copy is ticked. GitHub closed with nothing new says the owners decide. Designers never read the GitHub words.
import '../../../../../../packages/react/src/test/setup';
import { createElement } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { expectNoAxeViolations } from '../../../../../../packages/react/src/test/axe';
import { ACCESS_MESSAGE, ACCESS_TICK_MS, nothingNewLine } from '../../../lib/add-product';
import { COPY_WORDS, type CopyAccess } from '../../../lib/design-copy';
import { CopyAccessStep } from './CopyAccessStep';

const ACCESS: CopyAccess = { kind: 'needs-access', copy: 'acme/shop-design', name: 'shop-design', installation: { id: 42, account: { login: 'acme', type: 'Organization' }, repository_selection: 'selected' } };

interface FakePopup {
  closed: boolean;
  close: () => void;
  focus: () => void;
}
let popup: FakePopup;
let opened: unknown[][];

beforeEach(() => {
  opened = [];
  popup = {
    closed: false,
    close: vi.fn(() => {
      popup.closed = true;
    }),
    focus: vi.fn(),
  };
  vi.spyOn(window, 'open').mockImplementation((...a: unknown[]) => {
    opened.push(a);
    return popup as unknown as Window;
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const show = (check: (a: CopyAccess) => Promise<boolean>, onVisible = vi.fn()) => ({ onVisible, ...render(createElement(CopyAccessStep, { access: ACCESS, onVisible, check })) });

describe('Make my copy: one more step when Bridge may not open the copy', () => {
  it('says the one step in designer words, naming the copy, with Open GitHub as the one action', async () => {
    const { container } = show(async () => false);
    const line = screen.getByText(COPY_WORDS.access('shop-design'));
    expect(line).toHaveTextContent('One more step: let Bridge open your copy. Tick shop-design on GitHub, then Save.');
    expect(container.textContent).not.toMatch(/fork|repositor|installation/i);
    expect(screen.getAllByRole('button')).toHaveLength(1);
    await expectNoAxeViolations(container);
  });

  it('opens the account page on GitHub in a centered window, waits, and goes on once the copy is ticked', async () => {
    let ticked = false;
    const check = vi.fn(async () => ticked);
    const { onVisible, container } = show(check);
    fireEvent.click(screen.getByRole('button', { name: COPY_WORDS.openGitHub }));
    expect(opened[0]![0]).toBe('https://github.com/organizations/acme/settings/installations/42');
    expect(String(opened[0]![2])).toMatch(/popup=yes/);
    expect(await screen.findByText(COPY_WORDS.accessWaiting('shop-design'))).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/fork|repositor|installation/i);
    ticked = true;
    // The return page says GitHub saved: read at once.
    await act(async () => {
      window.dispatchEvent(new MessageEvent('message', { origin: location.origin, data: { type: ACCESS_MESSAGE } }));
    });
    await waitFor(() => expect(onVisible).toHaveBeenCalledTimes(1));
    expect(popup.close).toHaveBeenCalled();
    expect(screen.getByText(COPY_WORDS.making)).toBeInTheDocument();
  });

  it('ignores a message from another site', async () => {
    const check = vi.fn(async () => true);
    show(check);
    fireEvent.click(screen.getByRole('button', { name: COPY_WORDS.openGitHub }));
    await act(async () => {
      window.dispatchEvent(new MessageEvent('message', { origin: 'https://evil.example', data: { type: ACCESS_MESSAGE } }));
    });
    expect(check).not.toHaveBeenCalled();
  });

  it('GitHub closed with nothing new: the owners decide, and Try again reads again', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const check = vi.fn(async () => false);
    show(check);
    fireEvent.click(screen.getByRole('button', { name: COPY_WORDS.openGitHub }));
    popup.closed = true;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ACCESS_TICK_MS + 10);
    });
    expect(await screen.findByText(nothingNewLine('acme'))).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(check).toHaveBeenCalledTimes(2));
    // Open GitHub stays the way to do it again.
    expect(screen.getByRole('button', { name: COPY_WORDS.openGitHub })).toBeInTheDocument();
  });
});
