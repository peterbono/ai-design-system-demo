// The quota load test (docs/QUOTA-LOADTEST.md): simulated Studio sessions over a fake clock, driving the real server
// read path (api/contribute handleContribute -> api/_lib/team-read.ts onRead, onChanges, onBlobs, onUsers) with the
// in-memory Redis and a fake GitHub (fake-github.ts). Nothing here calls GitHub or Upstash.
//
// Time runs in TICK_MS steps: every request due in one step is sent together (in flight together, so the cache sees
// the same misses a real burst would), steps run one after the other. A page load sends its reads in phases
// (pages.ts), PHASE_MS apart, as the browser does once the first answers are back.

import { memoryRedis } from '../../api/_lib/redis';
import { budgetOf, clearReadMemory, countKey, noteWrite, READ_LIMITS } from '../../api/_lib/team-read';
import { type ContribDeps, cookieName, handleContribute, signSession } from '../../api/contribute/index';
import { memberStore } from '../../api/_lib/members';
import { fakeGitHub, fakeWorld, finishChecks, pushCommit, type FakeWorld } from './fake-github';
import { PAGES, type ClientRead, type PageName } from './pages';

const HOUR = 60 * 60 * 1000;
const MIN = 60 * 1000;
export const TICK_MS = 250;
export const PHASE_MS = 500;
const HOST = 'bridge.example.com';
const ORIGIN = `https://${HOST}`;
const SECRET = 's'.repeat(40);
export const T0 = Date.parse('2026-11-02T09:00:00Z');

/** A deterministic random source (mulberry32), so every run of a scenario measures the same thing. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Person {
  email: string;
  role: 'lead' | 'designer';
  /** Page loads: first at `start` ms after T0, then every `every()` ms. */
  start: number;
  every: () => number;
  /** Which page each load opens. */
  page: () => PageName;
}

export interface Scenario {
  name: string;
  label: string;
  /** Open changes on the team. */
  changes: number;
  people: Person[];
  /** Simulated length (ms). */
  duration: number;
  /** Changes updated in the run (a new commit, its checks finishing 4 min later). */
  updates: number;
  /** Share of the updates written through Bridge (noteWrite: every kept answer is revalidated at once). */
  viaBridge?: number;
  seed: number;
  env?: Record<string, string>;
  /**
   * Warm functions serving the reads, each with its own installation token (api/contribute cachedApp keeps one 30
   * minutes). Only matters with `tokenBoundEtags`. Default 1.
   */
  instances?: number;
  tokenBoundEtags?: boolean;
}

export interface Result {
  name: string;
  label: string;
  people: number;
  pageLoads: number;
  /** Reads the pages asked for (a change in a status batch is its 5 reads, a blob or a login is one). */
  reads: number;
  /** Proxy requests (gh=, changes=, blobs=, users=). */
  requests: number;
  /** Reads the person's tab answered itself (no request to Bridge). */
  tabKept: number;
  counted: number;
  free: number;
  /** Counted GitHub calls scaled to one hour. */
  countedPerHour: number;
  peakPerMinute: number;
  peakInFlight: number;
  /** Requests answered while the reader had spent READ_MAX_UPSTREAM and the answer was not fresh. */
  capHits: number;
  readersAtCap: number;
  teamBudgetHits: number;
  memberBudgetHits: number;
  busyAnswers: number;
  readersBusy: number;
  /** Changes a status batch left out (the page then reads them one by one). */
  changesLeftOut: number;
  /** Counted calls GitHub answered with an ETag it had already sent: free 304s if Bridge had kept that ETag longer. */
  unchanged: number;
  /** Counted calls made while another call for the same path was in flight (no request coalescing). */
  overlapping: number;
  /** Highest request weight one member reached in a 10 min window (READ_MAX_IP, 1,200 by default). */
  peakMemberWeight: number;
  /** Highest request weight the team reached in a 10 min window (READ_MAX_TEAM, 6,000 by default). */
  peakTeamWeight: number;
  /** 1 - counted / reads: the share of reads that cost GitHub's limit nothing. */
  hitRatio: number;
  /** Counted calls by kind of read, for the report. */
  byKind: Record<string, number>;
  /** Proxy answers by X-Bridge-Cache. */
  bySource: Record<string, number>;
}

type Job = { at: number; run: () => Promise<void> };

/** A read by sha the tab keeps 10 minutes (contribute-session.ts): trees, blobs, commits, contents at a sha. */
const BY_SHA = /\/git\/(trees|blobs|commits)\/[0-9a-f]{40}|^\/commits\/[0-9a-f]{40}$|[?&]ref=[0-9a-f]{40}/;

const kindOf = (path: string): string => {
  const p = path.replace(/^\/repos\/[^/]+\/[^/]+/, '').split('?')[0]!;
  if (p.startsWith('/users/')) return 'users';
  if (/^\/pulls\/\d+$/.test(p)) return 'pull';
  if (/^\/pulls\/\d+\//.test(p)) return `pull ${p.split('/')[3]}`;
  if (/^\/commits\/[0-9a-f]{40}\/(check-runs|status)$/.test(p)) return p.endsWith('status') ? 'commit status' : 'check-runs';
  if (p.startsWith('/git/blobs/')) return 'blobs';
  if (p.startsWith('/git/trees/')) return 'trees';
  if (p.startsWith('/contents/')) return 'contents';
  return p.split('/').slice(0, 2).join('/') || 'repo';
};

export async function runScenario(s: Scenario): Promise<Result> {
  clearReadMemory();
  const r = rng(s.seed);
  const pick = rng(s.seed + 1000);
  let now = T0;
  const world: FakeWorld = fakeWorld(s.changes);
  const gh = fakeGitHub(world, () => now, { tokenBoundEtags: s.tokenBoundEtags });
  const redis = memoryRedis(() => now);
  const deps: ContribDeps = {
    fetch: gh.fetch,
    now: () => now,
    redis,
    app: {
      // One token per warm function and per 30 minutes (api/contribute cachedApp); requests land on any of them.
      installationToken: async () => {
        return `ghs_read_${Math.floor(pick() * (s.instances ?? 1))}_${Math.floor((now - T0) / (30 * 60 * 1000))}`;
      },
    },
  };
  const env = { LIBRARY_SESSION_SECRET: SECRET, ...(s.env ?? {}) };
  const team = `${world.owner}/${world.repo}`;
  const members = memberStore(redis);
  const cookies = new Map<string, string>();
  for (const p of s.people) {
    await members.put(team, { email: p.email, name: p.email.split('@')[0]!, role: p.role === 'lead' ? 'admin' : 'edit', version: 1, addedBy: 'dana', at: new Date(now).toISOString() });
    cookies.set(p.email, `${cookieName(team)}=${signSession({ repo: team, email: p.email, name: p.email.split('@')[0]!, v: 1, exp: now + 1e10 }, SECRET)}`);
  }
  const upLimit = Number(s.env?.READ_MAX_UPSTREAM ?? READ_LIMITS.upstream);
  const teamLimit = Number(s.env?.READ_MAX_TEAM ?? READ_LIMITS.team);

  const res: Result = {
    name: s.name,
    label: s.label,
    people: s.people.length,
    pageLoads: 0,
    reads: 0,
    requests: 0,
    tabKept: 0,
    counted: 0,
    free: 0,
    countedPerHour: 0,
    peakPerMinute: 0,
    peakInFlight: 0,
    capHits: 0,
    readersAtCap: 0,
    teamBudgetHits: 0,
    memberBudgetHits: 0,
    busyAnswers: 0,
    readersBusy: 0,
    changesLeftOut: 0,
    unchanged: 0,
    overlapping: 0,
    peakMemberWeight: 0,
    peakTeamWeight: 0,
    hitRatio: 0,
    byKind: {},
    bySource: {},
  };
  const tabs = new Map<string, Map<string, number>>();
  const atCap = new Set<string>();
  const sawBusy = new Set<string>();

  const req = (email: string, query: string, headers: Record<string, string> = {}) =>
    new Request(`${ORIGIN}/api/contribute?repo=${encodeURIComponent(team)}&${query}`, { headers: { host: HOST, 'x-real-ip': '198.51.100.7', cookie: cookies.get(email)!, ...headers } });

  /** One read the page asks for, through the real handler; the follow-ups it implies (a change left out) come back. */
  const send = async (email: string, read: ClientRead): Promise<ClientRead[]> => {
    // The person's tab keeps answers (and shares a read in flight): scripts/contribute-session.ts. The status batch
    // is never shared (prefetchChangeStatuses), so the badge's and the page's both go out.
    if (!read.changes) {
      const tab = tabs.get(email) ?? new Map<string, number>();
      tabs.set(email, tab);
      const key = JSON.stringify([read.repo, read.gh, read.users]);
      if ((tab.get(key) ?? 0) > now) {
        res.tabKept += 1;
        return [];
      }
      tab.set(key, now + (read.keep ?? (read.gh !== undefined && BY_SHA.test(read.gh) ? 10 * MIN : 20 * 1000)));
    }
    let q: string;
    if (read.gh !== undefined) q = `gh=${encodeURIComponent(`/repos/${read.repo ?? team}${read.gh}`)}`;
    else if (read.changes) q = `changes=${read.changes.map((c) => `${c.number}:${c.sha}`).join(',')}`;
    else if (read.blobs) q = `blobs=${read.blobs.join(',')}`;
    else q = `users=${read.users!.join(',')}`;
    res.requests += 1;
    res.reads += read.changes ? read.changes.length * 5 : (read.blobs?.length ?? read.users?.length ?? 1);
    const request = req(email, q, read.headers);
    const upKey = countKey('up', budgetOf(request, { kind: 'member', email }).who, now);
    const spentBefore = Number(await redis.cmd('GET', upKey)) || 0;
    const answer = await handleContribute(request, env, deps);
    const who = budgetOf(request, { kind: 'member', email }).who;
    const [mine, all] = (await redis.pipe([['GET', countKey('member', who, now)], ['GET', countKey('team', team.toLowerCase(), now)]])).map((x) => Number(x) || 0);
    res.peakMemberWeight = Math.max(res.peakMemberWeight, mine!);
    res.peakTeamWeight = Math.max(res.peakTeamWeight, all!);
    const source = answer.headers.get('x-bridge-cache') ?? (read.gh !== undefined ? String(answer.status) : 'batch');
    res.bySource[source] = (res.bySource[source] ?? 0) + 1;
    if (spentBefore >= upLimit) {
      atCap.add(email);
      if (source !== 'hit') res.capHits += 1;
    }
    if (answer.status === 429) {
      res.busyAnswers += 1;
      sawBusy.add(email);
      const teamCount = Number(await redis.cmd('GET', countKey('team', team.toLowerCase(), now))) || 0;
      if (teamCount > teamLimit) res.teamBudgetHits += 1;
      else if (spentBefore < upLimit) res.memberBudgetHits += 1;
      return [];
    }
    if (read.changes && answer.status === 200) {
      const body = (await answer.json()) as { changes: Record<string, unknown> };
      const missing = read.changes.filter((c) => !body.changes[c.number]);
      res.changesLeftOut += missing.length;
      if (missing.length) sawBusy.add(email);
      // scripts/pr-status.ts: a change the batch left out is read on its own (its five reads).
      return missing.flatMap((c) => changeReadsOf(c));
    }
    await answer.arrayBuffer();
    return [];
  };

  // The schedule: page loads, then the world's updates.
  const jobs: Job[] = [];
  for (const p of s.people) {
    let load = 0;
    for (let t = p.start; t < s.duration; t += p.every()) {
      const page = p.page();
      const at = T0 + t;
      const ctx = { role: p.role, team, load: load++ };
      jobs.push({
        at,
        run: async () => {
          res.pageLoads += 1;
          const phases = PAGES[page](world, ctx);
          phases.forEach((reads, k) => {
            const run = async () => {
              const follow = (await Promise.all(reads.map((x) => send(p.email, x)))).flat();
              if (follow.length) queue({ at: now + PHASE_MS, run: async () => void (await Promise.all(follow.map((x) => send(p.email, x)))) });
            };
            if (k === 0) queue({ at, run });
            else queue({ at: at + k * PHASE_MS, run });
          });
        },
      });
    }
  }
  for (let i = 0; i < s.updates; i++) {
    const at = T0 + Math.floor(((i + 0.5) / s.updates) * s.duration);
    const c = world.changes[Math.floor(r() * world.changes.length)];
    if (!c) continue;
    const viaBridge = r() < (s.viaBridge ?? 0.5);
    jobs.push({
      at,
      run: async () => {
        pushCommit(world, c.number, i + 1);
        // A write through Bridge marks the team (api/contribute noteWrite): kept answers are revalidated at once.
        if (viaBridge) await noteWrite(redis, team, now);
      },
    });
    jobs.push({ at: at + 4 * 60 * 1000, run: async () => finishChecks(world, c.number) });
  }

  // A tiny event loop over the fake clock: every job due in one tick runs together.
  const pending: Job[] = [];
  const queue = (j: Job) => pending.push(j);
  jobs.forEach(queue);
  const minute = new Map<number, number>();
  while (pending.length) {
    pending.sort((a, b) => a.at - b.at);
    const tick = Math.floor(pending[0]!.at / TICK_MS) * TICK_MS;
    now = Math.max(now, tick);
    const due: Job[] = [];
    while (pending.length && pending[0]!.at < tick + TICK_MS) due.push(pending.shift()!);
    const before = gh.calls.length;
    await Promise.all(due.map((j) => j.run()));
    for (const c of gh.calls.slice(before)) {
      if (c.kind !== 'counted') continue;
      const m = Math.floor((c.at - T0) / 60000);
      minute.set(m, (minute.get(m) ?? 0) + 1);
    }
  }

  for (const c of gh.calls) {
    if (c.kind === 'counted') {
      res.counted += 1;
      if (c.unchanged) res.unchanged += 1;
      if (c.overlapping) res.overlapping += 1;
      const k = kindOf(c.path);
      res.byKind[k] = (res.byKind[k] ?? 0) + 1;
    } else res.free += 1;
  }
  res.countedPerHour = Math.round((res.counted * 3600000) / s.duration);
  res.peakPerMinute = Math.max(0, ...minute.values());
  res.peakInFlight = gh.peak();
  res.readersAtCap = atCap.size;
  res.readersBusy = sawBusy.size;
  res.hitRatio = res.reads ? 1 - res.counted / res.reads : 1;
  return res;
}

/** The five reads of one change's status, as scripts/pr-status.ts pullStatus asks them alone. */
export function changeReadsOf(c: { number: number; sha: string }): ClientRead[] {
  return [`/pulls/${c.number}`, `/pulls/${c.number}/reviews?per_page=100`, `/pulls/${c.number}/files?per_page=100`, `/commits/${c.sha}/check-runs?per_page=100`, `/commits/${c.sha}/status`].map((gh) => ({ gh }));
}

// ---------------------------------------------------------------------------------------------------------------
// The scenarios of docs/QUOTA-LOADTEST.md

/** A mixed-pages person: Home most often, then Changes, a change, Being built, a product, the Library. */
function mixed(r: () => number, role: 'lead' | 'designer'): () => PageName {
  const lead: [PageName, number][] = [['home', 0.3], ['changes', 0.2], ['change', 0.3], ['building', 0.1], ['product', 0.05], ['library', 0.05]];
  const designer: [PageName, number][] = [['home', 0.3], ['changes', 0.1], ['change', 0.15], ['building', 0.1], ['product', 0.1], ['library', 0.25]];
  const table = role === 'lead' ? lead : designer;
  return () => {
    let x = r();
    for (const [p, w] of table) if ((x -= w) < 0) return p;
    return 'home';
  };
}

function team(r: () => number, designers: number, leads: number, minEvery: number, maxEvery: number): Person[] {
  const out: Person[] = [];
  const add = (role: 'lead' | 'designer', i: number) =>
    out.push({ email: `${role}-${i}@acme.design`, role, start: Math.floor(r() * maxEvery), every: () => Math.floor(minEvery + r() * (maxEvery - minEvery)), page: mixed(r, role) });
  for (let i = 0; i < leads; i++) add('lead', i);
  for (let i = 0; i < designers; i++) add('designer', i);
  return out;
}

export function scenarios(o: { duration?: number } = {}): Scenario[] {
  const duration = o.duration ?? HOUR;
  const scale = duration / HOUR;
  const b = rng(2);
  const c = rng(3);
  const d = rng(4);
  const out: Scenario[] = [
    {
      name: 'A',
      label: '1 lead, 10 open changes, a load every 2 min',
      changes: 10,
      people: [{ email: 'lead-0@acme.design', role: 'lead' as const, start: 0, every: () => 2 * MIN, page: (() => { const order: PageName[] = ['home', 'changes', 'change', 'building', 'product', 'library']; let i = 0; return () => order[i++ % order.length]!; })() }],
      duration,
      updates: Math.round(5 * scale),
      seed: 11,
    },
    { name: 'B', label: '10 designers + 2 leads, mixed pages, a load every 1 to 3 min, 5 updates an hour', changes: 10, people: team(b, 10, 2, MIN, 3 * MIN), duration, updates: Math.round(5 * scale), seed: 12 },
    { name: 'C', label: '50 designers + 5 leads, same rates', changes: 20, people: team(c, 50, 5, MIN, 3 * MIN), duration, updates: Math.round(5 * scale), seed: 13 },
    // C again with the team budget out of the way: what the same people ask of GitHub when nobody is turned away.
    { name: 'C2', label: 'C with READ_MAX_TEAM lifted (the demand)', changes: 20, people: team(rng(3), 50, 5, MIN, 3 * MIN), duration, updates: Math.round(5 * scale), seed: 13, env: { READ_MAX_TEAM: '100000000' } },
    // C2 if GitHub's ETags were bound to the token: 4 warm functions, a new token each 30 minutes.
    { name: 'C3', label: 'C2 with token-bound ETags, 4 warm functions', changes: 20, people: team(rng(3), 50, 5, MIN, 3 * MIN), duration, updates: Math.round(5 * scale), seed: 13, env: { READ_MAX_TEAM: '100000000' }, instances: 4, tokenBoundEtags: true },
    {
      name: 'D',
      label: 'Burst: 50 people open Home within 1 minute',
      changes: 20,
      people: Array.from({ length: 50 }, (_, i) => ({ email: `p-${i}@acme.design`, role: (i < 5 ? 'lead' : 'designer') as 'lead' | 'designer', start: Math.floor(d() * MIN), every: () => HOUR * 10, page: () => 'home' as PageName })),
      duration: 2 * MIN,
      updates: 0,
      seed: 14,
    },
  ];
  return out;
}
