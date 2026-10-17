---
"@bridge-ds/docs-site": patch
---

Studio review, designer first. A pull request now answers three things at first glance: who acts now ("Waiting for
the design owner (@x) to approve.", "Your turn: approve the design."), who approved on the design and tech side (one
row per approval the tier needs, with a check or an empty circle and the action on the row of the role you hold),
and what it looks like (the biggest before/after from the visual impact, "N screens changed" with a link to all, a
quiet line while it is prepared or "No visual change", then the token diff). Files, checks, changeset and previews
move under one collapsed "For developers". In review rows and the Overview Activity rows say who acts now, and the
Overview greeting lists the changes waiting for you. One pure, tested rule set (`whoActs`, `approvalRows` in
lib/changes.ts) drives all three.
