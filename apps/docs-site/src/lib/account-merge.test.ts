// One Gmail mailbox, one Bridge account (api/_lib/canonical-email.ts, api/_lib/account-merge.ts): the canonical
// spelling, either spelling signing in to one account, the lazy merge of two accounts made before the rule (the live
// case: an older dotted account linked to GitHub, a newer one with an auto-created workspace), two GitHub accounts
// never merged, idempotency, the lock, invites and memberships kept under an older spelling, and other providers left
// as typed.
import { describe, expect, it } from 'vitest';
import { getAccount, type Account } from '../../api/_lib/account';
import { mergeEmailAccounts, mergedKey, mergeLockKey, spellingsPattern } from '../../api/_lib/account-merge';
import { canonicalEmail, emailSpellings, isGmail, sameEmail } from '../../api/_lib/canonical-email';
import { memberStore, type EmailMember } from '../../api/_lib/members';
import { memoryRedis } from '../../api/_lib/redis';
import { getTeamRecord, myRequests, putRequest, putTeamRecord } from '../../api/_lib/teams';
import { accountRef, createGrant, getGrant } from '../../api/_lib/oauth';
import { sealingKey } from '../../api/_lib/sealed';
import { type AccountDeps, handleAccount } from '../../api/account/index';
import { type EmailMessage, inviteStoreOn, INVITE_TTL_MS } from '../../api/invites/index';
import { sha256 } from '../../api/_lib/http';

const HOST = 'bridge.example.com';
const ORIGIN = `https://${HOST}`;
const T0 = Date.parse('2026-11-02T10:00:00Z');
const SECRET = 's'.repeat(40);
const ENV = { LIBRARY_SESSION_SECRET: SECRET };
const OLD = 'florian.gouloubi@gmail.com';
const NEW = 'floriangouloubi@gmail.com';
const H = { host: HOST, origin: ORIGIN, 'content-type': 'application/json', 'x-bridge-account': '1', 'sec-fetch-site': 'same-origin' };
const act = (body: unknown, extra: Record<string, string> = {}) => new Request(`${ORIGIN}/api/account`, { method: 'POST', headers: { ...H, ...extra }, body: JSON.stringify(body) });
const me = (cookie = '') => new Request(`${ORIGIN}/api/account`, { headers: { host: HOST, ...(cookie ? { cookie } : {}) } });
const cookieOf = (r: Response) => (r.headers.get('set-cookie') ?? '').split(';')[0]!;
const codeIn = (msg: EmailMessage) => /\b(\d{6})\b/.exec(msg.text)![1]!;

function setup() {
  const now = T0;
  const redis = memoryRedis(() => now);
  const members = memberStore(redis);
  const sent: EmailMessage[] = [];
  const warnings: string[] = [];
  let n = 0;
  const deps: AccountDeps = {
    fetch: async () => new Response('{}', { status: 404 }),
    now: () => now,
    code: () => String(100000 + ++n),
    redis,
    members,
    email: { send: async (msg) => void sent.push(msg) },
    warn: (m) => void warnings.push(m),
  };
  return { redis, members, sent, warnings, deps, now: () => now };
}

const account = (email: string, x: Partial<Account> = {}): Account => ({ id: `id-${email}`, email, name: 'Florian', nameSet: true, github: null, createdAt: '2026-01-01T00:00:00Z', version: 1, ...x });
const member = (email: string, role: EmailMember['role'], at: string): EmailMember => ({ email, name: 'Florian', role, version: 1, addedBy: 'dana', at });

/** Writes a key the way Bridge wrote it before canonical keys: under the address lower-cased. */
const putLegacyAccount = (s: ReturnType<typeof setup>, a: Account) => s.redis.cmd('SET', `bridge:account:${a.email}`, JSON.stringify(a));
async function putLegacyMember(s: ReturnType<typeof setup>, repo: string, m: EmailMember) {
  await s.redis.pipe([
    ['SET', `bridge:member:${repo}:${m.email}`, JSON.stringify(m)],
    ['SADD', `bridge:members:${repo}`, m.email],
    ['SADD', `bridge:account:teams:${m.email}`, repo],
  ]);
}

async function signIn(s: ReturnType<typeof setup>, email: string) {
  expect((await handleAccount(act({ action: 'code', email }), ENV, s.deps)).status).toBe(200);
  const r = await handleAccount(act({ action: 'verify', email, code: codeIn(s.sent.at(-1)!) }), ENV, s.deps);
  expect(r.status).toBe(200);
  return { cookie: cookieOf(r), body: await r.json() };
}

/** The live case: an older dotted account linked to GitHub, a newer one with an auto-created workspace. */
async function liveCase(s: ReturnType<typeof setup>, opts: { oldTeam: boolean }) {
  await putLegacyAccount(s, account(OLD, { id: 'old', createdAt: '2026-03-01T00:00:00Z', github: { login: 'peterbono', id: 42 }, notify: { needs: 'daily', news: 'off' }, tz: 'Asia/Manila' }));
  await s.redis.cmd('SET', 'bridge:account:gh:42', OLD);
  if (opts.oldTeam) await putLegacyMember(s, 'acme/ds', member(OLD, 'edit', '2026-03-02T00:00:00Z'));
  // The newer account, already under the canonical key (it was typed without dots), with its workspace.
  await s.redis.cmd('SET', `bridge:account:${NEW}`, JSON.stringify(account(NEW, { id: 'new', createdAt: '2026-10-30T00:00:00Z', name: 'floriangouloubi', nameSet: false })));
  await putTeamRecord(s.redis, { id: 'a1b2c3d4e5f60718', name: 'Your workspace', createdBy: NEW, createdAt: '2026-10-30T00:00:00Z', repo: null, storybook: null });
  await s.members.put('_team/a1b2c3d4e5f60718', member(NEW, 'admin', '2026-10-30T00:00:00Z'));
}

describe('canonicalEmail', () => {
  it('Gmail: lower case, no dots, no +tag, googlemail.com is gmail.com', () => {
    expect(canonicalEmail('Florian.Gouloubi@Gmail.com')).toBe(NEW);
    expect(canonicalEmail(' f.l.o.r.i.a.n.gouloubi+bridge@googlemail.com ')).toBe(NEW);
    expect(canonicalEmail('floriangouloubi+a+b@gmail.com')).toBe(NEW);
    expect(canonicalEmail(NEW)).toBe(NEW);
  });

  it('other providers: lower case only, dots and plus kept', () => {
    expect(canonicalEmail('First.Last+tag@Acme.Design')).toBe('first.last+tag@acme.design');
    expect(canonicalEmail('first.last@outlook.com')).toBe('first.last@outlook.com');
    expect(canonicalEmail('a.b@gmail.com.evil.io')).toBe('a.b@gmail.com.evil.io');
    expect(canonicalEmail('a.b@sub.gmail.com')).toBe('a.b@sub.gmail.com');
  });

  it('never an empty mailbox name, and anything that is not an address only lower-cased', () => {
    expect(canonicalEmail('+tag@gmail.com')).toBe('+tag@gmail.com');
    expect(canonicalEmail('gh:PeterBono')).toBe('gh:peterbono');
    expect(canonicalEmail('')).toBe('');
  });

  it('sameEmail, isGmail, emailSpellings', () => {
    expect(sameEmail(OLD, 'FlorianGouloubi+x@googlemail.com')).toBe(true);
    expect(sameEmail('first.last@acme.design', 'firstlast@acme.design')).toBe(false);
    expect(sameEmail('', '')).toBe(false);
    expect(sameEmail(null, NEW)).toBe(false);
    expect(isGmail('a@googlemail.com')).toBe(true);
    expect(isGmail('a@acme.design')).toBe(false);
    expect(emailSpellings('Florian.Gouloubi@gmail.com')).toEqual([OLD, NEW]);
    expect(emailSpellings('mia@acme.design')).toEqual(['mia@acme.design']);
  });

  it('the scan pattern matches every spelling of the mailbox', () => {
    const re = new RegExp(`^${spellingsPattern(NEW).replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`);
    for (const k of [`bridge:account:${OLD}`, 'bridge:member:acme/ds:f.lorian.gouloubi+x@googlemail.com', `bridge:invites:email:${NEW}`]) expect(re.test(k)).toBe(true);
    expect(re.test('bridge:account:someone@gmail.com')).toBe(false);
  });
});

describe('sign-in with either spelling', () => {
  it('a new Gmail account: either spelling signs in to the same account, shown as first typed; no duplicate', async () => {
    const s = setup();
    const first = await signIn(s, 'Florian.Gouloubi@gmail.com');
    expect(first.body.created).toBe(true);
    expect(first.body.account.email).toBe(OLD);
    expect(s.sent[0]!.to).toBe(OLD);
    const again = await signIn(s, 'floriangouloubi+bridge@googlemail.com');
    expect(again.body.created).toBe(false);
    expect(again.body.account.email).toBe(OLD);
    expect(s.redis.keys().filter((k) => /^bridge:account:[^:]+@/.test(k))).toEqual([`bridge:account:${NEW}`]);
    expect((await getAccount(s.redis, NEW))!.displayEmail).toBe(OLD);
  });

  it('caps sign-in codes per mailbox, not per spelling', async () => {
    const s = setup();
    const spellings = ['a.b.c@gmail.com', 'abc@gmail.com', 'a.bc@gmail.com', 'ab.c@gmail.com', 'abc+1@gmail.com', 'abc+2@googlemail.com'];
    const statuses = [];
    for (const email of spellings) statuses.push((await handleAccount(act({ action: 'code', email }), ENV, s.deps)).status);
    expect(statuses).toEqual([200, 200, 200, 200, 200, 429]);
  });

  it('other providers keep dots: two addresses, two accounts, nothing merged', async () => {
    const s = setup();
    const a = await signIn(s, 'first.last@acme.design');
    const b = await signIn(s, 'firstlast@acme.design');
    expect(a.body.created && b.body.created).toBe(true);
    expect((await getAccount(s.redis, 'first.last@acme.design'))!.id).not.toBe((await getAccount(s.redis, 'firstlast@acme.design'))!.id);
    expect(await mergeEmailAccounts({ redis: s.redis, now: s.now }, 'first.last@acme.design')).toBe('not-gmail');
  });
});

describe('merging two accounts of one Gmail mailbox (the live case)', () => {
  it('keeps the older identity and GitHub, unions teams, drops the empty workspace when another team exists', async () => {
    const s = setup();
    await liveCase(s, { oldTeam: true });
    // An invite and a join request sent to the dotted spelling before canonical keys.
    const store = inviteStoreOn(s.redis, s.now);
    await s.redis.cmd('SET', 'bridge:invite:acme/web:inv1', JSON.stringify({ id: 'inv1', repo: 'acme/web', email: OLD, role: 'edit', invitedBy: 'sam', createdAt: '', sentAt: '', expiresAt: new Date(T0 + INVITE_TTL_MS).toISOString(), tokenHash: sha256('t') }), 'EX', 3600);
    await s.redis.cmd('SADD', `bridge:invites:email:${OLD}`, 'acme/web|inv1');
    await s.redis.pipe([
      ['SET', `bridge:joinreq:acme/app:${OLD}`, JSON.stringify({ id: 'r1', repo: 'acme/app', email: OLD, name: 'Florian', createdAt: '', expiresAt: new Date(T0 + 3600_000).toISOString() }), 'EX', 3600],
      ['ZADD', 'bridge:joinreqs:acme/app', T0 + 3600_000, OLD],
      ['SADD', `bridge:joinreq:mine:${OLD}`, 'acme/app'],
      ['ZADD', `bridge:notify:digest:${OLD}`, T0, JSON.stringify({ id: 'n1', kind: 'shipped', title: 'x', href: '/', at: T0 })],
      ['ZADD', 'bridge:notify:due', T0 + 1000, OLD],
      ['SET', `bridge:account:ghteams:${OLD}`, JSON.stringify({ 'acme/ds': { role: 'admin', at: T0 } })],
      ['SADD', 'bridge:account:ghteams-of:acme/ds', OLD],
    ]);
    // A connection in Claude made by the dotted account before canonical keys.
    const key = sealingKey(SECRET, 'oauth-grant')!;
    const legacyRef = sha256(`account:${OLD}`);
    const grant = await createGrant(s.redis, key, { repo: 'acme/ds', client: { clientId: 'c', clientName: 'Claude' }, login: 'peterbono', name: 'Florian', gh: { access: 'a', refresh: 'r', expiresAt: 0 } as never, account: legacyRef }, (n) => new Uint8Array(n).fill(7), T0);

    const { cookie, body } = await signIn(s, NEW);
    expect(body.created).toBe(false);
    expect(body.account).toMatchObject({ email: OLD, name: 'Florian', github: { login: 'peterbono', id: 42 }, notify: { needs: 'daily', news: 'off' } });
    expect(body.account.teams.map((t: { repo: string }) => t.repo)).toEqual(['acme/ds']);
    const a = (await getAccount(s.redis, NEW))!;
    expect(a).toMatchObject({ id: 'old', email: NEW, displayEmail: OLD, createdAt: '2026-03-01T00:00:00Z', tz: 'Asia/Manila' });
    expect(await s.redis.cmd('GET', 'bridge:account:gh:42')).toBe(NEW);
    // The empty auto-created workspace went: the account is on acme/ds.
    expect(await getTeamRecord(s.redis, 'a1b2c3d4e5f60718')).toBeNull();
    expect(await s.members.list('_team/a1b2c3d4e5f60718')).toEqual([]);
    // Everything moved to the canonical key, nothing left under the dotted one.
    expect(s.redis.keys().filter((k) => k.includes(OLD))).toEqual([]);
    expect(await s.members.get('acme/ds', NEW)).toMatchObject({ email: OLD, role: 'edit' });
    expect(await s.redis.cmd('SMEMBERS', 'bridge:members:acme/ds')).toEqual([NEW]);
    expect((await store.byEmail(NEW)).map((i) => i.id)).toEqual(['inv1']);
    expect([...(await myRequests(s.redis, NEW, T0)).entries()]).toEqual([['acme/app', 'pending']]);
    expect(await s.redis.cmd('ZRANGE', 'bridge:joinreqs:acme/app', 0, -1)).toEqual([NEW]);
    expect(await s.redis.cmd('ZRANGE', `bridge:notify:digest:${NEW}`, 0, -1)).toHaveLength(1);
    expect(await s.redis.cmd('ZRANGE', 'bridge:notify:due', 0, -1)).toEqual([NEW]);
    expect(JSON.parse((await s.redis.cmd('GET', `bridge:account:ghteams:${NEW}`)) as string)).toEqual({ 'acme/ds': { role: 'admin', at: T0 } });
    expect(await s.redis.cmd('SMEMBERS', 'bridge:account:ghteams-of:acme/ds')).toEqual([NEW]);
    expect((await getGrant(s.redis, grant.id))!.account).toBe(accountRef(NEW));
    expect(await s.redis.cmd('SMEMBERS', `bridge:oauth:account:${accountRef(NEW)}`)).toEqual([grant.id]);
    // The dotted session and the new one both open the merged account; signing in dotted reaches it too.
    expect((await (await handleAccount(me(cookie), ENV, s.deps)).json()).account.email).toBe(OLD);
    expect((await signIn(s, OLD)).body.created).toBe(false);
    // Nothing logged an address.
    expect(s.warnings.join(' ')).not.toContain('@');
  });

  it('keeps the workspace (now the canonical account’s) when the account has no other team', async () => {
    const s = setup();
    await liveCase(s, { oldTeam: false });
    const { body } = await signIn(s, OLD);
    expect(body.account.github).toEqual({ login: 'peterbono', id: 42 });
    expect(body.account.teams.map((t: { repo: string }) => t.repo)).toEqual(['_team/a1b2c3d4e5f60718']);
    expect(await getTeamRecord(s.redis, 'a1b2c3d4e5f60718')).toMatchObject({ createdBy: NEW });
    expect(await s.members.get('_team/a1b2c3d4e5f60718', OLD)).toMatchObject({ role: 'admin' });
  });

  it('merges on an account read too (a session of the older account), and the higher role wins on a shared team', async () => {
    const s = setup();
    await liveCase(s, { oldTeam: true });
    await s.members.put('acme/ds', member(NEW, 'admin', '2026-10-31T00:00:00Z'));
    const { signAccountSession, ACCOUNT_COOKIE } = await import('../../api/_lib/account');
    const cookie = `${ACCOUNT_COOKIE}=${signAccountSession({ email: OLD, v: 1, exp: T0 + 3600_000 }, SECRET)}`;
    const r = await (await handleAccount(me(cookie), ENV, s.deps)).json();
    expect(r.account).toMatchObject({ email: OLD, github: { id: 42 } });
    expect(r.account.teams).toEqual([{ repo: 'acme/ds', name: expect.any(String), role: 'admin', via: 'email' }]);
    // The older membership's record (its spelling keeps its member reference), Admin from the newer one.
    expect(await s.members.get('acme/ds', NEW)).toMatchObject({ email: OLD, role: 'admin', at: '2026-03-02T00:00:00Z' });
  });

  it('two accounts linked to different GitHub accounts are never merged, and no address is logged', async () => {
    const s = setup();
    await liveCase(s, { oldTeam: true });
    const other = account(NEW, { id: 'new', createdAt: '2026-10-30T00:00:00Z', github: { login: 'someone', id: 99 } });
    await s.redis.cmd('SET', `bridge:account:${NEW}`, JSON.stringify(other));
    expect(await mergeEmailAccounts({ redis: s.redis, now: s.now, warn: (m) => void s.warnings.push(m) }, NEW)).toBe('conflict');
    expect(JSON.parse((await s.redis.cmd('GET', `bridge:account:${OLD}`)) as string).id).toBe('old');
    expect(JSON.parse((await s.redis.cmd('GET', `bridge:account:${NEW}`)) as string).id).toBe('new');
    expect(await s.redis.cmd('GET', `bridge:member:acme/ds:${OLD}`)).not.toBeNull();
    expect(await s.redis.cmd('GET', mergedKey(NEW))).toBe('conflict');
    expect(s.warnings).toHaveLength(1);
    expect(s.warnings[0]).not.toContain('@');
    expect(s.warnings[0]).not.toMatch(/florian|peterbono|someone/i);
  });

  it('is idempotent: a second run (marker cleared, as after a crash) changes nothing', async () => {
    const s = setup();
    await liveCase(s, { oldTeam: true });
    expect(await mergeEmailAccounts({ redis: s.redis, now: s.now }, OLD)).toBe('merged');
    const after = JSON.stringify(s.redis.snapshot());
    expect(await mergeEmailAccounts({ redis: s.redis, now: s.now }, NEW)).toBe('done-before');
    await s.redis.cmd('DEL', mergedKey(NEW));
    // A fresh warm function: the in-process memo is per Redis connection, so run on a copy.
    const copy = memoryRedis(s.now);
    copy.restore(s.redis.snapshot());
    expect(await mergeEmailAccounts({ redis: copy, now: s.now }, NEW)).toBe('none');
    const again = copy.snapshot().filter((e) => !e.key.startsWith('bridge:account:canon:'));
    expect(JSON.stringify(again)).toBe(JSON.stringify(JSON.parse(after).filter((e: { key: string }) => !e.key.startsWith('bridge:account:canon:'))));
  });

  it('a merge in progress (the lock held) waits: nothing moves, readers still find the older spelling', async () => {
    const s = setup();
    await liveCase(s, { oldTeam: true });
    await s.redis.cmd('SET', mergeLockKey(NEW), 'other', 'NX', 'EX', 60);
    expect(await mergeEmailAccounts({ redis: s.redis, now: s.now }, NEW)).toBe('busy');
    expect(await s.redis.cmd('GET', `bridge:account:${OLD}`)).not.toBeNull();
    // Reads by the dotted spelling find the dotted records first.
    expect((await getAccount(s.redis, OLD))!.id).toBe('old');
    expect(await s.members.get('acme/ds', OLD)).toMatchObject({ email: OLD });
    expect((await s.members.list('acme/ds')).map((m) => m.email)).toEqual([OLD]);
  });
});

describe('invites and memberships under an older spelling', () => {
  it('an invite to a dotted address is found by the canonical one, and the other way round', async () => {
    const s = setup();
    const store = inviteStoreOn(s.redis, s.now);
    const inv = { id: 'i1', repo: 'acme/ds', email: 'Florian.Gouloubi+work@googlemail.com', role: 'edit' as const, invitedBy: 'sam', createdAt: '', sentAt: '', expiresAt: new Date(T0 + INVITE_TTL_MS).toISOString(), tokenHash: sha256('x') };
    await store.put(inv, 3600);
    expect((await store.byEmail(NEW)).map((i) => i.id)).toEqual(['i1']);
    expect((await store.byEmail(OLD)).map((i) => i.id)).toEqual(['i1']);
    // Kept under the older key (before canonical keys): read under the spelling given.
    await s.redis.cmd('SADD', `bridge:invites:email:${OLD}`, 'acme/ds|i1');
    await s.redis.cmd('DEL', `bridge:invites:email:${NEW}`);
    expect((await store.byEmail(OLD)).map((i) => i.id)).toEqual(['i1']);
  });

  it('a membership written under the dotted key: found, listed once, and removing it removes every spelling', async () => {
    const s = setup();
    await putLegacyMember(s, 'acme/ds', member(OLD, 'edit', '2026-03-02T00:00:00Z'));
    expect(await s.members.get('acme/ds', OLD)).not.toBeNull();
    // Written again (a role change): moves to the canonical key, listed once.
    await s.members.put('acme/ds', { ...member(OLD, 'admin', '2026-03-02T00:00:00Z') });
    expect(await s.redis.cmd('GET', `bridge:member:acme/ds:${OLD}`)).toBeNull();
    expect((await s.members.list('acme/ds')).map((m) => [m.email, m.role])).toEqual([[OLD, 'admin']]);
    // Removed by the canonical spelling while an older copy is still there: both go.
    await putLegacyMember(s, 'acme/ds', member(OLD, 'edit', '2026-03-02T00:00:00Z'));
    expect(await s.members.remove('acme/ds', NEW)).toBe(true);
    expect(await s.members.get('acme/ds', OLD)).toBeNull();
    expect(await s.members.get('acme/ds', NEW)).toBeNull();
    expect(await s.members.list('acme/ds')).toEqual([]);
  });

  it('a join request placed under one spelling is the request of the mailbox', async () => {
    const s = setup();
    await putRequest(s.redis, { id: 'r1', repo: 'acme/ds', email: OLD, name: 'F', createdAt: '', expiresAt: new Date(T0 + 3600_000).toISOString() }, T0);
    expect([...(await myRequests(s.redis, 'floriangouloubi+x@googlemail.com', T0)).keys()]).toEqual(['acme/ds']);
  });
});
