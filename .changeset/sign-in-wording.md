---
"@bridge-ds/docs-site": patch
---

Studio says "Sign in" everywhere when the site has Sign in with GitHub: "Sign in to send", "Sign in to start", "Sign in to propose", "Sign in to review", the rate limit and expired sign-in messages, and the token editor note. A site without a GitHub App keeps "Connect GitHub", since pasting a token is the way in there. The wording comes from one helper, `lib/gh-wording.ts`.
