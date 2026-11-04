---
"@bridge-ds/docs-site": patch
"@bridge-ds/toolbar": patch
---

"Open the preview" of a private product's exploration reads the change again. Studio now waits a moment for the member's read pass when the preview is opened before it arrived (it used to open without it, so the toolbar could not read the change), and asks again after a refusal instead of keeping it for the life of the page. A preview built with a toolbar older than 0.8.0, which would leave the pass in the address and show an empty page, opens without it and says to bring in the latest product. The toolbar tells the product's hash router when it takes the pass out of the address, so a router that read it first shows the real screen, never an empty page.
