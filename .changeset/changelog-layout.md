---
"@bridge-ds/docs-site": patch
---

Library Changelog shows the real releases. Published versions come from each package's CHANGELOG.md, grouped into one release per publish with its date from the release tags (v1.1.0 on Oct 18, 2026, v1.0.0 on Oct 17, 2026) and the package versions it shipped; the pending entries show as "Coming in the next release". The page said "no release tagged yet" because the release tags sit on merge commits, which the commit list skipped. Each row puts the kind badge on the left and the title at full width, with one line under it and a small meta line (bump, then package tags or "5 packages" that opens the list). Long releases show their first changes and fold the rest; internal changes are folded; sources, GitHub releases, npm links and the pending files sit in For developers.
