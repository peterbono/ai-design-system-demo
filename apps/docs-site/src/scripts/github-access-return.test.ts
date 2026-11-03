// The return page after GitHub's access settings (pages/studio/auth/access.astro): in the window the dialog opened,
// it tells the dialog (this site only) and closes; opened on its own, it stays.
import { describe, expect, it, vi } from 'vitest';
import { ACCESS_MESSAGE } from '../lib/add-product';
import { returnToOpener } from './github-access-return';

const win = (opener: { closed?: boolean; postMessage: ReturnType<typeof vi.fn> } | null) => ({ opener, location: { origin: 'https://bridge.example.com' }, close: vi.fn() });

describe('the access return page', () => {
  it('tells the dialog on this site only, then closes', () => {
    const opener = { closed: false, postMessage: vi.fn() };
    const w = win(opener);
    expect(returnToOpener(w)).toBe(true);
    expect(opener.postMessage).toHaveBeenCalledWith({ type: ACCESS_MESSAGE }, 'https://bridge.example.com');
    expect(w.close).toHaveBeenCalled();
  });

  it('stays open on its own, or when the dialog is gone', () => {
    const alone = win(null);
    expect(returnToOpener(alone)).toBe(false);
    expect(alone.close).not.toHaveBeenCalled();
    const gone = win({ closed: true, postMessage: vi.fn() });
    expect(returnToOpener(gone)).toBe(false);
    const other = win({ postMessage: vi.fn(() => { throw new Error('cross-origin'); }) });
    expect(returnToOpener(other)).toBe(false);
    expect(other.close).not.toHaveBeenCalled();
  });
});
