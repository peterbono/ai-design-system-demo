---
'@bridge-ds/docs-site': patch
---

The exploration page puts "Try it in the product" back next to "Open the preview": it opens the exploration's preview
with the Bridge toolbar, so Live product and This change flip on the same screen. It shows for a product whose
production Bridge knows (`products[].production`, or `previews.production` for the Admin demo), in the design system
repository or in the product's own. "Open the preview" now opens the preview as it is, without the toolbar. "See the
product today" uses the product's own `production` URL when it has one.
