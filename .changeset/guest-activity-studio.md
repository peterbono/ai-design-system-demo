---
'@bridge-ds/docs-site': patch
---

Hosted Studio for guests: signed out, a team's pages read its published `activity.json` (no GitHub API request), with "Updated 5 min ago" in the guest banner. History works for guests. What the activity did not record is read live, and a read GitHub refuses for the hourly limit falls back to it. Without it, identical anonymous reads go out once and are reused for two minutes in the tab. Every Branches row gets its status when the activity covers it, and the list never ends on an older paint.
