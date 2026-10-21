---
"@bridge-ds/docs-site": patch
---

Studio team chip, Recent teams: a team joins the list only after its page read the repository (public, read, write, admin or outside contributor), never because someone typed it in the launcher or the Create a new team dialog, and a team GitHub answers 404 for leaves it. Placeholders such as owner/repo or owner/design and invalid names are cleaned out of the stored list when it is read. Each entry now has a "Remove from recent teams" action, a sibling menu item on the same row, reachable with the arrow keys, that updates the list in place.
