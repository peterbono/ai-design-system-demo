// Adding a product straight to the team's library (POST /api/ship { action: "add-product" }, api/_lib/product-add.ts):
// Bridge checks on the server that the person is an admin or a lead, validates the entry, and writes that one product
// to bridge.config.json on the default branch. When GitHub refuses the direct write, the answer is `review`: Studio
// then opens the usual reviewed pull request (scripts/roles.ts proposeNewProduct). Pure apart from the fetch it is
// given. Unit tested in product-add-api.test.ts.
import type { ProductConfig } from '@bridge-ds/core';

export type AddProductAnswer =
  | { kind: 'added'; key: string; products: ProductConfig[] }
  /** Not written directly (direct write refused, app missing, a settings file Bridge cannot edit): open the review. */
  | { kind: 'review'; code: string }
  | { kind: 'refused'; code: 'not_lead' | 'needs_github' | 'taken' | 'invalid_product' | 'not_found' | 'signin'; message: string }
  /** Offline, GitHub down, or an answer Bridge does not know. */
  | { kind: 'failed' };

type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export const NEEDS_GITHUB = 'Adding a product needs a GitHub sign-in.';
const REFUSALS = new Set(['not_lead', 'needs_github', 'taken', 'invalid_product', 'not_found', 'signin']);

/** Asks Bridge to add `entry` to the team `repo` ("owner/name") with the viewer's GitHub token. Never throws. */
export async function addProductDirect(repo: string, entry: ProductConfig, bearer: string | null, fetchImpl: FetchLike = (u, i) => fetch(u, i)): Promise<AddProductAnswer> {
  if (!bearer) return { kind: 'refused', code: 'needs_github', message: NEEDS_GITHUB };
  try {
    const res = await fetchImpl('/api/ship', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${bearer}` },
      credentials: 'same-origin',
      body: JSON.stringify({ repo, action: 'add-product', product: entry }),
    });
    const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || typeof body !== 'object') return { kind: 'failed' };
    if (res.ok) {
      if (body.added === true && typeof body.key === 'string' && Array.isArray(body.products)) return { kind: 'added', key: body.key, products: body.products as ProductConfig[] };
      if (body.added === false && typeof body.code === 'string') return { kind: 'review', code: body.code };
      return { kind: 'failed' };
    }
    const code = typeof body.error === 'string' ? body.error : '';
    const message = typeof body.message === 'string' ? body.message : '';
    if (REFUSALS.has(code) && message) return { kind: 'refused', code: code as Extract<AddProductAnswer, { kind: 'refused' }>['code'], message };
    return { kind: 'failed' };
  } catch {
    return { kind: 'failed' };
  }
}
