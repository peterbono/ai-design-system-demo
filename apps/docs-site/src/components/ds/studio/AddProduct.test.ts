// @vitest-environment jsdom
// "Add a product" (AddProduct.tsx, lib/add-product.ts; validated board "Add a product v3", A): the products Bridge
// found on GitHub, one row each with Add, "Not in the list? Find it on GitHub", the designers' copy, Cancel and "Start
// a new product". Add adds it to the team at once (scripts/add-product.ts addToTeam), closes and opens its page; a
// library where Bridge may not add it directly sends it for review and says so; a refusal reads on its row. GitHub
// opens in a centered window on the team's account, the dialog waits and reads again, then shows the new product
// announced with its Add focused. GitHub closed with nothing new says the owners decide. Messages from another site
// are ignored. Someone who does not own the account: told before GitHub opens, a message to copy for the owners,
// "Request sent" after, remembered per team in this browser. GitHub not answering: one line and Try again.
import '../../../../../../packages/react/src/test/setup';
import { createElement } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { expectNoAxeViolations } from '../../../../../../packages/react/src/test/axe';
import { ACCESS_MESSAGE, ACCESS_TICK_MS, ADD_PRODUCT_WORDS as W, foundLine, nothingYetLine, ownersOnlyLine, pendingKey, requestSentLine, type ProductRepoChoice } from '../../../lib/add-product';
import { NEW_PRODUCT_WORDS as N } from '../../../lib/new-product';
import AddProduct, { setOpenPage } from './AddProduct';

const gh = vi.hoisted(() => ({
  access: { repos: [] as ProductRepoChoice[], installation: { id: 42, account: { login: 'acme', type: 'Organization' } } as unknown, account: 'acme', accountId: 77 as number | null, seen: 0 },
  poll: vi.fn(),
  add: vi.fn(),
  readFails: false,
  // GitHub did not answer the first read (not busy).
  readBreaks: 0,
  owner: null as boolean | null,
  // How long the ownership read takes (ms): the owners' line must never show up after the step.
  ownerDelay: 0,
  opened: [] as string[],
}));

vi.mock('../../../scripts/github-session', () => ({ onAccess: (fn: (a: unknown) => void) => fn({ admin: true }), readRepo: () => ({ owner: 'acme', repo: 'ds' }), currentViewer: () => ({ login: 'dana' }) }));
vi.mock('../../../scripts/repo-context', () => ({ repoContext: () => ({ owner: 'acme', repo: 'ds' }), siteConfig: () => ({ products: [] }) }));
vi.mock('../../../scripts/add-product', () => ({
  readProductAccess: async () => {
    if (gh.readFails) throw Object.assign(new Error('GitHub rate limit reached'), { status: 429, resetAt: null });
    if (gh.readBreaks > 0) {
      gh.readBreaks--;
      throw Object.assign(new Error('GitHub answered 500'), { status: 500 });
    }
    return gh.access;
  },
  teamAccount: async () => ({ account: 'acme', accountId: 77 }),
  pollProductRepos: (...a: unknown[]) => gh.poll(...a),
  detectPreviews: async () => null,
  addToTeam: (...a: unknown[]) => gh.add(...a),
  readOwnership: async () => {
    if (gh.ownerDelay) await new Promise((r) => setTimeout(r, gh.ownerDelay));
    return gh.owner;
  },
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
  gh.access = { repos: [], installation: { id: 42, account: { login: 'acme', type: 'Organization' } }, account: 'acme', accountId: 77, seen: 0 };
  gh.poll.mockReset();
  gh.add.mockReset().mockImplementation(async (entry: { key: string }) => ({ kind: 'added', key: entry.key }));
  gh.readFails = false;
  gh.readBreaks = 0;
  gh.owner = null;
  gh.ownerDelay = 0;
  gh.opened = [];
  setOpenPage((href) => gh.opened.push(href));
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

const show = (onSent = vi.fn(), onOpenChange = vi.fn()) => render(createElement(AddProduct, { products: [], open: true, onOpenChange, onSent }));

/** The way to GitHub: under the found products, or under the new product's form when Bridge found none. */
const findButton = () => screen.findByRole('button', { name: new RegExp(`^(${W.findOnGitHub}|${W.findThere})$`) });
const startWaiting = async () => {
  fireEvent.click(await findButton());
  expect(await screen.findByText(W.waiting)).toBeInTheDocument();
};

describe('Add a product: the products Bridge found', () => {
  it('one row each with its own Add, Not in the list, the copy, Cancel and Start a new product', async () => {
    gh.access.repos = [SHOP, PRINT];
    const { baseElement } = show();
    expect(await screen.findByRole('button', { name: W.addLabel('Shop') })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: W.title })).toBeInTheDocument();
    expect(screen.getByText(W.foundLead)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: W.addLabel('Art print shop') })).toHaveTextContent(W.add);
    expect(screen.getByText('acme/art-print-shop')).toBeInTheDocument();
    expect(screen.getByText(W.notListed)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: W.findOnGitHub })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: W.copy })).toBeChecked();
    expect(screen.getByRole('button', { name: W.cancel })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: W.startNew })).toBeInTheDocument();
    expect(screen.queryByRole('combobox')).toBeNull();
    for (const old of ["It's already built", "It's a new product", 'Which product does your team design for?', 'Back']) expect(screen.queryByText(old)).toBeNull();
    await expectNoAxeViolations(baseElement);
  });

  it('Add adds it to the team at once, with the copy, then closes and opens its page', async () => {
    gh.access.repos = [SHOP];
    const onSent = vi.fn();
    const onOpenChange = vi.fn();
    show(onSent, onOpenChange);
    fireEvent.click(await screen.findByRole('button', { name: W.addLabel('Shop') }));
    await waitFor(() => expect(gh.opened).toEqual(['/studio/products/shop/']));
    expect(gh.add).toHaveBeenCalledWith({ key: 'shop', name: 'Shop', repo: 'acme/shop', design: { repo: 'acme/shop-design' }, framework: 'react' });
    expect(onSent).toHaveBeenCalledTimes(1);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('without the copy: no designers\' copy in the entry', async () => {
    gh.access.repos = [SHOP];
    show();
    fireEvent.click(await screen.findByRole('checkbox', { name: W.copy }));
    fireEvent.click(screen.getByRole('button', { name: W.addLabel('Shop') }));
    await waitFor(() => expect(gh.add).toHaveBeenCalledWith({ key: 'shop', name: 'Shop', repo: 'acme/shop', framework: 'react' }));
  });

  it('a library where Bridge may not add it directly: sent for review, said plainly, Done closes', async () => {
    gh.access.repos = [SHOP];
    gh.add.mockResolvedValue({ kind: 'review' });
    const onOpenChange = vi.fn();
    const { baseElement } = show(vi.fn(), onOpenChange);
    fireEvent.click(await screen.findByRole('button', { name: W.addLabel('Shop') }));
    expect(await screen.findByRole('heading', { name: W.reviewTitle })).toBeInTheDocument();
    expect(screen.getByText(W.reviewLine('Shop'))).toBeInTheDocument();
    expect(gh.opened).toEqual([]);
    await expectNoAxeViolations(baseElement);
    fireEvent.click(screen.getByRole('button', { name: W.done }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("refused by Bridge: the reason on that product's row, nothing opens", async () => {
    gh.access.repos = [SHOP, PRINT];
    gh.add.mockResolvedValue({ kind: 'refused', message: 'Only admins and leads of your team add products. Ask one of them.' });
    show();
    fireEvent.click(await screen.findByRole('button', { name: W.addLabel('Shop') }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Only admins and leads of your team add products. Ask one of them.');
    expect(alert.closest('li')).toHaveTextContent('acme/shop');
    expect(gh.opened).toEqual([]);
  });

  it('not done: says to try again', async () => {
    gh.access.repos = [SHOP];
    gh.add.mockResolvedValue({ kind: 'failed' });
    show();
    fireEvent.click(await screen.findByRole('button', { name: W.addLabel('Shop') }));
    expect(await screen.findByRole('alert')).toHaveTextContent(W.refused);
  });

  it('Start a new product opens the name and Create product', async () => {
    gh.access.repos = [SHOP];
    show();
    fireEvent.click(await screen.findByRole('button', { name: W.startNew }));
    expect(await screen.findByLabelText(N.name)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: N.create })).toBeInTheDocument();
  });
});

describe('Add a product: a product Bridge cannot see yet', () => {
  it('nothing found: opens straight on a new product, with the way to code already on GitHub', async () => {
    show();
    expect(await screen.findByLabelText(N.name)).toBeInTheDocument();
    expect(screen.getByText(W.codeOnGitHub)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: W.findThere })).toBeInTheDocument();
  });

  it("no installation found: GitHub opens on the team's account, never on its account picker", async () => {
    gh.access.installation = null;
    show();
    await startWaiting();
    expect(opened[0]![0]).toBe('https://github.com/apps/bridge-design-studio/installations/new/permissions?target_id=77');
  });

  it("GitHub did not answer: one line with Try again, and GitHub still opens on the team's account", async () => {
    gh.readBreaks = 1;
    const { baseElement } = show();
    expect(await screen.findByText(new RegExp(W.unreadLine))).toBeInTheDocument();
    await expectNoAxeViolations(baseElement);
    gh.access.repos = [SHOP];
    fireEvent.click(screen.getByRole('button', { name: W.tryAgain }));
    expect(await screen.findByRole('button', { name: W.addLabel('Shop') })).toBeInTheDocument();
    expect(screen.queryByText(new RegExp(W.unreadLine))).toBeNull();
  });

  it("GitHub did not answer: Find it there opens the team's account", async () => {
    gh.readBreaks = 1;
    show();
    await screen.findByText(new RegExp(W.unreadLine));
    await startWaiting();
    expect(opened[0]![0]).toBe('https://github.com/apps/bridge-design-studio/installations/new/permissions?target_id=77');
  });

  it("never shows the owners' line late: it arrives with the step", async () => {
    gh.owner = false;
    gh.ownerDelay = 50;
    show();
    expect(screen.queryByText(W.codeOnGitHub)).toBeNull();
    expect(await screen.findByText(W.codeOnGitHub)).toBeInTheDocument();
    expect(screen.getByText(ownersOnlyLine('acme'))).toBeInTheDocument();
  });

  it("opens the installation's page in a centered window and waits, Cancel goes back", async () => {
    gh.access.repos = [SHOP];
    show();
    await startWaiting();
    expect(opened[0]![0]).toBe('https://github.com/organizations/acme/settings/installations/42');
    expect(String(opened[0]![2])).toMatch(/^popup=yes,width=1020,height=760,left=\d+,top=\d+$/);
    fireEvent.click(screen.getByRole('button', { name: W.cancel }));
    expect(await screen.findByRole('button', { name: W.addLabel('Shop') })).toBeInTheDocument();
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

  it('reads again while it waits; the new product comes back announced with its Add focused, GitHub closes', async () => {
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
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: W.addLabel('Art print shop') })));
  });

  it('from a new product: the product found on GitHub shows in the list', async () => {
    show();
    await screen.findByLabelText(N.name);
    vi.useFakeTimers({ shouldAdvanceTime: true });
    await startWaiting();
    gh.poll.mockResolvedValue([PRINT]);
    await act(() => vi.advanceTimersByTimeAsync(ACCESS_TICK_MS));
    expect(await screen.findByText(foundLine('Art print shop'))).toBeInTheDocument();
    expect(screen.getByRole('button', { name: W.addLabel('Art print shop') })).toBeInTheDocument();
  });

  it('GitHub closed with nothing new: one last read, then the owners decide, and Try again reads again', async () => {
    show();
    await screen.findByLabelText(N.name);
    vi.useFakeTimers({ shouldAdvanceTime: true });
    await startWaiting();
    gh.poll.mockResolvedValue([]);
    popup.closed = true;
    await act(() => vi.advanceTimersByTimeAsync(ACCESS_TICK_MS));
    expect(await screen.findByText(nothingYetLine('acme'))).toBeInTheDocument();
    expect(gh.poll).toHaveBeenCalledTimes(1);
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
    await screen.findByLabelText(N.name);
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
    expect(gh.poll).toHaveBeenCalledWith([], null);
  });
});

describe('Add a product: someone who can only request access', () => {
  const KEY = pendingKey('acme/ds');

  it('says before GitHub opens that the owners decide, and offers a message for them', async () => {
    gh.owner = false;
    const { baseElement } = show();
    expect(await screen.findByText(ownersOnlyLine('acme'))).toBeInTheDocument();
    expect(screen.getByRole('button', { name: W.findThere })).toBeInTheDocument();
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
    expect(await screen.findByText(W.codeOnGitHub)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: W.copyForOwners })).toBeNull();
  });

  it('opens the organization on the install page, where Save becomes a request', async () => {
    gh.owner = false;
    gh.access.installation = { id: 42, account: { login: 'acme', type: 'Organization', id: 7 } };
    show();
    await screen.findByText(ownersOnlyLine('acme'));
    await startWaiting();
    expect(opened[0]![0]).toBe('https://github.com/apps/bridge-design-studio/installations/new/permissions?target_id=7');
  });

  it('GitHub closed with nothing new: the request is sent, remembered, and said again on reopening', async () => {
    gh.owner = false;
    gh.access.repos = [SHOP];
    const view = show();
    await screen.findByText(ownersOnlyLine('acme'));
    vi.useFakeTimers({ shouldAdvanceTime: true });
    await startWaiting();
    gh.poll.mockResolvedValue([SHOP]);
    popup.closed = true;
    await act(() => vi.advanceTimersByTimeAsync(ACCESS_TICK_MS));
    expect(await screen.findByText(requestSentLine('acme', null))).toBeInTheDocument();
    expect(screen.queryByText(nothingYetLine('acme'))).toBeNull();
    expect(JSON.parse(localStorage.getItem(KEY)!)).toMatchObject({ account: 'acme', product: null, before: ['acme/shop'] });
    view.unmount();
    show();
    expect(await screen.findByText(requestSentLine('acme', null))).toBeInTheDocument();
    // Coming back to the window reads the list: the approved product is announced and the request forgotten.
    gh.poll.mockResolvedValue([SHOP, PRINT]);
    fireEvent.focus(window);
    expect(await screen.findByText(foundLine('Art print shop'))).toBeInTheDocument();
    expect(localStorage.getItem(KEY)).toBeNull();
    await act(() => new Promise((r) => setTimeout(r, 100)));
  });

  it('reopened after the owners approved: the product is announced at once', async () => {
    gh.access.repos = [SHOP, PRINT];
    localStorage.setItem(KEY, JSON.stringify({ account: 'acme', product: null, before: ['acme/shop'], at: Date.now() }));
    show();
    expect(await screen.findByText(foundLine('Art print shop'))).toBeInTheDocument();
    expect(localStorage.getItem(KEY)).toBeNull();
  });
});
