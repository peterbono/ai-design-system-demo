---
"@bridge-ds/docs-site": patch
---

Bridge keeps working under the old names of a renamed repository. One map of old names (src/lib/team-path.ts
canonicalRepo) is read wherever Bridge names a team or a repository: the read proxy and every API that takes a repo,
task links in explorations (In review, Approved and the shipped review show again, and GitHub is called by the new
name, without a redirect per read), webhook links, and Studio addresses (permanent redirects in vercel.json from
/studio/peterbono/ai-design-system-demo/ and /studio/art-print-shop-co/). The demo list keeps current names only.
A refusal of a toolbar read from another origin now carries its CORS headers, so the toolbar can read why.
