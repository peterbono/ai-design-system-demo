// @vitest-environment jsdom
// Done exploring: an exploration never checked against the library is checked while the dialog is open, then the
// pieces Bridge found are offered as checkboxes. Without a way to check, the dialog goes on without pieces.
import '../../../../../../packages/react/src/test/setup';
import { createElement } from 'react';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import DoneExploring, { DONE_EVENT, type DoneExploringDetail } from './DoneExploring';

afterEach(cleanup);

const ask = (over: Partial<DoneExploringDetail>) =>
  act(() => {
    document.dispatchEvent(new CustomEvent(DONE_EVENT, { detail: { number: 2, name: 'Dashboard', pieces: [], checked: false, sent: 0, confirm: async () => {}, closed: () => {}, ...over } }));
  });

describe('Done exploring, never checked', () => {
  it('checks it against the library while open, then offers what it found', async () => {
    let finish: (v: Awaited<ReturnType<NonNullable<DoneExploringDetail['check']>>>) => void = () => {};
    const check = vi.fn(() => new Promise<Awaited<ReturnType<NonNullable<DoneExploringDetail['check']>>>>((r) => (finish = r)));
    render(createElement(DoneExploring));
    await ask({ check });
    expect(check).toHaveBeenCalledOnce();
    expect(screen.getByText('Bridge is checking what the library is missing.')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Done exploring' }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => finish({ checked: true, sent: 0, pieces: [{ id: 'color-c2410c', title: 'New color #C2410C', summary: 'An orange the library does not have.' }] }));
    await waitFor(() => expect(screen.getByRole('checkbox', { name: /New color #C2410C/ })).toBeTruthy());
    expect((screen.getByRole('button', { name: 'Done exploring' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('when the check cannot run, says so and goes on without pieces', async () => {
    render(createElement(DoneExploring));
    await ask({ check: async () => null });
    await waitFor(() => expect(screen.getByText(/could not check it against the library this time/)).toBeTruthy());
    expect((screen.getByRole('button', { name: 'Done exploring' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('without a way to check, asks Claude first as before', async () => {
    render(createElement(DoneExploring));
    await ask({});
    expect(screen.getByText(/Ask Claude what is missing first/)).toBeTruthy();
  });
});
