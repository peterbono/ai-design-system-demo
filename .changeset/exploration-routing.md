---
'@bridge-ds/core': patch
'@bridge-ds/docs-site': patch
---

Every way into an exploration opens its exploration page. A link that names it as a change (Home, notifications, search, an old `?pr=` address) now lands on the exploration page instead of the change review, so designers never see the review footer or developer checks there. A running exploration whose `exploration` label is missing (an open draft on `explore/*` or with the Bridge block) still counts as running everywhere (core `isUnlabeledExploration`, used by `explorationStatus` and `isHeldExploration`), and Studio puts the label back when someone who can write opens it. Starting one labels it more reliably: `exploration` goes on by itself with retries, a product label GitHub refuses no longer takes it down too, and what is still missing is reported (`labelsMissing`). The feature sentence is no longer copied into the purpose when it is the name.
