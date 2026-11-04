---
"@bridge-ds/docs-site": patch
---

Add a product: the GitHub step never opens GitHub's "Where do you want to install?" while the team's account is known. When Bridge finds no installation for the team, or GitHub did not answer, Find it on GitHub opens the app's install page for the team's account (its GitHub id, read from the library and kept in this browser), so the admin lands on that account's product list and Save. The team's installation is also found under an old name of its account or library (lib/team-path renames), and by the account's id. A failed read no longer sticks for the rest of the page: the empty step says Bridge could not get the products from GitHub, with Try again, and reopening the dialog reads again. An empty list says why (Bridge sees none yet, or every product it sees is already in the team). The owners' line now arrives with the step instead of a moment later. "It's a new product" says a missing name on the name field itself and puts the focus there.
