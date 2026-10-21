---
'@bridge-ds/docs-site': patch
---

Team Libraries are noindex on the server: every `/library/<owner>/<repo>/` address answers `X-Robots-Tag: noindex`, except the teams in the committed allow-list `hosted/public-libraries.json`. The build fails when `vercel.json` falls behind the list and prints the rules to paste.
