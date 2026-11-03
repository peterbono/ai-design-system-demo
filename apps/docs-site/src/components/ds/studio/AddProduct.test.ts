// @vitest-environment jsdom
// "Add a product" when the product is not in the list (AddProduct.tsx, lib/add-product.ts): the list is never a dead
// end, "Give Bridge access" opens GitHub in a centered window on the installation's page, the dialog waits and reads
// again, then goes back to the form with the new product picked, named and announced. GitHub closed with nothing new
// says the owners decide. Messages from another site are ignored.
import '../../../../../../packages/react/src/test/setup';
import { createElement } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { expectNoAxeViolations } from '../../../../../../packages/react/src/test/axe';
import { ACCESS_MESSAGE, ACCESS_TICK_MS, ADD_PRODUCT_WORDS as W, foundLine, nothingNewLine, type ProductRepoChoice } from '../../../lib/add-product';
import AddProduct from './AddProduct';

const gh = vi.hoisted(() => ({
  access: { repos: [] as ProductRepoChoice[], installation: { id: 42, account: { login: 'acme', type: 'Organization' } } as unknown, account: 'acme' },
  poll: vi.fn(),
}));

vi.mock('../../../scripts/github-session', () => ({ onAccess: (fn: (a: unknown) => void) => fn({ admin: true }) }));
vi.mock('../../../scripts/repo-context', () => ({ repoContext: () => ({ owner: 'acme', repo: 'ds' }), siteConfig: () => ({ products: [] }) }));
vi.mock('../../../scripts/add-product', () => ({
  readProductAccess: async () => gh.access,
  pollProductRepos: (...a: unknown[]) => gh.poll(...a),
  detectPreviews: async () => null,
}));

const SHOP: ProductRepoChoice = { full: 'acme/shop', name: 'shop', defaultBranch: 'main' };
const PRINT: ProductRepoChoice = { full: 'acme/art-print-shop', name: 'art-print-shop', defaultBranch: 'main' };

interface FakePopup {
  closed: boolean;
  close: () => void;
  focus: () => void;
}
let popup: FakePopup;
let opened: unknown[][];

beforeEach(() => {
  gh.access = { repos: [], installation: { id: 42, account: { login: 'acme', type: 'Organization' } }, account: 'acme' };
  gh.poll.mockReset();
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

const show = () => render(createElement(AddProduct, { products: [], open: true, onOpenChange: () => undefined }));

const startWaiting = async () => {
  fireEvent.click(await screen.findByRole('button', { name: W.giveAccess }));
  expect(await screen.findByText(W.waiting)).toBeInTheDocument();
};

describe('Add a product: a product Bridge cannot see yet', () => {
  it('never dead-ends: an empty list keeps the field and the way to give access, without the Add button', async () => {
    const { baseElement } = show();
    expect(await screen.findByText(W.notListed)).toBeInTheDocument();
    expect(screen.getByRole('combobox')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: W.giveAccess })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: W.send })).toBeNull();
    await expectNoAxeViolations(baseElement);
  });

  it('keeps the line under a list with products', async () => {
    gh.access.repos = [SHOP];
    show();
    expect(await screen.findByText(W.notListed)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: W.send })).toBeInTheDocument();
  });

  it("opens the installation's page in a centered window and waits, Cancel goes back to the list", async () => {
    show();
    await startWaiting();
    expect(opened[0]![0]).toBe('https://github.com/organizations/acme/settings/installations/42');
    expect(String(opened[0]![2])).toMatch(/^popup=yes,width=1020,height=760,left=\d+,top=\d+$/);
    expect(screen.queryByRole('combobox')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: W.cancel }));
    expect(await screen.findByText(W.notListed)).toBeInTheDocument();
  });

  it('falls back to a new tab when the window is blocked', async () => {
    vi.mocked(window.open).mockImplementationOnce((...a: unknown[]) => {
      opened.push(a);
      return null;
    });
    show();
    await startWaiting();
    expect(opened[1]).toEqual(['https://github.com/organizations/acme/settings/installations/42', '_blank']);
  });

  it('reads again while it waits; the new product comes back picked, named and announced, GitHub closes', async () => {
    gh.access.repos = [SHOP];
    show();
    await screen.findByText(W.notListed);
    vi.useFakeTimers({ shouldAdvanceTime: true });
    await startWaiting();
    gh.poll.mockResolvedValueOnce([SHOP]).mockResolvedValue([SHOP, PRINT]);
    await act(() => vi.advanceTimersByTimeAsync(ACCESS_TICK_MS));
    expect(screen.getByText(W.waiting)).toBeInTheDocument();
    await act(() => vi.advanceTimersByTimeAsync(ACCESS_TICK_MS));
    expect(await screen.findByText(foundLine('Art print shop'))).toBeInTheDocument();
    expect(gh.poll).toHaveBeenCalledWith([], 42);
    expect(popup.close).toHaveBeenCalled();
    expect(screen.getByRole('combobox')).toHaveValue('art-print-shop');
    expect(screen.getByLabelText(W.name)).toHaveValue('Art print shop');
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: W.send })));
  });

  it('GitHub closed with nothing new: one last read, then the owners decide, and Try again reads again', async () => {
    show();
    await screen.findByText(W.notListed);
    vi.useFakeTimers({ shouldAdvanceTime: true });
    await startWaiting();
    gh.poll.mockResolvedValue([]);
    popup.closed = true;
    await act(() => vi.advanceTimersByTimeAsync(ACCESS_TICK_MS));
    expect(await screen.findByText(nothingNewLine('acme'))).toBeInTheDocument();
    expect(gh.poll).toHaveBeenCalledTimes(1);
    // No more reads once it stopped.
    await act(() => vi.advanceTimersByTimeAsync(ACCESS_TICK_MS * 3));
    expect(gh.poll).toHaveBeenCalledTimes(1);
    gh.poll.mockResolvedValue([PRINT]);
    fireEvent.click(screen.getByRole('button', { name: W.tryAgain }));
    expect(await screen.findByText(foundLine('Art print shop'))).toBeInTheDocument();
  });

  it("reads at once on this site's message, never on another site's", async () => {
    show();
    await startWaiting();
    gh.poll.mockResolvedValue([]);
    act(() => {
      window.dispatchEvent(new MessageEvent('message', { origin: 'https://evil.example', data: { type: ACCESS_MESSAGE } }));
    });
    expect(gh.poll).not.toHaveBeenCalled();
    gh.poll.mockResolvedValue([PRINT]);
    act(() => {
      window.dispatchEvent(new MessageEvent('message', { origin: location.origin, data: { type: ACCESS_MESSAGE } }));
    });
    expect(await screen.findByText(foundLine('Art print shop'))).toBeInTheDocument();
  });

  it('stops on GitHub busy and says when Bridge is back', async () => {
    show();
    await screen.findByText(W.notListed);
    vi.useFakeTimers({ shouldAdvanceTime: true });
    await startWaiting();
    gh.poll.mockRejectedValue(Object.assign(new Error('GitHub rate limit reached'), { status: 429, resetAt: null }));
    await act(() => vi.advanceTimersByTimeAsync(ACCESS_TICK_MS));
    expect(await screen.findByText(/GitHub is busy/)).toBeInTheDocument();
    await act(() => vi.advanceTimersByTimeAsync(ACCESS_TICK_MS * 3));
    expect(gh.poll).toHaveBeenCalledTimes(1);
  });
});
