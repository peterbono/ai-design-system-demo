---
"@bridge-ds/core": minor
---

Explorations: `explorations.ts` (branch naming `explore/<slug>`, the `exploration` label, the draft pull request body with purpose, snapshot install command, previews and promote or close, status running, promoted or closed, and the promotion plan with tier labels from the shared classifier) and `explorations-github.ts` (start, list, promote, close). `GitHubClient` gains `withBranchPrefix`, `commitToBranch` and `markReadyForReview` (GraphQL `markPullRequestReadyForReview`, since REST cannot unset draft). Component change requests take an optional `exploration` branch: the issue gets the `exploration` label and the brief says to work on that branch, never in a pull request to main. The branch preview comment says "Try this exploration in your product" for explorations and installs them as `name@url`.
