---
"@bridge-ds/core": minor
"@bridge-ds/figma-plugin": patch
"@bridge-ds/docs-site": patch
---

Exploration install commands that work. On exploration #64 the plugin showed a pkg.pr.new command that returned 404
(the pkg.pr.new app is not installed); the working one was the prerelease tarball command in the pull request's
`<!-- bridge-branch-preview -->` comment. Core reads that comment back: `installCommandFromPreviewComment(body)`,
`readPreviewComment`, `findPreviewComment`, `explorationTryIt` (ready only when the comment's snapshot matches the
branch head, "building" before, "failed" when the publish failed), `explorationTryItOnGitHub`,
`explorationShareMessage` and `GitHubClient.listIssueComments`. The draft pull request body no longer guesses a
command: it points to the comment.

DS Bridge plugin: the "Sent to <exploration>" screen is for designers. "Try it" lists the previews with the product
first (the admin demo, by its name in bridge.config.json), then Library and Workbench, one row each with "Open" on the
same line. "Test build for your product" says whether the build is ready or being prepared (with "Check again"), and
has one action, "Share with a developer", which copies a ready message with the working command, the previews and the
pull request. The command itself stays under "Show the command". The bar's primary is "Open in the product" when that
preview exists, otherwise "Open on GitHub". The Push form drops the "Commit title" disclosure for explorations (the
title is still generated) and says "Owners review it only if the exploration is promoted."; other Push and Pull
sentences say "the design system" instead of "main" and drop "commit".

Studio explorations: the detail reads the install command from the preview comment (or says the test build is being
prepared); the list no longer shows a guessed pkg.pr.new command.
