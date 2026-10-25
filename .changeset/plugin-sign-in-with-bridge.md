---
'@bridge-ds/figma-plugin': minor
'@bridge-ds/docs-site': minor
---

Sign in with Bridge in the Figma plugin. Designers connect with the Bridge account they already use: the plugin opens Studio with a one-time code (`/studio/connect-figma/`), they pick their team, and the plugin receives the team's repository and the GitHub sign-in Studio holds, with no token to paste and no secret on screen. The new `POST /api/plugin-link` keeps codes in Redis for 5 minutes, single use, and checks with GitHub that the sign-in can open the chosen team's repository. When the sign-in expires, the plugin says "Sign in again". A pasted token stays available under "For developers: connect with a token".
