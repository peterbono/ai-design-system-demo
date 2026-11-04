// @vitest-environment jsdom
// Back from GitHub (ResumeAction.tsx, AddProduct.tsx, StartNewProduct.tsx): after a sign-in or Install on GitHub,
// wherever the person lands, Add a product reopens at the step they were on, with what they typed, the line and the
// primary button focused. Nothing is created before they click. No sign-in: "Sign in again to finish." An old action
// never comes back.
import '../../../../../../packages/react/src/test/setup';
import { createElement } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { expectNoAxeViolations } from '../../../../../../packages/react/src/test/axe';
import { ADD_PRODUCT_WORDS as A, type ProductRepoChoice } from '../../../lib/add-product';
import { NEW_PRODUCT_WORDS as W } from '../../../lib/new-product';
import { PENDING_ACTION_KEY, PENDING_ACTION_MAX_AGE_MS, SIGN_IN_TO_FINISH } from '../../../lib/pending-action';
import ResumeAction from './ResumeAction';
import { setOpenPage } from './AddProduct';

setOpenPage(() => undefined);

const gh = vi.hoisted(() => ({
  ok: true,
  access: { repos: [] as ProductRepoChoice[], installation: null as unknown, account: 'art-print-shop-co' },
  start: vi.fn(),
  link: vi.fn(),
  propose: vi.fn(),
}));

vi.mock('../../../scripts/github-session', () => ({ onAccess: (fn: (a: unknown) => void) => fn({ admin: true }), hasWorkingToken: () => gh.ok, ghAuthFailure: () => null, currentViewer: () => ({ login: 'dana' }) }));
vi.mock('../../../scripts/repo-context', () => ({ repoContext: () => ({ owner: 'peterbono', repo: 'ai-design-system-demo' }), siteConfig: () => ({ products: [] }) }));
vi.mock('../../../scripts/add-product', () => ({
  readProductAccess: async () => gh.access,
  pollProductRepos: async () => [],
  readOwnership: async () => true,
  detectPreviews: async () => null,
  addToTeam: async (entry: { key: string }) => (gh.propose(entry), { kind: 'added', key: entry.key }),
}));
vi.mock('../../../scripts/new-product', () => ({
  startProductCode: (...a: unknown[]) => gh.start(...a),
  linkProductCode: (...a: unknown[]) => gh.link(...a),
}));
vi.mock('../../../scripts/roles', () => ({ proposeNewProduct: (...a: unknown[]) => gh.propose(...a) }));

const HOME = '/studio/t/peterbono/ai-design-system-demo/';
const keep = (kind: string, values: Record<string, unknown>, at = Date.now(), url = HOME) => localStorage.setItem(PENDING_ACTION_KEY, JSON.stringify({ kind, values, url, at }));

beforeEach(() => {
  localStorage.clear();
  history.replaceState(null, '', HOME);
  gh.ok = true;
  gh.access = { repos: [], installation: null, account: 'art-print-shop-co' };
  gh.start.mockReset().mockResolvedValue({ full: 'art-print-shop-co/atlas', name: 'atlas', defaultBranch: 'main' });
  gh.link.mockReset().mockResolvedValue(true);
  gh.propose.mockReset().mockResolvedValue({ number: 9, url: 'https://github.com/peterbono/ai-design-system-demo/pull/9' });
});

afterEach(cleanup);

describe('Back from GitHub', () => {
  it('back from Install on GitHub: the products Bridge found reopen with one line, nothing sent', async () => {
    gh.access.repos = [{ full: 'art-print-shop-co/shop', name: 'shop', defaultBranch: 'main' }];
    keep('add-product', {});
    const { baseElement } = render(createElement(ResumeAction));
    await screen.findByRole('button', { name: A.addLabel('Shop') }, { timeout: 3000 });
    expect(await screen.findByText('Back from GitHub. Pick your product to add it.', undefined, { timeout: 3000 })).toBeInTheDocument();
    expect(gh.propose).not.toHaveBeenCalled();
    expect(localStorage.getItem(PENDING_ACTION_KEY)).toBeNull();
    await expectNoAxeViolations(baseElement);
  });

  it('reopens "It\'s a new product" with the name, the line and Create focused, and creates nothing before the click', async () => {
    keep('new-product', { name: 'Atlas', owner: 'art-print-shop-co', copy: false });
    const { baseElement } = render(createElement(ResumeAction));
    expect(await screen.findByRole('heading', { name: W.title }, { timeout: 3000 })).toBeInTheDocument();
    expect(screen.getByLabelText(W.name)).toHaveValue('Atlas');
    expect(screen.getByRole('checkbox', { name: A.copy })).not.toBeChecked();
    expect(screen.getByText('Back from GitHub. Create Atlas now?')).toBeInTheDocument();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: W.create })));
    expect(gh.start).not.toHaveBeenCalled();
    expect(gh.propose).not.toHaveBeenCalled();
    // Shown once: the kept action is gone.
    expect(localStorage.getItem(PENDING_ACTION_KEY)).toBeNull();
    await expectNoAxeViolations(baseElement);
    fireEvent.click(screen.getByRole('button', { name: W.create }));
    await waitFor(() => expect(gh.start).toHaveBeenCalledWith({ owner: 'peterbono', slug: 'atlas', name: 'Atlas' }));
  });

  it('back without a sign-in: the same step, and the line says to sign in again', async () => {
    gh.ok = false;
    keep('new-product', { name: 'Atlas', owner: 'art-print-shop-co', copy: true });
    render(createElement(ResumeAction));
    expect(await screen.findByText(SIGN_IN_TO_FINISH, undefined, { timeout: 3000 })).toBeInTheDocument();
    expect(screen.getByLabelText(W.name)).toHaveValue('Atlas');
    expect(gh.start).not.toHaveBeenCalled();
  });

  it('reopens the products Bridge found with that product\'s Add focused', async () => {
    gh.access.repos = [{ full: 'art-print-shop-co/shop', name: 'shop', defaultBranch: 'main' }];
    keep('add-product', { repo: 'art-print-shop-co/shop', name: 'Shop', copy: true });
    render(createElement(ResumeAction));
    await screen.findByRole('button', { name: A.addLabel('Shop') }, { timeout: 3000 });
    expect(screen.getByText('Back from GitHub. Add Shop now?')).toBeInTheDocument();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: A.addLabel('Shop') })));
    expect(gh.propose).not.toHaveBeenCalled();
  });

  it('nothing kept, too old, or kept on another page: nothing opens', async () => {
    const { unmount } = render(createElement(ResumeAction));
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByRole('dialog')).toBeNull();
    unmount();
    keep('new-product', { name: 'Atlas' }, Date.now() - PENDING_ACTION_MAX_AGE_MS - 1000);
    const second = render(createElement(ResumeAction));
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByRole('dialog')).toBeNull();
    second.unmount();
    keep('new-product', { name: 'Atlas' }, Date.now(), '/studio/t/peterbono/ai-design-system-demo/settings/');
    render(createElement(ResumeAction));
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(localStorage.getItem(PENDING_ACTION_KEY)).not.toBeNull();
  });
});
