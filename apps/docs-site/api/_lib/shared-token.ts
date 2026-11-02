// One installation token per repository and permission set, shared by every warm function while it is valid. A token
// minted per function gave each function its own token, and GitHub may tie an ETag to the token that read it: a
// conditional read with another function's token could then be a counted 200 instead of a free 304
// (docs/QUOTA-LOADTEST.md, scenario C3). Sharing the token makes that impossible, whatever GitHub does.
//
// Redis (server only), the token sealed (api/_lib/sealed.ts, AES-256-GCM under a key derived from
// LIBRARY_SESSION_SECRET for this purpose only, bound to its key):
//   bridge:app:token:<sha256(scope:owner/repo)>       { token, until, installation? } sealed, until `until`
//   bridge:app:token:lock:<sha256(scope:owner/repo)>  "1" for LOCK_S while one function mints (no stampede)
// A function keeps what it read in memory for MEMORY_MS at most, so every function moves to a renewed token within a
// minute. The token never leaves the server and is never logged; the key names neither the token nor the repository.

import { installationOfToken, noteInstallationToken } from './github-quota.js';
import type { AppTokens } from './github-app.js';
import { sha256 } from './http.js';
import type { Redis } from './redis.js';
import { seal, sealingKey, unseal, type Sealed } from './sealed.js';

/** GitHub's installation tokens live an hour: Bridge shares one for 50 minutes after it was minted. */
export const TOKEN_SHARE_MS = 50 * 60 * 1000;
/** Less than this left of the 50 minutes: the next function that asks mints the next token. */
export const TOKEN_RENEW_MS = 5 * 60 * 1000;
/** How long a function answers from its memory before it looks at the shared token again. */
export const TOKEN_MEMORY_MS = 60 * 1000;
const LOCK_S = 10;
/** A function that finds another minting waits for its token this many times before minting its own. */
const WAITS = 10;
const PURPOSE = 'app-token-share';

export const sharedTokenKey = (scope: string, owner: string, repo: string) => `bridge:app:token:${sha256(`${scope}:${owner}/${repo}`.toLowerCase()).slice(0, 40)}`;

interface Shared {
  token: string;
  until: number;
  installation?: number;
  repo?: string;
}

export interface SharedTokenOptions {
  redis: Redis;
  /** LIBRARY_SESSION_SECRET: without it (32 characters at least), nothing is shared and each function mints its own. */
  secret: string;
  now: () => number;
  /** What the tokens are for (the app and its permission set): tokens of two scopes are never mixed. */
  scope: string;
  /** This function's memory (a module-level map in production, one per simulated function in the load test). */
  memory: Map<string, { token: string; until: number; check: number }>;
  /** How a function waits for another's token (tests pass a turn of the event loop). */
  wait?: () => Promise<void>;
}

/**
 * `app`'s tokens, shared through Redis: one per repository while it is valid, minted by one function when absent or
 * near its end. Redis unreachable: this function mints and keeps its own, as before.
 */
export function sharedAppTokens(app: AppTokens, o: SharedTokenOptions): AppTokens {
  const key = sealingKey(o.secret, PURPOSE);
  const wait = o.wait ?? (() => new Promise<void>((r) => setTimeout(r, 100)));
  const remember = (k: string, s: Shared) => {
    o.memory.set(k, { token: s.token, until: s.until, check: Math.min(s.until, o.now() + TOKEN_MEMORY_MS) });
    if (o.memory.size > 500) for (const [x, v] of o.memory) if (v.until <= o.now()) o.memory.delete(x);
  };
  const read = async (k: string): Promise<Shared | null> => {
    if (!key) return null;
    const raw = await o.redis.cmd('GET', k).catch(() => null);
    if (typeof raw !== 'string') return null;
    try {
      const text = unseal(JSON.parse(raw) as Sealed, key, k);
      const s = text ? (JSON.parse(text) as Shared) : null;
      return s && typeof s.token === 'string' && typeof s.until === 'number' ? s : null;
    } catch {
      return null;
    }
  };
  const mint = async (owner: string, repo: string): Promise<Shared | null> => {
    const token = await app.installationToken(owner, repo);
    if (!token) return null;
    // Which installation its calls spend (api/_lib/github-quota.ts), so a function that reads it from Redis meters it too.
    const inst = installationOfToken(token, o.now());
    return { token, until: o.now() + TOKEN_SHARE_MS, ...(inst ? { installation: inst.installation, repo: inst.repo } : {}) };
  };
  const use = (k: string, s: Shared) => {
    if (s.installation && s.repo) noteInstallationToken(s.token, s.installation, s.repo, o.now());
    remember(k, s);
    return s.token;
  };
  return {
    async installationToken(owner, repo) {
      const k = sharedTokenKey(o.scope, owner, repo);
      const mem = o.memory.get(k);
      if (mem && mem.check > o.now() && mem.until > o.now()) return mem.token;
      let s = await read(k);
      if (s && s.until - o.now() > TOKEN_RENEW_MS) return use(k, s);
      if (!key) {
        const own = await mint(owner, repo);
        return own ? use(k, own) : null;
      }
      // Absent or near its end: one function mints (a short lock), the others keep the one still valid or wait for it.
      const lock = `bridge:app:token:lock:${k.slice('bridge:app:token:'.length)}`;
      const got = await o.redis.cmd('SET', lock, '1', 'NX', 'EX', LOCK_S).catch(() => 'OK');
      if (got !== 'OK') {
        if (s && s.until > o.now()) return use(k, s);
        for (let i = 0; i < WAITS; i++) {
          await wait();
          s = await read(k);
          if (s && s.until > o.now()) return use(k, s);
        }
      }
      try {
        const own = await mint(owner, repo);
        if (!own) return null;
        const ttl = Math.ceil((own.until - o.now()) / 1000);
        await o.redis.cmd('SET', k, JSON.stringify(seal(JSON.stringify(own), key, k)), 'EX', ttl).catch(() => undefined);
        return use(k, own);
      } finally {
        if (got === 'OK') await o.redis.cmd('DEL', lock).catch(() => undefined);
      }
    },
  };
}
