// @vitest-environment jsdom
// Back from Bridge Direct's OK on GitHub (ResumeAction.tsx, AddProduct.tsx, StartNewProduct.tsx): wherever the person
// lands, Add a product reopens at the step they were on, with what they typed, the line and the primary button
// focused. Nothing is created before they click. Refused: the usual "needed" line. An old action never comes back.
import '../../../../../../packages/react/src/test/setup';
import { createElement } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { expectNoAxeViolations } from '../../../../../../packages/react/src/test/axe';
import { ADD_PRODUCT_WORDS as A, type ProductRepoChoice } from '../../../lib/add-product';
import { DIRECT_CONSENT } from '../../../lib/gh-wording';
import { NEW_PRODUCT_WORDS as W } from '../../../lib/new-product';
import { PENDING_ACTION_KEY, PENDING_ACTION_MAX_AGE_MS } from '../../../lib/pending-action';
import ResumeAction from './ResumeAction';

const gh = vi.hoisted(() => ({
  ok: true,
  access: { repos: [] as ProductRepoChoice[], installation: null as unknown, account: 'art-print-shop-co' },
  start: vi.fn(),
  link: vi.fn(),
  propose: vi.fn(),
}));

vi.mock('../../../scripts/github-session', () => ({ onAccess: (fn: (a: unknown) => void) => fn({ admin: true }), hasDirectOk: () => gh.ok }));
vi.mock('../../../scripts/repo-context', () => ({ repoContext: () => ({ owner: 'peterbono', repo: 'ai-design-system-demo' }), siteConfig: () => ({ products: [] }) }));
vi.mock('../../../scripts/add-product', () => ({
  readProductAccess: async () => gh.access,
  pollProductRepos: async () => [],
  readOwnership: async () => true,
  detectPreviews: async () => null,
}));
vi.mock('../../../scripts/new-product', () => ({
  startProductCode: (...a: unknown[]) => gh.start(...a),
  linkProductCode: (...a: unknown[]) => gh.link(...a),
}));
vi.mock('../../../scripts/roles', () => ({ proposeNewProduct: (...a: unknown[]) => gh.propose(...a) }));

const HOME = '/studio/t/peterbono/ai-design-system-demo/';
const keep = (kind: string, values: Record<string, unknown>, at = Date.now(), url = HOME) => sessionStorage.setItem(PENDING_ACTION_KEY, JSON.stringify({ kind, values, url, at }));

beforeEach(() => {
  sessionStorage.clear();
  history.replaceState(null, '', HOME);
  gh.ok = true;
  gh.access = { repos: [], installation: null, account: 'art-print-shop-co' };
  gh.start.mockReset().mockResolvedValue({ full: 'art-print-shop-co/atlas', name: 'atlas', defaultBranch: 'main' });
  gh.link.mockReset().mockResolvedValue(true);
  gh.propose.mockReset().mockResolvedValue({ number: 9, url: 'https://github.com/peterbono/ai-design-system-demo/pull/9' });
});

describe('Back from GitHub OK', () => {
  it('reopens "It\'s a new product" with the name, the line and Create focused, and creates nothing before the click', async () => {
    keep('new-product', { name: 'Atlas', owner: 'art-print-shop-co', copy: false });
    const { baseElement } = render(createElement(ResumeAction));
    expect(await screen.findByRole('heading', { name: W.title }, { timeout: 3000 })).toBeInTheDocument();
    expect(screen.getByLabelText(W.name)).toHaveValue('Atlas');
    expect(screen.getByRole('checkbox', { name: A.copy })).not.toBeChecked();
    expect(screen.getByText('GitHub gave the OK. Create Atlas now?')).toBeInTheDocument();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: W.create })));
    expect(gh.start).not.toHaveBeenCalled();
    expect(gh.propose).not.toHaveBeenCalled();
    // Shown once: the kept action is gone.
    expect(sessionStorage.getItem(PENDING_ACTION_KEY)).toBeNull();
    await expectNoAxeViolations(baseElement);
    fireEvent.click(screen.getByRole('button', { name: W.create }));
    await waitFor(() => expect(gh.start).toHaveBeenCalledWith({ owner: 'art-print-shop-co', slug: 'atlas', name: 'Atlas' }));
  });

  it('refused or closed on GitHub: the same step with the usual line', async () => {
    gh.ok = false;
    keep('new-product', { name: 'Atlas', owner: 'art-print-shop-co', copy: true });
    render(createElement(ResumeAction));
    expect(await screen.findByText(DIRECT_CONSENT.needed, undefined, { timeout: 3000 })).toBeInTheDocument();
    expect(screen.getByLabelText(W.name)).toHaveValue('Atlas');
    expect(gh.start).not.toHaveBeenCalled();
  });

  it('reopens "It\'s already built" with the product picked and Add product focused', async () => {
    gh.access.repos = [{ full: 'art-print-shop-co/shop', name: 'shop', defaultBranch: 'main' }];
    keep('add-product', { repo: 'art-print-shop-co/shop', name: 'Shop', copy: true });
    render(createElement(ResumeAction));
    await screen.findByRole('heading', { name: A.built }, { timeout: 3000 });
    expect(screen.getByText('GitHub gave the OK. Add Shop now?')).toBeInTheDocument();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: A.send })));
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
    expect(sessionStorage.getItem(PENDING_ACTION_KEY)).not.toBeNull();
  });
});
