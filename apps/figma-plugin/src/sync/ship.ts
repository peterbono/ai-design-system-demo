// Asks Bridge to ship a token push from Figma (POST /api/ship, docs/HOSTED.md "Ship from Figma"): Bridge re-reads the
// pull request with its own app token and, when it holds token values only, approves it and turns on auto-merge.
// The plugin's GitHub token only proves the designer can read the repository; asking never widens anything.

import { STUDIO_ORIGIN } from '../shared/messages';

export type ArmAnswer =
  | { armed: true; route: 'shipped'; merged?: boolean | undefined }
  | { armed: false; route: 'waiting-for-developer'; code: string; reason: string; retryAfter?: number | undefined };

/** The checks are still running: ask again after `retryAfter` seconds. */
export const CHECKS_PENDING = 'checks_pending';

export async function armShip(token: string, repo: string, pr: number, fetchImpl: typeof fetch = fetch, origin = STUDIO_ORIGIN): Promise<ArmAnswer> {
  // Offline, a blocked domain or the site down: one sentence a designer can read, not the browser's "Failed to fetch".
  const res = await fetchImpl(`${origin}/api/ship`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ repo, pr }),
  }).catch(() => {
    throw new Error('Bridge could not be reached, so a developer adds it to the library.');
  });
  const body = (await res.json().catch(() => ({}))) as Partial<ArmAnswer> & { error?: string; message?: string };
  if (!res.ok) throw new Error(body.message || `Bridge could not ship it (${res.status}).`);
  if (body.armed === true) return { armed: true, route: 'shipped', ...(body.merged ? { merged: true } : {}) };
  if (body.armed === false && typeof body.reason === 'string')
    return { armed: false, route: 'waiting-for-developer', code: String(body.code ?? ''), reason: body.reason, ...(typeof body.retryAfter === 'number' ? { retryAfter: body.retryAfter } : {}) };
  throw new Error('Bridge answered something unexpected: a developer adds it to the library.');
}
