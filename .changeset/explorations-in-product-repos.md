---
"@bridge-ds/core": patch
"@bridge-ds/mcp": patch
"@bridge-ds/cli": patch
"@bridge-ds/docs-site": patch
---

Explorations created in a product's own repository (`products[].repo`) are no longer invisible after creation. Studio (Changes, home, Being built), `bridge explore list` and `bridge_list_explorations` read each product repository once (through the GitHub sign-in or Bridge's read proxy) and list its explorations under their product; a repository Bridge cannot read is skipped silently in lists and shown as not connected in Settings, `bridge products` and `bridge_list_products`. They open at `changes/?exploration=<n>&product=<key>` and are named `shop#12` by the CLI and Claude. Missing pieces, Done exploring, Archive and the developer section run against the product pull request; the requests from ticked pieces are filed in the design system repository with a link back (`owner/name#12`) and the product preview. Status follows the product pull request. New in core: `listProductExplorationsOnGitHub`, `parseExplorationRef`, `explorationRefLabel`, `productRepos`, `productOfRepo`, and a `library` client option on `doneExploringOnGitHub`, `proposePiecesOnGitHub`, `openLibraryBranchOnGitHub` and `productBranchViewOnGitHub`.
