// @vitest-environment jsdom
// A new product in Add a product (AddProduct.tsx, StartNewProduct.tsx, lib/new-product.ts; validated board "Add a
// product v3", B): the dialog opens straight on it when Bridge found nothing, or from "Start a new product". Its name
// only (it goes where the team's products live), the designers' copy on, "Its code is already on GitHub? Find it
// there", Cancel and Create product. Bridge starts the code, adds it to the team and opens its page (no previews step
// here). Refusals in designer words, with the ask-an-owner message when an owner decides. Started but not added: it
// waits in the list with the reason on its row.
import '../../../../../../packages/react/src/test/setup';
import { createElement } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { expectNoAxeViolations } from '../../../../../../packages/react/src/test/axe';
import { ADD_PRODUCT_WORDS as A, type ProductRepoChoice } from '../../../lib/add-product';
import { NEW_PRODUCT_WORDS as W, askOwnerMessage } from '../../../lib/new-product';
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

/** Nothing found: the dialog opens straight on the new product, the name focused. */
const openForm = async () => {
  expect(await screen.findByLabelText(W.name)).toBeInTheDocument();
  await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText(W.name)));
};

const create = (name: string) => {
  fireEvent.change(screen.getByLabelText(W.name), { target: { value: name } });
  fireEvent.click(screen.getByRole('button', { name: W.create }));
};

describe('Add a product: a new product', () => {
  it('opens straight on the name when Bridge found nothing: the copy on, Find it there, Cancel and Create product', async () => {
    const { baseElement } = show();
    await openForm();
    expect(screen.getByRole('heading', { name: W.title })).toBeInTheDocument();
    expect(screen.getByText(W.lead)).toBeInTheDocument();
    expect(screen.getByText(W.nameHelp)).toBeInTheDocument();
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(screen.getByRole('checkbox', { name: A.copy })).toBeChecked();
    expect(screen.getByText(A.codeOnGitHub)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: A.findThere })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: A.cancel })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: W.create })).toBeInTheDocument();
    for (const old of ["It's a new product", "It's already built", 'Back', 'Show its previews']) expect(screen.queryByText(old)).toBeNull();
    await expectNoAxeViolations(baseElement);
  });

  it('"Start a new product" from the found products opens it, and Find it there goes back to them', async () => {
    gh.access.repos = [SHOP];
    show();
    fireEvent.click(await screen.findByRole('button', { name: A.startNew }));
    await openForm();
    fireEvent.click(screen.getByRole('button', { name: A.findThere }));
    expect(await screen.findByRole('button', { name: A.addLabel('Shop') })).toBeInTheDocument();
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
