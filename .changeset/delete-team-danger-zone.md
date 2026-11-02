---
"@bridge-ds/docs-site": patch
---

Team Settings get a Danger zone for admins: "Delete this team" for a team made in Bridge, "Disconnect this team from Bridge" for a repository's team. Confirmed by typing the team's name. The server (api/entry `delete-team`, admins only, idempotent, capped per day) removes members, invites, join requests, connections in Claude, the name, discovery, the library access setting, the notifications registry and the team record, and never writes to GitHub. The browser forgets the team and goes to the person's next team. The security page and docs/HOSTED.md say what goes and what ages out.
