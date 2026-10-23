---
'@bridge-ds/core': minor
---

Figma plugin Settings: a token that can read the repository but not write to it is refused before it is saved, naming what is missing ("Contents", "Pull requests", "Issues"), instead of showing "Connected" and failing at Send. New GitHubClient.writeAccess(base) probes the three permissions with requests that are invalid on purpose, so nothing is written.
