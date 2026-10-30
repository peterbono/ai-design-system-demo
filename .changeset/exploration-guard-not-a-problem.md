---
'@bridge-ds/core': minor
'@bridge-ds/mcp': patch
'@bridge-ds/docs-site': patch
---

An exploration no longer reads as having a problem. Its guard check, "Exploration not merged as is", fails by design
while it is an exploration, so the one check summary (core `summarizeCi` with `exploration`, `GitHubClient.getChecks`
with `exploration`) leaves it out for a pull request that is one (new `isGuardedExploration`: the `exploration` label,
or a running `explore/*` draft whose label is missing). Studio statuses, Home, the review queue, the branch page, the
MCP branch facts and review, and the Done exploring note use it; any other pull request with that check failing
still counts it. Exploration rows on Changes and Home cards now carry the state their page shows, as the one status
tag: "Not started" while only the Bridge note changed, "Exploring", "Archived", or where it stands after Done
exploring (new core `explorationStateLabel`), and Changes rows say when the exploration last moved.
