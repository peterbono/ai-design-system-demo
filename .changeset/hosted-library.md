---
'@bridge-ds/core': minor
'@bridge-ds/cli': minor
'@bridge-ds/docs-site': minor
---

Hosted Library per team (multi-team PR 4a). `/library/<owner>/<repo>/` serves a team's published design system:
Home, Foundations (generic token specimens), Components (cards by family; one component with a live Storybook story
and its `docs.json` guidance) and Tokens (every token with its value per theme). Each page is built once at
`/library-shell/...` and reached through two new `vercel.json` rewrites; the build fails on a missing shell or on any
file that would take a team's Library address. Signed out, a Library reads the team's `bridge-data` snapshot from the
raw host with no GitHub API call; signed in, it reads like Studio. Pages are `noindex` unless `bridge.config.json` sets
the new `library.public: true` (core `libraryIsPublic`, schema). `bridge snapshot` now also writes `llms.txt` (core
`snapshotLlmsTxt`), which the Library links for AI agents. On a team's Studio, the header's Library button opens the
team's Library. `scripts/hosted-smoke.mjs` covers the Library routes.
