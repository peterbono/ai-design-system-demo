// Reads a Storybook for the quick start (plan section 5, spike in the PR): /api/storybook first, because only the
// server can tell whether the Storybook may be framed and it also reads hosts that send no CORS header (Netlify).
// When the function is unreachable (astro dev, an outage) or refuses a private address (a Storybook on localhost,
// which only this browser can reach), the browser reads index.json itself; the frame verdict is then unknown.
// Results are kept for this page view, so the list and the preview share one read.
import { fetchStorybookIndex, normalizeStorybookUrl, parseStorybookIndex, StorybookIndexError, type StorybookIndex } from '@bridge-ds/core';
import type { FrameVerdict } from '../lib/storybook-view';

export interface LoadedStorybook {
  /** The base previews load from (after the host's redirects). */
  base: string;
  index: StorybookIndex;
  frame: FrameVerdict;
  via: 'proxy' | 'direct';
}

const cache = new Map<string, Promise<LoadedStorybook>>();

/** An error with a code from StorybookIndexError or from the proxy ('blocked', 'too-large', 'timeout', 'redirects'). */
export class StorybookLoadError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

// Answers the proxy gives that the browser cannot do better on: trust them instead of retrying directly.
const FINAL = new Set(['invalid-url', 'not-found', 'not-json', 'private', 'empty', 'too-large', 'redirects']);

async function viaProxy(base: string, signal?: AbortSignal): Promise<LoadedStorybook | null> {
  let res: Response;
  try {
    res = await fetch(`/api/storybook?url=${encodeURIComponent(base)}`, { headers: { accept: 'application/json' }, ...(signal ? { signal } : {}) });
  } catch (err) {
    if (signal?.aborted) throw err;
    return null;
  }
  let body: { base?: string; source?: 'index.json' | 'stories.json'; index?: unknown; frame?: FrameVerdict; error?: string; message?: string } | null = null;
  try {
    body = await res.json();
  } catch {
    return null; // no function here (a static 404 page): read directly
  }
  if (res.ok && body?.index && body.base) {
    const index = parseStorybookIndex(body.index, body.source);
    return { base: body.base, index, frame: body.frame ?? 'unknown', via: 'proxy' };
  }
  if (body?.error && FINAL.has(body.error)) throw new StorybookLoadError(body.error, body.message ?? body.error);
  return null;
}

async function load(base: string, signal?: AbortSignal): Promise<LoadedStorybook> {
  const proxied = await viaProxy(base, signal);
  if (proxied) return proxied;
  try {
    const index = await fetchStorybookIndex(base, signal ? { signal } : {});
    return { base, index, frame: 'unknown', via: 'direct' };
  } catch (err) {
    if (err instanceof StorybookIndexError) throw new StorybookLoadError(err.code, err.message);
    throw err;
  }
}

/** Reads the Storybook at `input` (any address a person pastes). Throws StorybookLoadError. */
export function loadStorybook(input: string, opts: { signal?: AbortSignal; fresh?: boolean } = {}): Promise<LoadedStorybook> {
  let base: string;
  try {
    base = normalizeStorybookUrl(input);
  } catch (err) {
    return Promise.reject(new StorybookLoadError('invalid-url', (err as Error).message));
  }
  if (!opts.fresh && cache.has(base)) return cache.get(base)!;
  const p = load(base, opts.signal);
  cache.set(base, p);
  p.catch(() => cache.delete(base));
  return p;
}
