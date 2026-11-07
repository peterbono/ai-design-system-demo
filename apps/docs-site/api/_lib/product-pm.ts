// The product manager of each product of a team (board R2, Settings > Products), and what they say about an exploration
// of that product (board R3): Bridge keeps who it is, server side, and writes their words in the exploration's block for
// them (api/contribute, actions set-pm and pm-word). A PM may only view: they never write anything else.
//
// Key (Upstash Redis, no expiry: a PM stays until a lead or an admin changes it):
//   bridge:pm:<owner/repo>   JSON { <product key, lower case>: { email } (an email member) or { login } (a GitHub
//                            person), with their display name }
// The browser never sees a PM's email: it reads their member reference (exploration-member memberRef) or their login.
import { explorationBlockOf, memberRef } from './exploration-member.js';
import { canonicalEmail } from './canonical-email.js';
import type { Redis } from './redis.js';

export interface ProductPm {
  /** An email member of the team, canonical. */
  email?: string;
  /** A GitHub person of the team. */
  login?: string;
  name: string;
}

/** What Studio reads: never an email. */
export type PublicPm = { name: string; login: string } | { name: string; ref: string };

export const pmKey = (team: string) => `bridge:pm:${team.toLowerCase()}`;
export const PRODUCT_KEY = /^[a-z0-9][a-z0-9-]{0,59}$/;

const parse = (raw: unknown): ProductPm | null => {
  if (typeof raw !== 'string') return null;
  try {
    const v = JSON.parse(raw) as ProductPm;
    if (!v || typeof v.name !== 'string' || (typeof v.email !== 'string' && typeof v.login !== 'string')) return null;
    return v;
  } catch {
    return null;
  }
};

/** Every product's PM on the team. */
export async function pmsOf(redis: Redis, team: string): Promise<Record<string, ProductPm>> {
  const raw = await redis.cmd('GET', pmKey(team));
  let all: Record<string, unknown> = {};
  try {
    all = typeof raw === 'string' ? (JSON.parse(raw) as Record<string, unknown>) : {};
  } catch {
    all = {};
  }
  const out: Record<string, ProductPm> = {};
  for (const [k, v] of Object.entries(all && typeof all === 'object' ? all : {})) {
    const pm = parse(JSON.stringify(v));
    if (pm && PRODUCT_KEY.test(k)) out[k] = pm;
  }
  return out;
}

export async function pmOf(redis: Redis, team: string, product: string): Promise<ProductPm | null> {
  return (await pmsOf(redis, team))[product.toLowerCase()] ?? null;
}

export async function setPm(redis: Redis, team: string, product: string, pm: ProductPm | null): Promise<void> {
  const { [product.toLowerCase()]: _was, ...rest } = await pmsOf(redis, team);
  const next = pm ? { ...rest, [product.toLowerCase()]: pm.email ? { email: canonicalEmail(pm.email), name: pm.name } : { login: pm.login, name: pm.name } } : rest;
  await redis.cmd('SET', pmKey(team), JSON.stringify(next));
}

export const publicPm = (pm: ProductPm): PublicPm => (pm.login ? { name: pm.name, login: pm.login } : { name: pm.name, ref: memberRef(pm.email!) });

/** True when `who` (an email member or a GitHub login) is this PM. */
export function isPm(pm: ProductPm | null, who: { email?: string | null; login?: string | null }): boolean {
  if (!pm) return false;
  if (pm.email && who.email) return canonicalEmail(pm.email) === canonicalEmail(who.email);
  return Boolean(pm.login && who.login && pm.login.toLowerCase() === who.login.toLowerCase());
}

/** The PM's words: only Bridge's server writes them (the server copy of core explorations.ts PM_KINDS). */
export const PM_KINDS: ReadonlySet<string> = new Set(['pm-ok', 'pm-changes', 'pm-call']);
export const PM_ONLY = 'Only the product manager can say this.';

const pmWords = (block: Record<string, unknown> | null): string[] => {
  const all = block?.decisions;
  return Array.isArray(all) ? all.filter((d) => PM_KINDS.has(String(d?.kind))).map((d) => JSON.stringify([d.kind, d.at, d.by, d.byName])) : [];
};

/** True when `after` adds a PM word `before` did not have: through the proxy, nobody writes those. */
export function addsPmWords(before: unknown, after: unknown): boolean {
  const known = new Set(pmWords(explorationBlockOf(before)));
  return pmWords(explorationBlockOf(after)).some((w) => !known.has(w));
}

const MARK = 'bridge-exploration';
const BLOCK = new RegExp(`<!-- ${MARK} (\\{[\\s\\S]*?\\}) -->`);
const ENDS_ROUND = new Set(['changes', 'take-back']);

export interface PmWord {
  kind: 'pm-ok' | 'pm-changes' | 'pm-call';
  at: string;
  by?: string;
  byName?: string;
  text?: string;
  /** pm-call: the PM's name. */
  to?: string[];
}

/** The body with one more PM word, in the round it belongs to (core withDecision); null without a block. */
export function withPmWord(body: string, d: PmWord): string | null {
  const m = BLOCK.exec(body);
  const e = explorationBlockOf(body);
  if (!m || !e) return null;
  const before = Array.isArray(e.decisions) ? (e.decisions as { kind?: unknown }[]).filter((x) => x && typeof x === 'object') : [];
  const round = 1 + before.filter((x) => ENDS_ROUND.has(String(x.kind))).length;
  const next = { ...e, decisions: [...before, { ...d, round }] };
  const block = `<!-- ${MARK} ${JSON.stringify(next).replace(/-->/g, '--\\u003e')} -->`;
  return body.slice(0, m.index) + block + body.slice(m.index + m[0].length);
}
