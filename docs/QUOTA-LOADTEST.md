# GitHub quota load test

Is Bridge's server read path robust enough for an enterprise team, measured against GitHub's API limits? This page
holds the measured answer (2026-11-02, main at 73db3753, after #763, #764 and #765) and how to run it again.

## Verdict

GitHub's quota is not the bottleneck; Bridge's own team budget is.

- With the shared cache, 55 people (50 designers and 5 leads, a page load every 1 to 3 minutes) cost the installation
  **495 counted GitHub calls an hour, 9.9 % of the 5,000 baseline**. 99.8 % of the reads that reach Bridge are
  answered from the cache or by a free 304.
- The same 55 people overrun the team budget (`READ_MAX_TEAM`, 6,000 request weight per 10 minutes): the team
  reaches 13,630, and **every one of the 55 readers sees "Bridge is busy"** (23,622 of 42,939 requests refused). The
  budget counts requests, not GitHub calls, so it turns readers away while GitHub is 90 % idle. At today's rates the
  ceiling is about 25 active people per team.
- One unknown changes everything: whether GitHub's ETags depend on the token. If they do, each new installation token
  (one per warm function, renewed every 30 minutes) misses the kept ETag, and the same 55 people cost **19,318
  counted calls an hour**, over even the 15,000 of GitHub Enterprise Cloud. The harness models both cases; a
  two-call check against GitHub settles it (recommendation 2).

## Results

Simulated hour, fake clock, cold cache at the start. "Counted" is every GitHub answer except a 304 to a conditional
request; "free" is a 304. "Reads at Bridge" counts each change of a status batch as its 5 reads, each blob or login
as one; reads the person's tab still kept never reach Bridge and are not counted.

| Scenario | People | Page loads | Reads at Bridge | Counted calls | Counted / h | Of 5,000 / h | Free 304s | Peak / min | Peak in flight | Cache hit ratio |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| A: 1 lead, 10 open changes, a load every 2 min | 1 | 30 | 2400 | 446 | 446 | 8.9 % | 1886 | 158 | 28 | 81.4 % |
| B: 10 designers + 2 leads, mixed pages, a load every 1 to 3 min, 5 updates an hour | 12 | 355 | 29801 | 318 | 318 | 6.4 % | 9877 | 106 | 26 | 98.9 % |
| C: 50 designers + 5 leads, same rates | 55 | 1634 | 241216 | 472 | 472 | 9.4 % | 12159 | 289 | 40 | 99.8 % |
| C2: C with READ_MAX_TEAM lifted (the demand) | 55 | 1634 | 241216 | 495 | 495 | 9.9 % | 25206 | 289 | 40 | 99.8 % |
| C3: C2 with token-bound ETags, 4 warm functions | 55 | 1634 | 241216 | 19318 | 19318 | 386.4 % | 6106 | 561 | 40 | 92.0 % |
| D: Burst: 50 people open Home within 1 minute | 50 | 50 | 12805 | 267 | n/a (burst) | n/a | 245 | 267 | 26 | 97.9 % |

| Scenario | Reader cap hits (readers) | Team budget hits | Member budget hits | Busy answers (readers) | Changes left out | Peak member weight / 10 min | Peak team weight / 10 min | Counted but unchanged | Concurrent duplicate misses |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| A | 0 (0) | 0 | 0 | 0 (0) | 0 | 193 | 193 | 228 | 67 |
| B | 0 (0) | 0 | 0 | 0 (0) | 0 | 266 | 2023 | 72 | 24 |
| C | 0 (0) | 23622 | 0 | 23622 (55) | 0 | 471 | 13630 | 160 | 125 |
| C2 | 0 (0) | 0 | 0 | 0 (0) | 0 | 471 | 13630 | 157 | 119 |
| C3 | 137 (7) | 0 | 0 | 2 (1) | 0 | 471 | 13630 | 1908 | 5595 |
| D | 0 (0) | 0 | 0 | 0 (0) | 0 | 99 | 4455 | 102 | 100 |

- Reader cap (`READ_MAX_UPSTREAM`, 300 GitHub calls per reader per 10 minutes): never reached with ETags as GitHub
  documents them; reached by 7 readers only in C3.
- Member budget (`READ_MAX_IP`, 1,200 request weight per member per 10 minutes): a lead peaks at 471, fine.
- Team budget (`READ_MAX_TEAM`, 6,000 per 10 minutes): B uses a third of it; C needs 2.3 times it; the D burst
  alone (one Home load each) uses 4,455, three quarters of it, in one minute.
- Counted but unchanged: GitHub answered 200 with the same ETag it had sent before, because Bridge no longer kept
  that ETag (kept answers expire after `KEEP_S`, 10 minutes). Half of A's counted calls (228 of 446), a third of
  C2's (157 of 495).
- Concurrent duplicate misses: counted calls made while a call for the same path was already in flight. Home and
  the nav badge each send the same `changes=` batch, and nothing coalesces concurrent misses on the server: 100 of
  D's 267 counted calls, 67 of A's 446.
- Scenario E (webhooks keeping the cache fresh for 10 minutes) is skipped: the webhook work is not merged on main yet.

## Against GitHub's limits

Assumptions, from GitHub's REST API rate limit docs (not measured here):

- Primary limit of a GitHub App installation: 5,000 requests an hour; more for installations with over 20 users or
  repositories (50 an hour per extra one), up to 12,500; 15,000 an hour on GitHub Enterprise Cloud.
- A 304 answer to a conditional request (If-None-Match) made with the same authorization does not count.
- Secondary limits: at most 100 concurrent requests; at most 900 points a minute per REST endpoint (a GET is 1
  point); avoid bursts, and back off on `retry-after`.

Measured against them:

| | Counted / h | 5,000 | 12,500 | 15,000 |
| --- | --- | --- | --- | --- |
| C2, ETags as documented | 495 | 9.9 % | 4.0 % | 3.3 % |
| C3, token-bound ETags | 19,318 | 386 % | 155 % | 129 % |

Concurrency: the highest number of GitHub calls in flight at once was 40 (C), 26 for the D burst, with one simulated
function. Far from 100, but nothing bounds it: each `changes=` request reads with 4 workers, each blob batch with 8,
and concurrent requests add up. A burst larger than D (a whole office opening Home after a release mail) can approach
the limit. The busiest minute was 289 counted calls (561 in C3), under 900 points a minute.

## Top 3 recommendations

1. **Make the team budget count GitHub calls, not requests.** Charge `READ_MAX_TEAM` with cache misses (as the
   per-reader `upstream` count already does), sized to a share of the installation's hour (for example 60 % of
   5,000 is 500 per 10 minutes), and keep a high per-member request limit for abuse. Today a cached answer costs the
   team as much as a GitHub call, which caps a team at about 25 active people. Sending the status batch once per page
   (Home and the badge both send it, `needs-you.ts` and `home-data.ts`) halves its weight too.
2. **Keep ETags longer, and check whether they are token-bound.** Revalidating is free, so keep the body and ETag a
   day (or until Redis memory says otherwise) and revalidate after the 30 s fresh window: a third to a half of the
   counted calls disappear. Before an enterprise rollout, settle C3 with two real calls (the same read with two
   installation tokens, the second with the first's ETag): if GitHub answers 200, share one installation token
   across functions (kept in Redis, renewed before expiry) so the ETags stay valid.
3. **Coalesce concurrent misses and bound concurrency.** One GitHub call per path at a time (a short Redis lock,
   `SET NX`, with the others waiting for the kept answer), and a cap on GitHub calls in flight per installation. It
   removes about a third of the cold-burst calls and keeps bursts away from the 100 concurrent requests limit.

## How the harness works

`npm run loadtest:github -w @bridge-ds/docs-site` runs every scenario (about 12 s) and prints both tables;
`QUOTA_OUT=<file>` also writes the raw results as JSON. It is not part of `npm test`; a quick smoke run is
`apps/docs-site/src/lib/quota-loadtest.test.ts`, in the docs project.

- `apps/docs-site/test/quota/fake-github.ts`: a fake api.github.com. Recorded-shape bodies (pull requests, reviews,
  files, check runs, statuses, trees, contents, issues, users), an ETag on every answer, 304 on a matching
  If-None-Match, every call logged as counted or free. A world of open changes that move: a new commit (new head
  sha, checks queued) and checks finishing 4 minutes later.
- `apps/docs-site/test/quota/pages.ts`: the reads one load of each Studio page sends for a signed-in member, in
  phases, collected from the browser code (repo-context, the nav badge, home-data, reviews, building-data,
  product-page, pr-status). The tab's own cache is modeled (20 s, 10 minutes for reads by sha, longer for some
  lists), so only what reaches Bridge is sent.
- `apps/docs-site/test/quota/sim.ts`: the scenarios and the clock. Each read goes through the real handler
  (`handleContribute` in `api/contribute`, so `onRead`, `onChanges`, `onBlobs` and `onUsers` in
  `api/_lib/team-read.ts`), with the in-memory Redis and member cookies. Requests due in the same 250 ms tick are in
  flight together. Deterministic: the same numbers on every run.

Limits of the model:

- Every reader is an email member (session cookie). A reader signed in with GitHub is checked with their own token
  (`githubTeamReaderOf`, kept 5 minutes): calls on their own limit, not the installation's.
- The Library is counted as reads through Bridge, the pessimistic case: its pages may read with the viewer's own
  token instead.
- Token mints (the app JWT) are not counted: they do not use the installation's limit.
- The fake world keeps issues, comments and the default branch still; only the open changes move. A busier
  repository costs more misses, all of them on the counted side.
- One simulated function: the in-memory copies of answers by sha are shared by every request. They only save Redis
  reads, never GitHub calls, so the counts hold for many functions (except with token-bound ETags, C3).
