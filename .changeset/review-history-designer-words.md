---
"@bridge-ds/docs-site": patch
---

Studio review and history in designer words, with one source for every count. The review queue
(`reviewQueue` in lib/review-queue.ts) leaves out running explorations and release automation (the changesets
"Version packages" pull request on changeset-release/*, opened by github-actions[bot]); the Overview hero, the
nav badge and the In review tab all count it. In review rows say what approval a change needs in plain words
("Design + tech", "One approval", no color), with the same rule as the detail (label or computed from the changed
files, highest wins, read with the status), and a conflict now blocks before approvals in the list as in the
detail, with "Checking" until GitHub knows whether a change merges cleanly. "Other branches" becomes a link to
GitHub inside one "For developers" fold. The change detail says Ship instead of Merge; the owner override and
Close move into a More menu (DS Menu) with the override rule in one sentence; Conversation shows the count, the
last word and "Open on GitHub". The Overview hero reads "3 changes wait for design approval. 1 is blocked on the
developer side." with one GitHub link instead of an "Unblock" card, Activity folds Bridge app updates into one
labelled row, and an Adoption tile links to Quality (from the audit reports). History opens on a "Next release"
card built from the release pull request (changes counted, version bumps in plain words, the action for whoever
holds the ship right), rows read human summaries, and the demo history switch is development only.
