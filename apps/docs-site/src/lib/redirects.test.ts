// Old Studio URLs land on the page that replaced them, with their query and hash carried over.
import { describe, expect, it } from 'vitest';
import { REDIRECTS, redirectTarget } from './redirects';

describe('Quality redirects', () => {
  it('sends Checks and Adoption to the one Quality page', () => {
    expect(REDIRECTS['/studio/checks']).toBe('/studio/quality/');
    expect(REDIRECTS['/studio/adoption']).toBe('/studio/quality/');
    expect(REDIRECTS['/adoption']).toBe('/studio/quality/');
  });

  it('keeps the query and the hash of the old URL', () => {
    expect(redirectTarget(REDIRECTS['/studio/adoption']!, '?branch=x', '#admin-after')).toBe('/studio/quality/?branch=x#admin-after');
    expect(redirectTarget(REDIRECTS['/studio/checks']!, '', '')).toBe('/studio/quality/');
  });
});
