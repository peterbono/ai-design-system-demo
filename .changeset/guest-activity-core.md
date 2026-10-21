---
'@bridge-ds/core': minor
---

Repo activity (`activity.json`): `collectActivity` reads a team's open branches and their pages, open suggestions with their parsed payload, component requests, recent merges and token history from GitHub, and records the GitHub reads a signed-out Studio visitor makes, trimmed (`trimGitHub`, `activityShaper`). `activityAnswer` serves them back by path, `parseActivity` validates the file, `fitActivity` keeps it under 3 MB. While the default branch has not moved, the token history and every untouched branch page are kept from the last activity. History read without a token now takes file bodies from the raw host, which costs no API request.
