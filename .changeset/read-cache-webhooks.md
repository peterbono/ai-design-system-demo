---
"@bridge-ds/docs-site": patch
---

Team reads through Bridge follow GitHub's webhooks: `/api/github-webhook` (signed with `GITHUB_WEBHOOK_SECRET`, each delivery done once) marks only the changed topic of a repository (code, pulls, issues, checks, deployments, releases) to be checked again, and while deliveries arrive cached answers stay fresh 10 minutes instead of 30 seconds, falling back to 30 seconds on their own when the webhook goes quiet. GitHub calls now grow with activity, not with viewers.
