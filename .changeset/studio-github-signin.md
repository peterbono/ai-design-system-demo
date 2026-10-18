---
"@bridge-ds/docs-site": minor
---

Sign in with GitHub in Studio. When the site has a GitHub App (GITHUB_APP_CLIENT_ID and GITHUB_APP_CLIENT_SECRET on the host, docs/SIGN-IN.md), the side nav, Settings Account and the Connect dialog lead with "Sign in with GitHub" and keep "Use a token instead" as a quiet second way for developers. The sign-in uses state and PKCE, goes through one Vercel function (api/github/token.ts) that swaps the code for a user access token and renews it when it expires, and stores nothing on the server. Expired sign-ins, cancelled consent, the wrong account, a repository the app does not reach and missing app permissions each get a sentence that says how to fix them. Without the env vars Studio keeps the token paste exactly as before.
