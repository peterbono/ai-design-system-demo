// @vitest-environment jsdom
// A product page: its explorations grouped by where they stand, the archived ones counted in one quiet line, and the calm empty moment
// with the one action. The sidebar's Products group: one link per configured product, the current one marked.
import '../../../../../../packages/react/src/test/setup';
import { createElement } from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { expectNoAxeViolations } from '../../../../../../packages/react/src/test/axe';
import type { ProductConfig } from '@bridge-ds/core';
import { ProductPageView } from './ProductPage';
import { navProducts, ProductsNavView } from './ProductsNav';
import { person } from '../../../lib/home-model';
import type { ExplorationCard } from '../../../lib/home-explorations';
import type { ProductPageData } from '../../../scripts/product-page';
import type { LibraryLine } from '../../../lib/library-update';

// The viewer's access: a lead (GitHub write) by default, who may also start in the library.
const viewer = vi.hoisted(() => ({ access: { state: 'writer', write: true, admin: false, contributor: false } as Record<string, unknown> | null }));
vi.mock('../../../scripts/github-session', async (actual) => ({
  ...(await actual<Record<string, unknown>>()),
  onAccess: (fn: (a: unknown) => void) => viewer.access && fn(viewer.access),
}));
// The session module is large: load it once before the tests, so the access arrives right after a dialog opens.
beforeAll(async () => {
  await import('../../../scripts/github-session');
}, 30_000);

const products: ProductConfig[] = [
  { key: 'admin-app', name: 'Product admin', repo: 'acme/product-admin', production: 'https://admin.acme.app' },
  { key: 'library', name: 'Library', default: true },
];

const card = (n: number, over: Partial<ExplorationCard> = {}): ExplorationCard => ({
  number: n,
  key: `admin-app#${n}`,
  title: `Screen ${n}`,
  href: `/studio/changes/?exploration=${n}&product=admin-app`,
  product: 'Product admin',
  productKey: 'admin-app',
  author: person('ann', 'Ann Leroy', null),
  stage: 'exploring',
  state: 'Exploring',
  updated: '2026-10-20T10:00:00Z',
  preview: { kind: 'screen', src: null },
  own: false,
  ...over,
});

const data = (over: Partial<ProductPageData> = {}): ProductPageData => ({
  product: products[0]!,
  products,
  ownRepo: 'acme/product-admin',
  reached: true,
  loading: false,
  failed: null,
  cards: [],
  archived: [],
  copy: null,
  busy: null,
  ...over,
});

describe('ProductPageView', () => {
  it('groups the explorations by where they stand, says it in the header, and counts the archived ones in one line', async () => {
    const cards = [card(1), card(2), card(3, { stage: 'with-devs', state: 'Waiting to be picked up' }), card(4, { stage: 'kept', state: 'Shipped' })];
    const { container } = render(createElement(ProductPageView, { productKey: 'admin-app', components: [], data: data({ cards, archived: [card(9)] }) }));
    expect(screen.getByRole('heading', { level: 1, name: 'Product admin' })).toBeTruthy();
    expect(container.querySelector('[data-st-summary]')!.textContent).toBe('2 exploring, 1 waiting to be picked up.');
    expect([...container.querySelectorAll('[data-state-group]')].map((g) => [g.getAttribute('data-state-group'), g.querySelectorAll('.sh-card-item').length])).toEqual([
      ['running', 2],
      ['waiting', 1],
      ['shipped', 1],
    ]);
    // One quiet line: the live product. The repository and a healthy connection are not shown.
    expect(screen.getByRole('link', { name: /Open the live product/ }).getAttribute('href')).toBe('https://admin.acme.app');
    expect(screen.queryByRole('link', { name: /acme\/product-admin/ })).toBeNull();
    expect(screen.queryByText('Connected')).toBeNull();
    // On a product page the product goes without saying.
    expect(container.querySelector('.sh-card-product')).toBeNull();
    // The one primary action on the title's line; archived ones are one quiet line to Changes' Archived tab, no cards.
    await waitFor(() => expect(container.querySelector('[data-st-actions]')!.textContent).toContain('Start an exploration'));
    const line = container.querySelector('[data-archived-line]')!;
    expect(line.textContent).toBe('1 archived. See archived');
    expect(screen.getByRole('link', { name: 'See archived' }).getAttribute('href')).toBe('/studio/changes/?state=archived&product=admin-app');
    expect(line.querySelector('.sh-card-item')).toBeNull();
    expect(screen.queryByRole('button', { name: /Archived/ })).toBeNull();
    await expectNoAxeViolations(container);
  });

  it('turns nothing yet into a calm moment with the reason and the one action, none in the header', async () => {
    const { container } = render(createElement(ProductPageView, { productKey: 'library', components: [], data: data({ product: products[1]!, ownRepo: null, reached: null }) }));
    expect(container.querySelector('[data-st-summary]')!.textContent).toBe('Nothing explored here yet.');
    // The Home's way to start: one card in the zone, the drawing inside it, and the whole card opens the start flow.
    expect(container.querySelector('.pp-empty .pp-choice svg.ill')).toBeTruthy();
    expect(container.querySelector('.pp-empty')!.textContent).toContain('Try a token, a variant or a new component');
    await waitFor(() => expect(container.querySelector('.pp-empty')!.textContent).toContain('Start an exploration'));
    expect(container.querySelector('[data-st-actions]')!.textContent).toBe('');
    expect(container.querySelector('.pp-facts')).toBeNull();
    await expectNoAxeViolations(container);
  });

  it("offers a designer of the team no start on the library's page: library changes are the lead's", async () => {
    viewer.access = { state: 'writer', write: true, admin: false, contributor: true };
    try {
      const { container } = render(createElement(ProductPageView, { productKey: 'library', components: [], lead: false, data: data({ product: products[1]!, ownRepo: null, reached: null }) }));
      await new Promise((r) => setTimeout(r, 300));
      expect(container.querySelector('.pp-empty')).toBeTruthy();
      expect(screen.queryByRole('button', { name: 'Start an exploration' })).toBeNull();
      // The page's lead says what it is for and where asks go; no "Nothing explored here yet" for who cannot explore it.
      expect(container.querySelector('[data-st-summary]')!.textContent).toBe('The library your products use. Leads change it, so ask them for what you need.');
      expect(container.textContent).not.toContain('Nothing explored');
      // Two equal choice cards in the one zone, each a whole-card link named by its title, with a drawing and a chevron.
      const cards = [...container.querySelectorAll('.pp-empty .sh-choices > li .pp-choice')];
      expect(cards).toHaveLength(2);
      expect(screen.getByRole('link', { name: 'Ask for a component change' }).getAttribute('href')).toBe('/studio/components/');
      expect(screen.getByRole('link', { name: 'Suggest a token change' }).getAttribute('href')).toBe('/studio/tokens/');
      for (const c of cards) {
        expect(c.querySelectorAll('[data-card-primary]')).toHaveLength(1);
        expect(c.querySelector('svg.ill')).toBeTruthy();
        expect(c.querySelector('.pp-choice-go')).toBeTruthy();
      }
      await expectNoAxeViolations(container);
    } finally {
      viewer.access = { state: 'writer', write: true, admin: false, contributor: false };
    }
  });

  it("no copy of the product yet: one calm card and Make my copy, never the developers' repository", async () => {
    const make = vi.fn(async () => ({ line: 'Your copy of Product admin is ready. Start an exploration in it.', ready: true }));
    const { container } = render(createElement(ProductPageView, { productKey: 'admin-app', components: [], data: data({ copy: { kind: 'missing' }, reached: null }), copy: { make, latest: vi.fn() } }));
    const card = container.querySelector('[data-copy-missing]')!;
    expect(card.textContent).toContain("Get your own copy of Product admin to explore in. The developers' code stays untouched.");
    // The card is the one action: no start in the header, no list, no "Not connected yet".
    expect(container.querySelector('[data-st-actions]')!.textContent).toBe('');
    expect(container.querySelector('[data-state-group]')).toBeNull();
    expect(container.textContent).not.toMatch(/fork|repository|Not connected/i);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Make my copy' }));
    });
    expect(make).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(card.textContent).toContain('Your copy of Product admin is ready.'));
    await expectNoAxeViolations(container);
  });

  it('the copy is made but Bridge may not open it yet: the one more step in the same zone, in designer words', async () => {
    const access = { kind: 'needs-access' as const, copy: 'acme/product-admin-design', name: 'product-admin-design', installation: { id: 42, account: { login: 'acme', type: 'Organization' }, repository_selection: 'selected' } };
    const make = vi.fn(async () => ({ line: '', ready: false, access }));
    const { container } = render(createElement(ProductPageView, { productKey: 'admin-app', components: [], data: data({ copy: { kind: 'missing' }, reached: null }), copy: { make, finish: vi.fn(), latest: vi.fn() } }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Make my copy' }));
    });
    const zone = container.querySelector('[data-copy-missing]')!;
    await waitFor(() => expect(zone.textContent).toContain('One more step: let Bridge open your copy. Tick product-admin-design on GitHub, then Save.'));
    expect(within(zone as HTMLElement).getByRole('button', { name: 'Open GitHub' })).toBeInTheDocument();
    expect(zone.textContent).not.toMatch(/fork|repositor|installation/i);
    await expectNoAxeViolations(container);
  });

  it('the product moved on since the copy: one quiet line and Get the latest, nothing when up to date', async () => {
    const latest = vi.fn(async () => 'Your copy is up to date.');
    const { container, unmount } = render(createElement(ProductPageView, { productKey: 'admin-app', components: [], data: data({ cards: [card(1)], copy: { kind: 'ready', behind: 2 } }), copy: { make: vi.fn(), latest } }));
    expect(container.querySelector('[data-copy-behind]')!.textContent).toContain('Product admin changed since your copy.');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Get the latest' }));
    });
    expect(latest).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(container.querySelector('.pp-facts')!.textContent).toContain('Your copy is up to date.'));
    expect(container.querySelector('[data-copy-behind]')).toBeNull();
    unmount();
    const fresh = render(createElement(ProductPageView, { productKey: 'admin-app', components: [], data: data({ cards: [card(1)], copy: { kind: 'ready', behind: 0 } }) }));
    expect(fresh.container.querySelector('[data-copy-behind]')).toBeNull();
  });

  it('never "changed since your copy" without the action: a viewer who cannot get the latest reads nothing', () => {
    const behind = data({ cards: [card(1)], copy: { kind: 'ready', behind: 2 } });
    const none = render(createElement(ProductPageView, { productKey: 'admin-app', components: [], data: behind }));
    expect(none.container.querySelector('[data-copy-behind]')).toBeNull();
    expect(none.container.textContent).not.toContain('changed since your copy');
    none.unmount();
    // Making a copy only (no right to get the latest): still nothing.
    const makeOnly = render(createElement(ProductPageView, { productKey: 'admin-app', components: [], data: behind, copy: { make: vi.fn(), latest: null } }));
    expect(makeOnly.container.querySelector('[data-copy-behind]')).toBeNull();
    makeOnly.unmount();
    // An email designer may get the latest (Bridge syncs the copy for them) but not make one: the sentence with its action.
    const email = render(createElement(ProductPageView, { productKey: 'admin-app', components: [], data: behind, copy: { make: null, latest: vi.fn(async () => 'Your copy is up to date.') } }));
    const line = email.container.querySelector('[data-copy-behind]')!;
    expect(line.textContent).toContain('Product admin changed since your copy.');
    expect(within(line as HTMLElement).getByRole('button', { name: 'Get the latest' })).toBeTruthy();
  });

  it('says "2 archived." in the plural, and nothing at all without archived ones', () => {
    const { container, unmount } = render(createElement(ProductPageView, { productKey: 'admin-app', components: [], data: data({ cards: [card(1)], archived: [card(8), card(9)] }) }));
    expect(container.querySelector('[data-archived-line]')!.textContent).toBe('2 archived. See archived');
    unmount();
    const none = render(createElement(ProductPageView, { productKey: 'admin-app', components: [], data: data({ cards: [card(1)] }) }));
    expect(none.container.querySelector('[data-archived-line]')).toBeNull();
  });

  it('says when the team lists no such product', () => {
    render(createElement(ProductPageView, { productKey: 'shop', components: [], data: data({ product: null }) }));
    expect(screen.getByRole('heading', { level: 1, name: 'Product not found' })).toBeTruthy();
  });
});

describe('ProductPageView, the library line', () => {
  const line = (over: Partial<LibraryLine> = {}): LibraryLine => ({ text: 'Product admin uses the library from 1.8.3. The latest is 1.8.4.', send: false, sent: false, link: null, ...over });

  it('a lead: the line and "Send the update to the developers" on it; once sent, it says so', async () => {
    let sent = false;
    const send = vi.fn(async () => {
      sent = true;
    });
    const { container, rerender } = render(createElement(ProductPageView, { productKey: 'admin-app', components: [], data: data({ cards: [card(1)] }), library: { line: line({ send: true }), send } }));
    const at = container.querySelector('[data-library-line]')!;
    expect(at.textContent).toContain('Product admin uses the library from 1.8.3. The latest is 1.8.4.');
    // In the header's quiet line, next to what it acts on; one primary action stays on the title's line.
    expect(at.closest('.pp-facts')).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Send the update to the developers' }));
    });
    expect(send).toHaveBeenCalledTimes(1);
    expect(sent).toBe(true);
    rerender(createElement(ProductPageView, { productKey: 'admin-app', components: [], data: data({ cards: [card(1)] }), library: { line: line({ sent: true, link: 'https://github.com/acme/product-admin/pull/7' }) } }));
    expect(container.querySelector('[data-library-sent]')!.textContent).toBe('Update sent to the developers.');
    expect(screen.getByRole('link', { name: /Open their update/ }).getAttribute('href')).toBe('https://github.com/acme/product-admin/pull/7');
    expect(screen.queryByRole('button', { name: 'Send the update to the developers' })).toBeNull();
    await expectNoAxeViolations(container);
  });

  it('a lead without GitHub (an email admin): the line and "Update sent to the developers." only, no link, no tech words', () => {
    const { container } = render(createElement(ProductPageView, { productKey: 'admin-app', components: [], data: data({ cards: [card(1)] }), library: { line: line({ sent: true }) } }));
    const text = container.querySelector('[data-library-line]')!.textContent!;
    expect(text).toContain('Update sent to the developers.');
    expect(screen.queryByRole('link', { name: /Open their update/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Send the update to the developers' })).toBeNull();
    expect(text).not.toMatch(/npm|package|lockfile|pull request|GitHub|branch/i);
  });

  it('a refused send: one plain sentence on the line', async () => {
    const send = vi.fn(async () => {
      throw new Error('Bridge cannot work in this product yet. Ask an admin to connect it to Bridge.');
    });
    const { container } = render(createElement(ProductPageView, { productKey: 'admin-app', components: [], data: data({ cards: [card(1)] }), library: { line: line({ send: true }), send } }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Send the update to the developers' }));
    });
    await waitFor(() => expect(container.querySelector('[data-library-line] [role="status"]')!.textContent).toBe('Bridge cannot work in this product yet. Ask an admin to connect it to Bridge.'));
  });

  it('no line without a library view', () => {
    const { container } = render(createElement(ProductPageView, { productKey: 'admin-app', components: [], data: data({ cards: [card(1)] }) }));
    expect(container.querySelector('[data-library-line]')).toBeNull();
  });
});

describe('ProductPageView while GitHub is busy', () => {
  const busy = { resetsAt: new Date(Date.now() + 20 * 60_000), source: 'github' as const };
  const LINE = /^GitHub is busy for your account\. Bridge is back at \d{1,2}:\d{2}/;

  it('the team list never read: the wait, never "Product not found"', async () => {
    const { container } = render(createElement(ProductPageView, { productKey: 'admin-app', components: [], data: data({ product: null, busy }), onRetry: () => undefined }));
    expect(screen.queryByText('Product not found')).toBeNull();
    expect(screen.getByRole('status').textContent).toMatch(LINE);
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
    expect(container.textContent).not.toMatch(/rate limit|API/i);
    await expectNoAxeViolations(container);
  });

  it('nothing kept: one calm moment in place of the list, no "Make my copy", no "Nothing explored here yet"', () => {
    const retry = vi.fn();
    const { container } = render(createElement(ProductPageView, { productKey: 'admin-app', components: [], data: data({ busy }), onRetry: retry }));
    expect(container.querySelector('[data-busy="alone"]')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Make my copy' })).toBeNull();
    expect(container.querySelector('[data-st-summary]')?.textContent ?? '').toBe('');
    expect(container.textContent).not.toContain('Nothing explored');
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it('keeps the explorations as last read, with one quiet line above them', () => {
    const { container } = render(createElement(ProductPageView, { productKey: 'admin-app', components: [], data: data({ busy, cards: [card(1)] }), onRetry: () => undefined }));
    expect(container.querySelector('[data-busy="kept"]')!.textContent).toMatch(LINE);
    expect(container.querySelectorAll('.sh-card-item')).toHaveLength(1);
  });

  it('reads again once on its own, just after the reset', () => {
    vi.useFakeTimers();
    try {
      const retry = vi.fn();
      render(createElement(ProductPageView, { productKey: 'admin-app', components: [], data: data({ busy: { resetsAt: new Date(Date.now() + 60_000), source: 'github' } }), onRetry: retry }));
      vi.advanceTimersByTime(59_000);
      expect(retry).not.toHaveBeenCalled();
      vi.advanceTimersByTime(4_000);
      expect(retry).toHaveBeenCalledTimes(1);
      vi.advanceTimersByTime(60 * 60_000);
      expect(retry).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

/** Opens More actions for the product, then its Rename (the rename has no button of its own). */
async function openRename(name = 'Product admin') {
  await userEvent.click(screen.getByRole('button', { name: `More actions for ${name}` }));
  await userEvent.click(await screen.findByRole('menuitem', { name: 'Rename' }));
}

describe('ProductPageView, rename (admins)', () => {
  const view = (rename: Parameters<typeof ProductPageView>[0]['rename']) => render(createElement(ProductPageView, { productKey: 'admin-app', components: [], data: data({ cards: [card(1)] }), rename }));

  it("opens the name in place when Settings' Rename sent the admin here (#rename)", () => {
    history.replaceState(null, '', '#rename');
    try {
      view({ state: 'offer', onSend: vi.fn(async () => {}) });
      expect(screen.getByRole('textbox', { name: 'Product name' })).toBeTruthy();
    } finally {
      history.replaceState(null, '', location.pathname);
    }
  });

  it('#rename does nothing for a viewer who may not rename', () => {
    history.replaceState(null, '', '#rename');
    try {
      view(null);
      expect(screen.queryByRole('textbox', { name: 'Product name' })).toBeNull();
    } finally {
      history.replaceState(null, '', location.pathname);
    }
  });

  it('read only without the rename: no pencil, no More actions', () => {
    view(null);
    expect(screen.queryByRole('button', { name: /^Rename/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /^More actions/ })).toBeNull();
  });

  it('no pencil in view: Rename lives in More actions and opens the name in place; Escape cancels', async () => {
    const onSend = vi.fn(async () => {});
    const { container } = view({ state: 'offer', onSend });
    expect(screen.queryByRole('button', { name: /^Rename/ })).toBeNull();
    await openRename();
    const field = (await screen.findByRole('textbox', { name: 'Product name' })) as HTMLInputElement;
    expect(field.value).toBe('Product admin');
    expect(screen.getByRole('heading', { level: 1, name: 'Product admin' })).toBeTruthy();
    await expectNoAxeViolations(container);
    fireEvent.keyDown(field, { key: 'Escape' });
    expect(screen.queryByRole('textbox', { name: 'Product name' })).toBeNull();
    expect(onSend).not.toHaveBeenCalled();
  });

  it('checks the name before sending, and says how to fix it', async () => {
    const onSend = vi.fn(async () => {});
    view({ state: 'offer', onSend });
    await openRename();
    const field = await screen.findByRole('textbox', { name: 'Product name' });
    fireEvent.change(field, { target: { value: 'library' } });
    fireEvent.submit(field.closest('form')!);
    expect(screen.getByText('Another product already has this name. Pick a different one.')).toBeTruthy();
    fireEvent.change(field, { target: { value: '  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(screen.getByText('Type a name for the product.')).toBeTruthy();
    expect(onSend).not.toHaveBeenCalled();
  });

  it('Enter sends it for review; the title keeps the current name until it merges', async () => {
    const onSend = vi.fn(async () => {});
    view({ state: 'offer', onSend });
    await openRename();
    const field = await screen.findByRole('textbox', { name: 'Product name' });
    fireEvent.change(field, { target: { value: ' Back office ' } });
    await act(async () => {
      fireEvent.submit(field.closest('form')!);
    });
    expect(onSend).toHaveBeenCalledWith(' Back office ');
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Rename sent for review. It shows everywhere once merged.'));
    expect(screen.getByRole('heading', { level: 1, name: 'Product admin' })).toBeTruthy();
    expect(screen.getByText('Rename waiting for review')).toBeTruthy();
    // Nothing left to do: no More actions.
    expect(screen.queryByRole('button', { name: /^More actions/ })).toBeNull();
  });

  it('a refused write: one plain sentence, the details in the console', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    view({ state: 'offer', onSend: async () => Promise.reject(new Error('Resource not accessible by integration')) });
    await openRename();
    const field = await screen.findByRole('textbox', { name: 'Product name' });
    fireEvent.change(field, { target: { value: 'Back office' } });
    await act(async () => {
      fireEvent.submit(field.closest('form')!);
    });
    expect(await screen.findByText('Bridge could not send the rename. Ask an admin of the repository.')).toBeTruthy();
    expect(document.body.textContent).not.toContain('Resource not accessible');
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('a rename already waiting: says so, no second one', () => {
    view({ state: 'waiting', onSend: async () => {} });
    expect(screen.getByText('Rename waiting for review')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Rename/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /^More actions/ })).toBeNull();
  });
});

describe('ProductPageView, More actions (admins)', () => {
  const offer = () => ({ state: 'offer' as const, onSend: vi.fn(async () => {}) });
  const view = (over: Partial<Parameters<typeof ProductPageView>[0]> = {}) =>
    render(createElement(ProductPageView, { productKey: 'admin-app', components: [], data: data({ cards: [card(1)] }), rename: offer(), remove: offer(), ...over }));

  it('one "More actions for <product>" button at the end of the title line: Rename, then Remove from Bridge as danger', async () => {
    const { container } = view();
    const more = screen.getByRole('button', { name: 'More actions for Product admin' });
    // At the end of the title line, after the page's start action.
    expect(more.closest('[data-st-actions]')).toBeTruthy();
    await expectNoAxeViolations(container);
    await userEvent.click(more);
    const items = await screen.findAllByRole('menuitem');
    expect(items.map((i) => i.textContent)).toEqual(['Rename', 'Remove from Bridge']);
    // The danger item comes last, after a separator.
    expect(items[1]!.className).toMatch(/danger/);
    expect(screen.getByRole('separator')).toBeTruthy();
  });

  it('a viewer who may not edit sees no menu', () => {
    view({ rename: null, remove: null });
    expect(screen.queryByRole('button', { name: /^More actions/ })).toBeNull();
  });

  it('the library has no rename and no menu, even for an admin', () => {
    render(createElement(ProductPageView, { productKey: 'library', components: [], data: data({ product: products[1]!, ownRepo: null, reached: null }), rename: offer(), remove: offer() }));
    expect(screen.getByRole('heading', { level: 1, name: 'Library' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Rename/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /^More actions/ })).toBeNull();
  });

  it('the library ignores #rename', () => {
    history.replaceState(null, '', '#rename');
    try {
      render(createElement(ProductPageView, { productKey: 'library', components: [], data: data({ product: products[1]!, ownRepo: null, reached: null }), rename: offer() }));
      expect(screen.queryByRole('textbox', { name: 'Product name' })).toBeNull();
    } finally {
      history.replaceState(null, '', location.pathname);
    }
  });

  it('Remove asks for the name typed exactly, says nothing is deleted on GitHub, then sends the removal for review', async () => {
    const remove = offer();
    view({ remove });
    await userEvent.click(screen.getByRole('button', { name: 'More actions for Product admin' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Remove from Bridge' }));
    const dialog = await screen.findByRole('dialog', { name: 'Remove Product admin from Bridge?' });
    expect(dialog.textContent).toContain('Bridge deletes nothing on GitHub');
    expect(dialog.textContent).not.toMatch(/repository|config|fork|\u2014/i);
    const confirm = within(dialog).getByRole('button', { name: 'Remove from Bridge' }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    const field = within(dialog).getByLabelText('Type Product admin to confirm');
    await userEvent.type(field, 'product admin');
    expect(confirm.disabled).toBe(true);
    await userEvent.clear(field);
    await userEvent.type(field, 'Product admin');
    expect(confirm.disabled).toBe(false);
    await userEvent.click(confirm);
    await waitFor(() => expect(remove.onSend).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByRole('status').textContent).toBe('Removal sent for review. Product admin leaves Bridge once it is approved.');
    expect(screen.getByText('Removal waiting for review')).toBeTruthy();
  });

  it('Cancel sends nothing; a refusal is said in the dialog in plain words', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const remove = { state: 'offer' as const, onSend: vi.fn(async () => Promise.reject(new Error('Resource not accessible by integration'))) };
    view({ remove });
    await userEvent.click(screen.getByRole('button', { name: 'More actions for Product admin' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Remove from Bridge' }));
    let dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(remove.onSend).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'More actions for Product admin' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Remove from Bridge' }));
    dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('Type Product admin to confirm'), 'Product admin');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Remove from Bridge' }));
    expect(await within(dialog).findByText('Bridge could not send the removal. Ask an admin of the repository.')).toBeTruthy();
    expect(document.body.textContent).not.toContain('Resource not accessible');
    warn.mockRestore();
  });
});

describe('ProductsNavView', () => {
  it('lists every configured product as a link to its page, the current one marked', async () => {
    const { container } = render(createElement('nav', { 'aria-label': 'Studio navigation' }, createElement(ProductsNavView, { products: navProducts(products), current: 'library' })));
    const links = screen.getAllByRole('link');
    expect(links.map((a) => [a.textContent, a.getAttribute('href')])).toEqual([
      ['Product admin', '/studio/products/admin-app/'],
      ['Library', '/studio/products/library/'],
    ]);
    expect(links[1]!.getAttribute('aria-current')).toBe('page');
    expect(links[0]!.getAttribute('aria-current')).toBeNull();
    expect(screen.getByText('Products')).toBeTruthy();
    await expectNoAxeViolations(container);
  });
});
