---
'@bridge-ds/docs-site': minor
---

Team addresses for the hosted Studio (multi-team PR 3a). Every Studio page is also built as an empty team shell at
`/team-shell/...` (`<html data-hosted data-shell>`, `noindex`), and `vercel.json` rewrites `/studio/<owner>/<repo>/...`
and the escape form `/studio/~/<owner>/<repo>/...` to it, two rules per form with the trailing slash one first. Static
files still win, so every existing `/studio/` page and deep link is unchanged. On a shell, the build-time Studio links
follow the team (`scripts/team-links.ts`), and the page says team pages open there soon, with the same page on the
demo. The build writes the paths a team can never take, read from the built Studio folder, to
`/team-shell/reserved.json`, and fails on a missing or malformed shell or on a link to a Studio path no file serves.
Team addresses and shells answer `X-Robots-Tag: noindex`. With `BRIDGE_HOSTED=1`, Studio home shows "Open your team's
Bridge": a field that takes `owner/repo` or a GitHub address. `scripts/hosted-smoke.mjs` checks a deployment.
