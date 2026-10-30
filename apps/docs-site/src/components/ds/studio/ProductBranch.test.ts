// @vitest-environment jsdom
// The product branch page while exploring: explorations are free, so nothing asks the designer to check the library
// before Done exploring, and "Try it in the product" says when it opens the product as it is today.
import '../../../../../../packages/react/src/test/setup';
import { createElement } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ProductBranch, type ProductBranchProps } from './ProductBranch';
import { TRY_BUILDING_NOTE, TRY_TODAY_NOTE } from '../../../lib/product-branch';

const base: ProductBranchProps = {
  number: 611,
  crumbs: [{ label: 'Changes', href: '/studio/changes/' }, { label: 'Admin demo' }],
  title: 'Explore new design pr being built',
  sentence: { lead: 'Not checked against the library yet.', strong: '', rest: ' Ask Claude what is missing from the library.' },
  tryUrl: null,
  rows: [],
  checked: false,
  exploring: true,
  why: null,
  visual: 'none',
  product: 'Admin demo',
  connected: true,
  connectLabel: (g) => g,
  onAct: async () => undefined,
  onDone: null,
  onArchive: null,
  developer: [],
  githubUrl: 'https://github.com/acme/ds/pull/611',
  ask: 'Ask Claude: "Check what my feature adds that the library does not have."',
};

const paint = (over: Partial<ProductBranchProps> = {}) => render(createElement(ProductBranch, { ...base, ...over }));

afterEach(cleanup);

describe('ProductBranch while exploring', () => {
  it('never pushes the library check before Done exploring', () => {
    paint();
    expect(screen.queryByText(/Not checked against the library/)).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Missing from the library' })).toBeNull();
    expect(screen.queryByText(/Ask Claude/)).toBeNull();
  });

  it('shows the pieces once checked, or once done exploring', () => {
    paint({ checked: true, sentence: { lead: 'Built with the library.', strong: '', rest: '' } });
    expect(screen.getByRole('heading', { name: 'Missing from the library' })).toBeTruthy();
    expect(screen.getByText('Built with the library.')).toBeTruthy();
    cleanup();
    paint({ exploring: false });
    expect(screen.getByRole('heading', { name: 'Missing from the library' })).toBeTruthy();
  });

  it('opens the product today when the branch has no build of its own, and says so next to the button', () => {
    paint({ tryUrl: 'https://bridge-demo.example.com/', tryNote: TRY_TODAY_NOTE });
    const link = screen.getByRole('link', { name: 'Try it in the product' });
    expect(link.getAttribute('href')).toBe('https://bridge-demo.example.com/');
    expect(link.getAttribute('aria-describedby')).toBe('pb-try-note');
    expect(screen.getByText(TRY_TODAY_NOTE)).toBeTruthy();
  });

  it('while the preview builds: the button is disabled and says why', () => {
    paint({ tryNote: TRY_BUILDING_NOTE });
    expect(screen.queryByRole('link', { name: 'Try it in the product' })).toBeNull();
    expect((screen.getByRole('button', { name: 'Try it in the product' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(TRY_BUILDING_NOTE)).toBeTruthy();
  });
});
