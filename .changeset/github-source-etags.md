---
'@bridge-ds/core': minor
---

GitHub client: conditional requests (ETag and If-None-Match, sent only with a token since only then is a 304 free) with
a shared in-memory store or a Web Storage store, `rateLimit` from the response headers, optional stale answers when the
hourly limit is used up, and no more retries of an exhausted hourly limit. New `getBlobRaw`, `getRawText`,
`readRawFile`, the App installation endpoints (`listUserInstallations`, `listInstallationRepos`, `findInstallation`,
`installationFor`), `gitHubSource` (one tree call, bodies by blob sha) and the repo access states
(`accessState`, `resolveRepoAccess`).
