---
"@bridge-ds/docs-site": patch
---

Faster Studio pages: lists of pull requests read through Bridge drop the repository objects and API links no page reads
(bodies stay whole), so a list of 50 weighs a quarter of what it did and is kept on the server instead of asked of GitHub
on every page. The browser keeps them and asks again with their ETag, so an unchanged list costs a 304.
