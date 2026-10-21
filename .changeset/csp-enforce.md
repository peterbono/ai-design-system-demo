---
'@bridge-ds/docs-site': patch
---

The Content-Security-Policy is enforced (`Content-Security-Policy` instead of `Content-Security-Policy-Report-Only`). Violations are still reported to `/api/csp-report`. The site has its own not-found page, replacing Vercel's platform 404 page, whose inline scripts the policy blocks.
