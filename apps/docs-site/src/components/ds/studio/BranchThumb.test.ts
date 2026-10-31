// @vitest-environment jsdom
// The screen thumbnail of an exploration: its preview capture with "Captured ... ago" on a card, the plate when there
// is none, and the plate again, in the same box, when the image does not load.
import '../../../../../../packages/react/src/test/setup';
import { createElement } from 'react';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { BranchThumb } from './BranchThumb';

afterEach(cleanup);

const shot = { kind: 'screen' as const, src: 'https://raw.githubusercontent.com/o/r/bridge-shots/o/p/2.webp?v=abc1234', capturedAt: new Date(Date.now() - 2 * 3600 * 1000).toISOString(), product: 'Product admin', screen: 'Dashboard', seed: 'admin-app#2' };

describe('BranchThumb, explored screens', () => {
  it('shows the capture and when it was taken on a card', () => {
    const { container } = render(createElement(BranchThumb, { spec: shot, size: 'card' }));
    expect(container.querySelector('img.bt-screen')?.getAttribute('src')).toBe(shot.src);
    expect(container.querySelector('.bt-captured')?.textContent).toBe('Captured 2 h ago');
    expect(container.querySelector('.bt')!.classList.contains('is-shot')).toBe(true);
  });

  it('keeps a row thumbnail to the image only', () => {
    const { container } = render(createElement(BranchThumb, { spec: shot, size: 'row' }));
    expect(container.querySelector('img.bt-screen')).toBeTruthy();
    expect(container.querySelector('.bt-captured')).toBeNull();
  });

  it('falls back to the plate when the image does not load', () => {
    const { container } = render(createElement(BranchThumb, { spec: shot, size: 'card' }));
    fireEvent.error(container.querySelector('img')!);
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('.bt-plate-screen')?.textContent).toBe('Dashboard');
    expect(container.querySelector('.bt-plate-product')?.textContent).toBe('Product admin');
  });

  it('draws the plate without a capture, one drawing per exploration', () => {
    const a = render(createElement(BranchThumb, { spec: { kind: 'screen', src: null, product: 'Product admin', screen: null, seed: 'admin-app#2' }, size: 'card' }));
    const first = a.container.querySelector('svg')!.innerHTML;
    expect(a.container.querySelector('.bt-plate-screen')?.textContent).toBe('Product admin');
    cleanup();
    const seeds = ['600', '601', '611', '612', 'admin-app#3'];
    const others = seeds.map((seed) => {
      const r = render(createElement(BranchThumb, { spec: { kind: 'screen', src: null, product: 'Product admin', seed }, size: 'card' }));
      const html = r.container.querySelector('svg')!.innerHTML;
      cleanup();
      return html;
    });
    expect(others.some((h) => h !== first)).toBe(true);
  });
});
