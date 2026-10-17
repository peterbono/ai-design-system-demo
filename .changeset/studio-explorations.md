---
"@bridge-ds/docs-site": minor
---

Studio Changes gets an Explorations view: draft pull requests labeled `exploration` on `explore/<slug>` branches, summary first ("2 explorations running."), each with its purpose, author, previews, the snapshot install command to copy for a product staging branch and the requests filed on it. "Start an exploration" creates the branch from main with an exploration note and the draft pull request (or shows the `bridge explore start` command without GitHub). The detail opens in place (?exploration=N) with Promote to review (tier labels from the shared classifier, label removed, ready for review) and Close. Running explorations leave the In review list, show "Exploration (not mergeable)" in place of a tier, and never pass the merge gate, owner override included. How review works explains explorations.
