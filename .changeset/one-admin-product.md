---
"@bridge-ds/docs-site": patch
"@bridge-ds/mcp": patch
---

One admin product: Bridge's config lists Product admin (its own repository, peterbono/bridge-product-admin) and the library only. The Admin demo (apps/admin) stays in this repository as the migration demo and the visual check's app, but is no longer a target of Start an exploration, Home, Changes or Being built; an old exploration labeled "product: admin" lands on the library instead of failing. Studio and Try it in the product pick a product's preview app by its key from bridge.config.json, no longer by a fixed "admin".
