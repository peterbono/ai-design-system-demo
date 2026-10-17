---
"@bridge-ds/figma-plugin": minor
---

Push to an exploration, and a calmer Push screen. The destination is the main decision at the top of the Changes: a
segmented control "Send for review" | "Try in an exploration". An exploration is picked among the running ones (or
started with a name and a purpose); its variable edits become one commit on `explore/<slug>` (no new pull request to
main, earlier exploration commits kept) and component changes become requests labeled `exploration`. Items marked
"Exploration only" (the experimental mark, renamed in the row menu with a line that says what it does) start checked
for an exploration and unchecked for review. The result screen shows the exploration's previews and the snapshot
install command. The bar's primary action follows the choice ("Send for review" / "Send to exploration") and steps
aside while a request form is open. Component rows read once: the sentence, then value chips for concrete changes
only (the Details table is gone). "Description" becomes "Message to the team", its own section. The Requests section
is replaced by one quiet line at the bottom, also on the idle screen: "Something the scan cannot see? Request a
component change".
