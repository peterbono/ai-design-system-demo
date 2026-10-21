---
'@bridge-ds/core': patch
'@bridge-ds/docs-site': minor
---

Team pages always sign in with the read-only Bridge app. When a team in direct mode saves code for the first time
(start a branch, save to it, ship, review), Studio explains why in "Allow Bridge to save to branches" and asks for
Bridge Direct's OK once, then lands back on the same page. Its token lives in its own slot next to Bridge's;
suggestions and comments keep going out with Bridge. When Bridge Direct is not on the team's repository, admins get
"Install Bridge Direct" and everyone else "Ask your lead". New optional `GITHUB_APP_DIRECT_SLUG`. The self-hosted
Studio is unchanged. Core: a `fetch` that throws its own `GitHubError` keeps it instead of turning into "Could not
reach GitHub".
