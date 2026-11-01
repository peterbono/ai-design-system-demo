---
"@bridge-ds/core": minor
"@bridge-ds/mcp": minor
"@bridge-ds/cli": patch
"@bridge-ds/toolbar": minor
"@bridge-ds/docs-site": minor
---

The design team's copy of a product: `products[].design` (`{ "repo", "preview"? }`) names a fork of the product's repository that the design team owns. Explorations of that product start in the copy, never in the developers' repository, and "Done exploring" sends the developers a task there instead of a branch: an issue labeled `from-design` with the preview, the files the prototype changes, the library pieces it needed, and how to fetch the prototype code from the copy. Studio's product page offers "Make my copy" while there is none (a fork in the copy's organization, every branch) and "Get the latest" when the product moved on (GitHub's Sync fork); an exploration in the copy opens in Claude Code on the web with the copy selected and the branch named. New core exports: `designCopyOf`, `productCodeRepoOf`, `productOfDesignCopy`, `designCopyStateOnGitHub`, `makeDesignCopyOnGitHub`, `waitForDesignCopy`, `getLatestDesignCopyOnGitHub`, `designTaskBody`, `designTaskTitle`, `designCopyTakeCommands`, `DESIGN_COPY_STARTING_POINT`, `FROM_DESIGN_LABEL`; `GitHubClient` gains `forRepo`, `createFork`, `mergeUpstream` and `ensureLabel`; the exploration block gains `task`. The toolbar takes a `repo` override (the deploy's own repository): on a deploy of the copy it reads the copy's explorations and previews. Art print shop moved to `art-print-shop-co/art-print-shop`, explored in `art-print-shop-co/art-print-shop-design`.
