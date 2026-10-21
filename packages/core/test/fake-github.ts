// A small fake of api.github.com and raw.githubusercontent.com for client tests: routes by "METHOD /path", ETags
// with If-None-Match (304 is free, like GitHub's primary limit), an hourly budget that runs out, and a raw host that
// serves public files only.

import type { FetchLike } from '../src/github-client';

export interface FakeRoute {
  status?: number;
  body: unknown;
  /** Sent as the ETag header; a request with a matching If-None-Match gets 304. */
  etag?: string;
  /** Body sent as text (raw media type). */
  text?: string;
}

export interface FakeCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  status: number;
}

export function fakeGitHub(opts: { routes?: Record<string, FakeRoute>; raw?: Record<string, string>; budget?: number } = {}) {
  const routes = opts.routes ?? {};
  const raw = opts.raw ?? {};
  const calls: FakeCall[] = [];
  const state = { remaining: opts.budget ?? 5000, limit: opts.budget ?? 5000, reset: 1_900_000_000, rawDown: false };

  const respond = (status: number, body: unknown, headers: Record<string, string> = {}, text?: string) => ({
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (n: string) => headers[n.toLowerCase()] ?? null },
    json: async () => body,
    text: async () => text ?? (typeof body === 'string' ? body : JSON.stringify(body)),
  });

  const fetchImpl: FetchLike = async (url, init) => {
    const method = init?.method ?? 'GET';
    const headers = init?.headers ?? {};
    if (url.startsWith('https://raw.githubusercontent.com/')) {
      if (state.rawDown) {
        calls.push({ url, method, headers, status: 0 });
        throw new TypeError('fetch failed');
      }
      const key = url.slice('https://raw.githubusercontent.com/'.length);
      const status = key in raw ? 200 : 404;
      calls.push({ url, method, headers, status });
      return respond(status, null, {}, key in raw ? raw[key] : '404: Not Found');
    }
    const path = url.replace('https://api.github.com', '');
    const route = routes[`${method} ${path}`];
    const rl = (): Record<string, string> => ({
      'x-ratelimit-limit': String(state.limit),
      'x-ratelimit-remaining': String(state.remaining),
      'x-ratelimit-reset': String(state.reset),
      'x-ratelimit-resource': 'core',
    });
    if (route?.etag && headers['If-None-Match'] === route.etag) {
      calls.push({ url, method, headers, status: 304 });
      return respond(304, null, { ...rl(), etag: route.etag });
    }
    if (state.remaining <= 0) {
      calls.push({ url, method, headers, status: 403 });
      return respond(403, { message: 'API rate limit exceeded for user.' }, rl());
    }
    state.remaining--;
    const status = route ? (route.status ?? 200) : 404;
    calls.push({ url, method, headers, status });
    const body = route ? route.body : { message: 'Not Found' };
    return respond(status, body, { ...rl(), ...(route?.etag ? { etag: route.etag } : {}) }, route?.text);
  };

  return { fetchImpl, calls, routes, raw, state, apiCalls: () => calls.filter((c) => c.url.startsWith('https://api.github.com')) };
}

export const noSleep = { attempts: 3, baseDelayMs: 0, sleep: async () => {} };
