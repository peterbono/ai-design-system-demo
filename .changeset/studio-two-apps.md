---
'@bridge-ds/docs-site': minor
---

Studio signs in through two GitHub Apps: "Bridge" (read only on code, Issues write) by default, and "Bridge Direct"
when bridge.config.json has `"changes": "direct"`. The token function picks the app from an allow-list of the two
configured client IDs, tokens are stored per app, and a sign-in made with the other app is removed with a prompt to
sign in again. Sites with one app keep signing in as before.
