// @vitest-environment jsdom
// "It's a new product" in Add a product (AddProduct.tsx, StartNewProduct.tsx, lib/new-product.ts): the second choice
// card, a small form (its name only: it goes where the team's products live, no Where to pick), Bridge starts the code and proposes it with the designers' copy
// on, then the previews step. Refusals in designer words, with the ask-an-owner message when an owner decides. Started
// but not proposed: "It's already built" with it picked. Back goes to the choice.
import '../../../../../../packages/react/src/test/setup';
import { createElement } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { expectNoAxeViolations } from '../../../../../../packages/react/src/test/axe';
import { ADD_PRODUCT_WORDS as A, type ProductRepoChoice } from '../../../lib/add-product';
import { CLOUDFLARE_IMPORT_URL, NEW_PRODUCT_WORDS as W, askOwnerMessage, vercelImportUrl } from '../../../lib/new-product';
import AddProduct from './AddProduct';

const gh = vi.hoisted(() => ({
  access: { repos: [] as ProductRepoChoice[], installation: null as unknown, account: 'acme' },
  start: vi.fn(),
  link: vi.fn(),
  propose: vi.fn(),
}));

vi.mock('../../../scripts/github-session', () => ({ onAccess: (fn: (a: unknown) => void) => fn({ admin: true }) }));
vi.mock('../../../scripts/repo-context', () => ({ repoContext: () => ({ owner: 'acme', repo: 'ds' }), siteConfig: () => ({ products: [] }) }));
vi.mock('../../../scripts/add-product', () => ({
  readProductAccess: async () => gh.access,
  pollProductRepos: async () => [],
  detectPreviews: async () => null,
}));
vi.mock('../../../scripts/new-product', () => ({
  startProductCode: (...a: unknown[]) => gh.start(...a),
  linkProductCode: (...a: unknown[]) => gh.link(...a),
}));
vi.mock('../../../scripts/roles', () => ({ proposeNewProduct: (...a: unknown[]) => gh.propose(...a) }));

const SHOP: ProductRepoChoice = { full: 'acme/shop', name: 'shop', defaultBranch: 'main' };
const NEW: ProductRepoChoice = { full: 'acme/art-print-shop', name: 'art-print-shop', defaultBranch: 'main' };

beforeEach(() => {
  gh.access = { repos: [SHOP], installation: null, account: 'acme' };
  gh.start.mockReset().mockResolvedValue(NEW);
  gh.link.mockReset().mockResolvedValue(true);
  gh.propose.mockReset().mockResolvedValue({ number: 7, url: 'https://github.com/acme/ds/pull/7' });
});

const show = (onSent = vi.fn(), onOpenChange = vi.fn()) => render(createElement(AddProduct, { products: [], open: true, onOpenChange, onSent }));

const openForm = async () => {
  fireEvent.click(await screen.findByRole('button', { name: A.fresh }));
  expect(await screen.findByRole('heading', { name: W.title })).toBeInTheDocument();
  await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText(W.name)));
};

describe('Add a product: no code yet', () => {
  it('is the second card of the choice, whatever Bridge sees on GitHub', async () => {
    const { unmount } = show();
    expect(await screen.findByRole('button', { name: A.fresh })).toHaveAccessibleDescription(A.freshHelp);
    unmount();
    gh.access.repos = [];
    show();
    expect(await screen.findByRole('button', { name: A.fresh })).toBeInTheDocument();
  });

  it('asks only for the name, no Where and no address, one primary action, Back to the choice', async () => {
    const { baseElement } = show();
    await openForm();
    fireEvent.change(screen.getByLabelText(W.name), { target: { value: 'Art print shop' } });
    expect(screen.getByText(W.nameHelp)).toBeInTheDocument();
    expect(screen.queryByText('Where')).toBeNull();
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(screen.queryByText(/Its address|acme\/art-print-shop/)).toBeNull();
    expect(screen.getByRole('checkbox', { name: A.copy })).toBeChecked();
    expect(screen.getByRole('button', { name: W.create })).toBeInTheDocument();
    await expectNoAxeViolations(baseElement);
    fireEvent.click(screen.getByRole('button', { name: W.back }));
    expect(await screen.findByText(A.question)).toBeInTheDocument();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: A.fresh })));
  });

  it("goes where the team's products live, even when Bridge reaches other accounts", async () => {
    gh.access = { repos: [SHOP, { full: 'peterbono/site', name: 'site', defaultBranch: 'main' }], installation: null, account: 'peterbono' };
    render(createElement(AddProduct, { products: [{ key: 'prints', name: 'Prints', repo: 'the-bridge-company/prints' }], open: true, onOpenChange: vi.fn(), onSent: vi.fn() }));
    await openForm();
    expect(screen.queryByRole('combobox')).toBeNull();
    fireEvent.change(screen.getByLabelText(W.name), { target: { value: 'Data pilot' } });
    fireEvent.click(screen.getByRole('button', { name: W.create }));
    await waitFor(() => expect(gh.start).toHaveBeenCalledWith(expect.objectContaining({ owner: 'the-bridge-company', slug: 'data-pilot' })));
  });

  it("no product yet: goes to the team's own account (the library's owner)", async () => {
    gh.access = { repos: [{ full: 'studio/site', name: 'site', defaultBranch: 'main' }], installation: null, account: 'studio' };
    show();
    await openForm();
    fireEvent.change(screen.getByLabelText(W.name), { target: { value: 'Data pilot' } });
    fireEvent.click(screen.getByRole('button', { name: W.create }));
    await waitFor(() => expect(gh.start).toHaveBeenCalledWith(expect.objectContaining({ owner: 'acme', slug: 'data-pilot' })));
  });

  it('starts the code, proposes it with the copy on, then shows the way to its previews', async () => {
    const onSent = vi.fn();
    const onOpenChange = vi.fn();
    show(onSent, onOpenChange);
    await openForm();
    fireEvent.change(screen.getByLabelText(W.name), { target: { value: 'Art print shop' } });
    fireEvent.click(screen.getByRole('button', { name: W.create }));
    expect(await screen.findByRole('heading', { name: W.readyTitle })).toBeInTheDocument();
    expect(gh.start).toHaveBeenCalledWith({ owner: 'acme', slug: 'art-print-shop', name: 'Art print shop' });
    expect(gh.link).toHaveBeenCalledWith(NEW, 'art-print-shop');
    expect(gh.propose).toHaveBeenCalledWith({ key: 'art-print-shop', name: 'Art print shop', repo: 'acme/art-print-shop', design: { repo: 'acme/art-print-shop-design' }, framework: 'react' });
    expect(screen.getByText(W.ready('Art print shop'))).toBeInTheDocument();
    const vercel = screen.getByRole('link', { name: W.vercel });
    expect(vercel).toHaveAttribute('href', vercelImportUrl('acme/art-print-shop'));
    expect(vercel).toHaveAttribute('target', '_blank');
    expect(screen.getByRole('link', { name: W.cloudflare })).toHaveAttribute('href', CLOUDFLARE_IMPORT_URL);
    expect(screen.getByText(W.previewsLater)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: W.done }));
    expect(onSent).toHaveBeenCalledTimes(1);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('no name yet: Create product says what is missing on the name field, which takes the focus', async () => {
    const { baseElement } = show();
    await openForm();
    const create = screen.getByRole('button', { name: W.create });
    // Enabled (DS Button guidance: an enabled button plus a message saying what is missing).
    expect(create).toBeEnabled();
    fireEvent.click(create);
    const field = screen.getByLabelText(W.name);
    await waitFor(() => expect(field).toHaveAttribute('aria-invalid', 'true'));
    expect(field).toHaveAccessibleDescription(expect.stringContaining('Type a name for the product.'));
    expect(document.activeElement).toBe(field);
    expect(gh.start).not.toHaveBeenCalled();
    await expectNoAxeViolations(baseElement);
    // Typing clears it.
    fireEvent.change(field, { target: { value: 'Atlas' } });
    await waitFor(() => expect(field).not.toHaveAttribute('aria-invalid', 'true'));
  });

  it('a name taken: says so, nothing proposed', async () => {
    gh.start.mockRejectedValue(Object.assign(new Error('Repository creation failed.'), { status: 422, detail: 'name already exists on this account' }));
    show();
    await openForm();
    fireEvent.change(screen.getByLabelText(W.name), { target: { value: 'Shop two' } });
    fireEvent.click(screen.getByRole('button', { name: W.create }));
    expect(await screen.findByRole('alert')).toHaveTextContent('acme already has something called shop-two. Pick a different name.');
    expect(gh.propose).not.toHaveBeenCalled();
  });

  it('no permission in the account: the ask-an-owner message goes on the clipboard', async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    gh.start.mockRejectedValue(Object.assign(new Error('Forbidden'), { status: 403, detail: 'You need admin access to the organization' }));
    show();
    await openForm();
    fireEvent.change(screen.getByLabelText(W.name), { target: { value: 'Checkout' } });
    fireEvent.click(screen.getByRole('button', { name: W.create }));
    expect(await screen.findByRole('alert')).toHaveTextContent('You cannot create products in acme yet.');
    fireEvent.click(screen.getByRole('button', { name: 'Ask an owner of acme' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(askOwnerMessage('acme', 'no-permission', 'Checkout')));
  });

  it('started but not proposed: already built, with it picked and its name kept', async () => {
    gh.propose.mockRejectedValue(new Error('nope'));
    show();
    await openForm();
    fireEvent.change(screen.getByLabelText(W.name), { target: { value: 'Art print shop' } });
    fireEvent.click(screen.getByRole('button', { name: W.create }));
    expect(await screen.findByText(A.refused)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: A.built })).toBeInTheDocument();
    expect(screen.getByRole('combobox')).toHaveValue('Art print shop');
    gh.propose.mockResolvedValue({ number: 8, url: 'https://github.com/acme/ds/pull/8' });
    fireEvent.click(screen.getByRole('button', { name: A.send }));
    await waitFor(() => expect(gh.propose).toHaveBeenLastCalledWith(expect.objectContaining({ name: 'Art print shop', repo: 'acme/art-print-shop' })));
  });
});
