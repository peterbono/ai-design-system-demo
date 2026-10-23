// Guest reads (a signed-out visitor of a team's hosted Studio, /studio/<owner>/<repo>/...). GitHub gives an address 60
// API requests an hour, about three page views of a busy team. Two things keep a guest under it:
//
// 1. The team's activity.json (core activity.ts), published by the bridge-data workflow next to snapshot.json and read
//    once per page from the raw host, which costs no API request. While it is younger than ACTIVITY_MAX_AGE_MS, every
//    GitHub GET it recorded is answered from it before any network (studioFetch and ghGet in github-session.ts ask
//    guestAnswer first), so Home, Branches, a branch, Review, History, suggestions and requests make no API call.
//    Older, it is kept for one case: GitHub refuses a read for the hourly limit, and the recorded answer stands in.
// 2. For any public repository, with or without activity: an anonymous GET answered in the last ANON_FRESH_MS is
//    served again from this tab (sessionStorage) instead of asking GitHub, so moving between pages does not read the
//    repository, its default branch and its open pull requests again. Signed in, nothing here applies: reads are live.
//
// Never imports github-session (it imports this).
import { ACTIVITY_MAX_BYTES, activityAnswer, activityIsUsable, activityRawUrl, parseActivity, type HistoryReport, type RepoActivity } from '@bridge-ds/core';
import { isHosted, pageTeamFromPath } from '../lib/team-path';
import { libraryFromPath } from '../lib/library-shells';

/** The team in the address (a Studio or Library team page), null elsewhere. */
const pageTeam = (): { owner: string; repo: string } | null => (typeof location === 'undefined' ? null : (pageTeamFromPath(location.pathname, isHosted()) ?? libraryFromPath(location.pathname)));

export interface GuestActivity {
  activity: RepoActivity;
  /** Young enough to answer before the network (else only when GitHub refuses for the limit). */
  fresh: boolean;
}

let reading: Promise<GuestActivity | null> | null = null;
const listeners = new Set<(g: GuestActivity | null) => void>();

/**
 * The team's activity for this page, read once from the raw host. Null off a team page, when the team publishes none,
 * or when it is another repository's (a fork keeps its parent's bridge-data branch). Never rejects.
 */
export function guestActivity(): Promise<GuestActivity | null> {
  reading ??= (async () => {
    const team = pageTeam();
    if (!team) return null;
    try {
      const res = await fetch(activityRawUrl(team.owner, team.repo));
      if (!res.ok) return null;
      const text = await res.text();
      if (text.length > ACTIVITY_MAX_BYTES * 2) return null;
      const activity = parseActivity(text);
      const own = activity.repo.owner.toLowerCase() === team.owner.toLowerCase() && activity.repo.name.toLowerCase() === team.repo.toLowerCase();
      if (!own) return null;
      return { activity, fresh: activityIsUsable(activity, team) };
    } catch {
      return null;
    }
  })();
  void reading.then((g) => listeners.forEach((fn) => fn(g)));
  return reading;
}

/** Hears when the activity is known (at once when it already is). Returns the way to stop. */
export function onGuestActivity(fn: (g: GuestActivity | null) => void): () => void {
  listeners.add(fn);
  if (reading) void reading.then(fn);
  return () => listeners.delete(fn);
}

/** Set once a page answered a read from the activity: the guest banner then says how recent it is. */
let used: RepoActivity | null = null;
const usedListeners = new Set<(a: RepoActivity) => void>();
/** Hears the first read answered from the activity on this page. */
export function onActivityUsed(fn: (a: RepoActivity) => void): () => void {
  if (used) fn(used);
  usedListeners.add(fn);
  return () => usedListeners.delete(fn);
}
function markUsed(a: RepoActivity) {
  if (used) return;
  used = a;
  usedListeners.forEach((fn) => fn(a));
}

const json = (status: number, body: unknown, source: string) =>
  new Response(status === 204 ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'X-Bridge-Source': source } });

/**
 * The recorded answer to an anonymous GitHub GET, as a Response, or null (read it live). `limited`: GitHub just
 * refused it for the hourly limit, so an older activity answers too.
 */
export async function guestAnswer(url: string, opts: { limited?: boolean } = {}): Promise<Response | null> {
  const g = await guestActivity();
  if (!g || !(g.fresh || opts.limited)) return null;
  const hit = activityAnswer(g.activity, url);
  if (!hit) return null;
  markUsed(g.activity);
  return json(hit.status, hit.body, 'activity');
}

/**
 * The token history the team's CI published, whatever the activity's age (older history is still history), or null
 * when there is none: the History view then says to sign in.
 */
export async function guestHistory(): Promise<HistoryReport | null> {
  const g = await guestActivity();
  if (!g?.activity.history) return null;
  markUsed(g.activity);
  return g.activity.history;
}

/** Exposed for tests: forgets the activity read by this page. */
export function resetGuestActivity() {
  reading = null;
  used = null;
}

// --- Anonymous reads kept in this tab ------------------------------------------------------------------------------

/** An anonymous answer younger than this is served again instead of asking GitHub. */
export const ANON_FRESH_MS = 2 * 60 * 1000;
const ANON_PREFIX = 'bridge.gh.anon:';
/** Bodies above this are not kept (whole-repository trees): the in-flight share still applies. */
const ANON_MAX_CHARS = 200_000;
const ANON_MAX_ENTRIES = 80;

interface Kept {
  at: number;
  status: number;
  body: string;
}

interface Limited {
  limited: true;
  reset: string | null;
}

const memory = new Map<string, Kept>();
const inflight = new Map<string, Promise<Kept | Limited>>();

function readKept(key: string): Kept | undefined {
  const m = memory.get(key);
  if (m) return m;
  try {
    const raw = sessionStorage.getItem(ANON_PREFIX + key);
    return raw ? (JSON.parse(raw) as Kept) : undefined;
  } catch {
    return undefined;
  }
}

function keep(key: string, k: Kept) {
  memory.set(key, k);
  if (k.body.length > ANON_MAX_CHARS) return;
  try {
    const keys = Object.keys(sessionStorage).filter((x) => x.startsWith(ANON_PREFIX));
    if (keys.length >= ANON_MAX_ENTRIES) {
      const oldest = keys
        .map((x) => [x, (JSON.parse(sessionStorage.getItem(x) ?? '{}') as Partial<Kept>).at ?? 0] as const)
        .sort((a, b) => a[1] - b[1])
        .slice(0, keys.length - ANON_MAX_ENTRIES + 1);
      for (const [x] of oldest) sessionStorage.removeItem(x);
    }
    sessionStorage.setItem(ANON_PREFIX + key, JSON.stringify(k));
  } catch {
    /* storage full or blocked: this page keeps it in memory */
  }
}

const rateLimited = (res: Response) => (res.status === 403 || res.status === 429) && res.headers.get('x-ratelimit-remaining') === '0';
const respond = (k: Kept, source: string) => new Response(k.status === 204 ? null : k.body, { status: k.status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'X-Bridge-Source': source } });

/**
 * An anonymous GitHub API GET for a guest: the activity first, then this tab's recent answer, then GitHub, with one
 * request for identical reads in flight. A read GitHub refuses for the limit falls back to the activity (any age),
 * then to the last answer this tab kept. `accept` is part of the key (raw media type reads differ).
 */
export async function guestFetch(url: string, accept: string, doFetch: () => Promise<Response>): Promise<Response> {
  const fromActivity = await guestAnswer(url);
  if (fromActivity) return fromActivity;
  const key = `${accept} ${url}`;
  const kept = readKept(key);
  if (kept && Date.now() - kept.at < ANON_FRESH_MS) return respond(kept, 'tab');
  let p = inflight.get(key);
  if (!p) {
    p = (async (): Promise<Kept | Limited> => {
      const res = await doFetch();
      if (rateLimited(res)) return { limited: true, reset: res.headers.get('x-ratelimit-reset') };
      const k = { at: Date.now(), status: res.status, body: await res.text() };
      // Only answers worth serving again: a success, or a 404 (a missing file stays missing for two minutes).
      if (res.status === 200 || res.status === 404) keep(key, k);
      return k;
    })();
    inflight.set(key, p);
    void p.finally(() => inflight.delete(key)).catch(() => undefined);
  }
  let got: Kept | Limited;
  try {
    got = await p;
  } catch (err) {
    // Offline: the last answer this tab kept, whatever its age.
    if (kept) return respond(kept, 'tab');
    throw err;
  }
  if (!('limited' in got)) return respond(got, 'github');
  // GitHub refused for the hourly limit: the activity whatever its age, else what this tab kept, else the refusal.
  const late = await guestAnswer(url, { limited: true });
  if (late) return late;
  if (kept) return respond(kept, 'tab');
  return new Response(JSON.stringify({ message: 'API rate limit exceeded' }), {
    status: 403,
    headers: { 'Content-Type': 'application/json', 'x-ratelimit-remaining': '0', ...(got.reset ? { 'x-ratelimit-reset': got.reset } : {}) },
  });
}

/** Forgets the reads kept in this tab (sign-in: the next reads are the signed-in visitor's). */
export function clearGuestReads() {
  memory.clear();
  try {
    for (const k of Object.keys(sessionStorage)) if (k.startsWith(ANON_PREFIX)) sessionStorage.removeItem(k);
  } catch {
    /* storage blocked */
  }
}
