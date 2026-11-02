---
"@bridge-ds/docs-site": patch
---

Settings shows a team's admins how much of GitHub's hourly limit Bridge used for their team, and says calmly when it gets close. The server records the GitHub limit of each Bridge app installation from every answer (throttled writes), logs one warning per installation and hour under 20% left, and counts GitHub's slow-down answers.
