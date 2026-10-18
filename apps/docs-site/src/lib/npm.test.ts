import { describe, expect, it } from 'vitest';
import { npmUrl } from './npm';

describe('npmUrl', () => {
  it('links a scoped package to its npmjs.com page', () => {
    expect(npmUrl('@bridge-ds/react')).toBe('https://www.npmjs.com/package/@bridge-ds/react');
  });
  it('links an unscoped package', () => {
    expect(npmUrl('react')).toBe('https://www.npmjs.com/package/react');
  });
});
