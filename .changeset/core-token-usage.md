---
'@bridge-ds/core': minor
---

Add `tokenUsage()`: one definition of a token in use. A token is in use when a component stylesheet or a global
stylesheet (base styles, app shell) reads its variable, or when a token in use aliases it. Bridge uses it for the
Overview counts and the token explorer's Unused flag.
