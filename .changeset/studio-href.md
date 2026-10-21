---
'@bridge-ds/docs-site': patch
---

Every Studio link, redirect and Studio file fetch goes through `studioHref(path)` (`lib/team-path.ts`, also exported
from `lib/nav.ts`), multi-team PR 2d. In self-hosted mode and at build time it returns `/studio/<path>` unchanged; on a
team shell (`<html data-hosted>`) it keeps the team, `/studio/<owner>/<repo>/<path>` (or the `/studio/~/` escape form).
The address parsing (`repoFromPath`, `isHosted`) moved there from `scripts/repo-context.ts`, which re-exports it. The
explorer's token link helper is now `tokenFocusHref`. A new test, `no-studio-literals`, fails on any new literal
`/studio/` path outside `team-path.ts`, `nav.ts` and `redirects.ts`; the three fixed exceptions (the OAuth callback in
the sign-in lib and the token API, and an inline script on the Library tokens page) are listed with their reason. The
built site is unchanged apart from chunk hashes and one new shared chunk.
