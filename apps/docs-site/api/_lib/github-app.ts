// Installation tokens of the Bridge GitHub App, scoped to one repository and to the permissions a feature needs,
// minted per request and never stored. Shared by api/invites, api/library-access and api/contribute.

import { createSign } from 'node:crypto';
import { b64url, GITHUB_DOWN, HttpError, type FetchLike } from './http.js';

export type AppPermission = 'read' | 'write';

/** An installation token for one repository, or null when the app is not installed there or lacks a permission. */
export interface AppTokens {
  installationToken(owner: string, repo: string): Promise<string | null>;
}

export interface AppTokenOptions {
  /** Narrows the token to these permissions (GitHub refuses with 422 when the installation lacks one: null). */
  permissions?: Record<string, AppPermission>;
  /** Permissions the token must carry, checked on GitHub's answer (null otherwise). */
  require?: Record<string, AppPermission>;
  userAgent?: string;
}

/** A GitHub App JWT (RS256), valid 9 minutes, backdated 60 s for clock drift. */
export function appJwt(appId: string, privateKey: string, nowMs: number): string {
  const now = Math.floor(nowMs / 1000);
  const head = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const body = b64url(JSON.stringify({ iat: now - 60, exp: now + 540, iss: appId }));
  const sig = createSign('RSA-SHA256').update(`${head}.${body}`).sign(privateKey.replace(/\\n/g, '\n'));
  return `${head}.${body}.${b64url(sig)}`;
}

async function call(f: FetchLike, jwt: string, method: string, path: string, ua: string, body?: unknown): Promise<{ status: number; data: any }> {
  let res: Response;
  try {
    res = await f(`https://api.github.com${path}`, {
      method,
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${jwt}`,
        'User-Agent': ua,
        'X-GitHub-Api-Version': '2022-11-28',
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  } catch {
    throw new HttpError(502, 'unreachable', GITHUB_DOWN);
  }
  if (res.status >= 500) throw new HttpError(502, 'unreachable', GITHUB_DOWN);
  let data: any = null;
  try {
    data = res.status === 204 ? null : await res.json();
  } catch {
    data = null;
  }
  return { status: res.status, data };
}

const grants = (have: unknown, want: AppPermission) => have === 'write' || (want === 'read' && have === 'read');

export function githubApp(appId: string, privateKey: string, f: FetchLike, now: () => number, opts: AppTokenOptions = {}): AppTokens {
  const ua = opts.userAgent ?? 'bridge-studio';
  return {
    async installationToken(owner, repo) {
      const jwt = appJwt(appId, privateKey, now());
      const inst = await call(f, jwt, 'GET', `/repos/${owner}/${repo}/installation`, ua);
      if (inst.status === 404) return null;
      if (inst.status !== 200 || typeof inst.data?.id !== 'number') throw new HttpError(502, 'unreachable', GITHUB_DOWN);
      const tok = await call(f, jwt, 'POST', `/app/installations/${inst.data.id}/access_tokens`, ua, { repositories: [repo], ...(opts.permissions ? { permissions: opts.permissions } : {}) });
      if (tok.status === 404 || tok.status === 422) return null;
      if (tok.status !== 201 || typeof tok.data?.token !== 'string') throw new HttpError(502, 'unreachable', GITHUB_DOWN);
      // Missing a permission the feature needs: say so instead of failing later.
      const perms = tok.data.permissions;
      if (opts.require && perms && Object.entries(opts.require).some(([k, v]) => !grants(perms[k], v))) return null;
      return tok.data.token as string;
    },
  };
}
