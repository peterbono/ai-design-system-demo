// Who sent which change through Bridge (api/contribute), and what happens to it when that person deletes their
// account (api/account). The keys live here so both functions share one definition.
//
// Keys (Upstash Redis, emails lower case, a year from the last write):
//   bridge:contrib:branch:<repo>:<branch>     the email of who created a branch through Bridge
//   bridge:contrib:issue:<repo>:<number>      the email of who opened an issue or pull request through Bridge
//   bridge:contrib:mine:<repo>:<email>        set of "b:<branch>" and "i:<number>" they made
//   bridge:contrib:count:<repo>:<email>:<day> their writes that day (two days)
//
// On account deletion (forgetChanges) the change stays in the team's history, with a neutral author: every key above
// that holds the email goes, and the "Requested by <name> (<email>) through Bridge." line Bridge wrote in each of their
// issues and pull requests on GitHub becomes "Requested by A former member through Bridge." (the Bridge app's token,
// best effort: the account is deleted even when GitHub cannot be reached). Git commits stay as git recorded them.

import type { AppTokens } from './github-app.js';
import type { FetchLike } from './http.js';
import { globEscape, type Redis } from './redis.js';

/** The neutral author a deleted account's changes keep in the team's history. */
export const FORMER_MEMBER = 'A former member';
/** The line that replaces a deleted member's "Requested by" line (core requesterOf reads it as the name above). */
export const FORMER_MEMBER_LINE = `Requested by ${FORMER_MEMBER} through Bridge.`;

export const branchKey = (repo: string, b: string) => `bridge:contrib:branch:${repo.toLowerCase()}:${b}`;
export const issueKey = (repo: string, n: string | number) => `bridge:contrib:issue:${repo.toLowerCase()}:${n}`;
export const mineKey = (repo: string, email: string) => `bridge:contrib:mine:${repo.toLowerCase()}:${email.toLowerCase()}`;
const MINE_PREFIX = 'bridge:contrib:mine:';

/** The "Requested by ... through Bridge." line api/contribute writes for an email member, wherever it sits. */
const REQUESTED_LINE = /^([ \t]*)Requested by [^\n]{1,300}? through Bridge\.[ \t]*$/gm;

/** `body` with every "Requested by ... through Bridge." line naming the former member instead. */
export function anonymiseRequestedBy(body: string): string {
  return body.replace(REQUESTED_LINE, (_m, indent: string) => `${indent}${FORMER_MEMBER_LINE}`);
}

async function scan(redis: Redis, pattern: string): Promise<string[]> {
  const out = new Set<string>();
  let cursor = '0';
  for (let i = 0; i < 1000; i++) {
    const r = (await redis.cmd('SCAN', cursor, 'MATCH', pattern, 'COUNT', 500)) as [string | number, string[]] | null;
    if (!Array.isArray(r)) break;
    for (const k of r[1] ?? []) out.add(k);
    cursor = String(r[0]);
    if (cursor === '0') break;
  }
  return [...out];
}

export interface ForgetDeps {
  /** The Bridge app with issues and pull requests write, or null when it is not set up on this site. */
  app: AppTokens | null;
  fetch: FetchLike;
}

/** What forgetChanges did: the changes it found, and how many GitHub bodies it rewrote. */
export interface Forgotten {
  changes: number;
  rewritten: number;
}

async function rewriteOnGitHub(deps: ForgetDeps, repo: string, numbers: string[]): Promise<number> {
  const [owner, name] = repo.split('/');
  if (!deps.app || !owner || !name || !numbers.length) return 0;
  const token = await deps.app.installationToken(owner, name).catch(() => null);
  if (!token) return 0;
  const headers = { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`, 'User-Agent': 'bridge-account', 'X-GitHub-Api-Version': '2022-11-28' };
  let n = 0;
  for (const num of numbers) {
    try {
      // The issues endpoint edits a pull request's body too.
      const path = `https://api.github.com/repos/${owner}/${name}/issues/${num}`;
      const got = await deps.fetch(path, { method: 'GET', headers });
      if (got.status !== 200) continue;
      const body = ((await got.json()) as { body?: unknown })?.body;
      if (typeof body !== 'string') continue;
      const next = anonymiseRequestedBy(body);
      if (next === body) continue;
      const put = await deps.fetch(path, { method: 'PATCH', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ body: next }) });
      if (put.status === 200) n++;
    } catch {
      // Best effort: the account goes anyway.
    }
  }
  return n;
}

/**
 * Forgets who sent which change: for every team (also the ones the person left), the changes they sent through Bridge
 * keep their place in the team's history with "A former member" as the author, and no key keeps the email.
 */
export async function forgetChanges(redis: Redis, email: string, deps: ForgetDeps): Promise<Forgotten> {
  const e = email.trim().toLowerCase();
  const out: Forgotten = { changes: 0, rewritten: 0 };
  const sets = await scan(redis, `${MINE_PREFIX}*:${globEscape(e)}`);
  for (const key of sets) {
    const repo = key.slice(MINE_PREFIX.length, key.length - e.length - 1);
    const raw = await redis.cmd('SMEMBERS', key);
    const items = Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : [];
    const owned = items.map((it) => (it.startsWith('b:') ? branchKey(repo, it.slice(2)) : it.startsWith('i:') ? issueKey(repo, it.slice(2)) : null));
    const holders = owned.length ? await redis.pipe(owned.map((k) => ['GET', k ?? 'bridge:contrib:none'])) : [];
    const mine = owned.filter((k, i): k is string => k !== null && String(holders[i] ?? '').toLowerCase() === e);
    out.changes += items.length;
    const numbers = items.filter((it, i) => it.startsWith('i:') && /^\d+$/.test(it.slice(2)) && owned[i] && mine.includes(owned[i]!)).map((it) => it.slice(2));
    out.rewritten += await rewriteOnGitHub(deps, repo, numbers);
    await redis.pipe([...mine.map((k) => ['DEL', k]), ['DEL', key]]);
  }
  const counters = await scan(redis, `bridge:contrib:count:*:${globEscape(e)}:*`);
  if (counters.length) await redis.pipe(counters.map((k) => ['DEL', k]));
  return out;
}
