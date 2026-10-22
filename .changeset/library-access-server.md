---
'@bridge-ds/docs-site': minor
---

Library access, server: /api/library-access stores who reads each team's Library (Anyone with the link, Anyone with a work email at listed domains, Only the team; admins only, checked on GitHub), emails readers a one-time sign-in link (15 minutes, only its hash kept, exact domain match, consumer domains refused), and opens a signed httpOnly session cookie for that team's Library (30 days, ended at once when the setting changes). Private Libraries are served from their published snapshot with a read-only app token after the session check; public ones keep 0 GitHub API calls. Daily caps per email, network, team and site. New env: LIBRARY_SESSION_SECRET (docs/HOSTED.md). Invites now offer contributor roles only: the server refuses Can view for new invites and role changes; existing ones keep it.
