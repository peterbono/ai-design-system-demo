---
"@bridge-ds/core": minor
"@bridge-ds/mcp": patch
"@bridge-ds/cli": patch
"@bridge-ds/docs-site": patch
"@bridge-ds/figma-plugin": patch
---

Real branch preview URLs and install commands everywhere, never guessed ones. On exploration #64
(`explore/button-normal-again`) Vercel shortened the admin and Storybook aliases with a hash
(`bridge-admin-git-explore-button-norm-0ed5ba-peterbonos-projects.vercel.app`), so the template URLs were wrong.

Core: `branchPreviewUrls(client, prNumber | sha, config)` reads what Vercel reports, in order: GitHub deployments of the
head commit, the Vercel commit statuses (state of each deploy), the Vercel bot comment (`[vc]` header, decoded), and the
`previews.apps` template only when its host label fits in 63 characters. Pure parts: `parseVercelComment`,
`findVercelComment`, `appForProject` (Vercel project to app by the template host), `resolveBranchPreviews`,
`previewLinksOf`, `previewsSettled`. `explorationTestBuildOnGitHub` returns the install command from the preview comment
and the real previews in one read. `GitHubClient.listCommitStatuses` and `listDeployments`. The sticky PR comment
(`previewComment`) takes the resolved previews and never prints a shortened template URL. Removed: `explorationInstall`
and `ExplorationInstall` (guessed pkg.pr.new commands); `StartedExploration.install` becomes `tryIt` and
`ExplorationSummary.install` is gone (it gains `headSha`).

Preview packages workflow: the comment's preview table uses the URLs Vercel reports (deployments, statuses, its comment).

MCP and CLI: `bridge_list_explorations` / `bridge explore list` return the install command from the preview comment
(`install.state` building, ready or failed) and the previews Vercel reports; `bridge explore start` no longer prints a
pkg.pr.new command.

Studio: the pull request detail ("Preview and install") shows the URLs Vercel reports and the command the workflow
published, or that the test build is being prepared; the exploration detail fills its previews the same way.

DS Bridge plugin: the exploration result screen ("Try it") shows the real URLs, checks every 15 seconds for up to 10
minutes while it is open (stopping once the command and every preview are ready), updates in place without
re-rendering, and keeps "Check again".
