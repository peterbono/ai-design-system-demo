---
"@bridge-ds/core": patch
"@bridge-ds/mcp": patch
---

A hosting platform that refused to run (Vercel "Deployment rate limited") no longer counts as a failed check, and a failed check no longer stops "where is my push" polling: a re-run can still ship it.
