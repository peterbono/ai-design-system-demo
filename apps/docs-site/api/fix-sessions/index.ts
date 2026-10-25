// GET /api/fix-sessions?repo=owner/name&component=Name: the fix session of one component, as the Figma plugin reads it
// (apps/figma-plugin/src/sync/fix-session.ts). The same answer as /api/mcp?view=session (docs/FIGMA-FIXES.md, "Work in
// progress: fix sessions"): { session: SessionView }. Bearer is the Bridge sign-in token; CORS is open.
import { handleConnector, type ConnectorDeps, type ConnectorEnv } from '../mcp/index.js';
import type { FetchLike } from '../_lib/http.js';

export function handleFixSessions(req: Request, env: ConnectorEnv, deps: ConnectorDeps): Promise<Response> {
  const u = new URL(req.url);
  u.searchParams.set('view', 'session');
  for (const k of ['oauth', 'wk']) u.searchParams.delete(k);
  return handleConnector(new Request(u, { method: req.method === 'OPTIONS' ? 'OPTIONS' : 'GET', headers: req.headers }), env, deps);
}

const envFromProcess = (): ConnectorEnv => ({
  KV_REST_API_URL: process.env.KV_REST_API_URL,
  KV_REST_API_TOKEN: process.env.KV_REST_API_TOKEN,
  UPSTASH_REDIS_REST_URL: process.env.UPSTASH_REDIS_REST_URL,
  UPSTASH_REDIS_REST_TOKEN: process.env.UPSTASH_REDIS_REST_TOKEN,
  LIBRARY_SESSION_SECRET: process.env.LIBRARY_SESSION_SECRET,
  GITHUB_APP_ID: process.env.GITHUB_APP_ID,
  GITHUB_APP_PRIVATE_KEY: process.env.GITHUB_APP_PRIVATE_KEY,
  PUBLIC_SITE_URL: process.env.PUBLIC_SITE_URL,
});

const realFetch: FetchLike = (url, init) => fetch(url, init);
const handle = (request: Request) => handleFixSessions(request, envFromProcess(), { fetch: realFetch });

/** Vercel Functions entries (Web standard signature). */
export const GET = handle;
export const OPTIONS = handle;
