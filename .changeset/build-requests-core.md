---
"@bridge-ds/core": patch
---

Pushes from Figma and build requests: a push from the Figma plugin counts as design-approved in the shared gate
(`figmaPushOf`, `withFigmaPushApprovals`, `branchVerdict` `figmaPush` and `autoShip`), token values ship after the
checks, renames and removals wait for a developer, structure changes become build requests
(`composeBuildRequestIssue`, `createBuildRequestOnGitHub`) whose status is read from GitHub (`buildRequestStatus`,
`listBuildRequestsOnGitHub`). Publish result and `libraryArrival` for the plugin. See docs/BUILD-REQUESTS.md.
