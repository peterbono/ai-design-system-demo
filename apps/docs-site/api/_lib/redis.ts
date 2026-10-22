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

/**
 * In-memory Redis for tests: strings, sets and sorted sets, EX and NX, GET, SET, GETDEL, DEL, MGET, INCRBY, EXPIRE,
 * SADD, SREM, SMEMBERS, SISMEMBER, ZADD, ZREM, ZRANGE (all), ZREMRANGEBYSCORE, TYPE and SCAN (one page, MATCH glob
 * with `*`, `?` and backslash escapes). TTLs follow `now`.
 */
export function memoryRedis(now: () => number = Date.now): Redis & { keys(): string[]; dump(): Map<string, string | string[]> } {
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
        items.set(k, { value: rest[1]!, until: ex >= 0 ? now() + Number(rest[2 + ex + 1]) * 1000 : Infinity });
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
        z.set(rest[2]!, Number(rest[1]));
        items.set(k, { value: z, until: items.get(k)?.until ?? Infinity });
        return 1;
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
    async cmd(...args) {
      return run(args);
    },
    async pipe(cmds) {
      return cmds.map(run);
    },
  };
}
