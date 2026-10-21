---
"@bridge-ds/core": minor
---

Who asked for a change: `requesterOf(body)` reads the line Bridge writes in a pull request or suggestion body ("Requested by Ann Leroy (@annleroy).", "Requested by Ann Leroy.", "Requested by @ann.", and the request footer "Requested from Figma by @ann with Bridge."), and `requesterLine()` writes it. Studio shows that person, not the account or agent that opened the branch. New optional config key `demo: { "viewer": "Dana", "role": "DS lead" }`: a public demo's persona, honoured by Bridge's own demo repositories only, for visitors without an account. It's in the schema, validated, and carried in `SiteRepo.demo`.
