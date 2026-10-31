---
"@bridge-ds/core": minor
"@bridge-ds/docs-site": patch
---

Exploration page "..." menu: Rename (the pull request title and the exploration's name in its body, the branch and preview link unchanged) and Back to exploring (undoes Done exploring while no developer has pushed since: the developer section and the done marker leave the body, the `exploration` label comes back, `ready-for-devs` goes; a refused label write still succeeds through the body). New core exports: `renameExplorationOnGitHub`, `reopenExplorationOnGitHub`, `withExplorationName`, `withoutDoneExploring`, `renamedExplorationTitle`; the exploration block gains `reopenedAt`.
