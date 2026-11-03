#!/usr/bin/env node
// Step 2 of the Bridge architecture plan: a team's key (its library repository, "owner/name") changes when the
// repository moves to the team's GitHub organization, or when that organization is renamed. Every server store keys
// teams by that string (Upstash Redis, api/_lib/*.ts: members, invites, join requests, discovery, names, AI tools,
// notify, contrib authorship, fix sessions, OAuth grants, library settings, ...) and many values embed it (sets of
// "owner/repo", "<repo>|<id>", JSON { repo }). This script rewrites both.
//
//   node --env-file=.env.prod scripts/migrate-team-key.mjs \
//     --from peterbono/ai-design-system-demo --to the-bridge-company/ai-design-system-demo \
//     --owner art-print-shop-co=the-bridge-company
//
// Dry run by default: prints what would change (key names with emails masked, never a value, never a secret).
// --apply           writes. Every touched key is first saved to a local backup file (--backup, default
//                   migrate-team-key-backup-<time>.json; it holds emails and sealed values: keep it private, delete it
//                   once the migration is confirmed). A moved key is copied, read back and compared, and only then is
//                   the old key deleted. A rewritten set or sorted set gets its new members first, checked, then loses
//                   the old ones. A string rewritten in place is written only if it did not change since it was read.
// --keep-old        with --apply: copy only, never delete the old keys or old members.
// --restore <file>  puts back what a backup file holds (dry run unless --apply) and removes the keys the run created.
// --match <glob>    which keys to scan (default bridge:*).
//
// Env: KV_REST_API_URL + KV_REST_API_TOKEN, or UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN (vercel env pull).
// Idempotent: a second run finds nothing left to change. Caches and rate counters are left alone (SKIP below): they
// expire on their own and the app refills them under the new key.

import { writeFileSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** GitHub's own name rules: owner 1-39 alphanumerics or single hyphens, repository letters, digits, '.', '-', '_'. */
const OWNER = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const NAME = /^[A-Za-z0-9._-]{1,100}$/;
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** "owner/name" lower case, or throws. */
export function parseRepoKey(s) {
  const [owner, name, ...rest] = String(s ?? '').trim().toLowerCase().split('/');
  if (rest.length || !owner || !name || !OWNER.test(owner) || !NAME.test(name)) throw new Error(`Not an owner/name repository: "${s}"`);
  return `${owner}/${name}`;
}

/** ["old=new", ...] as [[old, new], ...] lower case, or throws. */
export function parseOwnerMap(list) {
  return (list ?? []).map((pair) => {
    const [a, b, ...rest] = String(pair).trim().toLowerCase().split('=');
    if (rest.length || !a || !b || !OWNER.test(a) || !OWNER.test(b)) throw new Error(`Not an old=new owner pair: "${pair}"`);
    return [a, b];
  });
}

/**
 * The rewriter of one migration: every "owner/name" of `from` becomes `to`, and every "<old owner>/<name>" becomes
 * "<new owner>/<name>", wherever it appears in a key or a value (case-insensitive; a repository string ends where
 * GitHub's name characters end, so "owner/name-old" or "xowner/name" never match). Throws when the result could be
 * rewritten again (the migration would not be idempotent).
 */
export function makeRewriter({ from, to, owners = [] }) {
  const f = parseRepoKey(from);
  const t = parseRepoKey(to);
  if (f === t && !owners.length) throw new Error('--from and --to are the same repository.');
  const ownerMap = new Map(owners.map(([a, b]) => [a.toLowerCase(), b.toLowerCase()]));
  for (const [a, b] of ownerMap) if (a === b) throw new Error(`Owner "${a}" is mapped to itself.`);
  // A repository string starts after anything but an owner character (so "xowner/name" never matches; a URL path
  // does) and ends where GitHub's name characters end (so "owner/name-old" never matches).
  const repoRe = new RegExp(`(?<![A-Za-z0-9-])${esc(f)}(?![A-Za-z0-9._-])`, 'gi');
  const ownerRes = [...ownerMap].map(([a, b]) => [new RegExp(`(?<![A-Za-z0-9-])${esc(a)}/([A-Za-z0-9._-]{1,100})(?![A-Za-z0-9._-])`, 'gi'), b]);
  const repo = (owner, name) => {
    const full = `${owner}/${name}`.toLowerCase();
    if (full === f) return t;
    const o = ownerMap.get(owner.toLowerCase());
    return o ? `${o}/${name}` : null;
  };
  const rewrite = (text) => {
    let out = String(text).replace(repoRe, t);
    for (const [re, b] of ownerRes) out = out.replace(re, (m, name) => `${b}/${name}`);
    return out;
  };
  if (rewrite(t) !== t) throw new Error(`"${t}" would be rewritten again: the migration would not be idempotent.`);
  for (const b of ownerMap.values()) if (ownerMap.has(b)) throw new Error(`Owner "${b}" is both a target and a source.`);
  return {
    from: f,
    to: t,
    owners: [...ownerMap],
    rewrite,
    touches: (text) => rewrite(text) !== String(text),
    /** The repository a single "owner/name" string becomes, or null when this migration leaves it. */
    repo: (s) => {
      const [o, n, ...rest] = String(s).split('/');
      return o && n && !rest.length ? repo(o, n) : null;
    },
  };
}

/**
 * Keys the migration never rewrites: caches of GitHub answers and rate counters. They expire on their own, and some
 * embed the repository through a hash (bridge:app:token, bridge:read:get) so a rename could not find them anyway.
 */
export const SKIP = [
  /^bridge:read:(get|blob|change|changed|count|known|wrote|products|who|user|hook):/,
  /^bridge:gh:quota:/,
  /^bridge:app:token:/,
  /^bridge:hook:delivery:/,
  /^bridge:npm:latest:/,
  /:count:/,
  /^bridge:local:(fixture|fixtures|git)(:|$)/,
];
export const isSkipped = (key) => SKIP.some((r) => r.test(key));

/** An email in a key, masked for printing: "fl***@gmail.com". */
export const maskEmails = (s) => String(s).replace(/([^\s:|/@]{1,2})[^\s:|/@]*@([^\s:|/#]+)/g, '$1***@$2');

/** A key's family for the summary: its parts up to the repository, "bridge:member:<repo>:…". */
export function familyOf(key, rw) {
  const parts = key.split(':');
  const i = parts.findIndex((p) => /^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+/.test(p) && rw.touches(p));
  if (i < 0) return `${parts.slice(0, Math.min(parts.length, 3)).join(':')}${parts.length > 3 ? ':…' : ''} (value)`;
  return `${parts.slice(0, i).join(':')}:<repo>${i < parts.length - 1 ? ':…' : ''}`;
}

/**
 * What to do with one key, from what Redis holds: { key, type: 'string'|'set'|'zset'|other, value, pttl }.
 * value: a string; the members of a set; [[member, score], ...] of a sorted set.
 * Answers { action: 'none' | 'skip' | 'unsupported' | 'rewrite' | 'move', newKey, newValue, valueChanges }.
 */
export function planEntry(entry, rw) {
  const { key, type, value } = entry;
  if (isSkipped(key)) return { action: rw.touches(key) ? 'skip' : 'none', key };
  const newKey = rw.rewrite(key);
  let newValue = value;
  let valueChanges = 0;
  if (type === 'string') {
    newValue = rw.rewrite(value);
    valueChanges = newValue === value ? 0 : 1;
  } else if (type === 'set') {
    const next = [...new Set(value.map((m) => rw.rewrite(m)))];
    valueChanges = value.filter((m) => rw.touches(m)).length;
    newValue = next;
  } else if (type === 'zset') {
    const next = new Map();
    for (const [m, s] of value) {
      const n = rw.rewrite(m);
      // Two old members becoming one: the later score wins (the most recent for every sorted set Bridge keeps).
      next.set(n, Math.max(Number(s), next.has(n) ? next.get(n) : -Infinity));
      if (n !== m) valueChanges++;
    }
    newValue = [...next];
  } else {
    return { action: newKey !== key ? 'unsupported' : 'none', key, type };
  }
  if (newKey !== key) return { action: 'move', key, newKey, type, newValue, valueChanges, pttl: entry.pttl };
  if (valueChanges) return { action: 'rewrite', key, newKey, type, value, newValue, valueChanges, pttl: entry.pttl };
  return { action: 'none', key };
}

/** True when what was read back at the new key holds what the plan wrote. */
export function verified(plan, readBack) {
  if (plan.type === 'string') return readBack === plan.newValue;
  if (plan.type === 'set') {
    const have = new Set(readBack ?? []);
    return plan.newValue.every((m) => have.has(m));
  }
  if (plan.type === 'zset') {
    const have = new Map(readBack ?? []);
    return plan.newValue.every(([m, s]) => have.has(m) && Number(have.get(m)) >= Number(s));
  }
  return false;
}

// ---------------------------------------------------------------------------------------------------------------
// Redis access (Upstash REST) and the run

export function upstash(url, token, f = fetch) {
  const base = url.replace(/\/+$/, '');
  const call = async (path, body) => {
    const res = await f(`${base}${path}`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    // Never echo the response body: it may hold values.
    if (!res.ok) throw new Error(`Redis answered ${res.status}.`);
    return res.json();
  };
  return {
    async cmd(...args) {
      const r = await call('', args.map(String));
      if (r.error) throw new Error(`Redis refused ${String(args[0]).toUpperCase()}.`);
      return r.result;
    },
    async pipe(cmds) {
      if (!cmds.length) return [];
      const r = await call('/pipeline', cmds.map((c) => c.map(String)));
      if (!Array.isArray(r) || r.some((x) => x?.error)) throw new Error('Redis refused a pipelined command.');
      return r.map((x) => x.result);
    },
  };
}

async function scanAll(redis, match) {
  const keys = new Set();
  let cursor = '0';
  for (let i = 0; i < 100_000; i++) {
    const [next, batch] = await redis.cmd('SCAN', cursor, 'MATCH', match, 'COUNT', 1000);
    for (const k of batch) keys.add(k);
    cursor = String(next);
    if (cursor === '0') break;
  }
  return [...keys].sort();
}

const pairs = (flat) => {
  const out = [];
  for (let i = 0; i + 1 < (flat ?? []).length; i += 2) out.push([flat[i], Number(flat[i + 1])]);
  return out;
};

/** Reads keys with their type, value and remaining life (ms, -1: none). */
export async function readEntries(redis, keys) {
  const out = [];
  for (let i = 0; i < keys.length; i += 100) {
    const batch = keys.slice(i, i + 100);
    const meta = await redis.pipe(batch.flatMap((k) => [['TYPE', k], ['PTTL', k]]));
    const reads = batch.map((k, j) => {
      const t = meta[j * 2];
      return t === 'string' ? ['GET', k] : t === 'set' ? ['SMEMBERS', k] : t === 'zset' ? ['ZRANGE', k, 0, -1, 'WITHSCORES'] : ['TYPE', k];
    });
    const values = await redis.pipe(reads);
    batch.forEach((key, j) => {
      const type = meta[j * 2];
      if (type === 'none') return;
      const value = type === 'zset' ? pairs(values[j]) : type === 'string' || type === 'set' ? values[j] : null;
      out.push({ key, type, value, pttl: Number(meta[j * 2 + 1]) });
    });
  }
  return out;
}

const readOne = async (redis, type, key) =>
  type === 'string' ? redis.cmd('GET', key) : type === 'set' ? redis.cmd('SMEMBERS', key) : pairs(await redis.cmd('ZRANGE', key, 0, -1, 'WITHSCORES'));

/** Writes one plan; answers { ok, note }. Nothing is deleted before the copy is read back and matches. */
export async function applyPlan(redis, plan, { keepOld = false } = {}) {
  const life = plan.pttl > 0 ? plan.pttl : null;
  if (plan.action === 'move') {
    if (plan.type === 'string') {
      const set = await redis.cmd('SET', plan.newKey, plan.newValue, 'NX', ...(life ? ['PX', life] : []));
      if (set === null) {
        const there = await redis.cmd('GET', plan.newKey);
        if (there !== plan.newValue) return { ok: false, note: 'conflict: the new key already holds something else, old key kept' };
      }
    } else if (plan.type === 'set') {
      if (plan.newValue.length) await redis.cmd('SADD', plan.newKey, ...plan.newValue);
      if (life) await redis.cmd('PEXPIRE', plan.newKey, life);
    } else {
      const args = plan.newValue.flatMap(([m, s]) => [s, m]);
      if (args.length) await redis.cmd('ZADD', plan.newKey, ...args);
      if (life) await redis.cmd('PEXPIRE', plan.newKey, life);
    }
    if (!verified(plan, await readOne(redis, plan.type, plan.newKey))) return { ok: false, note: 'copy did not read back, old key kept' };
    if (!keepOld) await redis.cmd('DEL', plan.key);
    return { ok: true };
  }
  if (plan.action === 'rewrite') {
    if (plan.type === 'string') {
      // Written only if the live app did not change it since it was read.
      if ((await redis.cmd('GET', plan.key)) !== plan.value) return { ok: false, note: 'changed since read, left as is (run again)' };
      await redis.cmd('SET', plan.key, plan.newValue, 'KEEPTTL');
      return { ok: (await redis.cmd('GET', plan.key)) === plan.newValue };
    }
    if (plan.type === 'set') {
      await redis.cmd('SADD', plan.key, ...plan.newValue);
      if (!verified(plan, await readOne(redis, 'set', plan.key))) return { ok: false, note: 'new members did not read back, old kept' };
      const old = plan.value.filter((m) => !plan.newValue.includes(m));
      if (!keepOld && old.length) await redis.cmd('SREM', plan.key, ...old);
      return { ok: true };
    }
    await redis.cmd('ZADD', plan.key, ...plan.newValue.flatMap(([m, s]) => [s, m]));
    if (!verified(plan, await readOne(redis, 'zset', plan.key))) return { ok: false, note: 'new members did not read back, old kept' };
    const keep = new Set(plan.newValue.map(([m]) => m));
    const old = plan.value.map(([m]) => m).filter((m) => !keep.has(m));
    if (!keepOld && old.length) await redis.cmd('ZREM', plan.key, ...old);
    return { ok: true };
  }
  return { ok: true };
}

/** Plans (and with apply, writes) a whole migration. `log` gets lines without values or secrets. */
export async function migrate(redis, rw, { apply = false, keepOld = false, match = 'bridge:*', backup = null, log = console.log } = {}) {
  const keys = await scanAll(redis, match);
  // Only keys that are not caches are read: a key that names the repository, or one whose value might.
  const entries = await readEntries(redis, keys.filter((k) => !isSkipped(k) || rw.touches(k)));
  const plans = entries.map((e) => ({ ...planEntry(e, rw), original: e }));
  const todo = plans.filter((p) => p.action === 'move' || p.action === 'rewrite');
  const skipped = plans.filter((p) => p.action === 'skip');
  const unsupported = plans.filter((p) => p.action === 'unsupported');

  const families = new Map();
  for (const p of todo) {
    const f = `${p.action === 'move' ? 'move   ' : 'rewrite'} ${familyOf(p.key, rw)}`;
    families.set(f, (families.get(f) ?? 0) + 1);
  }
  log(`Scanned ${keys.length} keys (${match}); ${rw.from} -> ${rw.to}${rw.owners.map(([a, b]) => `, ${a}/* -> ${b}/*`).join('')}.`);
  log(`${todo.length} to change, ${skipped.length} caches or counters left to expire, ${unsupported.length} of a type this script does not handle.`);
  for (const [f, n] of [...families].sort()) log(`  ${String(n).padStart(4)}  ${f}`);
  for (const p of todo) log(`  ${p.action === 'move' ? 'move   ' : 'rewrite'} ${maskEmails(p.key)}${p.action === 'move' ? ` -> ${maskEmails(p.newKey)}` : ''}${p.valueChanges ? `  (${p.valueChanges} in value)` : ''}`);
  for (const p of unsupported) log(`  UNSUPPORTED ${p.type} ${maskEmails(p.key)}: move it by hand`);
  if (!apply) {
    log('Dry run: nothing written. Add --apply to write.');
    return { todo: todo.length, done: 0, failed: 0, skipped: skipped.length, unsupported: unsupported.length };
  }
  if (backup && todo.length) {
    writeFileSync(backup, JSON.stringify({ at: new Date().toISOString(), from: rw.from, to: rw.to, owners: rw.owners, entries: todo.map((p) => ({ ...p.original, newKey: p.newKey })) }), { mode: 0o600 });
    log(`Backup of the ${todo.length} original keys: ${backup} (private: emails and sealed values).`);
  }
  let done = 0;
  let failed = 0;
  for (const p of todo) {
    const r = await applyPlan(redis, p, { keepOld });
    if (r.ok) done++;
    else {
      failed++;
      log(`  FAILED ${maskEmails(p.key)}: ${r.note ?? 'did not read back'}`);
    }
  }
  log(`Applied ${done}/${todo.length}${failed ? `, ${failed} failed (nothing of theirs was deleted)` : ''}${keepOld ? ', old keys kept (--keep-old)' : ''}.`);
  return { todo: todo.length, done, failed, skipped: skipped.length, unsupported: unsupported.length };
}

/** Puts back the originals a backup holds, and removes the keys the migration created. */
export async function restore(redis, file, { apply = false, log = console.log } = {}) {
  const { entries } = JSON.parse(readFileSync(file, 'utf8'));
  log(`${entries.length} keys to put back from ${file}.`);
  for (const e of entries) log(`  restore ${maskEmails(e.key)}${e.newKey && e.newKey !== e.key ? ` (drop ${maskEmails(e.newKey)})` : ''}`);
  if (!apply) {
    log('Dry run: nothing written. Add --apply to write.');
    return { restored: 0 };
  }
  let restored = 0;
  for (const e of entries) {
    const life = e.pttl > 0 ? ['PX', e.pttl] : [];
    if (e.newKey && e.newKey !== e.key) await redis.cmd('DEL', e.newKey);
    await redis.cmd('DEL', e.key);
    if (e.type === 'string') await redis.cmd('SET', e.key, e.value, ...life);
    else {
      if (e.type === 'set' && e.value.length) await redis.cmd('SADD', e.key, ...e.value);
      if (e.type === 'zset' && e.value.length) await redis.cmd('ZADD', e.key, ...e.value.flatMap(([m, s]) => [s, m]));
      if (life.length) await redis.cmd('PEXPIRE', e.key, e.pttl);
    }
    restored++;
  }
  log(`Restored ${restored} keys.`);
  return { restored };
}

export function parseArgs(argv) {
  const a = { owners: [], apply: false, keepOld: false, match: 'bridge:*' };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    const next = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`${k} needs a value.`);
      return v;
    };
    if (k === '--from') a.from = next();
    else if (k === '--to') a.to = next();
    else if (k === '--owner') a.owners.push(next());
    else if (k === '--apply') a.apply = true;
    else if (k === '--keep-old') a.keepOld = true;
    else if (k === '--backup') a.backup = next();
    else if (k === '--restore') a.restore = next();
    else if (k === '--match') a.match = next();
    else throw new Error(`Unknown argument ${k}.`);
  }
  return a;
}

async function main() {
  const a = parseArgs(process.argv.slice(2));
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) throw new Error('Set KV_REST_API_URL and KV_REST_API_TOKEN (or the UPSTASH_REDIS_REST_ pair).');
  const redis = upstash(url, token);
  if (a.restore) {
    await restore(redis, a.restore, { apply: a.apply });
    return;
  }
  if (!a.from || !a.to) throw new Error('Usage: migrate-team-key.mjs --from owner/name --to owner/name [--owner old=new ...] [--apply] [--keep-old] [--backup file] [--match glob] | --restore file [--apply]');
  const rw = makeRewriter({ from: a.from, to: a.to, owners: parseOwnerMap(a.owners) });
  const backup = a.backup ?? `migrate-team-key-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  const r = await migrate(redis, rw, { apply: a.apply, keepOld: a.keepOld, match: a.match, backup });
  if (r.failed) process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e) => {
    console.error(`migrate-team-key: ${e.message}`);
    process.exit(1);
  });
}
