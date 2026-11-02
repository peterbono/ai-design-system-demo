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
    paint({ checked: true, rows: null, sentence: { lead: 'Built with the library.', strong: '', rest: '' } });
    expect(screen.getByRole('heading', { name: 'Missing from the library' })).toBeTruthy();
    expect(screen.getByText('Built with the library.')).toBeTruthy();
    cleanup();
    // Nothing missing: the zone says it once, the sentence above it does not repeat it.
    paint({ checked: true, rows: [], sentence: { lead: 'Built with the library. ', strong: 'Nothing is missing', rest: ': every value and component comes from it.' } });
    expect(screen.getByText('Nothing: every value and component comes from the library.')).toBeTruthy();
    expect(screen.queryByText('Nothing is missing')).toBeNull();
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

  it('no build and nothing known about it: the reason in words beside the disabled button', () => {
    paint({ tryUrl: null, tryNote: null });
    const button = screen.getByRole('button', { name: 'Try it in the product' }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.getAttribute('aria-describedby')).toBe('pb-try-note');
    expect(screen.getByText('Preview not available yet')).toBeTruthy();
  });

  it('once done exploring: its tag and one sentence, and the plate while there is no before and after', () => {
    const { container } = paint({ status: 'promoted', state: 'Promoted to review: it is in review now, and goes through the usual approvals.', visual: 'none', exploring: false });
    const line = container.querySelector('.pb-status')!;
    expect(line.textContent).toContain('In review');
    expect(line.textContent).toContain('Promoted to review');
    expect(container.querySelector('.pb-screen .xp-plate')).toBeTruthy();
  });

  it('while the preview builds: the button is disabled and says why', () => {
    paint({ tryNote: TRY_BUILDING_NOTE });
    expect(screen.queryByRole('link', { name: 'Try it in the product' })).toBeNull();
    expect((screen.getByRole('button', { name: 'Try it in the product' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(TRY_BUILDING_NOTE)).toBeTruthy();
  });
});
