import { describe, expect, it } from 'vitest';
import { applyPlan, familyOf, isSkipped, makeRewriter, maskEmails, migrate, parseArgs, parseOwnerMap, parseRepoKey, planEntry, restore, verified } from './migrate-team-key.mjs';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const STEP2 = { from: 'peterbono/ai-design-system-demo', to: 'the-bridge-company/ai-design-system-demo', owners: parseOwnerMap(['art-print-shop-co=the-bridge-company']) };
const rw = makeRewriter(STEP2);

describe('makeRewriter', () => {
  it('rewrites the team repository in keys, set members, invite tokens and JSON', () => {
    expect(rw.rewrite('bridge:member:peterbono/ai-design-system-demo:a@b.co')).toBe('bridge:member:the-bridge-company/ai-design-system-demo:a@b.co');
    expect(rw.rewrite('peterbono/ai-design-system-demo|inv1')).toBe('the-bridge-company/ai-design-system-demo|inv1');
    expect(rw.rewrite('bridge:notify:soon:a@b.co:peterbono/ai-design-system-demo#12')).toBe('bridge:notify:soon:a@b.co:the-bridge-company/ai-design-system-demo#12');
    expect(rw.rewrite('{"repo":"Peterbono/AI-Design-System-Demo","x":1}')).toBe('{"repo":"the-bridge-company/ai-design-system-demo","x":1}');
    expect(rw.rewrite('https://github.com/peterbono/ai-design-system-demo/pull/3')).toBe('https://github.com/the-bridge-company/ai-design-system-demo/pull/3');
  });

  it('renames the owner of every repository of a renamed organization, keeping the name', () => {
    expect(rw.rewrite('art-print-shop-co/art-print-shop')).toBe('the-bridge-company/art-print-shop');
    expect(rw.rewrite('{"repo":"Art-Print-Shop-Co/art-print-shop-design"}')).toBe('{"repo":"the-bridge-company/art-print-shop-design"}');
    expect(rw.rewrite('bridge:notify:repo:art-print-shop-co/art-print-shop')).toBe('bridge:notify:repo:the-bridge-company/art-print-shop');
  });

  it('leaves look-alikes and other repositories alone', () => {
    for (const s of [
      'peterbono/ai-design-system-demo-old',
      'xpeterbono/ai-design-system-demo',
      'peterbono/bridge-demo-ds',
      'my-art-print-shop-co/art-print-shop',
      'https://{branch}.art-print-shop-design.vercel.app',
      '_team/0123456789abcdef',
      'a@peterbono.com',
    ]) expect(rw.rewrite(s)).toBe(s);
  });

  it('is idempotent and refuses a migration that is not', () => {
    const once = rw.rewrite('peterbono/ai-design-system-demo art-print-shop-co/x');
    expect(rw.rewrite(once)).toBe(once);
    expect(() => makeRewriter({ from: 'a/b', to: 'c/d', owners: [['c', 'e']] })).toThrow(/idempotent/);
    expect(() => makeRewriter({ from: 'a/b', to: 'a/b' })).toThrow(/same/);
    expect(() => makeRewriter({ from: 'a/b', to: 'c/d', owners: [['x', 'y'], ['y', 'z']] })).toThrow(/both/);
  });

  it('answers the repository a single key becomes', () => {
    expect(rw.repo('PeterBono/ai-design-system-demo')).toBe('the-bridge-company/ai-design-system-demo');
    expect(rw.repo('art-print-shop-co/shop')).toBe('the-bridge-company/shop');
    expect(rw.repo('peterbono/bridge-demo-ds')).toBeNull();
  });
});

describe('parsing', () => {
  it('reads repositories, owner pairs and arguments', () => {
    expect(parseRepoKey(' Peterbono/AI-Design-System-Demo ')).toBe('peterbono/ai-design-system-demo');
    expect(() => parseRepoKey('nope')).toThrow();
    expect(() => parseOwnerMap(['a'])).toThrow();
    expect(parseArgs(['--from', 'a/b', '--to', 'c/d', '--owner', 'x=y', '--apply', '--keep-old'])).toMatchObject({ from: 'a/b', to: 'c/d', owners: ['x=y'], apply: true, keepOld: true });
    expect(() => parseArgs(['--from'])).toThrow();
    expect(() => parseArgs(['--force'])).toThrow();
  });
});

describe('planEntry', () => {
  it('moves a key that names the repository, rewriting its value too', () => {
    const p = planEntry({ key: 'bridge:invite:peterbono/ai-design-system-demo:i1', type: 'string', value: '{"repo":"peterbono/ai-design-system-demo"}', pttl: 5000 }, rw);
    expect(p).toMatchObject({ action: 'move', newKey: 'bridge:invite:the-bridge-company/ai-design-system-demo:i1', newValue: '{"repo":"the-bridge-company/ai-design-system-demo"}', pttl: 5000 });
  });

  it('rewrites set and sorted set members in place, merging duplicates', () => {
    const s = planEntry({ key: 'bridge:account:teams:a@b.co', type: 'set', value: ['peterbono/ai-design-system-demo', 'the-bridge-company/ai-design-system-demo', 'x/y'], pttl: -1 }, rw);
    expect(s.action).toBe('rewrite');
    expect(s.newValue.sort()).toEqual(['the-bridge-company/ai-design-system-demo', 'x/y']);
    const z = planEntry({ key: 'bridge:notify:digest:a@b.co', type: 'zset', value: [['{"repo":"peterbono/ai-design-system-demo"}', 3]], pttl: -1 }, rw);
    expect(z).toMatchObject({ action: 'rewrite', newValue: [['{"repo":"the-bridge-company/ai-design-system-demo"}', 3]] });
  });

  it('skips caches and counters, ignores what does not name the repository', () => {
    expect(planEntry({ key: 'bridge:read:blob:peterbono/ai-design-system-demo:abc', type: 'string', value: 'x' }, rw).action).toBe('skip');
    expect(planEntry({ key: 'bridge:contrib:count:peterbono/ai-design-system-demo:a@b.co:2026-11-04', type: 'string', value: '1' }, rw).action).toBe('skip');
    expect(planEntry({ key: 'bridge:account:a@b.co', type: 'string', value: '{"name":"A"}' }, rw).action).toBe('none');
    expect(planEntry({ key: 'bridge:x:peterbono/ai-design-system-demo', type: 'hash', value: null }, rw).action).toBe('unsupported');
    expect(isSkipped('bridge:app:token:abc')).toBe(true);
    expect(isSkipped('bridge:members:peterbono/ai-design-system-demo')).toBe(false);
  });

  it('checks a read back copy', () => {
    expect(verified({ type: 'string', newValue: 'a' }, 'a')).toBe(true);
    expect(verified({ type: 'set', newValue: ['a', 'b'] }, ['b'])).toBe(false);
    expect(verified({ type: 'zset', newValue: [['a', 2]] }, [['a', 2], ['b', 1]])).toBe(true);
  });
});

describe('printing', () => {
  it('masks emails and groups keys by family', () => {
    expect(maskEmails('bridge:member:o/r:florian@gmail.com')).toBe('bridge:member:o/r:fl***@gmail.com');
    expect(familyOf('bridge:member:peterbono/ai-design-system-demo:a@b.co', rw)).toBe('bridge:member:<repo>:…');
    expect(familyOf('bridge:members:peterbono/ai-design-system-demo', rw)).toBe('bridge:members:<repo>');
  });
});

/** A Redis with just the commands the script sends. */
function fakeRedis(init = {}) {
  const db = new Map(Object.entries(init).map(([k, v]) => [k, { ...v }]));
  const ops = [];
  const run = (args) => {
    const [op, k, ...rest] = args.map(String);
    ops.push(op);
    const e = db.get(k);
    switch (op) {
      case 'SCAN': {
        const glob = new RegExp(`^${rest[1].replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`);
        return ['0', [...db.keys()].filter((x) => glob.test(x))];
      }
      case 'TYPE': return e ? e.type : 'none';
      case 'PTTL': return e ? e.pttl ?? -1 : -2;
      case 'GET': return e?.type === 'string' ? e.value : null;
      case 'SMEMBERS': return e ? [...e.value] : [];
      case 'ZRANGE': return e ? e.value.flatMap(([m, s]) => [m, String(s)]) : [];
      case 'SET': {
        if (rest.includes('NX') && e) return null;
        const px = rest.indexOf('PX');
        db.set(k, { type: 'string', value: rest[0], pttl: px >= 0 ? Number(rest[px + 1]) : rest.includes('KEEPTTL') ? e?.pttl ?? -1 : -1 });
        return 'OK';
      }
      case 'SADD': {
        const s = new Set(e?.value ?? []);
        rest.forEach((m) => s.add(m));
        db.set(k, { type: 'set', value: [...s], pttl: e?.pttl ?? -1 });
        return 1;
      }
      case 'SREM': {
        e.value = e.value.filter((m) => !rest.includes(m));
        return 1;
      }
      case 'ZADD': {
        const z = new Map(e?.value ?? []);
        for (let i = 0; i < rest.length; i += 2) z.set(rest[i + 1], Number(rest[i]));
        db.set(k, { type: 'zset', value: [...z], pttl: e?.pttl ?? -1 });
        return 1;
      }
      case 'ZREM': {
        e.value = e.value.filter(([m]) => !rest.includes(m));
        return 1;
      }
      case 'PEXPIRE': {
        if (e) e.pttl = Number(rest[0]);
        return 1;
      }
      case 'DEL': return db.delete(k) ? 1 : 0;
      default: throw new Error(`fake: ${op}`);
    }
  };
  return { db, ops, cmd: async (...a) => run(a), pipe: async (cmds) => cmds.map(run) };
}

const R = 'peterbono/ai-design-system-demo';
const N = 'the-bridge-company/ai-design-system-demo';
const seed = () => ({
  [`bridge:members:${R}`]: { type: 'set', value: ['a@b.co'] },
  [`bridge:member:${R}:a@b.co`]: { type: 'string', value: '{"email":"a@b.co","role":"admin"}' },
  [`bridge:invite:${R}:i1`]: { type: 'string', value: `{"repo":"${R}","id":"i1"}`, pttl: 60_000 },
  'bridge:invite-token:h1': { type: 'string', value: `${R}|i1`, pttl: 60_000 },
  'bridge:account:teams:a@b.co': { type: 'set', value: [R, 'art-print-shop-co/art-print-shop'] },
  [`bridge:joinreqs:${R}`]: { type: 'zset', value: [['c@d.co', 99]] },
  'bridge:notify:teams': { type: 'set', value: [R, 'art-print-shop-co/art-print-shop-design', 'peterbono/bridge-demo-ds'] },
  [`bridge:read:blob:${R}:abc`]: { type: 'string', value: 'cached' },
  'bridge:account:a@b.co': { type: 'string', value: '{"name":"A"}' },
});

describe('migrate', () => {
  it('dry run writes nothing', async () => {
    const redis = fakeRedis(seed());
    const lines = [];
    const r = await migrate(redis, rw, { log: (l) => lines.push(l) });
    expect(r).toMatchObject({ todo: 7, done: 0, skipped: 1 });
    expect(redis.ops.filter((o) => ['SET', 'SADD', 'SREM', 'ZADD', 'ZREM', 'DEL', 'PEXPIRE'].includes(o))).toEqual([]);
    expect(lines.join('\n')).not.toContain('admin'); // no value is printed
    expect(lines.join('\n')).not.toContain('a@b.co');
  });

  it('applies, keeps lives, leaves caches, and a second run finds nothing', async () => {
    const redis = fakeRedis(seed());
    const backup = join(mkdtempSync(join(tmpdir(), 'mtk-')), 'b.json');
    const r = await migrate(redis, rw, { apply: true, backup, log: () => {} });
    expect(r).toMatchObject({ todo: 7, done: 7, failed: 0 });
    const db = redis.db;
    expect(db.has(`bridge:members:${R}`)).toBe(false);
    expect(db.get(`bridge:members:${N}`).value).toEqual(['a@b.co']);
    expect(db.get(`bridge:invite:${N}:i1`)).toMatchObject({ value: `{"repo":"${N}","id":"i1"}`, pttl: 60_000 });
    expect(db.get('bridge:invite-token:h1')).toMatchObject({ value: `${N}|i1`, pttl: 60_000 });
    expect(db.get('bridge:account:teams:a@b.co').value.sort()).toEqual(['the-bridge-company/art-print-shop', N].sort());
    expect(db.get(`bridge:joinreqs:${N}`).value).toEqual([['c@d.co', 99]]);
    expect(db.get('bridge:notify:teams').value.sort()).toEqual(['peterbono/bridge-demo-ds', 'the-bridge-company/art-print-shop-design', N].sort());
    expect(db.has(`bridge:read:blob:${R}:abc`)).toBe(true);
    expect(JSON.parse(readFileSync(backup, 'utf8')).entries).toHaveLength(7);
    expect(await migrate(redis, rw, { apply: true, log: () => {} })).toMatchObject({ todo: 0 });
  });

  it('never deletes the old key when the new one holds something else', async () => {
    const redis = fakeRedis({ [`bridge:member:${R}:a@b.co`]: { type: 'string', value: '{"role":"admin"}' }, [`bridge:member:${N}:a@b.co`]: { type: 'string', value: '{"role":"viewer"}' } });
    const r = await migrate(redis, rw, { apply: true, log: () => {} });
    expect(r).toMatchObject({ done: 0, failed: 1 });
    expect(redis.db.get(`bridge:member:${R}:a@b.co`).value).toBe('{"role":"admin"}');
    expect(redis.db.get(`bridge:member:${N}:a@b.co`).value).toBe('{"role":"viewer"}');
  });

  it('--keep-old copies only', async () => {
    const redis = fakeRedis(seed());
    await migrate(redis, rw, { apply: true, keepOld: true, log: () => {} });
    expect(redis.db.has(`bridge:members:${R}`)).toBe(true);
    expect(redis.db.has(`bridge:members:${N}`)).toBe(true);
    expect(redis.db.get('bridge:notify:teams').value).toContain(R);
  });

  it('a string changed since it was read is left as is', async () => {
    const redis = fakeRedis({ 'bridge:invite-token:h1': { type: 'string', value: `${R}|i1` } });
    const plan = planEntry({ key: 'bridge:invite-token:h1', type: 'string', value: `${R}|i0`, pttl: -1 }, rw);
    expect(await applyPlan(redis, plan)).toMatchObject({ ok: false });
    expect(redis.db.get('bridge:invite-token:h1').value).toBe(`${R}|i1`);
  });

  it('restores a backup', async () => {
    const before = seed();
    const redis = fakeRedis(before);
    const backup = join(mkdtempSync(join(tmpdir(), 'mtk-')), 'b.json');
    await migrate(redis, rw, { apply: true, backup, log: () => {} });
    await restore(redis, backup, { apply: true, log: () => {} });
    for (const [k, v] of Object.entries(before)) expect(redis.db.get(k)?.value).toEqual(v.value);
    expect(redis.db.has(`bridge:members:${N}`)).toBe(false);
  });
});
