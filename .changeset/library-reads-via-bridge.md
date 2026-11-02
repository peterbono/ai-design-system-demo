---
"@bridge-ds/docs-site": patch
---

Studio no longer spends each viewer's own GitHub limit. Anyone on the team signed in with GitHub (leads, admins, designers) now reads the team's library, its products and people's profiles through Bridge with the app's token and the team's shared cache (30 s for lists and statuses, ETag checks that GitHub does not count, a day for answers by commit sha). Membership is checked on the server, the read allow-list holds (now with releases), and a read right after a write on GitHub asks Bridge for a fresh answer. Each reader may cost the app at most 300 GitHub calls per 10 minutes (`READ_MAX_UPSTREAM`), so one viewer cannot use up the team's limit. Writes keep their routes.
