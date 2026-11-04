// Studio's side of adding a product directly (lib/product-add-api.ts): what it sends and how it reads each answer.
import { describe, expect, it, vi } from 'vitest';
import type { ProductConfig } from '@bridge-ds/core';
import { addProductDirect, NEEDS_GITHUB } from './product-add-api';

const ENTRY: ProductConfig = { key: 'checkout', name: 'Checkout', repo: 'acme/checkout', framework: 'react' };
const answer = (status: number, body: unknown) => vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }));

describe('addProductDirect', () => {
  it('posts the entry with the GitHub token to /api/ship', async () => {
    const f = answer(200, { added: true, key: 'checkout', products: [ENTRY], commit: 'e' });
    expect(await addProductDirect('acme/ds', ENTRY, 'ghu_token', f)).toEqual({ kind: 'added', key: 'checkout', products: [ENTRY] });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/ship');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer ghu_token');
    expect(JSON.parse(String(init.body))).toEqual({ repo: 'acme/ds', action: 'add-product', product: ENTRY });
  });

  it('without a GitHub sign-in: refused, nothing sent', async () => {
    const f = answer(200, {});
    expect(await addProductDirect('acme/ds', ENTRY, null, f)).toEqual({ kind: 'refused', code: 'needs_github', message: NEEDS_GITHUB });
    expect(f).not.toHaveBeenCalled();
  });

  it('not written directly: review, with the reason code', async () => {
    expect(await addProductDirect('acme/ds', ENTRY, 't', answer(200, { added: false, code: 'direct_refused', reason: 'x' }))).toEqual({ kind: 'review', code: 'direct_refused' });
  });

  it.each([
    [403, 'not_lead'],
    [409, 'taken'],
    [400, 'invalid_product'],
    [400, 'not_found'],
    [401, 'signin'],
    [403, 'needs_github'],
  ])('%i %s: refused with the server words', async (status, code) => {
    expect(await addProductDirect('acme/ds', ENTRY, 't', answer(status, { error: code, message: 'Words.' }))).toEqual({ kind: 'refused', code, message: 'Words.' });
  });

  it('anything else fails quietly', async () => {
    expect(await addProductDirect('acme/ds', ENTRY, 't', answer(502, { error: 'unreachable', message: 'GitHub did not answer.' }))).toEqual({ kind: 'failed' });
    expect(await addProductDirect('acme/ds', ENTRY, 't', answer(200, { armed: true }))).toEqual({ kind: 'failed' });
    expect(await addProductDirect('acme/ds', ENTRY, 't', vi.fn(async () => Promise.reject(new Error('offline'))))).toEqual({ kind: 'failed' });
  });
});
