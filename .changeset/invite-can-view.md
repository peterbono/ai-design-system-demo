---
"@bridge-ds/docs-site": patch
---

Can view is back in the invite role picker, first as on the board: "Sees everything in Studio and the library." A Can view invitee joins the team with their email (no GitHub account), is listed in Members as Can view, and gets the read-only Studio (the team chip and account say Can view, the home asks "What do you want to look at?", write actions are not shown). Every write path refuses them on the server: the contribute proxy (branches, commits, pull requests, issues, reviews), library updates, shipping, and the connector's edit actions (team-caller `need: 'edit'`). Admins move an email member to and from Can view; the invite email names the role and says no GitHub account is needed.
