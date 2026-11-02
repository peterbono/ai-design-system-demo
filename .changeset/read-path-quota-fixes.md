---
"@bridge-ds/docs-site": patch
---

Team reads through Bridge scale to large teams: the team budget (`READ_MAX_TEAM`, now 500 per 10 minutes) counts GitHub calls instead of requests, so cached answers never make a reader wait (55 people: no "Bridge is busy", was all 55); requests are limited per member only, against abuse (3,000 per 10 minutes). Kept answers keep their ETag a day and are revalidated for free; every function shares one sealed read token per repository, so kept ETags stay valid whichever function asks; concurrent misses of one answer make one GitHub call, with at most 20 in flight per function; Home and the nav badge send the status batch once. Measured in docs/QUOTA-LOADTEST.md.
