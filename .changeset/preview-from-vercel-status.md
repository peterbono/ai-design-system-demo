---
'@bridge-ds/core': patch
'@bridge-ds/docs-site': patch
---

Open the preview works when Vercel built the branch but Bridge has no Vercel comment to read: a finished Vercel commit status now gives the branch alias Vercel serves (core `vercelBranchAlias`, the shortened `-git-...-<hash>-` form included), and an exploration started for a product of the design system repository falls back to that product's own preview template when the page lists no preview apps (a team page).
