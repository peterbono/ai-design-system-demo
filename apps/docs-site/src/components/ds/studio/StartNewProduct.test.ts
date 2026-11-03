// @vitest-environment jsdom
// "No code yet? Start a new product" in Add a product (AddProduct.tsx, StartNewProduct.tsx, lib/new-product.ts): one
// more quiet line under the list (and under the empty line), a small form with the address in plain words, Bridge
// starts the code and proposes it with the designers' copy on, then the previews step. Refusals in designer words,
// with the ask-an-owner message when an owner decides. Started but not proposed: back to the list with it picked.
import '../../../../../../packages/react/src/test/setup';
import { createElement } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { expectNoAxeViolations } from '../../../../../../packages/react/src/test/axe';
import { ADD_PRODUCT_WORDS as A, type ProductRepoChoice } from '../../../lib/add-product';
import { CLOUDFLARE_IMPORT_URL, NEW_PRODUCT_WORDS as W, addressLine, askOwnerMessage, vercelImportUrl } from '../../../lib/new-product';
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
  fireEvent.click(await screen.findByRole('button', { name: W.start }));
  expect(await screen.findByRole('heading', { name: W.title })).toBeInTheDocument();
};

describe('Add a product: no code yet', () => {
  it('offers a second quiet line under the list, and under the empty line', async () => {
    const { unmount } = show();
    expect(await screen.findByText(A.notListed)).toBeInTheDocument();
    expect(screen.getByText(W.noCode)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: W.start })).toBeInTheDocument();
    unmount();
    gh.access.repos = [];
    show();
    expect(await screen.findByText(A.emptyLine)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: W.start })).toBeInTheDocument();
  });

  it('shows the address in plain words, one primary action, Back to the list', async () => {
    const { baseElement } = show();
    await openForm();
    fireEvent.change(screen.getByLabelText(W.name), { target: { value: 'Art print shop' } });
    expect(screen.getByText(addressLine('acme', 'art-print-shop'))).toBeInTheDocument();
    // One account only: no Where field.
    expect(screen.queryByText(W.where)).toBeNull();
    expect(screen.getByRole('checkbox', { name: A.copy })).toBeChecked();
    expect(screen.getByRole('button', { name: W.create })).toBeInTheDocument();
    await expectNoAxeViolations(baseElement);
    fireEvent.click(screen.getByRole('button', { name: W.back }));
    expect(await screen.findByText(A.notListed)).toBeInTheDocument();
  });

  it('offers Where when Bridge reaches more than one account', async () => {
    gh.access.repos = [SHOP, { full: 'studio/site', name: 'site', defaultBranch: 'main' }];
    show();
    await openForm();
    expect(screen.getByText(W.where)).toBeInTheDocument();
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

  it('started but not proposed: back to the list with it picked and named', async () => {
    gh.propose.mockRejectedValue(new Error('nope'));
    show();
    await openForm();
    fireEvent.change(screen.getByLabelText(W.name), { target: { value: 'Art print shop' } });
    fireEvent.click(screen.getByRole('button', { name: W.create }));
    expect(await screen.findByText(A.refused)).toBeInTheDocument();
    expect(screen.getByRole('combobox')).toHaveValue('art-print-shop');
    expect(screen.getByLabelText(A.name)).toHaveValue('Art print shop');
  });
});
