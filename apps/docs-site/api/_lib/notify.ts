// Notifications, phase 1: designers who joined by email learn what happens to their work (docs/HOSTED.md,
// "Notifications"). GitHub's webhook (api/_lib/github-webhook.ts) hands every delivery of a watched repository to
// notifyEventsOf (api/_lib/notify-events.ts); here each notice finds its designer, server side only, and is either
// sent right away (it waits on them) or kept for the daily summary at 09:00 in their time zone (it is news).
//
// Who a notice is for: the member Bridge keeps as the author of the task or suggestion (bridge:contrib:issue, written
// by api/contribute when they filed it), else the author of the exploration the task links. Never an address read from
// GitHub, never one written there. A designer signed in with GitHub (kept as gh:<login>) gets nothing from Bridge in
// phase 1: GitHub tells them. Nobody hears about what they did themselves (Bridge's bot did it for them).
//
// Rules: "Things that need me" right away (default), in the daily summary, or never; "What moved" in the daily summary
// (default) or never (Account > Email, api/account action notify). Right away is at most one email per thing per hour;
// more in that hour folds into the summary. The summary is never sent empty. Without BREVO_API_KEY nothing is sent:
// notices are kept for the summary and one line says so once per warm function. Nothing here logs an address, a token
// or a payload.
//
// Keys (Upstash Redis; the email in a key or on the due list canonical, api/_lib/canonical-email.ts, so one Gmail
// mailbox gets one summary whatever its spelling; what was kept under the address lower-cased is read too):
//   bridge:notify:teams                    set of watched repositories (the team's, its products' copies and
//                                          developers' repositories), owner/name lower case; filled by api/contribute
//                                          when an email member files something or opens Studio, never expires (the
//                                          read cache's 20-minute bridge:read:known does not decide this)
//   bridge:notify:repo:<repo>              { team, kind: team|copy|code, product? }, a year
//   bridge:notify:item:<repo>:<n>          { title?, copy? } of a task or suggestion Bridge filed, a year
//   bridge:notify:digest:<email>           sorted set of kept notices (JSON, names only) by time, 30 days
//   bridge:notify:due                      sorted set of emails by when their summary is due (ms)
//   bridge:notify:soon:<email>:<repo>#<n>  "1", an hour: the last right-away email for that thing
//   bridge:notify:once:<kind>:<repo>:<n>   "1", 30 days: shipped and declined are said once per thing
//   bridge:notify:sweep                    "1", 5 minutes: one summary round at a time outside the cron
//   bridge:notify:off:<email>              { needs, news } of someone who unsubscribed with no Bridge account
//   bridge:notify:remind                   sorted set of lead reminders (JSON) by when they are due (ms)
//   bridge:notify:waiting:<repo>:<n>       the wait a reminder belongs to, 30 days: any later word ends it

import { getAccount, type Account } from './account.js';
import { brevoSender, type EmailSender } from './email.js';
import { canonicalEmail, emailSpellings } from './canonical-email.js';
import { issueKey } from './former-member.js';
import type { FetchLike } from './http.js';
import { memberStore, type MemberStore } from './members.js';
import { cleanTitle, NEEDS_KINDS, type Notice, type NotifyKind } from './notify-events.js';
import { digestEmail, instantEmail, unsubToken, type NotifyItem, type UnsubKind } from './notify-mail.js';
import type { Redis, RedisArg } from './redis.js';
import { getTeamNames } from './teams.js';
import { teamDisplayName } from '../../src/lib/demo.js';
import { STUDIO_ROOT, teamHref } from '../../src/lib/team-path.js';

// ---------------------------------------------------------------------------------------------------------------
// Preferences and time zone

export type NeedsPref = 'soon' | 'daily' | 'off';
export type NewsPref = 'daily' | 'off';
export interface NotifyPrefs {
  needs: NeedsPref;
  news: NewsPref;
}
export const DEFAULT_PREFS: NotifyPrefs = { needs: 'soon', news: 'daily' };
export const DEFAULT_TZ = 'Europe/Paris';
export const DIGEST_HOUR = 9;

/** The person's choices (Account > Email), with the defaults for what they never set. */
export function prefsOf(a: Pick<Account, 'notify'> | null | undefined): NotifyPrefs {
  const n = a?.notify;
  return {
    needs: n?.needs === 'daily' || n?.needs === 'off' || n?.needs === 'soon' ? n.needs : DEFAULT_PREFS.needs,
    news: n?.news === 'off' || n?.news === 'daily' ? n.news : DEFAULT_PREFS.news,
  };
}

/** The choices a request sends, or null when one is not a choice Bridge offers. Absent keys keep `base`. */
export function parsePrefs(body: Record<string, unknown>, base: NotifyPrefs): NotifyPrefs | null {
  const needs = body.needs === undefined ? base.needs : body.needs;
  const news = body.news === undefined ? base.news : body.news;
  if (needs !== 'soon' && needs !== 'daily' && needs !== 'off') return null;
  if (news !== 'daily' && news !== 'off') return null;
  return { needs, news };
}

/** An IANA time zone this runtime knows ("Europe/Paris"), else null. */
export function validTimeZone(v: unknown): string | null {
  if (typeof v !== 'string' || v.length > 64 || !/^[A-Za-z][A-Za-z0-9_+\-/]*$/.test(v)) return null;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: v });
    return v;
  } catch {
    return null;
  }
}

/** How far `tz` is ahead of UTC at `at` (ms). */
function offsetMs(tz: string, at: number): number {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(new Date(at));
  const n = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  const wall = Date.UTC(n('year'), n('month') - 1, n('day'), n('hour') % 24, n('minute'), n('second'));
  return wall - Math.floor(at / 1000) * 1000;
}

/** The next DIGEST_HOUR:00 in `tz` strictly after `now` (ms, UTC). */
export function nextDigestAt(now: number, tz: string = DEFAULT_TZ, hour = DIGEST_HOUR): number {
  const zone = validTimeZone(tz) ?? DEFAULT_TZ;
  const local = new Date(now + offsetMs(zone, now));
  const wall = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(), hour);
  const toUtc = (w: number) => {
    const first = w - offsetMs(zone, w);
    return w - offsetMs(zone, first);
  };
  const today = toUtc(wall);
  return today > now ? today : toUtc(wall + 24 * 60 * 60 * 1000);
}

// ---------------------------------------------------------------------------------------------------------------
// Keys and the registry of watched repositories

export const NOTIFY_TEAMS_KEY = 'bridge:notify:teams';
export const DUE_KEY = 'bridge:notify:due';
export const SWEEP_KEY = 'bridge:notify:sweep';
const lc = (s: string) => s.trim().toLowerCase();
export const repoMetaKey = (repo: string) => `bridge:notify:repo:${lc(repo)}`;
export const itemMetaKey = (repo: string, n: number | string) => `bridge:notify:item:${lc(repo)}:${n}`;
export const digestKey = (email: string) => `bridge:notify:digest:${canonicalEmail(email)}`;
const digestKeys = (email: string) => emailSpellings(email).map((e) => `bridge:notify:digest:${e}`);
export const soonKey = (email: string, repo: string, n: number) => `bridge:notify:soon:${canonicalEmail(email)}:${lc(repo)}#${n}`;
/** Lead reminders waiting: JSON notices, by when they are due (ms). */
export const REMIND_KEY = 'bridge:notify:remind';
export const waitingKey = (repo: string, n: number) => `bridge:notify:waiting:${lc(repo)}:${n}`;
export const REMIND_MS = 3 * 24 * 60 * 60 * 1000;
export const onceKey = (kind: NotifyKind, repo: string, n: number) => `bridge:notify:once:${kind}:${lc(repo)}:${n}`;
/** The choices of someone who unsubscribed without a Bridge account (an older email member). */
export const optOutKey = (email: string) => `bridge:notify:off:${canonicalEmail(email)}`;

/** The person's choices: on their account, else what an unsubscribe link kept for them, else the defaults. */
export async function prefsFor(redis: Redis, email: string, account: Account | null): Promise<NotifyPrefs> {
  if (account) return prefsOf(account);
  for (const e of emailSpellings(email)) {
    const kept = parse<NotifyPrefs>(await redis.cmd('GET', `bridge:notify:off:${e}`));
    if (kept) return prefsOf({ notify: kept });
  }
  return prefsOf(undefined);
}

export const YEAR_S = 365 * 24 * 60 * 60;
export const KEEP_S = 30 * 24 * 60 * 60;
export const SOON_S = 60 * 60;
const SWEEP_S = 5 * 60;
/** Kept notices per person: past that, the oldest go. */
export const DIGEST_MAX = 100;

export interface RepoMeta {
  /** The team the repository belongs to (owner/name, or a team key). */
  team: string;
  kind: 'team' | 'copy' | 'code';
  /** The product key (bridge.config.json products[].key), for a product's repositories. */
  product?: string;
}

export interface ItemMeta {
  title?: string;
  copy?: { repo: string; number: number };
}

/** The writes that watch these repositories for notifications (one pipeline with the caller's own writes). */
export function watchWrites(entries: readonly { repo: string; meta: RepoMeta }[]): RedisArg[][] {
  if (!entries.length) return [];
  return [
    ['SADD', NOTIFY_TEAMS_KEY, ...entries.map((e) => lc(e.repo))],
    ...entries.map((e) => ['SET', repoMetaKey(e.repo), JSON.stringify({ team: lc(e.meta.team), kind: e.meta.kind, ...(e.meta.product ? { product: e.meta.product } : {}) }), 'EX', YEAR_S]),
  ];
}

/**
 * A team leaves Bridge (api/entry delete-team): its repository, and every watched repository whose meta names it (its
 * products' copies, developers' repositories), stop being watched. Notices already kept in summaries age out.
 */
export async function unwatchTeam(redis: Redis, team: string): Promise<void> {
  const t = lc(team);
  const raw = await redis.cmd('SMEMBERS', NOTIFY_TEAMS_KEY);
  const repos = Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : [];
  const metas = repos.length ? ((await redis.cmd('MGET', ...repos.map(repoMetaKey))) as unknown[] | null) : [];
  const gone = repos.filter((r, i) => lc(r) === t || parse<RepoMeta>(metas?.[i])?.team === t);
  if (!gone.includes(t)) gone.push(t);
  await redis.pipe([['SREM', NOTIFY_TEAMS_KEY, ...gone], ...gone.map((r) => ['DEL', repoMetaKey(r)])]);
}

/** The write that keeps what a task or suggestion is called and which exploration it comes from. */
export function itemWrite(repo: string, n: number, meta: ItemMeta): RedisArg[] {
  return ['SET', itemMetaKey(repo, n), JSON.stringify(meta), 'EX', YEAR_S];
}

const parse = <T>(raw: unknown): T | null => {
  if (typeof raw !== 'string') return null;
  try {
    const v = JSON.parse(raw) as unknown;
    return v && typeof v === 'object' ? (v as T) : null;
  } catch {
    return null;
  }
};

// ---------------------------------------------------------------------------------------------------------------
// The sender

let warnedNoSender = false;
/** Tests start each case with the warning not said yet. */
export const resetNotifyWarning = () => {
  warnedNoSender = false;
};

export interface NotifyEnv {
  BREVO_API_KEY?: string | undefined;
  NOTIFY_FROM?: string | undefined;
  INVITE_EMAIL_FROM?: string | undefined;
}

/** Brevo from the env (NOTIFY_FROM, else INVITE_EMAIL_FROM, as the sender), or null: notices are kept, not sent. */
export function notifySenderFromEnv(env: NotifyEnv, f: FetchLike): EmailSender | null {
  const key = env.BREVO_API_KEY?.trim();
  const from = (env.NOTIFY_FROM ?? env.INVITE_EMAIL_FROM)?.trim();
  return key && from ? brevoSender(key, from, f) : null;
}

export interface NotifyDeps {
  redis: Redis;
  /** Null: nothing is sent, everything is kept for the summary. */
  sender: EmailSender | null;
  /** LIBRARY_SESSION_SECRET: unsubscribe links. */
  secret: string;
  /** Where links point (PUBLIC_SITE_URL, else the site that got the delivery). */
  origin: string;
  now: () => number;
  members?: MemberStore;
  /** Where "not sent" is said, once; never an address. */
  warn?: (msg: string) => void;
  random?: (n: number) => Uint8Array;
  /**
   * A GitHub person's profile name (team-read profileNameOf: Studio's kept profile, else one GitHub read with the
   * repository's read token), for someone with no Bridge account. Absent or null: their login.
   */
  profileName?: (login: string, repo: string) => Promise<string | null>;
  /** A GitHub login's id (one read): how a lead's Bridge account is found. Absent: GitHub tells them, nothing is sent. */
  loginId?: (login: string, repo: string) => Promise<number | null>;
}

function noSender(d: NotifyDeps) {
  if (d.sender || warnedNoSender) return;
  warnedNoSender = true;
  (d.warn ?? ((m: string) => console.warn(m)))('notifications: BREVO_API_KEY is not set, notifications are kept but not sent');
}

// ---------------------------------------------------------------------------------------------------------------
// Links

/** The team's Studio, absolute: the escape form of teamHref (the form that always works). */
export function teamBase(origin: string, team: string): string {
  const [o = '', r = ''] = team.split('/');
  return `${origin.replace(/\/+$/, '')}${teamHref(o, r, null)}`;
}

/** The Studio page of a notice: the exploration for a task, the change for a suggestion, else Being built. */
export function hrefOf(origin: string, team: string, kind: NotifyKind, n: number, copy: ItemMeta['copy'] | null, product: string | undefined): string {
  const base = teamBase(origin, team);
  if (kind === 'changes' || kind === 'suggestion-declined') return `${base}changes/?pr=${n}`;
  if (kind.startsWith('lead-')) return `${base}changes/?exploration=${n}${product ? `&product=${encodeURIComponent(product)}` : ''}`;
  if (copy && product) return `${base}changes/?exploration=${copy.number}&product=${encodeURIComponent(product)}`;
  return `${base}building/`;
}

function linksFor(d: NotifyDeps, email: string, kind: UnsubKind, home: string): { to: string; settings: string; unsubscribe: string } {
  const token = unsubToken(d.secret, email, kind, d.random) ?? '';
  return { to: email, settings: `${home}#account`, unsubscribe: `${d.origin.replace(/\/+$/, '')}/api/account?unsub=${encodeURIComponent(token)}` };
}

// ---------------------------------------------------------------------------------------------------------------
// Delivering notices

export type Outcome =
  | { kind: NotifyKind; status: 'sent' }
  | { kind: NotifyKind; status: 'kept'; reason?: string }
  | { kind: NotifyKind; status: 'skipped'; reason: 'unwatched' | 'not-library' | 'no-owner' | 'github' | 'not-member' | 'off' | 'repeat' | 'own' };

/** Who a notice is for: the first of its items Bridge keeps an author for, else the author of the exploration it links. */
async function ownerOf(d: NotifyDeps, n: Notice): Promise<{ owner: string; item: number; meta: ItemMeta | null } | null> {
  const reads = n.items.flatMap((i) => [['GET', issueKey(n.repo, i)], ['GET', itemMetaKey(n.repo, i)]]);
  const r = reads.length ? await d.redis.pipe(reads) : [];
  for (let i = 0; i < n.items.length; i++) {
    const meta = parse<ItemMeta>(r[i * 2 + 1]);
    const owner = r[i * 2];
    const copy = meta?.copy ?? (n.items.length === 1 ? n.copy : null);
    if (typeof owner === 'string') return { owner, item: n.items[i]!, meta: { ...meta, ...(copy ? { copy } : {}) } };
    // A task filed before Bridge kept its author: the exploration it links is theirs.
    if (copy) {
      const viaCopy = await d.redis.cmd('GET', issueKey(copy.repo, copy.number));
      if (typeof viaCopy === 'string') return { owner: viaCopy, item: n.items[i]!, meta: { ...meta, copy } };
    }
  }
  return null;
}

/**
 * The name Bridge gives the person who did it, as Studio names them: their Bridge account name when their GitHub is
 * linked to one, else their GitHub profile name, else their login.
 */
export async function actorName(d: Pick<NotifyDeps, 'redis' | 'profileName'>, a: Notice['actor'], repo: string): Promise<string> {
  if (a.id !== null) {
    const email = await d.redis.cmd('GET', `bridge:account:gh:${a.id}`);
    if (typeof email === 'string') {
      const acc = await getAccount(d.redis, email);
      const name = acc?.github?.id === a.id ? acc.name.trim() : '';
      if (name && !name.includes('@')) return name;
    }
  }
  const profile = d.profileName ? ((await d.profileName(a.login, repo).catch(() => null))?.trim() ?? '') : '';
  return profile && !profile.includes('@') ? profile : a.login;
}

/** A login's public id, one read of GitHub's public profile. */
export const publicLoginId =
  (f: FetchLike) =>
  async (login: string): Promise<number | null> => {
    if (!/^[A-Za-z0-9-]{1,39}$/.test(login)) return null;
    const res = await f(`https://api.github.com/users/${login}`, { method: 'GET', headers: { accept: 'application/vnd.github+json', 'user-agent': 'bridge' } });
    if (!res.ok) return null;
    const id = ((await res.json().catch(() => null)) as { id?: unknown } | null)?.id;
    return Number.isSafeInteger(id) ? (id as number) : null;
  };

/** The Bridge account of a GitHub login, by id: never an address read from GitHub. */
async function accountEmailOf(d: NotifyDeps, login: string, repo: string): Promise<string | null> {
  const id = d.loginId ? await d.loginId(login, repo).catch(() => null) : null;
  if (id === null) return null;
  const email = await d.redis.cmd('GET', `bridge:account:gh:${id}`);
  return typeof email === 'string' ? email : null;
}

/** One notice per lead named on it, so each is sent, kept or skipped on its own; never the person who did it. */
function perPerson(notices: readonly Notice[]): Notice[] {
  return notices.flatMap((n) => (n.to ? n.to.filter((l) => l.toLowerCase() !== n.actor.login.toLowerCase()).map((l) => ({ ...n, to: [l] })) : [n]));
}

/** What waits on a lead also reaches the leads who signed in by email (the member record says so): by address, not login. */
const LEAD_WAITS: ReadonlySet<string> = new Set(['lead-ask', 'lead-answer', 'lead-reminder']);
async function withEmailLeads(notices: Notice[], d: NotifyDeps, members: MemberStore): Promise<Notice[]> {
  const waits = notices.find((n) => LEAD_WAITS.has(n.kind));
  if (!waits) return notices;
  const repoMeta = parse<RepoMeta>(await d.redis.cmd('GET', repoMetaKey(waits.repo)));
  if (!repoMeta || typeof repoMeta.team !== 'string') return notices;
  const leads = (await members.list(repoMeta.team)).filter((m) => m.lead);
  const first = new Set<string>();
  const extra = notices.filter((n) => LEAD_WAITS.has(n.kind) && !first.has(n.kind) && first.add(n.kind)).flatMap((n) => leads.filter((m) => m.name !== n.actorName).map((m) => ({ ...n, to: [`email:${m.email}`] })));
  return [...notices, ...extra];
}

async function keep(d: NotifyDeps, email: string, item: NotifyItem, tz: string): Promise<void> {
  const now = d.now();
  await d.redis.pipe([
    ['ZADD', digestKey(email), item.at, JSON.stringify(item)],
    ['EXPIRE', digestKey(email), KEEP_S],
    ['ZADD', DUE_KEY, 'NX', nextDigestAt(now, tz), canonicalEmail(email)],
  ]);
}

/**
 * Every notice of one delivery to its designer: sent, kept for the summary, or skipped (with why, for tests; never
 * logged). `eventId` is the delivery's id: GitHub's redelivery of it was already refused by the webhook.
 */
export async function deliverNotices(notices: readonly Notice[], d: NotifyDeps, eventId: string): Promise<Outcome[]> {
  const out: Outcome[] = [];
  const members = d.members ?? memberStore(d.redis);
  // The talk with a lead: whether a reminder runs, before who hears about it. It needs no recipient.
  for (const n of notices) {
    const item = n.items[0];
    if (item === undefined) continue;
    if (n.stops) await d.redis.cmd('DEL', waitingKey(n.repo, item));
    if (n.waits) {
      const token = `${eventId}:${n.kind}`;
      await d.redis.pipe([
        ['SET', waitingKey(n.repo, item), token, 'EX', KEEP_S],
        ['ZADD', REMIND_KEY, d.now() + REMIND_MS, JSON.stringify({ token, notice: { ...n, kind: 'lead-reminder', waits: false } })],
      ]);
    }
  }
  for (const [idx, n] of (await withEmailLeads(perPerson(notices), d, members)).entries()) {
    const skip = (reason: Extract<Outcome, { status: 'skipped' }>['reason']) => out.push({ kind: n.kind, status: 'skipped', reason });
    const repoMeta = parse<RepoMeta>(await d.redis.cmd('GET', repoMetaKey(n.repo)));
    if (!repoMeta || typeof repoMeta.team !== 'string') {
      skip('unwatched');
      continue;
    }
    if (n.scope === 'library' && repoMeta.kind !== 'team') {
      skip('not-library');
      continue;
    }
    const talk = n.kind.startsWith('lead-');
    // The leads have no Bridge record on the task: their login, through their Bridge account.
    const found = n.to?.length ? { owner: n.to[0]!.startsWith('email:') ? n.to[0]!.slice(6) : `gh:${n.to[0]}`, item: n.items[0]!, meta: null } : await ownerOf(d, n);
    if (!found) {
      skip('no-owner');
      continue;
    }
    // Someone signed in with GitHub: GitHub tells them, except a talk with their lead, if they have a Bridge account.
    const login = found.owner.startsWith('gh:') ? found.owner.slice(3) : null;
    if (login && !talk) {
      skip('github');
      continue;
    }
    if (login && login.toLowerCase() === n.actor.login.toLowerCase()) {
      skip('own');
      continue;
    }
    const linked = login ? await accountEmailOf(d, login, n.repo) : null;
    if (login && !linked) {
      skip('github');
      continue;
    }
    const email = lc(linked ?? found.owner);
    if (!email.includes('@') || (!linked && !(await members.get(repoMeta.team, email)))) {
      skip('not-member');
      continue;
    }
    // Their own act, when they joined by email: the block names them, never by address.
    if (talk && n.actorName && !n.actor.login) {
      const own = await getAccount(d.redis, email);
      const m = await members.get(repoMeta.team, email);
      if ((m?.name ?? own?.name ?? '').trim().toLowerCase() === n.actorName.trim().toLowerCase()) {
        skip('own');
        continue;
      }
    }
    const account = await getAccount(d.redis, email);
    const prefs = await prefsFor(d.redis, email, account);
    const needs = NEEDS_KINDS.has(n.kind);
    if ((needs && prefs.needs === 'off') || (!needs && prefs.news === 'off')) {
      skip('off');
      continue;
    }
    // Shipped and declined are said once per thing (the task closing and the change that closes it both say it).
    if (!needs && !talk && (await d.redis.cmd('SET', onceKey(n.kind, n.repo, found.item), '1', 'NX', 'EX', KEEP_S)) === null) {
      skip('repeat');
      continue;
    }
    const names = await getTeamNames(d.redis, [repoMeta.team]).catch(() => new Map());
    const team = teamDisplayName(repoMeta.team, { name: names.get(repoMeta.team)?.name });
    const item: NotifyItem = {
      id: `${eventId}:${idx}`,
      kind: n.kind,
      // A title kept before Bridge named things the way Studio does ("add a toast alert") reads "Add a toast alert".
      title: cleanTitle(found.meta?.title) || n.title || 'Your work',
      actor: n.actorName ?? (await actorName(d, n.actor, n.repo)),
      team,
      teamRepo: repoMeta.team,
      href: hrefOf(d.origin, repoMeta.team, n.kind, found.item, found.meta?.copy ?? null, repoMeta.product),
      at: d.now(),
      ...(n.quote ? { quote: n.quote } : {}),
    };
    const tz = validTimeZone(account?.tz) ?? DEFAULT_TZ;
    let why: string | undefined;
    if (needs && prefs.needs === 'soon') {
      // At most one right-away email per thing per hour: more folds into the summary.
      const first = (await d.redis.cmd('SET', soonKey(email, n.repo, found.item), '1', 'NX', 'EX', SOON_S)) !== null;
      if (first && d.sender) {
        try {
          await d.sender.send(instantEmail(item, linksFor(d, email, 'needs', teamBase(d.origin, repoMeta.team))));
          out.push({ kind: n.kind, status: 'sent' });
          continue;
        } catch (e) {
          // Not sent: it waits in the summary. The reason (the provider's status and code) shows in the delivery.
          why = `not-sent ${e instanceof Error ? e.message.slice(0, 80) : 'error'}`;
          // A send that failed does not use up the hour: the next event on this thing tries again right away.
          await d.redis.cmd('DEL', soonKey(email, n.repo, found.item)).catch(() => null);
          console.warn(`notifications: ${why}`);
        }
      } else why = first ? 'no-sender' : 'within-the-hour';
      if (!d.sender) noSender(d);
    }
    // The summary names things, it never quotes them: what they wrote is not kept.
    const { quote: _said, ...kept } = item;
    await keep(d, email, kept, tz);
    out.push({ kind: n.kind, status: 'kept', ...(why ? { reason: why } : {}) });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// The daily summary

export interface SweepResult {
  sent: number;
  empty: number;
  /** Due but not sent (no sender, or the provider refused): due again later. */
  later: number;
}

const isItem = (v: any): v is NotifyItem => v && typeof v.id === 'string' && typeof v.kind === 'string' && typeof v.title === 'string' && typeof v.href === 'string' && typeof v.at === 'number';

/** The summary of one person, if they have anything left to read under their current choices. */
export async function digestFor(d: NotifyDeps, email: string): Promise<{ items: NotifyItem[]; raw: string[]; account: Account | null }> {
  // The canonical list and, until the person's next sign-in moves it, the one under the spelling on the due list.
  const lists = await d.redis.pipe(digestKeys(email).map((k) => ['ZRANGE', k, 0, -1]));
  const raw = lists.flatMap((l) => (Array.isArray(l) ? l.filter((x): x is string => typeof x === 'string') : []));
  const account = await getAccount(d.redis, email);
  const prefs = await prefsFor(d.redis, email, account);
  const seen = new Set<string>();
  const items = raw
    .map((r) => parse<NotifyItem>(r))
    .filter(isItem)
    .filter((i) => (NEEDS_KINDS.has(i.kind) ? prefs.needs !== 'off' : prefs.news !== 'off'))
    .filter((i) => !seen.has(i.id) && Boolean(seen.add(i.id)))
    .slice(-DIGEST_MAX);
  return { items, raw, account };
}

/**
 * Sends the summaries that are due (their 09:00 passed), at most `max` people per call. A person is taken off the due
 * list before anything is sent (ZREM answers 1 to one caller only), so two rounds never send twice. Nothing to say:
 * nothing sent.
 */
/**
 * The reminders due: each goes once, only if the lead still has not answered (the same wait is still on, by its token:
 * any later word ended it). What was due is gone from the list whatever happens: never twice.
 */
export async function sendReminders(d: NotifyDeps, max = 25): Promise<number> {
  const due = ((await d.redis.cmd('ZRANGEBYSCORE', REMIND_KEY, '-inf', d.now(), 'LIMIT', 0, max)) as string[] | null) ?? [];
  let sent = 0;
  for (const raw of due) {
    if (Number(await d.redis.cmd('ZREM', REMIND_KEY, raw)) !== 1) continue;
    const r = parse<{ token: string; notice: Notice }>(raw);
    const item = r?.notice.items[0];
    if (!r || item === undefined || (await d.redis.cmd('GET', waitingKey(r.notice.repo, item))) !== r.token) continue;
    await d.redis.cmd('DEL', waitingKey(r.notice.repo, item));
    const out = await deliverNotices([r.notice], d, `remind:${r.token}`);
    sent += out.filter((o) => o.status === 'sent').length;
  }
  return sent;
}

export async function sendDueDigests(d: NotifyDeps, max = 25): Promise<SweepResult> {
  await sendReminders(d, max).catch(() => 0);
  const res: SweepResult = { sent: 0, empty: 0, later: 0 };
  const now = d.now();
  const due = ((await d.redis.cmd('ZRANGEBYSCORE', DUE_KEY, '-inf', now, 'LIMIT', 0, max)) as string[] | null) ?? [];
  for (const email of due) {
    if (Number(await d.redis.cmd('ZREM', DUE_KEY, email)) !== 1) continue;
    const { items, raw, account } = await digestFor(d, email);
    if (!items.length) {
      if (raw.length) await d.redis.pipe(digestKeys(email).map((k) => ['DEL', k]));
      res.empty++;
      continue;
    }
    const tz = validTimeZone(account?.tz) ?? DEFAULT_TZ;
    if (!d.sender) {
      noSender(d);
      await d.redis.cmd('ZADD', DUE_KEY, 'NX', nextDigestAt(now, tz), email);
      res.later++;
      continue;
    }
    const teams = [...new Set(items.map((i) => i.teamRepo))];
    const home = teams.length === 1 ? teamBase(d.origin, teams[0]!) : `${d.origin.replace(/\/+$/, '')}${STUDIO_ROOT}`;
    const msg = digestEmail(items, { ...linksFor(d, email, 'all', home), home });
    if (!msg) continue;
    try {
      await d.sender.send(msg);
    } catch {
      // Tried again in an hour.
      await d.redis.cmd('ZADD', DUE_KEY, 'NX', now + 60 * 60 * 1000, email);
      res.later++;
      continue;
    }
    // Only what this summary said goes: anything kept while it was sent waits for the next one.
    await d.redis.pipe(digestKeys(email).map((k) => ['ZREM', k, ...raw]));
    res.sent++;
  }
  return res;
}

/** A summary round outside the cron (after a webhook delivery), at most one per 5 minutes for the whole site. */
export async function sweepSometimes(d: NotifyDeps): Promise<SweepResult | null> {
  if ((await d.redis.cmd('SET', SWEEP_KEY, '1', 'NX', 'EX', SWEEP_S)) === null) return null;
  return sendDueDigests(d, 10);
}

/** What account deletion forgets: the person's kept notices and their place on the due list. */
export function forgetWrites(email: string): RedisArg[][] {
  const spellings = emailSpellings(email);
  return [
    ...spellings.map((e) => ['DEL', `bridge:notify:digest:${e}`]),
    ...spellings.map((e) => ['DEL', `bridge:notify:off:${e}`]),
    ['ZREM', DUE_KEY, ...spellings],
  ];
}
