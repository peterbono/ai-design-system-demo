---
"@bridge-ds/toolbar": minor
"@bridge-ds/docs-site": patch
---

The Bridge toolbar reads GitHub through Bridge's read proxy (new `proxy` prop, default production Bridge) instead of anonymous browser calls, so Before and After keep working past GitHub's 60 reads an hour per visitor. It reads GitHub directly when Bridge refuses or cannot be reached. Bridge's read proxy answers GET reads of public demo teams to the product origins their bridge.config.json names (CORS, no credentials).
