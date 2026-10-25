// Who is asking, for one team: a GitHub token (`Authorization: Bearer`: Studio's GitHub sign-in, and the Figma plugin's
// "Sign in with Bridge" token, api/plugin-link) read with itself, or an email member signed in to Studio (the contribute
// cookie or a Bridge account session, with `X-Bridge-Contribute: 1` from a page of this site: no cross-site form can
// send that header). The same rule as /api/ship. Nothing the browser says about who it is is trusted.

import { contributorOf, type ContribEnv } from '../contribute/index.js';
import type { AppTokens } from './github-app.js';
import { GITHUB_DOWN, HttpError, sameOriginWhenPresent, type FetchLike } from './http.js';
import { localAdminsOn } from './local-admin.js';
import type { MemberStore } from './members.js';
import type { Redis } from './redis.js';

export interface TeamCaller {
  kind: 'github' | 'member';
  /** The name Bridge shows: a GitHub profile name or login, an email member's name. Never an email. */
  name: string;
  /** The GitHub login, for a GitHub token. */
  login: string | null;
  admin: boolean;
  /** Can edit the library (GitHub push, or an email member). */
  canEdit: boolean;
}

export interface CallerDeps {
  fetch: FetchLike;
  now?: () => number;
  redis?: Redis;
  members?: MemberStore;
  app?: AppTokens;
}

export const CALLER_WORDS = {
  signin: 'Sign in to Bridge first: with GitHub, or with your email in Studio.',
  expired: 'Your GitHub sign-in expired. Sign in again.',
  notOnTeam: 'Only people on this team can see this.',
} as const;

/** The GitHub token of an `Authorization: Bearer` header (20 characters or more; local mode accepts the personas'). */
export function bearerOf(req: Request, processEnv: Record<string, string | undefined> = process.env): string | null {
  const m = /^Bearer\s+([A-Za-z0-9_.-]{1,255})$/i.exec(req.headers.get('authorization') ?? '')?.[1];
  if (!m) return null;
  return m.length >= (localAdminsOn(processEnv) ? 8 : 20) ? m : null;
}

export async function githubGet(f: FetchLike, token: string, path: string, ua = 'bridge'): Promise<{ status: number; data: any }> {
  let res: Response;
  try {
    res = await f(`https://api.github.com${path}`, { method: 'GET', headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`, 'User-Agent': ua, 'X-GitHub-Api-Version': '2022-11-28' } });
  } catch {
    throw new HttpError(502, 'unreachable', GITHUB_DOWN);
  }
  if (res.status >= 500) throw new HttpError(502, 'unreachable', GITHUB_DOWN);
  return { status: res.status, data: await res.json().catch(() => null) };
}

/**
 * The person behind the request, on this team, or a 401 or 403. `need: 'read'` lets anyone who can read the repository
 * (a reader of the library); `'edit'` needs push (or an email member).
 */
export async function teamCaller(req: Request, x: { owner: string; repo: string; full: string; need: 'read' | 'edit' }, env: ContribEnv, deps: CallerDeps): Promise<TeamCaller> {
  const bearer = bearerOf(req);
  if (bearer) {
    const me = await githubGet(deps.fetch, bearer, '/user');
    if (me.status === 401 || me.status === 403 || typeof me.data?.login !== 'string') throw new HttpError(401, 'signin', CALLER_WORDS.expired);
    const r = await githubGet(deps.fetch, bearer, `/repos/${x.owner}/${x.repo}`);
    if (r.status === 401) throw new HttpError(401, 'signin', CALLER_WORDS.expired);
    const p = r.status === 200 ? r.data?.permissions : null;
    const canEdit = Boolean(p?.push || p?.admin);
    if (!p || !(canEdit || (x.need === 'read' && p.pull))) throw new HttpError(403, 'forbidden', CALLER_WORDS.notOnTeam);
    const profile = typeof me.data.name === 'string' && me.data.name.trim() ? me.data.name.trim() : me.data.login;
    return { kind: 'github', name: profile, login: me.data.login, admin: p.admin === true, canEdit };
  }
  if (req.headers.get('x-bridge-contribute') !== '1' || !sameOriginWhenPresent(req)) throw new HttpError(401, 'signin', CALLER_WORDS.signin);
  const m = await contributorOf(req, x.full, env, { fetch: deps.fetch, ...(deps.now ? { now: deps.now } : {}), ...(deps.redis ? { redis: deps.redis } : {}), ...(deps.members ? { members: deps.members } : {}), ...(deps.app ? { app: deps.app } : {}) });
  if (!m) throw new HttpError(401, 'signin', CALLER_WORDS.signin);
  return { kind: 'member', name: m.name, login: null, admin: m.role === 'admin', canEdit: true };
}
