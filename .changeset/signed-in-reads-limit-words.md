---
'@bridge-ds/docs-site': patch
---

Studio, signed in: reads keep the token. An expired sign-in is renewed before a read, a 401 is renewed and read again
with the fresh token (never anonymously), and clients made before a refresh send the current token. When GitHub's
hourly limit for the account is reached, Studio says so and when it resets, never "anonymous reads" nor "Sign in".
The exploration page names its author with the display name this browser knows, the login only when none is known.
