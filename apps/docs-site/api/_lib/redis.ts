// Upstash Redis over REST (Vercel Marketplace), shared by the /api functions, and a small in-memory stand-in for
// tests that speaks the same commands. Node built-ins only.

import { HttpError, type FetchLike } from './http.js';

export type RedisArg = string | number;

export interface Redis {
  cmd(...args: RedisArg[]): Promise<unknown>;
  pipe(cmds: RedisArg[][]): Promise<unknown[]>;
}

/** Every failure answers 503 with `message`, in the words of the feature that called. */
export function redisRest(url: string, token: string, f: FetchLike, message: string): Redis {
  const base = url.replace(/\/+$/, '');
  const down = () => new HttpError(503, 'storage', message);
  const call = async (path: string, body: unknown): Promise<any> => {
    let res: Response;
    try {
      res = await f(`${base}${path}`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    } catch {
      throw down();
    }
    if (!res.ok) throw down();
    return res.json();
  };
  return {
    async cmd(...args) {
      const r = (await call('', args)) as { result?: unknown; error?: string };
      if (r.error) throw down();
      return r.result;
    },
    async pipe(cmds) {
      const r = (await call('/pipeline', cmds)) as { result?: unknown; error?: string }[];
      if (!Array.isArray(r) || r.some((x) => x?.error)) throw down();
      return r.map((x) => x.result);
    },
  };
}

/** A Redis MATCH glob as a regular expression: `*`, `?`, and `\\x` for a literal x. */
function globRegExp(glob: string): RegExp {
  let out = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]!;
    if (c === '\\' && i + 1 < glob.length) out += glob[++i]!.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    else if (c === '*') out += '.*';
    else if (c === '?') out += '.';
    else out += c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${out}$`, 's');
}

/** `s` with the characters a Redis MATCH glob treats specially escaped. */
export const globEscape = (s: string) => s.replace(/[*?[\]\\]/g, '\\$&');

/** Every live key of a memoryRedis, as JSON: a TTL is an absolute time in ms (null: no expiry). */
export type RedisSnapshot = (
  | { key: string; type: 'string'; value: string; until: number | null }
  | { key: string; type: 'set'; value: string[]; until: number | null }
  | { key: string; type: 'zset'; value: [string, number][]; until: number | null }
)[];

/**
 * In-memory Redis for tests (and the local server, `npm run dev:full`): strings, sets and sorted sets, EX, NX and KEEPTTL,
 * GET, SET, GETDEL, DEL, MGET, INCRBY, EXPIRE, SADD, SREM, SMEMBERS, SISMEMBER, ZADD (NX), ZREM, ZRANGE (all), ZCARD,
 * ZSCORE, ZRANGEBYSCORE (LIMIT), ZREMRANGEBYSCORE, TYPE and SCAN (one page, MATCH glob with `*`, `?` and backslash escapes). TTLs follow `now`.
 * `snapshot()` and `restore()` carry every live key across restarts.
 */
export function memoryRedis(now: () => number = Date.now): Redis & {
  keys(): string[];
  dump(): Map<string, string | string[]>;
  snapshot(): RedisSnapshot;
  restore(s: RedisSnapshot): void;
} {
  const items = new Map<string, { value: string | Set<string> | Map<string, number>; until: number }>();
  const live = (k: string) => {
    const v = items.get(k);
    if (v && v.until <= now()) items.delete(k);
    return items.get(k)?.value ?? null;
  };
  const str = (k: string) => {
    const v = live(k);
    return typeof v === 'string' ? v : null;
  };
  const set = (k: string) => {
    const v = live(k);
    return v instanceof Set ? v : null;
  };
  const zset = (k: string) => {
    const v = live(k);
    return v instanceof Map ? v : null;
  };
  const run = (args: RedisArg[]): unknown => {
    const [op, ...rest] = args.map(String);
    const k = rest[0]!;
    switch (op!.toUpperCase()) {
      case 'GET':
        return str(k);
      case 'SET': {
        const opts = rest.slice(2).map((x) => x.toUpperCase());
        if (opts.includes('NX') && live(k) !== null) return null;
        const ex = opts.indexOf('EX');
        // KEEPTTL: the key keeps the expiry it had (none when it had none).
        const kept = opts.includes('KEEPTTL') && live(k) !== null ? items.get(k)!.until : Infinity;
        items.set(k, { value: rest[1]!, until: ex >= 0 ? now() + Number(rest[2 + ex + 1]) * 1000 : kept });
        return 'OK';
      }
      case 'GETDEL': {
        const v = str(k);
        items.delete(k);
        return v;
      }
      case 'DEL':
        return rest.filter((x) => items.delete(x)).length;
      case 'MGET':
        return rest.map((x) => str(x));
      case 'INCRBY': {
        const next = Number(str(k) ?? 0) + Number(rest[1]);
        const until = items.get(k)?.until ?? Infinity;
        items.set(k, { value: String(next), until });
        return next;
      }
      case 'EXPIRE': {
        const v = items.get(k);
        if (!v || live(k) === null) return 0;
        v.until = now() + Number(rest[1]) * 1000;
        return 1;
      }
      case 'SADD': {
        const s = set(k) ?? new Set<string>();
        const before = s.size;
        for (const m of rest.slice(1)) s.add(m);
        items.set(k, { value: s, until: items.get(k)?.until ?? Infinity });
        return s.size - before;
      }
      case 'SREM': {
        const s = set(k);
        if (!s) return 0;
        let n = 0;
        for (const m of rest.slice(1)) if (s.delete(m)) n++;
        if (!s.size) items.delete(k);
        return n;
      }
      case 'SMEMBERS':
        return [...(set(k) ?? [])];
      case 'SISMEMBER':
        return set(k)?.has(rest[1]!) ? 1 : 0;
      case 'ZADD': {
        const z = zset(k) ?? new Map<string, number>();
        // ZADD key [NX] score member [score member ...]
        const nx = rest[1]!.toUpperCase() === 'NX';
        const pairs = rest.slice(nx ? 2 : 1);
        let added = 0;
        for (let i = 0; i + 1 < pairs.length; i += 2) {
          const m = pairs[i + 1]!;
          if (nx && z.has(m)) continue;
          if (!z.has(m)) added++;
          z.set(m, Number(pairs[i]));
        }
        if (z.size) items.set(k, { value: z, until: items.get(k)?.until ?? Infinity });
        return added;
      }
      case 'ZCARD':
        return zset(k)?.size ?? 0;
      case 'ZSCORE': {
        const sc = zset(k)?.get(rest[1]!);
        return sc === undefined ? null : String(sc);
      }
      case 'ZRANGEBYSCORE': {
        // ZRANGEBYSCORE key min max [LIMIT offset count]; min and max numbers or -inf / +inf.
        const bound = (v: string) => (v === '-inf' ? -Infinity : v === '+inf' ? Infinity : Number(v));
        const [min, max] = [bound(rest[1]!), bound(rest[2]!)];
        const li = rest.findIndex((x) => x.toUpperCase() === 'LIMIT');
        const all = [...(zset(k) ?? new Map<string, number>()).entries()].filter(([, sc]) => sc >= min && sc <= max).sort((a, b) => a[1] - b[1]).map(([m]) => m);
        return li >= 0 ? all.slice(Number(rest[li + 1]), Number(rest[li + 1]) + Number(rest[li + 2])) : all;
      }
      case 'ZREM': {
        const z = zset(k);
        return z ? rest.slice(1).filter((m) => z.delete(m)).length : 0;
      }
      case 'ZRANGE':
        return [...(zset(k) ?? new Map<string, number>()).entries()].sort((a, b) => a[1] - b[1]).map(([m]) => m);
      case 'ZREMRANGEBYSCORE': {
        const z = zset(k);
        if (!z) return 0;
        const max = Number(rest[2]);
        const gone = [...z.entries()].filter(([, sc]) => sc <= max).map(([m]) => m);
        for (const m of gone) z.delete(m);
        return gone.length;
      }
      case 'TYPE': {
        const v = live(k);
        return v === null ? 'none' : typeof v === 'string' ? 'string' : v instanceof Set ? 'set' : 'zset';
      }
      case 'SCAN': {
        const i = rest.findIndex((x) => x.toUpperCase() === 'MATCH');
        const re = i >= 0 ? globRegExp(rest[i + 1]!) : /^/;
        return ['0', [...items.keys()].filter((key) => live(key) !== null && re.test(key))];
      }
      default:
        throw new Error(`memoryRedis: ${op} is not supported`);
    }
  };
  return {
    keys: () => [...items.keys()].filter((k) => live(k) !== null),
    dump: () => new Map([...items.keys()].filter((k) => live(k) !== null).map((k) => {
      const v = live(k)!;
      return [k, typeof v === 'string' ? v : [...v.keys()]];
    })),
    snapshot: () =>
      [...items.keys()].filter((k) => live(k) !== null).map((key) => {
        const { value: v, until: u } = items.get(key)!;
        const until = Number.isFinite(u) ? u : null;
        if (typeof v === 'string') return { key, type: 'string' as const, value: v, until };
        if (v instanceof Set) return { key, type: 'set' as const, value: [...v], until };
        return { key, type: 'zset' as const, value: [...v.entries()], until };
      }),
    restore(s) {
      items.clear();
      for (const e of s) {
        const until = e.until ?? Infinity;
        if (until <= now()) continue;
        const value = e.type === 'string' ? e.value : e.type === 'set' ? new Set(e.value) : new Map(e.value);
        items.set(e.key, { value, until });
      }
    },
    async cmd(...args) {
      return run(args);
    },
    async pipe(cmds) {
      return cmds.map(run);
    },
  };
}
