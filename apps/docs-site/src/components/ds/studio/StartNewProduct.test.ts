// @vitest-environment jsdom
// A new product in Add a product (AddProduct.tsx, StartNewProduct.tsx, lib/new-product.ts; validated board "Add a
// product v3"), after the first question:
//   - B, "It's a new product": its name only (it goes where the team's products live), the designers' copy on, Back
//     and Create product. Bridge starts the code, adds it to the team and opens its page (no previews step here).
//   - D2, "Only its address": its name and its address (kept as its https origin), Back and Add product. Bridge starts
//     the design team's own code the same way and keeps the address in the entry.
// Refusals in designer words, with the ask-an-owner message when an owner decides. Started but not added: it waits in
// the list with the reason on its row (and its address).
import '../../../../../../packages/react/src/test/setup';
import { createElement } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { expectNoAxeViolations } from '../../../../../../packages/react/src/test/axe';
import { ADD_PRODUCT_WORDS as A, type ProductRepoChoice } from '../../../lib/add-product';
import { ADDRESS_PRODUCT_WORDS as D, NEW_PRODUCT_WORDS as W, askOwnerMessage } from '../../../lib/new-product';
import AddProduct, { setOpenPage } from './AddProduct';

const gh = vi.hoisted(() => ({
  access: { repos: [] as ProductRepoChoice[], installation: null as unknown, account: 'acme', accountId: null, seen: 0 },
  start: vi.fn(),
  link: vi.fn(),
  add: vi.fn(),
  opened: [] as string[],
}));

vi.mock('../../../scripts/github-session', () => ({ onAccess: (fn: (a: unknown) => void) => fn({ admin: true }), currentViewer: () => ({ login: 'dana' }) }));
vi.mock('../../../scripts/repo-context', () => ({ repoContext: () => ({ owner: 'acme', repo: 'ds' }), siteConfig: () => ({ products: [] }) }));
vi.mock('../../../scripts/add-product', () => ({
  readProductAccess: async () => gh.access,
  pollProductRepos: async () => [],
  readOwnership: async () => true,
  teamAccount: async () => ({ account: 'acme', accountId: null }),
  detectPreviews: async () => null,
  addToTeam: (...a: unknown[]) => gh.add(...a),
}));
vi.mock('../../../scripts/new-product', () => ({
  startProductCode: (...a: unknown[]) => gh.start(...a),
  linkProductCode: (...a: unknown[]) => gh.link(...a),
}));

const SHOP: ProductRepoChoice = { full: 'acme/shop', name: 'shop', defaultBranch: 'main' };
const NEW: ProductRepoChoice = { full: 'acme/art-print-shop', name: 'art-print-shop', defaultBranch: 'main' };
const POSTER: ProductRepoChoice = { full: 'acme/poster-studio', name: 'poster-studio', defaultBranch: 'main' };

beforeEach(() => {
  gh.access = { repos: [], installation: null, account: 'acme', accountId: null, seen: 0 };
  gh.start.mockReset().mockResolvedValue(NEW);
  gh.link.mockReset().mockResolvedValue(true);
  gh.add.mockReset().mockImplementation(async (entry: { key: string }) => ({ kind: 'added', key: entry.key }));
  gh.opened = [];
  setOpenPage((href) => gh.opened.push(href));
});

const show = (onSent = vi.fn(), onOpenChange = vi.fn(), products: { key: string; name: string; repo?: string }[] = []) =>
  render(createElement(AddProduct, { products, open: true, onOpenChange, onSent }));

/** The first question, then a card: the form opens with the name focused. */
const openForm = async (card: string = A.fresh) => {
  fireEvent.click(await screen.findByRole('button', { name: card }));
  expect(await screen.findByLabelText(W.name)).toBeInTheDocument();
  await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText(W.name)));
};

const create = (name: string) => {
  fireEvent.change(screen.getByLabelText(W.name), { target: { value: name } });
  fireEvent.click(screen.getByRole('button', { name: W.create }));
};

describe('Add a product: a new product (B)', () => {
  it("It's a new product: the name, the copy on, Back and Create product, nothing else", async () => {
    const { baseElement } = show();
    await openForm();
    expect(screen.getByRole('heading', { name: W.title })).toBeInTheDocument();
    expect(screen.getByText(W.lead)).toBeInTheDocument();
    expect(screen.getByText(W.nameHelp)).toBeInTheDocument();
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(screen.queryByLabelText(D.address)).toBeNull();
    expect(screen.getByRole('checkbox', { name: A.copy })).toBeChecked();
    expect(screen.getByRole('button', { name: A.back })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: W.create })).toBeInTheDocument();
    for (const old of ["It's already built", 'Its code is already on GitHub?', 'Find it there', 'Show its previews']) expect(screen.queryByText(old)).toBeNull();
    await expectNoAxeViolations(baseElement);
  });

  it('Back returns to the first question, its card focused', async () => {
    gh.access.repos = [SHOP];
    show();
    await openForm();
    fireEvent.click(screen.getByRole('button', { name: A.back }));
    const card = await screen.findByRole('button', { name: A.fresh });
    await waitFor(() => expect(document.activeElement).toBe(card));
    expect(screen.getByText(A.question)).toBeInTheDocument();
  });

  it("goes where the team's products live, even when Bridge reaches other accounts", async () => {
    gh.access = { ...gh.access, account: 'peterbono' };
    show(vi.fn(), vi.fn(), [{ key: 'prints', name: 'Prints', repo: 'the-bridge-company/prints' }]);
    await openForm();
    create('Data pilot');
    await waitFor(() => expect(gh.start).toHaveBeenCalledWith(expect.objectContaining({ owner: 'the-bridge-company', slug: 'data-pilot' })));
  });

  it("no product yet: goes to the team's own account (the library's owner)", async () => {
    gh.access = { ...gh.access, account: 'studio' };
    show();
    await openForm();
    create('Data pilot');
    await waitFor(() => expect(gh.start).toHaveBeenCalledWith(expect.objectContaining({ owner: 'acme', slug: 'data-pilot' })));
  });

  it('starts the code, adds it with the copy on, closes and opens its page', async () => {
    const onSent = vi.fn();
    const onOpenChange = vi.fn();
    show(onSent, onOpenChange);
    await openForm();
    create('Art print shop');
    await waitFor(() => expect(gh.opened).toEqual(['/studio/products/art-print-shop/']));
    expect(gh.start).toHaveBeenCalledWith({ owner: 'acme', slug: 'art-print-shop', name: 'Art print shop' });
    expect(gh.link).toHaveBeenCalledWith(NEW, 'art-print-shop');
    expect(gh.add).toHaveBeenCalledWith({ key: 'art-print-shop', name: 'Art print shop', repo: 'acme/art-print-shop', design: { repo: 'acme/art-print-shop-design' }, framework: 'react' });
    expect(onSent).toHaveBeenCalledTimes(1);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('no name yet: Create product says what is missing on the name field, which takes the focus', async () => {
    const { baseElement } = show();
    await openForm();
    const button = screen.getByRole('button', { name: W.create });
    expect(button).toBeEnabled();
    fireEvent.click(button);
    const field = screen.getByLabelText(W.name);
    await waitFor(() => expect(field).toHaveAttribute('aria-invalid', 'true'));
    expect(field).toHaveAccessibleDescription(expect.stringContaining('Type a name for the product.'));
    expect(document.activeElement).toBe(field);
    expect(gh.start).not.toHaveBeenCalled();
    await expectNoAxeViolations(baseElement);
    fireEvent.change(field, { target: { value: 'Atlas' } });
    await waitFor(() => expect(field).not.toHaveAttribute('aria-invalid', 'true'));
  });

  it('a name taken: says so, nothing added', async () => {
    gh.start.mockRejectedValue(Object.assign(new Error('Repository creation failed.'), { status: 422, detail: 'name already exists on this account' }));
    show();
    await openForm();
    create('Shop two');
    expect(await screen.findByRole('alert')).toHaveTextContent('acme already has something called shop-two. Pick a different name.');
    expect(gh.add).not.toHaveBeenCalled();
  });

  it('no permission in the account: the ask-an-owner message goes on the clipboard', async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    gh.start.mockRejectedValue(Object.assign(new Error('Forbidden'), { status: 403, detail: 'You need admin access to the organization' }));
    show();
    await openForm();
    create('Checkout');
    expect(await screen.findByRole('alert')).toHaveTextContent('You cannot create products in acme yet.');
    fireEvent.click(screen.getByRole('button', { name: 'Ask an owner of acme' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(askOwnerMessage('acme', 'no-permission', 'Checkout')));
  });

  it('started but not added: it waits in the list with the reason on its row, and its name kept', async () => {
    gh.add.mockResolvedValueOnce({ kind: 'refused', message: 'Only admins and leads of your team add products. Ask one of them.' });
    show();
    await openForm();
    create('Art print shop');
    expect(await screen.findByRole('alert')).toHaveTextContent('Only admins and leads of your team add products.');
    const add = screen.getByRole('button', { name: A.addLabel('Art print shop') });
    expect(gh.opened).toEqual([]);
    fireEvent.click(add);
    await waitFor(() => expect(gh.add).toHaveBeenLastCalledWith(expect.objectContaining({ name: 'Art print shop', repo: 'acme/art-print-shop' })));
  });
});

describe('Add a product: only its address (D2)', () => {
  const fill = (name: string, address: string) => {
    fireEvent.change(screen.getByLabelText(W.name), { target: { value: name } });
    fireEvent.change(screen.getByLabelText(D.address), { target: { value: address } });
    fireEvent.click(screen.getByRole('button', { name: D.add }));
  };

  it('the name and its address, the copy on, Back and Add product', async () => {
    const { baseElement } = show();
    await openForm(A.address);
    expect(screen.getByRole('heading', { name: D.title })).toBeInTheDocument();
    expect(screen.getByText(D.lead)).toBeInTheDocument();
    expect(screen.getByLabelText(D.address)).toHaveAccessibleDescription(expect.stringContaining(D.addressHelp));
    expect(screen.getByRole('checkbox', { name: A.copy })).toBeChecked();
    expect(screen.getByRole('button', { name: A.back })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: D.add })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: W.create })).toBeNull();
    await expectNoAxeViolations(baseElement);
  });

  it('starts the design team code, adds it with its https address, then opens its page', async () => {
    gh.start.mockResolvedValue(POSTER);
    show();
    await openForm(A.address);
    fill('Poster studio', 'posterstudio.com/checkout');
    await waitFor(() => expect(gh.opened).toEqual(['/studio/products/poster-studio/']));
    expect(gh.start).toHaveBeenCalledWith({ owner: 'acme', slug: 'poster-studio', name: 'Poster studio' });
    expect(gh.link).toHaveBeenCalledWith(POSTER, 'poster-studio');
    expect(gh.add).toHaveBeenCalledWith({ key: 'poster-studio', name: 'Poster studio', repo: 'acme/poster-studio', design: { repo: 'acme/poster-studio-design' }, address: 'https://posterstudio.com', framework: 'react' });
  });

  it('an address Bridge cannot read: said on its field, which takes the focus, nothing started', async () => {
    const { baseElement } = show();
    await openForm(A.address);
    fill('Poster studio', 'http://posterstudio.com');
    const field = screen.getByLabelText(D.address);
    await waitFor(() => expect(field).toHaveAttribute('aria-invalid', 'true'));
    expect(field).toHaveAccessibleDescription(expect.stringContaining(D.addressInvalid));
    expect(document.activeElement).toBe(field);
    expect(gh.start).not.toHaveBeenCalled();
    await expectNoAxeViolations(baseElement);
    fireEvent.change(field, { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: D.add }));
    await waitFor(() => expect(field).toHaveAccessibleDescription(expect.stringContaining(D.addressMissing)));
    expect(gh.start).not.toHaveBeenCalled();
  });

  it('started but not added: it waits in the list, and Add sends it again with its address', async () => {
    gh.start.mockResolvedValue(POSTER);
    gh.add.mockResolvedValueOnce({ kind: 'failed' });
    show();
    await openForm(A.address);
    fill('Poster studio', 'https://posterstudio.com');
    expect(await screen.findByRole('alert')).toHaveTextContent(A.refused);
    fireEvent.click(screen.getByRole('button', { name: A.addLabel('Poster studio') }));
    await waitFor(() => expect(gh.add).toHaveBeenLastCalledWith(expect.objectContaining({ repo: 'acme/poster-studio', address: 'https://posterstudio.com' })));
  });
});
