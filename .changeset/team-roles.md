---
"@bridge-ds/core": minor
"@bridge-ds/mcp": minor
"@bridge-ds/cli": minor
"@bridge-ds/docs-site": minor
---

Roles by team: `governance.owners` may name GitHub teams (`"@acme/design"`) as well as people, so a company assigns
roles by team and manages membership in GitHub. Still no database.

Core: new `teams.ts`. `parseOwnerEntry` reads a person (`"theo"`, `"@theo"`) or a team (`"@org/team-slug"`);
`loadConfig` and the JSON schema reject anything else with the entry named and both forms spelled out.
`TeamDirectory` expands teams to logins through any client with the new `GitHubClient` methods
(`listTeamMembers`, paginated; `getTeamMembership` for one person; `getAccountType`; `listOrgTeams`), cached for five
minutes. A team it cannot read is a typed state (`no-token`, `missing-permission`, `not-found`, `personal-account`,
`unreachable`) with the fix in `teamUnreadableMessage`, never an empty list: it keeps its place in the expanded lists
and matches nobody. `approverLists` and `shipPolicy` take the team states; `whoCanShipSentence` names a team with its
size ("Only the tech owner can ship this (@acme/web (4 people)).").

CLI: `bridge check` lists the teams named as owners with their size and reports each team it cannot read, with the
fix (never part of the exit code). MCP: `bridge_get_review` returns `roles`: who may approve design, approve tech and
ship, with teams named, and an approval counts when the reviewer is in the team.

Studio: approvals, who acts, the ship gate (with a membership check for the viewer), the Overview and History
count team members and name teams as teams. Settings, Review rules gains Design owners and Tech owners rows: a team
is a chip with its member count and avatars, a team that cannot be read gets one sentence with the reason and the
fix, and Edit takes a person or a team (a DS Combobox suggesting the organization's teams and the repository's
people), sent for review on `bridge.config.json`.
