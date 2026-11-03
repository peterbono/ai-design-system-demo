// @vitest-environment jsdom
// "Add a product" when the product is not in the list (AddProduct.tsx, lib/add-product.ts): the list is never a dead
// end, "Give Bridge access" opens GitHub in a centered window on the installation's page, the dialog waits and reads
// again, then goes back to the form with the new product picked, named and announced. GitHub closed with nothing new
// says the owners decide. Messages from another site are ignored. Someone who does not own the account: told before
// GitHub opens, a message to copy for the owners, "Request sent" after, remembered per team in this browser.
import '../../../../../../packages/react/src/test/setup';
import { createElement } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { expectNoAxeViolations } from '../../../../../../packages/react/src/test/axe';
import { ACCESS_MESSAGE, ACCESS_TICK_MS, ADD_PRODUCT_WORDS as W, foundLine, nothingNewLine, ownersOnlyLine, pendingKey, requestSentLine, type ProductRepoChoice } from '../../../lib/add-product';
import AddProduct from './AddProduct';

const gh = vi.hoisted(() => ({
  access: { repos: [] as ProductRepoChoice[], installation: { id: 42, account: { login: 'acme', type: 'Organization' } } as unknown, account: 'acme' },
  poll: vi.fn(),
  readFails: false,
  owner: null as boolean | null,
}));

vi.mock('../../../scripts/github-session', () => ({ onAccess: (fn: (a: unknown) => void) => fn({ admin: true }), readRepo: () => ({ owner: 'acme', repo: 'ds' }) }));
vi.mock('../../../scripts/repo-context', () => ({ repoContext: () => ({ owner: 'acme', repo: 'ds' }), siteConfig: () => ({ products: [] }) }));
vi.mock('../../../scripts/add-product', () => ({
  readProductAccess: async () => {
    if (gh.readFails) throw Object.assign(new Error('GitHub rate limit reached'), { status: 429, resetAt: null });
    return gh.access;
  },
  pollProductRepos: (...a: unknown[]) => gh.poll(...a),
  detectPreviews: async () => null,
  readOwnership: async () => gh.owner,
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
  gh.readFails = false;
  gh.owner = null;
  localStorage.clear();
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
  it('never dead-ends: an empty list says so in one sentence and Give Bridge access is the primary action', async () => {
    const { baseElement } = show();
    expect(await screen.findByText(W.emptyLine)).toBeInTheDocument();
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(screen.queryByText(W.notListed)).toBeNull();
    const give = screen.getByRole('button', { name: W.giveAccess });
    expect(give.closest('form')).toBeNull();
    expect(screen.getByRole('button', { name: W.cancel })).toBeInTheDocument();
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
    expect(await screen.findByText(W.emptyLine)).toBeInTheDocument();
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
    await screen.findByText(W.emptyLine);
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
    await screen.findByText(W.emptyLine);
    vi.useFakeTimers({ shouldAdvanceTime: true });
    await startWaiting();
    gh.poll.mockRejectedValue(Object.assign(new Error('GitHub rate limit reached'), { status: 429, resetAt: null }));
    await act(() => vi.advanceTimersByTimeAsync(ACCESS_TICK_MS));
    expect(await screen.findByText(/GitHub is busy/)).toBeInTheDocument();
    await act(() => vi.advanceTimersByTimeAsync(ACCESS_TICK_MS * 3));
    expect(gh.poll).toHaveBeenCalledTimes(1);
  });

  it('GitHub busy when the dialog opens: Try again fills the list, never calls a product new', async () => {
    gh.readFails = true;
    show();
    expect(await screen.findByText(/GitHub is busy/)).toBeInTheDocument();
    gh.poll.mockResolvedValue([SHOP]);
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(screen.queryByText(/GitHub is busy/)).toBeNull());
    expect(screen.queryByText(foundLine('Shop'))).toBeNull();
    expect(screen.getByRole('button', { name: W.send })).toBeInTheDocument();
    expect(gh.poll).toHaveBeenCalledWith([], null);
  });
});

describe('Add a product: someone who can only request access', () => {
  const KEY = pendingKey('acme/ds');

  it('says before GitHub opens that the owners decide, and offers a message for them', async () => {
    gh.owner = false;
    const { baseElement } = show();
    expect(await screen.findByText(ownersOnlyLine('acme'))).toBeInTheDocument();
    expect(screen.queryByText(W.emptyLine)).toBeNull();
    expect(screen.getByText(W.emptyNone)).toBeInTheDocument();
    // The same one action: GitHub shows them its Request button.
    expect(screen.getByRole('button', { name: W.giveAccess })).toBeInTheDocument();
    const writeText = vi.fn(async () => undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    fireEvent.click(screen.getByRole('button', { name: W.copyForOwners }));
    await waitFor(() => expect(writeText).toHaveBeenCalled());
    expect(String((writeText.mock.calls[0] as unknown[])[0])).toContain('https://github.com/organizations/acme/settings/installations/42');
    expect(await screen.findByRole('button', { name: W.copiedForOwners })).toBeInTheDocument();
    await expectNoAxeViolations(baseElement);
  });

  it('an owner, or Bridge not knowing, keeps the usual words', async () => {
    gh.owner = true;
    show();
    expect(await screen.findByText(W.emptyLine)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: W.copyForOwners })).toBeNull();
  });

  it('opens the organization on the install page, where Save becomes a request', async () => {
    gh.owner = false;
    gh.access.installation = { id: 42, account: { login: 'acme', type: 'Organization', id: 7 } };
    show();
    await screen.findByText(ownersOnlyLine('acme'));
    await startWaiting();
    expect(opened[0]![0]).toBe('https://github.com/apps/bridge-ds/installations/new/permissions?target_id=7');
  });

  it('GitHub closed with nothing new: the request is sent, remembered, and said again on reopening', async () => {
    gh.owner = false;
    gh.access.repos = [SHOP];
    const view = show();
    await screen.findByText(ownersOnlyLine('acme'));
    fireEvent.change(screen.getByLabelText(W.name), { target: { value: 'Print shop' } });
    vi.useFakeTimers({ shouldAdvanceTime: true });
    await startWaiting();
    gh.poll.mockResolvedValue([SHOP]);
    popup.closed = true;
    await act(() => vi.advanceTimersByTimeAsync(ACCESS_TICK_MS));
    expect(await screen.findByText(requestSentLine('acme', 'Print shop'))).toBeInTheDocument();
    expect(screen.queryByText(nothingNewLine('acme'))).toBeNull();
    expect(JSON.parse(localStorage.getItem(KEY)!)).toMatchObject({ account: 'acme', product: 'Print shop', before: ['acme/shop'] });
    view.unmount();
    show();
    expect(await screen.findByText(requestSentLine('acme', 'Print shop'))).toBeInTheDocument();
    // Coming back to the window reads the list: the approved product is picked and the request forgotten.
    gh.poll.mockResolvedValue([SHOP, PRINT]);
    fireEvent.focus(window);
    expect(await screen.findByText(foundLine('Art print shop'))).toBeInTheDocument();
    expect(localStorage.getItem(KEY)).toBeNull();
    // The picked product starts its own reads: let them settle before the next test.
    await act(() => new Promise((r) => setTimeout(r, 100)));
  });

  it('reopened after the owners approved: the product is picked at once', async () => {
    gh.access.repos = [SHOP, PRINT];
    localStorage.setItem(KEY, JSON.stringify({ account: 'acme', product: null, before: ['acme/shop'], at: Date.now() }));
    show();
    expect(await screen.findByText(foundLine('Art print shop'))).toBeInTheDocument();
    expect(screen.getByRole('combobox')).toHaveValue('art-print-shop');
    expect(localStorage.getItem(KEY)).toBeNull();
  });
});
