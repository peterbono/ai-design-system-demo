---
"@bridge-ds/core": minor
"@bridge-ds/docs-site": patch
---

Studio requests nobody is on now end in a decision, not a dead end. The Overview row says "Open request" (no more
"Triage") and what is expected: "Nobody is on it yet: explore it, assign someone or decline it." On the request, a
design system owner who is connected gets one row: Start an exploration (opens the Explorations form filled from the
request, then links the request to it and puts them on it), Assign someone (a DS Combobox of the people who can edit
the repository, in place) and Decline (a DS Dialog that asks for a reason, says who reads it, posts it and closes the
request as not planned). Once someone is on it, the row gives way to one sentence ("@ana is on it", "@ana is exploring
it"); everyone else reads who decides. A request linked to an exploration now counts its draft as the work on it.

Core: `linkRequestToExplorationOnGitHub`, `assignRequestOnGitHub`, `declineRequestOnGitHub`, the pure
`withRequestExploration`, `declineComment` and `declineReasonProblems`, `GitHubClient.updateIssue`, `addAssignees` and
`listCollaborators`, and `requests` in the exploration settings (listed in its draft pull request body).
