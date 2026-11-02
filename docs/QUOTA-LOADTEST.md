# GitHub quota load test

Is Bridge's server read path robust enough for an enterprise team, measured against GitHub's API limits? This page
holds the measured answer and how to run it again. First run 2026-11-02 on main at 73db3753 (after #763, #764 and
#765); fixes measured the same day on top of the webhooks (#768).

## Verdict

GitHub's quota is not the bottleneck, and Bridge's own team budget no longer is either.

- 55 people (50 designers and 5 leads, a page load every 1 to 3 minutes) cost the installation **355 counted GitHub
  calls an hour, 7.1 % of the 5,000 baseline**, and **no reader sees "Bridge is busy"**. Before the fixes, the same
  people overran the team budget (13,630 requests against 6,000 per 10 minutes) and all 55 saw it.
- The team budget now counts GitHub calls (cache misses), not requests: the team peaks at 220 of its 500 calls per
  10 minutes, a cold start included. Requests are only limited per reader, against abuse (a lead peaks at 351 of
  3,000).
- The open question of the first run (are GitHub's ETags tied to the token?) no longer matters: every function uses
  the same installation token, so the token-bound worst case (C3) costs 548 calls an hour instead of 19,226. What is
  left is one re-read of the kept answers per token renewal (every 50 minutes), and only if ETags are token-bound.
- Bursts are bounded: concurrent misses of one answer make one GitHub call, and a function has at most 20 calls in
  flight (40 before, unbounded), far from GitHub's 100.
- With the webhooks healthy (E), counted calls stay the same (what changed must be read once either way), but
  revalidations drop from 17,936 to 3,181 an hour: fewer round trips to GitHub, faster pages.

## Before and after

Simulated hour, fake clock, cold cache at the start. "Before" is main with the webhooks (#768), before this work; the
first run (before #768) is in the last column for A to D. "Counted" is every GitHub answer except a 304 to a
conditional request; "free" is a 304. "Busy" is the readers who saw "Bridge is busy" at least once.

| Scenario | Counted / h, first run | Counted / h, before | Counted / h, after | Free 304s, before | Free 304s, after | Busy readers, before | Busy readers, after | Duplicate misses, before | Duplicate misses, after | Peak in flight, before | Peak in flight, after |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| A: 1 lead, 10 open changes, a load every 2 min | 446 | 297 | 230 | 2035 | 1592 | 0 | 0 | 67 | 0 | 28 | 20 |
| B: 10 designers + 2 leads, mixed pages | 318 | 286 | 258 | 9909 | 7656 | 0 | 0 | 24 | 0 | 26 | 20 |
| C: 50 designers + 5 leads, same rates | 472 | 472 | 355 | 12159 | 17936 | **55** | **0** | 125 | 1 | 40 | 20 |
| C2: C with READ_MAX_TEAM lifted (the demand) | 495 | 495 | 355 | 25206 | 17936 | 0 | 0 | 119 | 1 | 40 | 20 |
| C3: C2 with token-bound ETags, 4 warm functions | 19318 | 19226 | 548 | 5953 | 17743 | 1 | 0 | 5603 | 1 | 40 | 20 |
| E: C2 with webhooks healthy | n/a | 509 | 357 | 4860 | 3181 | 0 | 0 | 131 | 1 | 42 | 20 |
| D: Burst: 50 people open Home within 1 minute (counted calls, not per hour) | 267 | 267 | 167 | 245 | 145 | 0 | 0 | 100 | 0 | 26 | 20 |

Where the counted calls went:

- **C (team budget)**: 23,622 refused requests before, none now. C and C2 are now the same run: the budget is never
  reached.
- **A, C2 (ETag retention)**: "counted but unchanged" (GitHub answered 200 with an ETag it had already sent, because
  Bridge no longer kept it) fell from 79 to 12 in A and from 157 to 17 in C2. Answers are kept a day to be
  revalidated, so an answer read again after a quiet half hour is a free 304.
- **D (single flight and one status batch per page)**: duplicate misses fell from 100 to 0, counted calls from 267 to
  167. The reads at Bridge fell from 12,805 to 7,805: Home and the nav badge now send the status batch once.
- **C3 (shared token)**: 19,226 to 548. The C3b reference run (the same harness, each function minting its own token)
  still gives 13,703: the shared token is what removes it.
- Free 304s went up in C (17,936 against 12,159): the readers who were refused before now read, mostly from the cache
  and by free revalidations.

## Results after the fixes

| Scenario | People | Page loads | Reads at Bridge | Counted calls | Counted / h | Of 5,000 / h | Free 304s | Peak / min | Peak in flight | Cache hit ratio |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| A: 1 lead, 10 open changes, a load every 2 min | 1 | 30 | 1900 | 230 | 230 | 4.6 % | 1592 | 108 | 20 | 87.9 % |
| B: 10 designers + 2 leads, mixed pages, a load every 1 to 3 min, 5 updates an hour | 12 | 355 | 22351 | 258 | 258 | 5.2 % | 7656 | 104 | 20 | 98.8 % |
| C: 50 designers + 5 leads, same rates | 55 | 1634 | 171216 | 355 | 355 | 7.1 % | 17936 | 189 | 20 | 99.8 % |
| C2: C with READ_MAX_TEAM lifted (the demand) | 55 | 1634 | 171216 | 355 | 355 | 7.1 % | 17936 | 189 | 20 | 99.8 % |
| C3: C2 with token-bound ETags, 4 warm functions | 55 | 1634 | 171216 | 548 | 548 | 11.0 % | 17743 | 189 | 20 | 99.7 % |
| C3b: C3 with a token per function (before) | 55 | 1634 | 171216 | 13703 | 13703 | 274.1 % | 4588 | 343 | 20 | 92.0 % |
| E: C2 with webhooks healthy | 55 | 1634 | 171216 | 357 | 357 | 7.1 % | 3181 | 189 | 20 | 99.8 % |
| D: Burst: 50 people open Home within 1 minute | 50 | 50 | 7805 | 167 | n/a (burst) | n/a | 145 | 167 | 20 | 97.9 % |

| Scenario | Reader cap hits (readers) | Team budget hits | Member budget hits | Busy answers (readers) | Changes left out | Peak member weight / 10 min | Peak team GitHub calls / 10 min | Counted but unchanged | Concurrent duplicate misses |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| A | 0 (0) | 0 | 0 | 0 (0) | 0 | 173 | 134 | 12 | 0 |
| B | 0 (0) | 0 | 0 | 0 (0) | 0 | 216 | 149 | 12 | 0 |
| C | 0 (0) | 0 | 0 | 0 (0) | 0 | 351 | 220 | 17 | 1 |
| C2 | 0 (0) | 0 | 0 | 0 (0) | 0 | 351 | 220 | 17 | 1 |
| C3 | 0 (0) | 0 | 0 | 0 (0) | 0 | 351 | 220 | 16 | 1 |
| C3b | 0 (0) | 0 | 0 | 0 (0) | 0 | 351 | 2404 | 37 | 1 |
| E | 0 (0) | 0 | 0 | 0 (0) | 0 | 351 | 220 | 19 | 1 |
| D | 0 (0) | 0 | 0 | 0 (0) | 0 | 79 | 166 | 2 | 0 |

- Team budget (`READ_MAX_TEAM`, now 500 GitHub calls per 10 minutes, 60 % of the 5,000 an hour): C peaks at 220,
  cold start included. Past it, readers get what is kept (confirmed by GitHub within 20 minutes), else busy.
- Reader cap (`READ_MAX_UPSTREAM`, 300 GitHub calls per reader per 10 minutes): never reached, C3 included.
- Member requests (`READ_MAX_IP`, now 3,000 per member per 10 minutes, abuse protection only): a lead peaks at 351.
- The one duplicate miss left in C is the team's product list and the product's visibility, read outside the cache.
- C3 against C2: 193 more calls, all at the one token renewal of the hour (the 4 mints are 2 repositories, minted at
  the start and renewed after 45 minutes). With token-bound ETags each renewal re-reads the kept answers once;
  with ETags as GitHub documents them, C3 is C2.

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
| C2, before | 495 | 9.9 % | 4.0 % | 3.3 % |
| C2, after | 355 | 7.1 % | 2.8 % | 2.4 % |
| C3, token-bound ETags, before | 19,226 | 385 % | 154 % | 128 % |
| C3, token-bound ETags, after | 548 | 11.0 % | 4.4 % | 3.7 % |

Concurrency: at most 20 GitHub calls in flight per function (`MAX_UPSTREAM_IN_FLIGHT`), so 5 warm functions stay
at the 100 concurrent requests limit at worst, and real bursts are lower (D needs 20 for a moment). The busiest minute
was 189 counted calls (343 in C3b), under 900 points a minute.

## What changed

1. **The team budget counts GitHub calls** (`api/_lib/team-read.ts`, `READ_LIMITS.team`): a cache hit or a 304 costs
   the team nothing; only a counted GitHub call does, like the per-reader `upstream` count. Over it, what is kept
   answers (confirmed within `KEEP_S`), else busy. Requests are limited per reader only, much higher, against abuse.
2. **One status batch per page** (`src/scripts/contribute-session.ts` `prefetchChangeStatuses`): one request in flight
   per batch, shared by the nav badge and Home, and a change whose reads the page still keeps is not asked again.
3. **ETags kept a day** (`ETAG_KEEP_S`): an answer past its fresh window (30 s, 10 min with webhooks) is revalidated
   with its ETag instead of read again, however long ago it was read. It stands in without GitHub only within
   `KEEP_S` (20 minutes) of GitHub last confirming it, as before. Each entry is still at most `MAX_KEPT_CHARS`.
4. **One read token for every function** (`api/_lib/shared-token.ts`): minted by one function under a 10 s Redis lock,
   kept in Redis sealed (AES-256-GCM, a key derived from `LIBRARY_SESSION_SECRET` for this purpose only, bound to its
   key), used by every function for 50 minutes, renewed in its last 5; each function looks again at least every
   minute. The token is never logged nor sent to the browser. The harness runs the real code, one memory per
   simulated function over one Redis.
5. **Single flight and a concurrency cap** (`once` and `slot` in `api/_lib/team-read.ts`): concurrent misses of one
   answer (a GET, a blob, a login) share one GitHub call in a function; at most 20 GitHub calls in flight per function,
   the others queue. Across functions there is no lock: N warm functions can still make N calls for the same answer at
   the same moment (the harness runs one process, so its C3 shares in-flight calls across the 4 simulated functions).

## How the harness works

`npm run loadtest:github -w @bridge-ds/docs-site` runs every scenario (about 14 s) and prints both tables;
`QUOTA_OUT=<file>` also writes the raw results as JSON. It is not part of `npm test`; a quick smoke run is
`apps/docs-site/src/lib/quota-loadtest.test.ts`, in the docs project.

- `apps/docs-site/test/quota/fake-github.ts`: a fake api.github.com. Recorded-shape bodies (pull requests, reviews,
  files, check runs, statuses, trees, contents, issues, users), an ETag on every answer, 304 on a matching
  If-None-Match, every call logged as counted or free. A world of open changes that move: a new commit (new head
  sha, checks queued) and checks finishing 4 minutes later.
- `apps/docs-site/test/quota/pages.ts`: the reads one load of each Studio page sends for a signed-in member, in
  phases, collected from the browser code (repo-context, the nav badge, home-data, reviews, building-data,
  product-page, pr-status). The tab's own cache is modeled (20 s, 10 minutes for reads by sha, longer for some
  lists; a status batch is sent once per page), so only what reaches Bridge is sent.
- `apps/docs-site/test/quota/sim.ts`: the scenarios and the clock. Each read goes through the real handler
  (`handleContribute` in `api/contribute`, so `onRead`, `onChanges`, `onBlobs` and `onUsers` in
  `api/_lib/team-read.ts`), with the in-memory Redis, member cookies, and the real shared token
  (`api/_lib/shared-token.ts`, `tokens: 'per-function'` gives the old behavior back). With `webhooks`, GitHub's
  deliveries go through the real signed handler (`api/_lib/github-webhook.ts`): push, pull_request and check_suite on
  each new commit, check_run, check_suite and status when its checks finish, and a delivery every 5 minutes for the
  installation's other activity, so the webhooks stay healthy. Requests due in the same 250 ms tick are in flight
  together. Deterministic: the same numbers on every run.

Limits of the model:

- Every reader is an email member (session cookie). A reader signed in with GitHub is checked with their own token
  (`githubTeamReaderOf`, kept 5 minutes): calls on their own limit, not the installation's.
- The Library is counted as reads through Bridge, the pessimistic case: its pages may read with the viewer's own
  token instead.
- Token mints (the app JWT) are not counted: they do not use the installation's limit.
- The fake world keeps issues, comments and the default branch still; only the open changes move. A busier
  repository costs more misses, all of them on the counted side.
- One process: the in-memory copies of answers by sha, the single flight and the concurrency cap are shared by the
  simulated functions of C3. They only save Redis reads and concurrent duplicates, so the counts hold for one
  function; with many warm functions, a cold burst can cost up to one call per function per answer.
- The "before" columns come from the same harness run against main at b2602fd3 (with the status batch sent twice and
  a token per function, as the code then did).
