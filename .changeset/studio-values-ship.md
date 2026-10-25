---
"@bridge-ds/core": patch
"@bridge-ds/mcp": patch
---

Token value changes ship by themselves once the design approval is in (decision TV-1). `branchVerdict` takes
`autoMerge` (GitHub `auto_merge` set): a design-approved token value change whose merge Bridge armed reads `autoShip`,
"On its way to the library". `GitHubClient.getPullRequest` returns `autoMerge`, and `bridge_branch_status` says Bridge
merges it once the automatic checks pass.
