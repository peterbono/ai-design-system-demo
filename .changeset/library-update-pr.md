---
"@bridge-ds/docs-site": minor
---

Products get library updates through Bridge. A product page says which library version the product uses and the latest one ("Art print shop uses the library from 1.8.3. The latest is 1.8.4."). A lead or an admin sends the update to the developers: Bridge opens one "Update the Bridge library" pull request in the product's own repository (package.json and package-lock.json only, the lockfile patched only when the dependency tree is unchanged, never merged), and updates it in place when a newer version lands.
