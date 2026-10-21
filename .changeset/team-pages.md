---
'@bridge-ds/docs-site': minor
---

Team pages for the hosted Studio (multi-team PR 3b). Home, Components, Quality and Tokens on
/studio/<owner>/<repo>/ now render in the browser from the team's repository: this browser's cache for the default
branch head first, then the team's Bridge snapshot when it was computed from that head, else a live read from GitHub.
Components lists the team's components with one Storybook preview in the drawer, or token specimens without a
Storybook. Quality shows the contrast gate, token findings, docs completeness and adoption audits from the snapshot
(or how to publish them). Tokens starts the same explorer and token editor from the team's files, with history read
through GitHub when signed in. Loading skeletons, calm empty states and errors with Try again (rate limit, repository
not found, too large to read).
