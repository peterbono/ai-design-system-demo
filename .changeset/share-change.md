---
"@bridge-ds/docs-site": minor
---

Share with a product team. A change in Studio gets a secondary action next to "Try it in the product" that opens a dialog with a ready-to-paste message for a developer of a product team: the change title, the preview install command the Preview packages workflow posted for the latest update (read from its comment, never guessed), the "Try it in the product" link when there is one, how long the preview lasts and how to go back to the stable version. Copy message, or Open in email (a mailto link, nothing is sent). While the preview of the latest update is being prepared, when it failed, or when the change touches no library package, the dialog says so instead of showing a command. After the change ships or closes it says whether the preview still installs: the prerelease tarballs this repository uses are removed then, pkg.pr.new snapshots stay.
