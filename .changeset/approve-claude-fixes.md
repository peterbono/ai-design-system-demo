---
"@bridge-ds/figma-plugin": minor
"@bridge-ds/docs-site": minor
---

Leads approve Claude's fixes from the Figma plugin. In "Claude's fixes", a lead (a repository admin, a design approver who can write, or an email Admin through Studio) sees "Approve all N" and "Approve" on each ready row; one click approves and runs Check for updates, so the fixes come into the file. Everyone else reads "Waiting for approval". The Bridge site checks each fix again with its GitHub App (figma-fixes.json only, `bridge fixes check`, nothing changed underneath, no failing check) and lands them in one push: one merge for one fix, one merge commit holding their union for several, so GitHub marks each pull request merged. A fix Bridge refuses says why on its row.
