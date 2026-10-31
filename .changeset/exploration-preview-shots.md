---
'@bridge-ds/docs-site': patch
---

Explorations show a real screenshot of their preview on their page, on the Studio home cards and in the Changes rows,
with "Captured 2 h ago" where it fits. A new workflow (Preview shots) captures the preview of every open exploration,
in this repository and in each public product repository, into the `bridge-shots` branch; Studio reads it without
GitHub API calls and keeps the plate when there is none. The plate now picks a different Field Guide drawing per
exploration, the home cards line up their tag, product and person, and the exploration page ends both columns on one
line (the activity moves under the preview after Done exploring).
