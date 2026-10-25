// Asks Bridge to ship a token push from Figma (POST /api/ship, docs/HOSTED.md "Ship from Figma"): Bridge re-reads the
// pull request with its own app token and, when it holds token values only, approves it and turns on auto-merge.
// Bridge ships a push by itself only for its author with write access, recorded by Bridge at its head commit right
// after the plugin opened it (markFigmaPush); asking never widens anything.

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

export type MarkAnswer = { marked: true } | { marked: false; code: string };

/**
 * Right after the plugin opens a token push, its author asks Bridge to record it (POST /api/ship, mark "figma"): Bridge
 * checks the author, their write access and the change, and signs the pull request's head. Only a recorded push ships
 * by itself; a later commit needs a design approval. Throws when Bridge could not be asked (ask again later).
 */
export async function markFigmaPush(token: string, repo: string, pr: number, fetchImpl: typeof fetch = fetch, origin = STUDIO_ORIGIN): Promise<MarkAnswer> {
  const res = await fetchImpl(`${origin}/api/ship`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ repo, pr, mark: 'figma' }),
  }).catch(() => {
    throw new Error('Bridge could not be reached, so a developer adds it to the library.');
  });
  const body = (await res.json().catch(() => ({}))) as { marked?: unknown; code?: unknown; message?: string };
  if (res.status >= 500) throw new Error(body.message || `Bridge could not record it (${res.status}).`);
  if (res.ok && body.marked === true) return { marked: true };
  return { marked: false, code: typeof body.code === 'string' ? body.code : `http_${res.status}` };
}

/**
 * The arm call of the ship poller: records each push once (markFigmaPush), then asks Bridge to arm it. A mark Bridge
 * could not be asked for is asked again on the next try; a refused one is not (the push then waits for a review).
 */
export function figmaShipper(token: string, repo: string, fetchImpl: typeof fetch = fetch, origin = STUDIO_ORIGIN): (pr: number) => Promise<ArmAnswer> {
  const recorded = new Set<number>();
  return async (pr) => {
    if (!recorded.has(pr)) {
      const asked = await markFigmaPush(token, repo, pr, fetchImpl, origin).then(
        () => true,
        () => false,
      );
      if (asked) recorded.add(pr);
    }
    return armShip(token, repo, pr, fetchImpl, origin);
  };
}
