---
"@bridge-ds/docs-site": patch
---

Studio right after sign-in: a team page waits for your sign-in before saying who you are, so an admin sees "Checking" and then "Admin", never "Guest", the read-only banner or a short members list. On the hosted site, /studio/ takes a member of the team it shows to the same page of their team, so the role and what waits on them match. Visitors who are not signed in no longer see the members list or "Make my copy", and their pages stop asking for things that need a sign-in.
