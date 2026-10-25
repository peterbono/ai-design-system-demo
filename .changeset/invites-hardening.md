---
'@bridge-ds/docs-site': minor
---

Invites, hardened. Only the invited person can accept: the GitHub account must have the invited email, verified (the GitHub Apps need the account permission "Email addresses: Read-only"; people signed in before sign in again). Otherwise nothing is granted, the invite stays valid, and the invite page says which address it was sent to, masked ("m•••@acme.design"), and how to fix it. Daily caps per admin (20), per team (40) and for the whole site (80), overridable with INVITES_MAX_PER_ADMIN_DAY, INVITES_MAX_PER_TEAM_DAY and INVITES_MAX_SITE_DAY, plus a 10 minute pause and 3 resends a day per invite: over a cap the server answers 429 and Studio says "You reached today's invite limit. Try again tomorrow." Each invite record now expires in Redis with the invite and is deleted on accept and cancel.
