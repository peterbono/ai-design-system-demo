---
"@bridge-ds/core": patch
---

GitHubClient.hasBranch: asks whether a branch exists without a 404. Studio reads a team's snapshot only when its bridge-data branch exists, and skips join requests without a Bridge account, so neither leaves an error in the console. Edit mode's Do and Don't titles are h3, as on the read page.
