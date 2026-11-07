// POST /api/github-webhook (vercel.json rewrites it to /api/contribute?hook=github, so it adds no function): the
// webhook of the Bridge GitHub App (docs/HOSTED.md, "Changes pushed by GitHub"). GitHub says what changed in a
// repository; Bridge notes it on the shared read cache (api/_lib/team-read.ts), so the team's next read of that topic
// asks GitHub again (with the kept ETag) and everything else stays fresh much longer (HOOK_FRESH_MS) while deliveries
// arrive. GitHub is then read when something changed, not every 30 seconds per viewer.
//
// Policy:
//   - only GitHub: X-Hub-Signature-256 (HMAC SHA-256 of the raw body with GITHUB_WEBHOOK_SECRET), checked in constant
//     time before anything is parsed; unsigned or wrong answers 401 and does nothing. No secret set: 503.
//   - once: X-GitHub-Delivery is kept DELIVERY_KEEP_S (SET NX), a delivery seen again answers 200 and does nothing.
//   - only what Bridge keeps: a repository with no answer kept (bridge:read:known:<repo>) is ignored (200, no write).
//   - fast: two Redis round trips, no GitHub call, nothing of the payload logged or stored but the event's facts
//     (repository names, installation id, a time).
//   - notifications (api/_lib/notify.ts): in the same first round trip, whether the repository is watched for designers
//     who joined by email (bridge:notify:teams, not the 20-minute read cache) and whether a daily summary is due. A
//     watched delivery goes through notifyEventsOf (pure) and deliverNotices (who it is for, sent or kept): only
//     names and titles are kept, never a comment body (its start is quoted in a right-away email, then dropped). The
//     one GitHub call it may make: the profile name of someone Bridge has no name for, kept a day like Studio's.
//     Once per delivery id, like everything else here. A failure there never fails the delivery.
//
// Keys (besides those of team-read.ts it writes: bridge:read:changed, bridge:read:hook:last, bridge:read:hook:inst):
//   bridge:hook:delivery:<X-GitHub-Delivery>   "1", DELIVERY_KEEP_S

import { createHmac, timingSafeEqual } from 'node:crypto';
import { SECURITY_HEADERS, json, siteOrigin } from './http.js';
import { notifyEventsOf } from './notify-events.js';
import { deliverNotices, DUE_KEY, NOTIFY_TEAMS_KEY, sweepSometimes, type NotifyDeps } from './notify.js';
import type { Redis, RedisArg } from './redis.js';
import { HOOK_HEALTHY_MS, HOOK_LAST_KEY, READ_TOPICS, changedWrites, hookInstallationKey, knownKey, productsKey, type ReadTopic } from './team-read.js';

/** GitHub sends at most 25 MB; a Vercel function takes 4.5 MB. A bigger delivery is refused before it is read. */
export const MAX_HOOK_BYTES = 4_500_000;
export const DELIVERY_KEEP_S = 24 * 60 * 60;
/** Repositories looked at per delivery (an installation event lists them all). */
export const MAX_HOOK_REPOS = 100;
const INSTALLATION_KEEP_S = 7 * 24 * 60 * 60;

export const deliveryKey = (id: string) => `bridge:hook:delivery:${id}`;

const DELIVERY = /^[0-9A-Za-z-]{1,64}$/;
const EVENT = /^[a-z_]{1,64}$/;
/** owner/name as GitHub names them; never `.` or `..` as a part. */
const REPO_FULL = /^(?!\.\.?\/)[\w.-]+\/(?!\.\.?$)[\w.-]+$/;

export interface WebhookDeps {
  /** Null: storage is not set up (503). */
  redis: Redis | null;
  secret: string | undefined;
  now: () => number;
  /**
   * Notifications (api/_lib/notify.ts): the sender (null: kept, not sent), LIBRARY_SESSION_SECRET for unsubscribe
   * links and PUBLIC_SITE_URL for links. Absent: deliveries only move the read cache.
   */
  notify?: Pick<NotifyDeps, 'sender' | 'secret' | 'warn' | 'members' | 'random' | 'profileName' | 'loginId'> & { publicUrl?: string | undefined };
  /** The lead guard (api/_lib/lead-guard.ts): a lead's words written on GitHub by someone who may not decide go back. */
  guard?: (event: string, payload: unknown) => Promise<boolean>;
}

/** Whether `signature` (the X-Hub-Signature-256 header, "sha256=<hex>") is GitHub's for `body` with `secret`. */
export function signatureValid(secret: string, body: Buffer, signature: string | null): boolean {
  const m = /^sha256=([0-9a-f]{64})$/i.exec(signature?.trim() ?? '');
  if (!m || !secret) return false;
  const want = createHmac('sha256', secret).update(body).digest();
  return timingSafeEqual(want, Buffer.from(m[1]!, 'hex'));
}

/** What one event changed: the repositories ("owner/name", lower case), their topics, and whether bridge.config.json may have. */
export interface HookEffect {
  repos: string[];
  topics: ReadTopic[];
  /** A push to the default branch: the team's product list (bridge:read:products) is read again. */
  config: boolean;
}

const EVENT_TOPICS: Record<string, readonly ReadTopic[]> = {
  // A push moves branches and files, and the files and commits of the open changes on that branch.
  push: ['code', 'pulls'],
  create: ['code'],
  delete: ['code', 'pulls'],
  // A pull request is also an issue in GitHub's lists.
  pull_request: ['pulls', 'issues'],
  pull_request_review: ['pulls'],
  pull_request_review_comment: ['pulls'],
  pull_request_review_thread: ['pulls'],
  // A check run moves often: only the checks. A finished suite or a commit status also moves a change's mergeable state.
  check_run: ['checks'],
  check_suite: ['checks', 'pulls'],
  status: ['checks', 'pulls'],
  deployment: ['deployments'],
  deployment_status: ['deployments'],
  issues: ['issues'],
  issue_comment: ['issues', 'pulls'],
  label: ['issues', 'pulls'],
  release: ['releases', 'code'],
  // Renamed, made private or public, archived, moved: everything Bridge kept of it.
  repository: READ_TOPICS,
  installation: READ_TOPICS,
  installation_repositories: READ_TOPICS,
};

const fullName = (r: unknown): string | null => {
  const n = r && typeof r === 'object' ? (r as { full_name?: unknown }).full_name : null;
  return typeof n === 'string' && REPO_FULL.test(n) ? n.toLowerCase() : null;
};

/** What `event` with `payload` changed in Bridge's cache (no repository: nothing, the delivery only proves the hook works). */
export function effectOf(event: string, payload: unknown): HookEffect {
  const p = (payload && typeof payload === 'object' ? payload : {}) as Record<string, unknown>;
  const topics = EVENT_TOPICS[event];
  if (!topics) return { repos: [], topics: [], config: false };
  const list = (v: unknown) => (Array.isArray(v) ? v.map(fullName) : []);
  const repos =
    event === 'installation' || event === 'installation_repositories'
      ? [...list(p.repositories), ...list(p.repositories_added), ...list(p.repositories_removed)]
      : [fullName(p.repository)];
  const repository = (p.repository ?? {}) as { default_branch?: unknown };
  const config = event === 'push' && typeof repository.default_branch === 'string' && p.ref === `refs/heads/${repository.default_branch}`;
  return { repos: [...new Set(repos.filter((r): r is string => r !== null))].slice(0, MAX_HOOK_REPOS), topics: [...topics], config };
}

const done = (body: Record<string, unknown>) => json(200, body, { 'Cache-Control': 'no-store' });

/** One delivery of the Bridge GitHub App's webhook. */
export async function handleGithubWebhook(req: Request, d: WebhookDeps): Promise<Response> {
  if (req.method.toUpperCase() !== 'POST') return new Response(null, { status: 405, headers: { ...SECURITY_HEADERS, Allow: 'POST' } });
  const secret = d.secret?.trim() ?? '';
  if (!secret || !d.redis) return json(503, { error: 'not_configured', message: 'Bridge does not take GitHub webhooks here yet.' });
  if (Number(req.headers.get('content-length') ?? 0) > MAX_HOOK_BYTES) return json(413, { error: 'too_large', message: 'This delivery is too large.' });
  const body = Buffer.from(await req.arrayBuffer());
  if (body.length > MAX_HOOK_BYTES) return json(413, { error: 'too_large', message: 'This delivery is too large.' });
  // Nothing is parsed or stored before the signature holds.
  if (!signatureValid(secret, body, req.headers.get('x-hub-signature-256'))) return json(401, { error: 'signature', message: 'This delivery is not signed by GitHub.' });

  const delivery = req.headers.get('x-github-delivery')?.trim() ?? '';
  const event = req.headers.get('x-github-event')?.trim() ?? '';
  if (!DELIVERY.test(delivery) || !EVENT.test(event)) return json(400, { error: 'bad_request', message: 'A delivery needs X-GitHub-Delivery and X-GitHub-Event.' });
  let payload: unknown;
  try {
    const text = body.toString('utf8');
    // A webhook set to application/x-www-form-urlencoded sends the JSON as `payload`.
    payload = JSON.parse((req.headers.get('content-type') ?? '').includes('x-www-form-urlencoded') ? (new URLSearchParams(text).get('payload') ?? '') : text);
  } catch {
    return json(400, { error: 'bad_request', message: 'A delivery is JSON.' });
  }

  const now = d.now();
  const installation = (payload as { installation?: { id?: unknown } } | null)?.installation?.id;
  const effect = effectOf(event, payload);
  // What it means for designers who joined by email (notifications): only for a repository Bridge watches for them.
  const notices = d.notify ? notifyEventsOf(event, payload) : [];
  const watch = notices[0]?.repo ?? null;
  // One round trip: seen before?, the webhooks are alive, watched for notifications?, and which repositories Bridge
  // keeps answers of.
  const first: RedisArg[][] = [
    ['SET', deliveryKey(delivery), '1', 'NX', 'EX', DELIVERY_KEEP_S],
    ['SET', HOOK_LAST_KEY, String(now), 'EX', Math.ceil(HOOK_HEALTHY_MS / 1000)],
    ...(Number.isSafeInteger(installation) && (installation as number) > 0 ? [['SET', hookInstallationKey(installation as number), String(now), 'EX', INSTALLATION_KEEP_S]] : []),
  ];
  // Notifications: is the repository watched, and is a daily summary due somewhere (the deliveries are the clock between
  // two crons)?
  const watchAt = watch ? first.push(['SISMEMBER', NOTIFY_TEAMS_KEY, watch]) - 1 : -1;
  const dueAt = d.notify ? first.push(['ZRANGEBYSCORE', DUE_KEY, '-inf', now, 'LIMIT', 0, 1]) - 1 : -1;
  const at = first.length;
  first.push(...effect.repos.map((r) => ['GET', knownKey(r)]));
  const r = await d.redis.pipe(first);
  if (r[0] === null) return done({ ok: true, duplicate: true });
  // Never in the way of the rest: a guard that fails leaves the description as it is.
  const guarded = d.guard ? await d.guard(event, payload).catch(() => false) : false;
  let notified: number | null = null;
  // What became of each notice (kind, status, reason): words only, never an address, so GitHub's Recent Deliveries
  // tell why a designer got nothing.
  let outcomes: string[] = [];
  if (d.notify) {
    const nd: NotifyDeps = { ...d.notify, redis: d.redis, now: d.now, origin: siteOrigin(req, d.notify.publicUrl) };
    // Never in the way of the read cache: a notification that fails is lost, the delivery still answers.
    try {
      if (watchAt >= 0 && Number(r[watchAt]) === 1) {
        const out = await deliverNotices(notices, nd, delivery);
        notified = out.length;
        outcomes = out.map((o) => [o.kind, o.status, 'reason' in o ? o.reason : ''].filter(Boolean).join(':'));
      } else if (notices.length) outcomes = notices.map((n) => `${n.kind}:skipped:unwatched`);
      if (Array.isArray(r[dueAt]) && (r[dueAt] as unknown[]).length) await sweepSometimes(nd);
    } catch {
      console.warn('notifications: a delivery could not be turned into notifications');
    }
  }
  const extra = { ...(notified !== null ? { notices: notified } : {}), ...(outcomes.length ? { outcomes } : {}), ...(guarded ? { guarded: true } : {}) };
  const known = effect.repos.filter((_, i) => r[at + i] !== null && r[at + i] !== undefined);
  if (!known.length || !effect.topics.length) return done({ ok: true, ignored: true, ...extra });

  const writes = known.flatMap((repo) => [...changedWrites(repo, effect.topics, now), ...(effect.config ? [['DEL', productsKey(repo)]] : [])]);
  try {
    await d.redis.pipe(writes);
  } catch (e) {
    // Let GitHub's redelivery do the work again.
    await d.redis.cmd('DEL', deliveryKey(delivery)).catch(() => undefined);
    throw e;
  }
  return done({ ok: true, repos: known.length, topics: effect.topics, ...extra });
}
