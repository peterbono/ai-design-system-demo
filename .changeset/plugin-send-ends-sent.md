---
'@bridge-ds/figma-plugin': patch
---

Send for review ends on "Sent for review" with "See it in Studio". Before, when Bridge could not ship a token change by itself, the headline turned into "Waiting for a developer" a few seconds after a successful send. Now the ship status stays on the token's own row, in calm words ("a developer adds it to the library"), and never replaces the headline. New flow tests run the real plugin UI in jsdom, with stand-ins for Figma and GitHub.
