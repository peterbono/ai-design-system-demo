// @vitest-environment jsdom
// "Add a product" (AddProduct.tsx, lib/add-product.ts; validated board "Add a product v3", D1 then A): one question
// and three cards first (Back comes back to it), then "Its code is on GitHub": the products Bridge found, one row each
// with Add, "Not in the list? Find it on GitHub", the designers' copy and Back; none found, one line and Find it on
// GitHub as the primary. Add adds it to the team at once (scripts/add-product.ts addToTeam), closes and opens its page; a
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
import { ADDRESS_PRODUCT_WORDS as D, NEW_PRODUCT_WORDS as N } from '../../../lib/new-product';
import { copySetupFresh, copySetupKey } from '../../../lib/design-copy';
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
  sessionStorage.clear();
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

/** The first question, then "Its code is on GitHub" (A). */
const githubCard = () => screen.findByRole('button', { name: new RegExp(`^${W.github}`) });
const showGitHub = async (onSent = vi.fn(), onOpenChange = vi.fn()) => {
  const r = show(onSent, onOpenChange);
  fireEvent.click(await githubCard());
  return r;
};

/** The way to GitHub: under the found products, or the footer's primary when Bridge found none. */
const findButton = () => screen.findByRole('button', { name: W.findOnGitHub });
const startWaiting = async () => {
  fireEvent.click(await findButton());
  expect(await screen.findByText(W.waiting)).toBeInTheDocument();
};

describe('Add a product: the first question (D1)', () => {
  it('one question and three equal cards, Its code is on GitHub recommended, Cancel only, nothing else yet', async () => {
    gh.access.repos = [SHOP];
    const { baseElement } = show();
    expect(await screen.findByRole('heading', { name: W.title })).toBeInTheDocument();
    expect(screen.getByText(W.question)).toBeInTheDocument();
    const github = await githubCard();
    expect(github).toHaveAccessibleName(`${W.github} ${W.recommended}`);
    expect(github).toHaveAccessibleDescription(W.githubHelp);
    expect(screen.getByRole('button', { name: W.address })).toHaveAccessibleDescription(W.addressHelp);
    expect(screen.getByRole('button', { name: W.fresh })).toHaveAccessibleDescription(W.freshHelp);
    expect(baseElement.querySelectorAll('.addp-choice')).toHaveLength(3);
    expect(baseElement.querySelectorAll('.addp-choice svg.ill')).toHaveLength(3);
    expect(screen.getByRole('button', { name: W.cancel })).toBeInTheDocument();
    // Details only after a choice.
    for (const later of [W.back, W.notListed, W.copy, W.foundLead]) expect(screen.queryByText(later)).toBeNull();
    expect(screen.queryByRole('button', { name: W.addLabel('Shop') })).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(github));
    await expectNoAxeViolations(baseElement);
  });

  it('each card opens its step, and Back comes back with that card focused', async () => {
    gh.access.repos = [SHOP];
    show();
    fireEvent.click(await githubCard());
    expect(await screen.findByRole('heading', { name: W.github })).toBeInTheDocument();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: W.addLabel('Shop') })));
    fireEvent.click(screen.getByRole('button', { name: W.back }));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: new RegExp(`^${W.github}`) })));
    fireEvent.click(screen.getByRole('button', { name: W.address }));
    expect(await screen.findByRole('heading', { name: D.title })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: W.back }));
    fireEvent.click(await screen.findByRole('button', { name: W.fresh }));
    expect(await screen.findByRole('heading', { name: N.title })).toBeInTheDocument();
    expect(screen.queryByLabelText(D.address)).toBeNull();
  });

  it('closing and opening again starts from the question', async () => {
    gh.access.repos = [SHOP];
    const view = show();
    fireEvent.click(await githubCard());
    await screen.findByRole('button', { name: W.addLabel('Shop') });
    view.rerender(createElement(AddProduct, { products: [], open: false, onOpenChange: vi.fn(), onSent: vi.fn() }));
    view.rerender(createElement(AddProduct, { products: [], open: true, onOpenChange: vi.fn(), onSent: vi.fn() }));
    expect(await screen.findByText(W.question)).toBeInTheDocument();
  });
});

describe('Add a product: the products Bridge found', () => {
  it('one row each with its own Add, Not in the list, the copy, and Back', async () => {
    gh.access.repos = [SHOP, PRINT];
    const { baseElement } = await showGitHub();
    expect(await screen.findByRole('button', { name: W.addLabel('Shop') })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: W.github })).toBeInTheDocument();
    expect(screen.getByText(W.foundLead)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: W.addLabel('Art print shop') })).toHaveTextContent(W.add);
    expect(screen.getByText('acme/art-print-shop')).toBeInTheDocument();
    expect(screen.getByText(W.notListed)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: W.findOnGitHub })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: W.copy })).toBeChecked();
    expect(screen.getByRole('button', { name: W.back })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: W.cancel })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Start a new product' })).toBeNull();
    expect(screen.queryByRole('combobox')).toBeNull();
    await expectNoAxeViolations(baseElement);
  });

  it('Add adds it to the team at once, with the copy, then closes and opens its page', async () => {
    gh.access.repos = [SHOP];
    const onSent = vi.fn();
    const onOpenChange = vi.fn();
    await showGitHub(onSent, onOpenChange);
    fireEvent.click(await screen.findByRole('button', { name: W.addLabel('Shop') }));
    await waitFor(() => expect(gh.opened).toEqual(['/studio/products/shop/']));
    expect(gh.add).toHaveBeenCalledWith({ key: 'shop', name: 'Shop', repo: 'acme/shop', design: { repo: 'acme/shop-design' }, framework: 'react' });
    expect(onSent).toHaveBeenCalledTimes(1);
    expect(onOpenChange).toHaveBeenCalledWith(false);
    // The copy was chosen here, once: the product's page makes it in the background with this sign-in.
    expect(copySetupFresh(sessionStorage.getItem(copySetupKey('acme/ds', 'shop')), Date.now())).toBe(true);
  });

  it('without the copy: no designers\' copy in the entry, nothing to make on its page', async () => {
    gh.access.repos = [SHOP];
    await showGitHub();
    fireEvent.click(await screen.findByRole('checkbox', { name: W.copy }));
    fireEvent.click(screen.getByRole('button', { name: W.addLabel('Shop') }));
    await waitFor(() => expect(gh.add).toHaveBeenCalledWith({ key: 'shop', name: 'Shop', repo: 'acme/shop', framework: 'react' }));
    await waitFor(() => expect(gh.opened).toEqual(['/studio/products/shop/']));
    expect(sessionStorage.getItem(copySetupKey('acme/ds', 'shop'))).toBeNull();
  });

  it('a library where Bridge may not add it directly: sent for review, said plainly, Done closes', async () => {
    gh.access.repos = [SHOP];
    gh.add.mockResolvedValue({ kind: 'review' });
    const onOpenChange = vi.fn();
    const { baseElement } = await showGitHub(vi.fn(), onOpenChange);
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
    await showGitHub();
    fireEvent.click(await screen.findByRole('button', { name: W.addLabel('Shop') }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Only admins and leads of your team add products. Ask one of them.');
    expect(alert.closest('li')).toHaveTextContent('acme/shop');
    expect(gh.opened).toEqual([]);
  });

  it('not done: says to try again', async () => {
    gh.access.repos = [SHOP];
    gh.add.mockResolvedValue({ kind: 'failed' });
    await showGitHub();
    fireEvent.click(await screen.findByRole('button', { name: W.addLabel('Shop') }));
    expect(await screen.findByRole('alert')).toHaveTextContent(W.refused);
  });

});

describe('Add a product: a product Bridge cannot see yet', () => {
  it('nothing found: one drawing, one line, and Find it on GitHub as the primary, with Back', async () => {
    const { baseElement } = await showGitHub();
    expect(await screen.findByText(W.noneFound)).toBeInTheDocument();
    expect(baseElement.querySelector('.addp-none svg.ill')).not.toBeNull();
    const find = screen.getByRole('button', { name: W.findOnGitHub });
    expect(find.closest('[class*="footer"]')).not.toBeNull();
    expect(screen.getByRole('button', { name: W.back })).toBeInTheDocument();
    expect(screen.queryByText(W.notListed)).toBeNull();
    expect(screen.queryByRole('checkbox', { name: W.copy })).toBeNull();
    expect(screen.queryByLabelText(N.name)).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(find));
    await expectNoAxeViolations(baseElement);
  });

  it("no installation found: GitHub opens on the team's account, never on its account picker", async () => {
    gh.access.installation = null;
    await showGitHub();
    await startWaiting();
    expect(opened[0]![0]).toBe('https://github.com/apps/bridge-design-studio/installations/new/permissions?target_id=77');
  });

  it("GitHub did not answer: one line with Try again, and GitHub still opens on the team's account", async () => {
    gh.readBreaks = 1;
    const { baseElement } = await showGitHub();
    expect(await screen.findByText(new RegExp(W.unreadLine))).toBeInTheDocument();
    await expectNoAxeViolations(baseElement);
    gh.access.repos = [SHOP];
    fireEvent.click(screen.getByRole('button', { name: W.tryAgain }));
    expect(await screen.findByRole('button', { name: W.addLabel('Shop') })).toBeInTheDocument();
    expect(screen.queryByText(new RegExp(W.unreadLine))).toBeNull();
  });

  it("GitHub did not answer: Find it there opens the team's account", async () => {
    gh.readBreaks = 1;
    await showGitHub();
    await screen.findByText(new RegExp(W.unreadLine));
    await startWaiting();
    expect(opened[0]![0]).toBe('https://github.com/apps/bridge-design-studio/installations/new/permissions?target_id=77');
  });

  it("never shows the owners' line late: it arrives with the step", async () => {
    gh.owner = false;
    gh.ownerDelay = 50;
    await showGitHub();
    expect(screen.queryByText(W.noneFound)).toBeNull();
    expect(await screen.findByText(W.noneFound)).toBeInTheDocument();
    expect(screen.getByText(ownersOnlyLine('acme'))).toBeInTheDocument();
  });

  it("opens the installation's page in a centered window and waits, Cancel goes back", async () => {
    gh.access.repos = [SHOP];
    await showGitHub();
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
    await showGitHub();
    await startWaiting();
    expect(opened[1]).toEqual(['https://github.com/organizations/acme/settings/installations/42', '_blank']);
  });

  it('reads again while it waits; the new product comes back announced with its Add focused, GitHub closes', async () => {
    gh.access.repos = [SHOP];
    await showGitHub();
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

  it('nothing found: the product found on GitHub shows in the list', async () => {
    await showGitHub();
    await screen.findByText(W.noneFound);
    vi.useFakeTimers({ shouldAdvanceTime: true });
    await startWaiting();
    gh.poll.mockResolvedValue([PRINT]);
    await act(() => vi.advanceTimersByTimeAsync(ACCESS_TICK_MS));
    expect(await screen.findByText(foundLine('Art print shop'))).toBeInTheDocument();
    expect(screen.getByRole('button', { name: W.addLabel('Art print shop') })).toBeInTheDocument();
  });

  it('GitHub closed with nothing new: one last read, then the owners decide, and Try again reads again', async () => {
    await showGitHub();
    await screen.findByText(W.noneFound);
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
    await showGitHub();
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
    await showGitHub();
    await screen.findByText(W.noneFound);
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
    await showGitHub();
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
    const { baseElement } = await showGitHub();
    expect(await screen.findByText(ownersOnlyLine('acme'))).toBeInTheDocument();
    expect(screen.getByRole('button', { name: W.findOnGitHub })).toBeInTheDocument();
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
    await showGitHub();
    expect(await screen.findByText(W.noneFound)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: W.copyForOwners })).toBeNull();
  });

  it('opens the organization on the install page, where Save becomes a request', async () => {
    gh.owner = false;
    gh.access.installation = { id: 42, account: { login: 'acme', type: 'Organization', id: 7 } };
    await showGitHub();
    await screen.findByText(ownersOnlyLine('acme'));
    await startWaiting();
    expect(opened[0]![0]).toBe('https://github.com/apps/bridge-design-studio/installations/new/permissions?target_id=7');
  });

  it('GitHub closed with nothing new: the request is sent, remembered, and said again on reopening', async () => {
    gh.owner = false;
    gh.access.repos = [SHOP];
    const view = await showGitHub();
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
    // The dialog reopens on the question, then on its GitHub step: focus again until the read has run (slow runners).
    await waitFor(
      () => {
        fireEvent.focus(window);
        expect(screen.getByText(foundLine('Art print shop'))).toBeInTheDocument();
      },
      { timeout: 5000, interval: 200 },
    );
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
